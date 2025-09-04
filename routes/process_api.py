# -*- coding: utf-8 -*-
"""
进程管理 API 蓝图
"""

from flask import Blueprint, request, jsonify
from flask_login import login_required
import logging
import os
from datetime import datetime, timezone
import psutil
import json
import glob

from api_utils import handle_api_error, success_response, error_response, add_audit_log, get_pagination_params
from process_manager import restart_process, stop_process, start_process, CONFIG_DIR, LOG_DIR
from models import db, TelegrafProcess, ConfigFile

logger = logging.getLogger(__name__)

process_api_bp = Blueprint('process_api', __name__, url_prefix='/api/processes')

@process_api_bp.route('/restart', methods=['POST'])
@login_required
@handle_api_error
def restart_process_api():
    data = request.get_json()
    pid_str = data.get('pid')
    config_id = data.get('config_id')

    if not pid_str or not config_id:
        return error_response('Missing pid or config_id', 400)

    try:
        pid = int(pid_str)
    except (ValueError, TypeError):
        return error_response(f'Invalid PID format: {pid_str}', 400)

    result = restart_process(pid)
    if result['success']:
        return success_response(result['message'], data={'new_pid': result.get('new_pid')})
    else:
        return error_response(result['error'], 500)

@process_api_bp.route('/<int:proc_id>/stop', methods=['POST'])
@login_required
@handle_api_error
def stop_process_api(proc_id):
    """Stops a managed process and unlocks the associated config file."""
    proc_record = TelegrafProcess.query.get_or_404(proc_id)

    if proc_record.pid is None or proc_record.status != 'running':
        # If the process is already stopped in our DB, ensure it's reflected
        proc_record.status = 'stopped'
        if proc_record.config_file:
            proc_record.config_file.is_locked = False
        db.session.commit()
        return success_response('Process was already stopped.')

    result = stop_process(proc_record.pid)
    
    if result.get('success'):
        # Unlock the associated config file
        if proc_record.config_file:
            proc_record.config_file.is_locked = False
        
        # Update the process status in DB
        proc_record.status = 'stopped'
        proc_record.stop_time = datetime.now(timezone.utc)
        db.session.commit()
        add_audit_log('process_stop', 'success', f"Stopped process for {proc_record.config_file.file_name}")
        return success_response(result['message'])
    else:
        # Even if stopping failed, if the process doesn't exist anymore, update DB
        if not psutil.pid_exists(proc_record.pid):
            proc_record.status = 'stopped'
            proc_record.stop_time = datetime.now(timezone.utc)
            if proc_record.config_file:
                proc_record.config_file.is_locked = False
            db.session.commit()

        return error_response(result['error'], 500)

@process_api_bp.route('/start', methods=['POST'])
@login_required
@handle_api_error
def start_process_api():
    data = request.get_json()
    config_id = data.get('config_id')
    if not config_id:
        return error_response('Missing config_id', 400)

    config_file = ConfigFile.query.get(config_id)
    if not config_file:
        return error_response(f'ConfigFile with id {config_id} not found', 404)

    # Fault tolerance: Scan running processes to see if one is already using this config file
    is_already_running = False
    for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
        try:
            if 'telegraf' in proc.info['name'].lower():
                cmdline = proc.info.get('cmdline', [])
                if cmdline:
                    for i, arg in enumerate(cmdline):
                        if arg == '--config' and i + 1 < len(cmdline):
                            running_config_path = cmdline[i + 1]
                            running_config_name = os.path.basename(running_config_path)
                            if running_config_name == config_file.file_name:
                                is_already_running = True
                                break
                if is_already_running:
                    break
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
    
    if is_already_running:
        return error_response(f'一个使用 {config_file.file_name} 的进程已在运行中。', 409)

    config_filepath = os.path.join(CONFIG_DIR, config_file.file_name)

    # Call the core start_process function
    start_result = start_process(config_filepath, config_file.file_name)

    if not start_result.get('success'):
        return error_response(f"Failed to start process: {start_result.get('error', 'Unknown error')}", 500)

    # If we have an old process record that was 'stopped', reuse it. Otherwise, create a new one.
    existing_process = TelegrafProcess.query.filter_by(config_file_id=config_id).first()
    if existing_process:
        proc_record = existing_process
    else:
        proc_record = TelegrafProcess()
        db.session.add(proc_record)

    proc_record.name = start_result['process_name']
    proc_record.pid = start_result['pid']
    proc_record.status = 'running'
    proc_record.config_file_id = config_id
    proc_record.log_file_path = start_result['log_file_path']
    proc_record.start_time = datetime.fromisoformat(start_result['start_time'])
    proc_record.stop_time = None

    # Lock the config file upon starting a process
    config_file.is_locked = True

    db.session.commit()

    add_audit_log('process_start', 'success', f"Started process for {config_file.file_name} with PID {proc_record.pid}")
    return success_response("Process started successfully", proc_record.to_dict())

@process_api_bp.route('/managed', methods=['GET', 'POST'])
@login_required
@handle_api_error
def get_managed_processes():
    """
    获取所有由系统管理的 Telegraf 进程列表（在数据库中有记录的）。
    支持 DataTables 服务器端处理。
    """
    if request.method == 'POST':
        if request.is_json:
            params = request.get_json()
        else:
            params = request.form
    else:
        params = request.args

    draw = int(params.get('draw', 1))
    start = int(params.get('start', 0))
    length = int(params.get('length', 10))
    search_value = params.get('search[value]', '').strip()
    order_column_index = int(params.get('order[0][column]', 0))
    order_dir = params.get('order[0][dir]', 'asc').strip()

    columns = ['pid', 'config_file', 'status', 'start_time', 'start_time', 'cpu_percent', 'memory_mb']
    order_column_name = columns[order_column_index] if 0 <= order_column_index < len(columns) else 'start_time'

    base_query = TelegrafProcess.query.join(ConfigFile, TelegrafProcess.config_file_id == ConfigFile.id).filter(TelegrafProcess.status != 'stopped')

    total_records = base_query.count()

    if search_value:
        search_term = f"%{search_value}%"
        base_query = base_query.filter(db.or_(
            ConfigFile.file_name.ilike(search_term),
            TelegrafProcess.status.ilike(search_term),
            db.cast(TelegrafProcess.pid, db.String).ilike(search_term)
        ))
    
    records_filtered = base_query.count()

    order_column = None
    if order_column_name == 'config_file':
        order_column = ConfigFile.file_name
    elif hasattr(TelegrafProcess, order_column_name):
        order_column = getattr(TelegrafProcess, order_column_name)

    if order_column is not None:
        if order_dir == 'desc':
            base_query = base_query.order_by(order_column.desc())
        else:
            base_query = base_query.order_by(order_column.asc())
    
    if length == -1:
        length = records_filtered if records_filtered > 0 else 1

    paginated_query = base_query.offset(start).limit(length)
    
    processes = paginated_query.all()

    process_list = []
    for p in processes:
        p_dict = p.to_dict()
        process_list.append(p_dict)

    return jsonify({
        "draw": draw,
        "recordsTotal": total_records,
        "recordsFiltered": records_filtered,
        "data": process_list
    })


@process_api_bp.route('/non_managed', methods=['GET'])
@login_required
@handle_api_error
def get_non_managed_processes():
    """获取所有非系统管理的 Telegraf 进程列表"""
    page, per_page = get_pagination_params(request)
    
    managed_pids = {p.pid for p in TelegrafProcess.query.with_entities(TelegrafProcess.pid).filter(TelegrafProcess.pid.isnot(None)).all()}
    
    non_managed_procs = []
    for proc in psutil.process_iter(['pid', 'name', 'cmdline', 'create_time']):
        try:
            if 'telegraf' in proc.info['name'].lower() and proc.info['pid'] not in managed_pids:
                non_managed_procs.append({
                    'pid': proc.info['pid'],
                    'start_time': datetime.fromtimestamp(proc.info['create_time']).isoformat(),
                    'cmdline': ' '.join(proc.info['cmdline']) if proc.info['cmdline'] else 'N/A'
                })
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
            
    total = len(non_managed_procs)
    
    if per_page == -1:
        paginated_procs = non_managed_procs
        pages = 1 if total > 0 else 0
        pagination_details = {'page': 1, 'per_page': total, 'total': total, 'pages': pages}
    else:
        start = (page - 1) * per_page
        end = start + per_page
        paginated_procs = non_managed_procs[start:end]
        pages = (total + per_page - 1) // per_page
        pagination_details = {'page': page, 'per_page': per_page, 'total': total, 'pages': pages}


    return success_response("Non-managed processes retrieved", {
        'items': paginated_procs,
        'pagination': pagination_details
    })

@process_api_bp.route('/history', methods=['GET'])
@login_required
@handle_api_error
def get_process_history():
    """获取已停止的进程历史记录"""
    history_records = TelegrafProcess.query.filter(TelegrafProcess.status == 'stopped').order_by(TelegrafProcess.stop_time.desc()).all()
    history_list = [r.to_dict() for r in history_records]
    return success_response("History retrieved", {'history': history_list})

@process_api_bp.route('/<int:pid>/logs', methods=['GET'])
@login_required
@handle_api_error
def get_process_logs(pid):
    """获取指定进程的日志"""
    limit = request.args.get('limit', 500, type=int)
    log_type = request.args.get('log_type', 'all').lower()

    proc_record = TelegrafProcess.query.filter_by(pid=pid).first()
    
    log_file_path = None
    if proc_record and proc_record.log_file_path and os.path.exists(proc_record.log_file_path):
        log_file_path = proc_record.log_file_path
    else:
        # Fallback for non-managed or old processes: try to find log by PID in the name
        log_file_pattern = os.path.join(LOG_DIR, f"telegraf_*_{pid}.log")
        log_files = glob.glob(log_file_pattern)
        if log_files:
            log_file_path = max(log_files, key=os.path.getmtime) # Get the latest one

    if not log_file_path:
        return success_response("Log file not found for this process.", {'logs': []})

    logs = []
    try:
        with open(log_file_path, 'r', encoding='utf-8', errors='ignore') as f:
            # Read lines from the end of the file for efficiency
            f.seek(0, os.SEEK_END)
            file_size = f.tell()
            f.seek(max(0, file_size - 1024 * 1024), os.SEEK_SET) # Read last 1MB max
            
            lines = f.readlines()

            for line in reversed(lines):
                if len(logs) >= limit:
                    break
                try:
                    # Assuming logs are plain text lines, not JSON
                    # Example format: "2024-08-27T10:00:00Z I! [inputs.cpu] ... "
                    parts = line.strip().split(" ", 2)
                    if len(parts) >= 3:
                        timestamp_str, log_level, message = parts[0], parts[1], parts[2]
                        log_entry = {
                            "timestamp": timestamp_str,
                            "log_type": log_level,
                            "message": message
                        }
                        if log_type == 'all' or log_level.lower().startswith(log_type[0]):
                             logs.append(log_entry)
                except Exception:
                    # For unstructured lines, just append them
                    logs.append({"timestamp": "N/A", "log_type": "raw", "message": line.strip()})

    except Exception as e:
        return error_response(f"Error reading log file: {str(e)}", 500)
    
    return success_response("Logs retrieved", {'logs': list(reversed(logs))})


@process_api_bp.route('/history/delete', methods=['POST'])
@login_required
@handle_api_error
def delete_history():
    data = request.get_json()
    pids = data.get('pids', [])
    if not pids:
        return error_response("No PIDs provided", 400)
    
    # We should delete based on the record ID, not PID, as PIDs can be reused.
    # The frontend sends PIDs, so we need to find the records.
    records_to_delete = TelegrafProcess.query.filter(TelegrafProcess.pid.in_(pids)).all()
    
    if not records_to_delete:
        return error_response("No matching history records found for the given PIDs.", 404)

    for record in records_to_delete:
        db.session.delete(record)

    db.session.commit()
    add_audit_log('history_delete', 'success', f"Deleted {len(records_to_delete)} history records.")
    return success_response(f"Successfully deleted {len(records_to_delete)} history records.")

@process_api_bp.route('/<int:pid>/stop_non_managed', methods=['POST'])
@login_required
@handle_api_error
def stop_non_managed_process(pid):
    """Stops a non-managed process."""
    result = stop_process(pid)
    if result.get('success'):
        add_audit_log('process_stop_non_managed', 'success', f"Stopped non-managed process with PID {pid}")
        return success_response(result['message'])
    else:
        return error_response(result['error'], 500)

@process_api_bp.route('/summary', methods=['GET'])
@login_required
@handle_api_error
def get_processes_summary():
    """
    获取所有正在运行的 Telegraf 进程的摘要，用于仪表盘。
    """
    summary_limit = 5  # Limit the number of processes returned in the summary for performance
    all_processes = []

    # 1. Get managed processes from DB
    managed_processes = TelegrafProcess.query.filter(TelegrafProcess.status == 'running').all()
    managed_pids = {p.pid for p in managed_processes}

    for p in managed_processes:
        process_info = p.to_dict()
        process_info['management_type'] = 'managed'
        all_processes.append(process_info)

    # 2. Get non-managed processes from psutil
    non_managed_procs = []
    for proc in psutil.process_iter(['pid', 'name', 'cmdline', 'create_time', 'cpu_percent', 'memory_info']):
        try:
            if 'telegraf' in proc.info['name'].lower() and proc.info['pid'] not in managed_pids:
                p_info = proc.info
                non_managed_procs.append({
                    'pid': p_info['pid'],
                    'name': ' '.join(p_info['cmdline']) if p_info['cmdline'] else p_info['name'],
                    'management_type': 'non_managed',
                    'status': 'running', # Assumed running as it's an active process
                    'start_time': datetime.fromtimestamp(p_info['create_time']).isoformat(),
                    'cpu_percent': p_info['cpu_percent'],
                    'memory_mb': p_info['memory_info'].rss / (1024 * 1024),
                    'config_file': {'file_name': 'N/A'} # Add placeholder for consistency
                })
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
    
    all_processes.extend(non_managed_procs)

    # Sort by start time descending to show newest first
    all_processes.sort(key=lambda x: x.get('start_time'), reverse=True)

    summary = {
        'total_processes': len(all_processes),
        'processes_summary': all_processes[:summary_limit]
    }

    return success_response("Processes summary retrieved", summary)
