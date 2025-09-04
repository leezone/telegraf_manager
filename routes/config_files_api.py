# -*- coding: utf-8 -*-
"""
配置文件管理 API 蓝图
"""

import os
import tempfile
import subprocess
import tomli
import re
from flask import Blueprint, request, jsonify
import logging
import psutil
from flask_login import login_required

from models import db, ConfigFile, TelegrafProcess, DirectorySetting, ConfigSnippet, PointInfo
from config_manager import config_version_service
from api_utils import handle_api_error, success_response, error_response, add_audit_log

logger = logging.getLogger(__name__)

config_files_api_bp = Blueprint('config_files_api', __name__, url_prefix='/api')

def _split_toml_snippets(toml_string: str) -> list[dict]:
    """
    Splits a TOML string into snippets based on top-level or second-level [section] headers.
    This groups child tables (level 3+) with their parent.
    """
    snippets = []
    current_lines = []
    current_header = None

    for line in toml_string.splitlines():
        stripped = line.strip()
        if stripped.startswith('[') and stripped.endswith(']'):
            section_name = stripped.strip('[]')
            level = len(section_name.split('.'))

            # Split only on level 1 (e.g., [agent]) or level 2 (e.g., [[inputs.cpu]]) headers.
            # Child tables (level 3+) will be kept with their parent snippet.
            is_main_header = False
            if stripped.startswith('[['): # Array of Tables
                if level <= 2:
                    is_main_header = True
            else: # Table
                if level <= 1:
                    is_main_header = True

            if is_main_header:
                if current_header:
                    snippets.append({
                        "header": current_header,
                        "content": "\n".join(current_lines).strip()
                    })
                current_header = stripped
                current_lines = [line]
            elif current_header is not None:
                current_lines.append(line)
        elif current_header is not None:
            current_lines.append(line)
    
    if current_header:
        snippets.append({
            "header": current_header,
            "content": "\n".join(current_lines).strip()
        })
        
    return snippets


@config_files_api_bp.route('/config_files', methods=['GET', 'POST'])
@login_required
@handle_api_error
def get_config_files():
    """获取所有当前激活的配置文件列表，支持DataTables服务器端处理"""
    if request.method == 'POST':
        params = request.form
    else:
        params = request.args

    draw = params.get('draw', 1, type=int)
    start = params.get('start', 0, type=int)
    length = params.get('length', 10, type=int)
    search_value = params.get('search[value]', '').strip()
    order_column_index = params.get('order[0][column]', 0, type=int)
    order_dir = params.get('order[0][dir]', 'asc').strip()

    columns = ['file_name', 'version', 'created_at', 'sync_status', 'running_status', None]
    order_column_name = columns[order_column_index] if 0 <= order_column_index < len(columns) else 'file_name'

    base_query = ConfigFile.query.filter_by(is_active=True)
    total_records = base_query.count()

    if search_value:
        search_term = f"%{search_value}%%"
        base_query = base_query.filter(db.or_(
            ConfigFile.file_name.ilike(search_term),
            ConfigFile.change_description.ilike(search_term)
        ))
    
    records_filtered = base_query.count()

    if order_column_name in ['file_name', 'version', 'created_at']:
        order_column = getattr(ConfigFile, order_column_name)
        if order_dir == 'desc':
            base_query = base_query.order_by(order_column.desc())
        else:
            base_query = base_query.order_by(order_column.asc())
    else:
        base_query = base_query.order_by(ConfigFile.created_at.desc())
    
    paginated_configs = base_query.offset(start).limit(length).all()

    # Get all running telegraf processes from psutil
    all_running_procs = []
    for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
        try:
            if 'telegraf' in proc.info['name'].lower():
                all_running_procs.append(proc.info)
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue

    # Create a map from config file name to running process info
    config_filename_to_proc = {}
    for proc_info in all_running_procs:
        cmdline = proc_info.get('cmdline', [])
        if cmdline:
            for i, arg in enumerate(cmdline):
                if arg == '--config' and i + 1 < len(cmdline):
                    config_path = cmdline[i + 1]
                    config_filename = os.path.basename(config_path)
                    config_filename_to_proc[config_filename] = proc_info
                    break

    data = []
    for config in paginated_configs:
        config_dict = config.to_dict()
        
        running_proc_info = config_filename_to_proc.get(config.file_name)
        is_running = running_proc_info is not None
        
        managed_process_record = TelegrafProcess.query.filter_by(config_file_id=config.id).first()

        config_dict['running_status'] = {
            'is_running': is_running,
            'managed_by': 'system' if managed_process_record and managed_process_record.status == 'running' else ('unmanaged' if is_running else 'none')
        }

        if config.data_points_synced:
            config_dict['sync_status'] = '已同步'
        else:
            point_count = PointInfo.query.filter_by(config_file_id=config.id).count()
            config_dict['sync_status'] = '部分同步' if point_count > 0 else '未同步'

        data.append(config_dict)

    return jsonify({
        "draw": draw,
        "recordsTotal": total_records,
        "recordsFiltered": records_filtered,
        "data": data
    })

@config_files_api_bp.route('/config_files/create', methods=['POST'])
@login_required
@handle_api_error
def create_config_file():
    """创建一个新的配置文件"""
    logger.info(f"Received request to create config file. JSON data: {request.json}")

    data = request.get_json()
    if not data or 'name' not in data or 'content' not in data:
        logger.warning(f"Missing name or content in request data: {data}")
        return error_response('缺少 name 或 content 字段', 400)

    change_type = data.get('change_type', 'manual')
    is_from_wizard = (change_type == 'wizard')

    try:
        result = config_version_service.check_and_create_new_version(
            file_name=data['name'],
            current_content=data['content'],
            change_type=change_type,
            change_description=data.get('change_description', '手动创建'),
            data_points_synced=is_from_wizard
        )
        
        add_audit_log('config_create', 'success', f"创建了配置文件 '{data['name']}'")
        return success_response("Config file created successfully", result, 201)
    except Exception as e:
        # Log the detailed error for debugging purposes
        logger.exception(f"Error creating config file: {data.get('name')}")
        return error_response(f"创建配置文件时发生内部错误: {str(e)}", 500)

@config_files_api_bp.route('/config_files/<int:id>', methods=['GET'])
@login_required
@handle_api_error
def get_config_file_detail(id):
    """获取单个配置文件的详细信息"""
    config = ConfigFile.query.get_or_404(id)
    config_dict = config.to_dict()

    # Determine sync status
    if config.data_points_synced:
        config_dict['sync_status'] = '已同步'
    else:
        point_count = PointInfo.query.filter_by(config_file_id=config.id).count()
        if point_count > 0:
            config_dict['sync_status'] = '部分同步'
        else:
            config_dict['sync_status'] = '未同步'

    # Get linked points for the new tab
    linked_points = PointInfo.query.filter_by(config_file_id=id).order_by(PointInfo.measurement).all()
    config_dict['linked_points'] = [p.to_dict() for p in linked_points]

    return success_response("Config file retrieved successfully", config_dict)

@config_files_api_bp.route('/config_files/<int:id>', methods=['PUT'])
@login_required
@handle_api_error
def update_config_file(id):
    """更新一个配置文件（如果名称或内容有变，则创建新版本）"""
    config_to_update = ConfigFile.query.get_or_404(id)
    if config_to_update.is_locked:
        return error_response('无法更新锁定的配置文件', 403)

    data = request.get_json()
    if not data or 'name' not in data or 'content' not in data:
        return error_response('缺少 name 或 content 字段', 400)

    old_name = config_to_update.file_name
    new_name = data['name']
    new_content = data['content']

    # Step 1: Handle rename if necessary
    if old_name != new_name:
        # Check if the new name already exists for another configuration
        if ConfigFile.query.filter(ConfigFile.file_name == new_name).first():
            return error_response(f"文件名 '{new_name}' 已存在，请使用其他名称。", 409)
        
        # Update all versions of the old file name to the new file name
        versions_to_rename = ConfigFile.query.filter_by(file_name=old_name).all()
        for version in versions_to_rename:
            version.file_name = new_name
        db.session.commit() # Commit the rename first

    # Step 2: Handle content change (creates a new version if content is different)
    result = config_version_service.check_and_create_new_version(
        file_name=new_name, # Use the new name
        current_content=new_content,
        change_type='manual',
        change_description='手动更新'
    )
    
    add_audit_log('config_update', 'success', f"更新了配置文件 '{new_name}' (ID: {id})")
    return success_response("Config file updated successfully", result.get('config'))

@config_files_api_bp.route('/config_files/<int:id>', methods=['DELETE'])
@login_required
@handle_api_error
def delete_config_file(id):
    """删除一个配置文件及其所有历史版本，并解除数据点关联"""
    config = ConfigFile.query.get_or_404(id)
    if config.is_locked:
        return error_response('无法删除锁定的配置文件', 403)

    file_name = config.file_name
    
    process = TelegrafProcess.query.filter_by(config_file_id=id).first()
    if process and process.status == 'running':
        return error_response('无法删除，该配置对应的进程正在运行', 409)

    # Find all versions of this config to get all associated points
    versions_to_delete = ConfigFile.query.filter_by(file_name=file_name).all()
    version_ids = [v.id for v in versions_to_delete]

    # Find and update all associated PointInfo records
    if version_ids:
        associated_points = PointInfo.query.filter(PointInfo.config_file_id.in_(version_ids)).all()
        if associated_points:
            for point in associated_points:
                point.config_file_id = None
                point.is_locked = False
            # Commit the unlinking and unlocking first
            db.session.commit()
            unlink_count = len(associated_points)
        else:
            unlink_count = 0
    else:
        unlink_count = 0

    # Now, delete the config file and its versions
    config_version_service.delete_config(id)
    
    add_audit_log('config_delete', 'success', f"删除了配置文件 '{file_name}' (ID: {id}) 及其所有版本，并解除了 {unlink_count} 个数据点位的关联")
    return success_response(f'配置文件 {file_name} 已被删除')


def _parse_influx_line(line: str) -> dict | None:
    """解析单行 InfluxDB 行协议数据，使用正则表达式以提高稳健性"""
    # 最终的正则表达式，它将行分割成三个部分：
    # 1. measurement和tags （第一个空格前的所有内容）
    # 2. fields （第一个空格和最后一个空格之间的所有内容）
    # 3. timestamp （最后一个空格后的所有内容）
    line_protocol_regex = re.compile(r'^(\S+) (.*) (\d+)$')
    
    match = line_protocol_regex.match(line.strip())
    if not match:
        return None

    try:
        measurement_tags, fields_str, timestamp_str = match.groups()

        # 解析 Measurement 和 Tags
        parts = measurement_tags.split(',', 1)
        measurement = parts[0]
        tags = {}
        if len(parts) > 1:
            tag_pairs = parts[1].split(',')
            for pair in tag_pairs:
                if '=' in pair:
                    key, value = pair.split('=', 1)
                    tags[key] = value

        # 解析 Fields
        fields = {}
        # 这个正则表达式可以更好地处理带引号的字符串
        field_pairs = re.findall(r'([\w.-]+)=((?:"[^"]*")|[^,]+)', fields_str)
        for key, value in field_pairs:
            # 尝试将值转换为数字
            if value.endswith('i') and not value.startswith('"'):
                try:
                    fields[key] = int(value[:-1])
                except ValueError:
                    fields[key] = value # fallback to string
            elif not value.startswith('"'):
                try:
                    fields[key] = float(value)
                except ValueError:
                    fields[key] = value # fallback to string
            else:
                # 如果是带引号的字符串，则去掉引号
                fields[key] = value.strip('"')

        timestamp = int(timestamp_str)
        # 将纳秒时间戳转换为毫秒时间戳，以便于前端处理
        timestamp_ms = timestamp // 1000000
        
        return {
            "measurement": measurement,
            "tags": tags,
            "fields": fields,
            "timestamp": timestamp_ms
        }
    except Exception as e:
        # 如果行格式不正确，则忽略
        logger.warning(f"Failed to parse line '{line.strip()}': {e}")
        return None

@config_files_api_bp.route('/config_files/<int:id>/snapshot', methods=['POST'])
@login_required
@handle_api_error
def get_data_snapshot(id):
    """获取指定配置文件的单次运行数据快照"""
    config = ConfigFile.query.get_or_404(id)
    
    tmp_config_file = None
    tmp_output_file = None

    try:
        # 创建临时输出文件
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.txt') as tmp_out:
            tmp_output_file = tmp_out.name

        # 创建临时配置文件，并添加 file output
        file_output_config = f'\n[[outputs.file]]\n  files = ["{tmp_output_file}"]\n  data_format = "influx"\n'
        modified_content = config.content + file_output_config

        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.conf') as tmp_conf:
            tmp_config_file = tmp_conf.name
            tmp_conf.write(modified_content)

        # 运行 telegraf --once 以确保采集到周期性数据
        result = subprocess.run(
            ['telegraf', '--once', '--config', tmp_config_file],
            capture_output=True, text=True, timeout=60
        )

        if result.returncode != 0:
            error_lines = result.stderr.splitlines()
            primary_error = next((line for line in error_lines if line.startswith('E! ')), "未知 Telegraf 错误")
            # 返回结构化错误，而不是抛出异常
            return error_response(
                "生成快照失败", 
                details={
                    "summary": primary_error,
                    "full_log": result.stderr
                },
                status_code=400 # 使用 400 表示这是一个客户端（配置）错误
            )

        # 读取并解析输出文件
        with open(tmp_output_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        parsed_data = [_parse_influx_line(line) for line in lines if line.strip()]
        # 过滤掉解析失败的行 (返回 None 的) 
        parsed_data = [item for item in parsed_data if item is not None]

        return success_response("Data snapshot generated successfully", {"metrics": parsed_data})

    finally:
        # 清理临时文件
        if tmp_config_file and os.path.exists(tmp_config_file):
            os.remove(tmp_config_file)
        if tmp_output_file and os.path.exists(tmp_output_file):
            os.remove(tmp_output_file)

@config_files_api_bp.route('/config_files/<int:id>/toggle_lock', methods=['POST'])
@login_required
@handle_api_error
def toggle_lock_config_file(id):
    """切换配置文件的锁定状态"""
    config = ConfigFile.query.get_or_404(id)
    
    # Toggle lock for all versions of this file
    versions_to_toggle = ConfigFile.query.filter_by(file_name=config.file_name).all()
    new_lock_state = not config.is_locked

    for version in versions_to_toggle:
        version.is_locked = new_lock_state
    
    db.session.commit()
    
    action = '锁定' if new_lock_state else '解锁'
    add_audit_log('config_lock_toggle', 'success', f"{action}了配置文件 '{config.file_name}'")
    return success_response(f"成功{action}了配置文件 '{config.file_name}' 的所有版本", {'is_locked': new_lock_state})

@config_files_api_bp.route('/config_files/<int:id>/parse_and_preview', methods=['POST'])
@login_required
@handle_api_error
def parse_and_preview(id):
    config_file = ConfigFile.query.get_or_404(id)
    
    ConfigSnippet.query.filter_by(config_file_id=id).delete()
    db.session.commit()
    
    raw_snippets = _split_toml_snippets(config_file.content)
    new_snippet_objects = []
    point_previews = []

    for raw_snippet in raw_snippets:
        header = raw_snippet['header']
        content = raw_snippet['content']
        
        section_name = header.strip().strip('[]')
        parts = section_name.split('.')
        snippet_type = parts[0] if parts else 'unknown'
        plugin_name = '.'.join(parts[1:]) if len(parts) > 1 else None

        snippet = ConfigSnippet(
            config_file_id=id,
            snippet_type=snippet_type,
            plugin_name=plugin_name,
            content=content,
            is_active=True
        )
        new_snippet_objects.append(snippet)
        db.session.add(snippet)

        if snippet_type == 'inputs' and plugin_name == 'opcua':
            try:
                parsed_content = tomli.loads(content)
                opcua_instances = parsed_content.get('inputs', {}).get('opcua', [])
                for instance in opcua_instances:
                    if 'group' in instance:
                        for group in instance.get('group', []):
                            measurement = group.get('name', f'opcua_{instance.get("name", "default")}')
                            if 'nodes' in group:
                                for node in group.get('nodes', []):
                                    point_previews.append({
                                        'measurement': measurement,
                                        'original_point_name': node.get('identifier'),
                                        'normalized_point_name': node.get('name'),
                                        'point_comment': f"从 {config_file.file_name} 解析",
                                        'tags': '{"":""}', 
                                        'fields': '{"":""}', 
                                        'data_source': 'parsed',
                                        'is_locked': True
                                    })
            except tomli.TOMLDecodeError:
                continue

    db.session.commit()
    snippets_as_dicts = [s.to_dict() for s in new_snippet_objects]

    return success_response("文件解析成功", {
        "snippets": snippets_as_dicts,
        "point_previews": point_previews
    })


@config_files_api_bp.route('/config_files/<int:id>/import_points', methods=['POST'])
@login_required
@handle_api_error
def import_points(id):
    data = request.get_json()
    points_to_import = data.get('points')

    if not points_to_import:
        return error_response("没有提供需要导入的数据点", 400)

    config_file = ConfigFile.query.get_or_404(id)
    
    imported_count = 0
    for point_data in points_to_import:
        new_point = PointInfo(
            config_file_id=id,
            measurement=point_data.get('measurement'),
            original_point_name=point_data.get('original_point_name'),
            normalized_point_name=point_data.get('normalized_point_name'),
            point_comment=point_data.get('point_comment'),
            tags=point_data.get('tags', '{"":""}'),
            fields=point_data.get('fields', '{"":""}'),
            data_source='parsed',
            is_locked=True,
            is_enabled=True
        )
        db.session.add(new_point)
        imported_count += 1

    # Mark the config file as synced
    config_file.data_points_synced = True
    db.session.commit()

    add_audit_log('points_import', 'success', f"从 '{config_file.file_name}' 导入了 {imported_count} 个数据点")
    return success_response(f"成功导入 {imported_count} 个数据点。", {'imported_count': imported_count})

@config_files_api_bp.route('/config_files/<path:file_name>/versions', methods=['GET'])
@login_required
@handle_api_error
def get_config_version_history(file_name):
    """获取指定文件名的版本历史"""
    versions = config_version_service.get_config_version_history(file_name)
    return success_response("Version history retrieved successfully", {'versions': versions})

@config_files_api_bp.route('/config_files/<int:id>/activate', methods=['POST'])
@login_required
@handle_api_error
def activate_config_version(id):
    """激活一个指定的历史版本"""
    config_version_service.activate_version(id)
    config = ConfigFile.query.get(id)
    add_audit_log('config_activate', 'success', f"激活了配置文件 '{config.file_name}' 的版本 v{config.version}")
    return success_response('版本激活成功')

@config_files_api_bp.route('/config_files/directory_settings', methods=['GET', 'POST'])
@login_required
@handle_api_error
def manage_directory_settings():
    """获取或更新目录设置"""
    if request.method == 'GET':
        setting = DirectorySetting.query.first()
        if setting:
            return success_response("Settings retrieved successfully", setting.to_dict())
        else:
            # Return default values if no settings are saved yet
            return success_response("Default settings returned", {
                'directory_path': '/etc/telegraf/telegraf.d',
                'file_filter': '.conf'
            })

    elif request.method == 'POST':
        data = request.get_json()
        if not data or 'directory_path' not in data:
            return error_response('Missing directory_path', 400)

        setting = DirectorySetting.query.first()
        if not setting:
            setting = DirectorySetting()
            db.session.add(setting)
        
        setting.directory_path = data['directory_path']
        setting.file_filter = data.get('file_filter', '.conf')
        db.session.commit()
        
        add_audit_log('directory_settings_update', 'success', f"Updated directory settings to {setting.directory_path}")
        return success_response("Settings updated successfully", setting.to_dict())

@config_files_api_bp.route('/config_files/list_directory', methods=['POST'])
@login_required
@handle_api_error
def list_directory_files():
    """列出指定目录中的文件"""
    data = request.get_json()
    directory_path = data.get('directory_path')
    file_filter = data.get('file_filter', '.conf')
    if not directory_path:
        return error_response('Directory path is required', 400)
    
    try:
        files = config_version_service.list_files_in_directory(directory_path, file_filter)
        return success_response("Files listed successfully", {"files": files})
    except ValueError as e:
        return error_response(str(e), 404)

@config_files_api_bp.route('/config_files/import_from_directory', methods=['POST'])
@login_required
@handle_api_error
def import_from_directory():
    """从目录导入单个文件"""
    data = request.get_json()
    file_path = data.get('file_path')
    force_overwrite = data.get('force_overwrite', False)
    if not file_path:
        return error_response('File path is required', 400)
    
    result = config_version_service.import_from_path(file_path, force_overwrite)
    return success_response("Import successful", result)

@config_files_api_bp.route('/config_files/import_all_from_directory', methods=['POST'])
@login_required
@handle_api_error
def import_all_from_directory():
    """从目录批量导入所有文件"""
    data = request.get_json()
    directory_path = data.get('directory_path')
    file_filter = data.get('file_filter', '.conf')
    force_overwrite = data.get('force_overwrite', False)
    if not directory_path:
        return error_response('Directory path is required', 400)

    result = config_version_service.import_all_from_directory(directory_path, file_filter, force_overwrite)
    return success_response("Batch import finished", result)

@config_files_api_bp.route('/config_files/preview_file', methods=['POST'])
@login_required
@handle_api_error
def preview_file():
    """预览指定路径的文件内容"""
    data = request.get_json()
    file_path = data.get('file_path')
    if not file_path:
        return error_response('File path is required', 400)

    # Basic security check to prevent traversing up the directory tree
    if '..' in file_path:
        return error_response('Invalid file path', 400)

    try:
        if not os.path.exists(file_path) or not os.path.isfile(file_path):
            return error_response('File not found', 404)
        
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        return success_response("File content retrieved successfully", {'content': content})
    except Exception as e:
        return error_response(f"Failed to read file: {str(e)}", 500)