# -*- coding: utf-8 -*-
"""
Telegraf 配置文件管理器
功能：处理配置文件版本控制、数据点同步和 systemd 服务检查
作者：项目开发团队
"""

import os
import re
import hashlib
import subprocess
import logging
from datetime import datetime
from typing import Dict, List, Optional, Tuple
import configparser
import json

# 配置日志记录
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Telegraf 相关路径常量
SYSTEMD_TELEGRAF_SERVICE = 'telegraf.service'
DEFAULT_TELEGRAF_CONFIG = '/etc/telegraf/telegraf.conf'
SYSTEMD_CONFIG_DIR = '/etc/systemd/system'


class ConfigManager:
    """Telegraf 配置文件管理器"""
    
    def __init__(self):
        self.systemd_service_path = f"{SYSTEMD_CONFIG_DIR}/{SYSTEMD_TELEGRAF_SERVICE}"
    
    def check_systemd_telegraf_service(self) -> Dict:
        """
        检查 systemd 管理的 Telegraf 服务状态和配置
        
        返回:
            dict: 包含服务状态和配置信息的字典
        """
        try:
            # 检查服务是否存在
            service_exists = os.path.exists(self.systemd_service_path)
            
            result = {
                'service_exists': service_exists,
                'is_active': False,
                'is_enabled': False,
                'config_file': None,
                'has_data_points': False,
                'warning_message': None
            }
            
            if not service_exists:
                return result
            
            # 检查服务状态（是否激活）
            try:
                active_result = subprocess.run(
                    ['systemctl', 'is-active', SYSTEMD_TELEGRAF_SERVICE],
                    capture_output=True, text=True, timeout=5
                )
                result['is_active'] = active_result.returncode == 0
            except (subprocess.TimeoutExpired, subprocess.SubprocessError):
                logger.warning("无法检查 systemd telegraf 服务激活状态")
            
            # 检查服务是否启用（开机自启）
            try:
                enabled_result = subprocess.run(
                    ['systemctl', 'is-enabled', SYSTEMD_TELEGRAF_SERVICE],
                    capture_output=True, text=True, timeout=5
                )
                result['is_enabled'] = enabled_result.returncode == 0
            except (subprocess.TimeoutExpired, subprocess.SubprocessError):
                logger.warning("无法检查 systemd telegraf 服务启用状态")
            
            # 获取服务使用的配置文件
            config_file = self._get_systemd_config_file()
            result['config_file'] = config_file
            
            # 检查配置文件是否包含有效数据点
            if config_file and os.path.exists(config_file):
                has_data_points, data_points = self._check_config_data_points(config_file)
                result['has_data_points'] = has_data_points
                result['data_points_count'] = len(data_points) if data_points else 0
                
                # 如果服务激活且有数据点，发出警告
                if result['is_active'] and has_data_points:
                    result['warning_message'] = (
                        f"警告：systemd 管理的 Telegraf 服务正在运行，"
                        f"使用配置文件 {config_file}，包含 {len(data_points)} 个数据点配置。"
                        f"这可能与本系统管理的进程产生冲突。"
                    )
            
            return result
            
        except Exception as e:
            logger.error(f"检查 systemd telegraf 服务时发生异常: {str(e)}")
            return {
                'service_exists': False,
                'error': str(e)
            }
    
    def _get_systemd_config_file(self) -> Optional[str]:
        """
        从 systemd 服务文件中获取 Telegraf 配置文件路径
        
        返回:
            str: 配置文件路径，如果未找到则返回默认路径
        """
        try:
            # 读取 systemd 服务文件
            if not os.path.exists(self.systemd_service_path):
                return DEFAULT_TELEGRAF_CONFIG
            
            with open(self.systemd_service_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # 查找 ExecStart 行中的 --config 参数
            exec_start_pattern = r'ExecStart=.*?--config[=\s]+([^\s]+)'
            match = re.search(exec_start_pattern, content)
            
            if match:
                return match.group(1)
            
            # 如果没有找到，返回默认配置文件路径
            return DEFAULT_TELEGRAF_CONFIG
            
        except Exception as e:
            logger.error(f"解析 systemd 服务文件时发生异常: {str(e)}")
            return DEFAULT_TELEGRAF_CONFIG
    
    def _find_plugin_blocks(self, content: str, section_type: str) -> List[Tuple[str, str]]:
        """
        通用方法：查找输入/输出插件块 (section_type: 'inputs' or 'outputs')
        返回 [(plugin_name, plugin_content), ...]
        """
        pattern = rf'[[{section_type}\.([^]]+)]]'
        matches = list(re.finditer(pattern, content))
        blocks = []
        for idx, match in enumerate(matches):
            plugin_name = match.group(1)
            start_pos = match.end()
            end_pos = matches[idx + 1].start() if idx + 1 < len(matches) else len(content)
            plugin_content = content[start_pos:end_pos]
            blocks.append((plugin_name, plugin_content))
        return blocks
    
    def _is_block_commented(self, content: str, match_start: int, plugin_name: str, section_type: str) -> bool:
        """
        检查插件块是否被注释掉
        """
        lines_before = content[:match_start].split('\n')
        for line in reversed(lines_before[-10:]):
            line = line.strip()
            if line.startswith('#') and f'{section_type}.{plugin_name}' in line:
                return True
            elif line and not line.startswith('#'):
                break
        return False
    
    def _check_config_data_points(self, config_file: str) -> Tuple[bool, List[Dict]]:
        """
        检查配置文件中的数据点信息
        
        参数:
            config_file (str): 配置文件路径
        
        返回:
            tuple: (是否有数据点, 数据点列表)
        """
        try:
            if not os.path.exists(config_file):
                return False, []
            
            with open(config_file, 'r', encoding='utf-8') as f:
                content = f.read()
            
            return self._check_config_data_points_from_string(content)
        
        except Exception as e:
            logger.error(f"检查配置文件数据点时发生异常: {str(e)}")
            return False, []
    
    def _check_config_data_points_from_string(self, content: str) -> Tuple[bool, List[Dict]]:
        """从字符串内容检查数据点信息"""
        data_points = []
        for section_type in ['inputs', 'outputs']:
            blocks = self._find_plugin_blocks(content, section_type)
            for plugin_name, plugin_content in blocks:
                # 查找块的起始位置
                pattern = rf'[[{section_type}\.{plugin_name}]]'
                match = re.search(pattern, content)
                if match and not self._is_block_commented(content, match.start(), plugin_name, section_type):
                    data_points.append({
                        'plugin_name': plugin_name,
                        'plugin_type': section_type[:-1],  # 'input' or 'output'
                        'config_content': plugin_content.strip()
                    })
        has_data_points = len(data_points) > 0
        return has_data_points, data_points
    
    def _check_config_data_points_from_content(self, content: str) -> Tuple[bool, List[Dict]]:
        """
        从配置内容中检查数据点信息（内部方法）
        
        参数:
            content (str): 配置文件内容
        
        返回:
            tuple: (是否有数据点, 数据点列表)
        """
        return self._check_config_data_points_from_string(content)
    
    def calculate_config_hash(self, content: str) -> str:
        """
        计算配置文件内容的哈希值
        
        参数:
            content (str): 配置文件内容
        
        返回:
            str: SHA256 哈希值
        """
        return hashlib.sha256(content.encode('utf-8')).hexdigest()
    
    def detect_config_changes(self, stored_content: str, current_content: str) -> Dict:
        """
        检测配置文件变更
        
        参数:
            stored_content (str): 数据库中存储的配置内容
            current_content (str): 当前配置文件内容
        
        返回:
            dict: 变更信息
        """
        stored_hash = self.calculate_config_hash(stored_content)
        current_hash = self.calculate_config_hash(current_content)
        
        if stored_hash == current_hash:
            return {
                'has_changes': False,
                'hash_changed': False
            }
        
        # 计算差异统计
        stored_lines = stored_content.split('\n')
        current_lines = current_content.split('\n')
        
        added_lines = len(current_lines) - len(stored_lines)
        
        return {
            'has_changes': True,
            'hash_changed': True,
            'old_hash': stored_hash,
            'new_hash': current_hash,
            'lines_changed': added_lines,
            'change_time': datetime.now().isoformat(),
            'change_reason': 'external_modification'  # 外部修改
        }
    
    def sync_config_data_points(self, config_content: str) -> List[Dict]:
        """
        从配置文件内容中提取数据点信息（增强版）
        
        参数:
            config_content (str): 配置文件内容
        
        返回:
            list: 数据点信息列表
        """
        has_points, plugin_data = self._check_config_data_points_from_content(config_content)
        
        synchronized_points = []
        for plugin in plugin_data:
            # 从插件配置中提取更详细的数据点信息
            plugin_points = self._extract_detailed_data_points(plugin)
            synchronized_points.extend(plugin_points)
        
        return synchronized_points
    
    def _extract_detailed_data_points(self, plugin_info: Dict) -> List[Dict]:
        """
        从插件信息中提取详细的数据点信息
        
        参数:
            plugin_info (dict): 插件信息
        
        返回:
            list: 详细数据点信息列表
        """
        points = []
        plugin_name = plugin_info['plugin_name']
        plugin_type = plugin_info['plugin_type']
        config_content = plugin_info['config_content']
        
        # 基础数据点信息
        measurement_name = f"{plugin_type}_{plugin_name}"
        
        # 尝试从配置内容中提取更多信息
        point_info = {
            'measurement': measurement_name,
            'original_point_name': plugin_name,
            'normalized_point_name': self._normalize_point_name(plugin_name),
            'point_comment': f"{plugin_type.title()} plugin: {plugin_name}",
            'tags': json.dumps({
                'plugin_type': plugin_type,
                'plugin_name': plugin_name,
                'measurement_source': 'telegraf_config'
            }),
            'fields': json.dumps(self._extract_plugin_fields(plugin_name, config_content)),
            'timestamp': datetime.now(),
            'data_type': self._infer_data_type(plugin_name),
            'unit': self._infer_unit(plugin_name),
            'data_source': 'config_sync',
            'is_enabled': True
        }
        
        points.append(point_info)
        
        # 对于某些插件，尝试提取多个数据点
        if plugin_name in ['cpu', 'mem', 'disk', 'net', 'system']:
            additional_points = self._extract_system_plugin_points(plugin_name, plugin_type, config_content)
            points.extend(additional_points)
        
        return points
    
    def _normalize_point_name(self, point_name: str) -> str:
        """
        标准化点位名称
        
        参数:
            point_name (str): 原始点位名称
        
        返回:
            str: 标准化后的点位名称
        """
        import re
        
        # 替换特殊字符为下划线
        normalized = re.sub(r'[^a-zA-Z0-9_]', '_', point_name)
        # 合并连续下划线
        normalized = re.sub(r'_+', '_', normalized)
        # 去除首尾下划线并转小写
        normalized = normalized.strip('_').lower()
        
        return normalized
    
    def _extract_plugin_fields(self, plugin_name: str, config_content: str) -> Dict:
        """
        从插件配置中提取字段信息
        
        参数:
            plugin_name (str): 插件名称
            config_content (str): 配置内容
        
        返回:
            dict: 字段信息
        """
        fields = {'config_snippet': config_content[:200] + '...' if len(config_content) > 200 else config_content}
        
        # 尝试提取特定配置参数
        config_lines = config_content.split('\n')
        for line in config_lines:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                key, value = line.split('=', 1)
                key = key.strip()
                value = value.strip().strip('"\'')
                
                # 只保留重要的配置参数
                if key in ['interval', 'servers', 'database', 'measurement', 'urls', 'files']:
                    fields[key] = value
        
        return fields
    
    def _infer_data_type(self, plugin_name: str) -> str:
        """
        根据插件名称推断数据类型
        
        参数:
            plugin_name (str): 插件名称
        
        返回:
            str: 数据类型
        """
        # 数值类型插件
        numeric_plugins = ['cpu', 'mem', 'disk', 'net', 'system', 'docker', 'mysql', 'postgresql']
        # 字符串类型插件
        string_plugins = ['exec', 'file', 'tail', 'syslog']
        # 布尔类型插件
        boolean_plugins = ['ping', 'http_response']
        
        if plugin_name in numeric_plugins:
            return 'float'
        elif plugin_name in string_plugins:
            return 'string'
        elif plugin_name in boolean_plugins:
            return 'boolean'
        else:
            return 'float'  # 默认为浮点型
    
    def _infer_unit(self, plugin_name: str) -> Optional[str]:
        """
        根据插件名称推断单位
        
        参数:
            plugin_name (str): 插件名称
        
        返回:
            str: 单位（可能为 None）
        """
        unit_map = {
            'cpu': '%',
            'mem': 'bytes',
            'disk': 'bytes',
            'net': 'bytes/s',
            'temp': '°C',
            'ping': 'ms',
            'http_response': 'ms'
        }
        
        return unit_map.get(plugin_name)
    
    def _extract_system_plugin_points(self, plugin_name: str, plugin_type: str, config_content: str) -> List[Dict]:
        """
        从系统插件中提取多个数据点
        
        参数:
            plugin_name (str): 插件名称
            plugin_type (str): 插件类型
            config_content (str): 配置内容
        
        返回:
            list: 系统插件的多个数据点
        """
        points = []
        
        # CPU 插件的多个指标
        if plugin_name == 'cpu':
            cpu_metrics = ['usage_idle', 'usage_user', 'usage_system', 'usage_iowait']
            for metric in cpu_metrics:
                points.append({
                    'measurement': f"cpu_{metric}",
                    'original_point_name': f"cpu.{metric}",
                    'normalized_point_name': f"cpu_{metric}",
                    'point_comment': f"CPU {metric.replace('usage_', '')} percentage",
                    'tags': json.dumps({
                        'plugin_type': plugin_type,
                        'plugin_name': plugin_name,
                        'metric_type': metric,
                        'measurement_source': 'telegraf_config'
                    }),
                    'fields': json.dumps({'metric_name': metric, 'base_plugin': plugin_name}),
                    'timestamp': datetime.now(),
                    'data_type': 'float',
                    'unit': '%',
                    'data_source': 'config_sync',
                    'is_enabled': True
                })
        
        # 内存插件的多个指标
        elif plugin_name == 'mem':
            mem_metrics = ['used', 'free', 'available', 'total', 'used_percent']
            for metric in mem_metrics:
                unit = '%' if 'percent' in metric else 'bytes'
                points.append({
                    'measurement': f"mem_{metric}",
                    'original_point_name': f"mem.{metric}",
                    'normalized_point_name': f"mem_{metric}",
                    'point_comment': f"Memory {metric} amount",
                    'tags': json.dumps({
                        'plugin_type': plugin_type,
                        'plugin_name': plugin_name,
                        'metric_type': metric,
                        'measurement_source': 'telegraf_config'
                    }),
                    'fields': json.dumps({'metric_name': metric, 'base_plugin': plugin_name}),
                    'timestamp': datetime.now(),
                    'data_type': 'float',
                    'unit': unit,
                    'data_source': 'config_sync',
                    'is_enabled': True
                })
        
        # 磁盘插件的多个指标
        elif plugin_name == 'disk':
            disk_metrics = ['used', 'free', 'total', 'used_percent']
            for metric in disk_metrics:
                unit = '%' if 'percent' in metric else 'bytes'
                points.append({
                    'measurement': f"disk_{metric}",
                    'original_point_name': f"disk.{metric}",
                    'normalized_point_name': f"disk_{metric}",
                    'point_comment': f"Disk {metric} space",
                    'tags': json.dumps({
                        'plugin_type': plugin_type,
                        'plugin_name': plugin_name,
                        'metric_type': metric,
                        'measurement_source': 'telegraf_config'
                    }),
                    'fields': json.dumps({'metric_name': metric, 'base_plugin': plugin_name}),
                    'timestamp': datetime.now(),
                    'data_type': 'float',
                    'unit': unit,
                    'data_source': 'config_sync',
                    'is_enabled': True
                })
        
        return points

    def list_files_in_directory(self, directory_path: str, file_filter: str) -> List[Dict]:
        files = []
        if not os.path.isdir(directory_path):
            raise ValueError(f"目录不存在: {directory_path}")
        for f in os.listdir(directory_path):
            if f.endswith(file_filter) or file_filter == '*':
                path = os.path.join(directory_path, f)
                if os.path.isfile(path):
                    try:
                        with open(path, 'r', encoding='utf-8') as file_content:
                            content = file_content.read()
                        files.append({
                            'name': f,
                            'path': path,
                            'size': os.path.getsize(path),
                            'hash': self.calculate_config_hash(content)
                        })
                    except Exception as e:
                        logger.warning(f"无法读取文件 {path}: {e}")
        return files

    def import_from_path(self, file_path: str, force_overwrite: bool = False) -> Dict:
        from models import db, ConfigFile, TelegrafProcess
        file_name = os.path.basename(file_path)
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        new_hash = self.calculate_config_hash(content)

        existing = ConfigFile.query.filter_by(file_name=file_name, is_active=True).first()

        if existing:
            if existing.content_hash == new_hash:
                return {"message": "内容无变化，已跳过。"}

            is_running = TelegrafProcess.query.filter_by(config_file_id=existing.id, status='running').first() is not None

            if is_running and not force_overwrite:
                return {
                    'error': 'Conflict', 
                    'message': '配置正在运行且内容有变化',
                    'existing_config': existing.to_dict(), 
                    'new_config_hash': new_hash
                }

        return self.check_and_create_new_version(file_name, content, change_type='import', change_description=f'从 {file_path} 导入')

    def import_all_from_directory(self, directory_path: str, file_filter: str, force_overwrite: bool = False) -> Dict:
        files = self.list_files_in_directory(directory_path, file_filter)
        imported_count = 0
        skipped_count = 0
        errors = []
        conflicts = []
        for f in files:
            try:
                result = self.import_from_path(f['path'], force_overwrite)
                if 'error' in result and result['error'] == 'Conflict':
                    conflicts.append({'file': f['name'], 'existing_config': result['existing_config'], 'new_config_hash': result['new_config_hash']})
                elif 'message' in result and '内容无变化' in result['message']:
                    skipped_count += 1
                else:
                    imported_count += 1
            except Exception as e:
                errors.append({'file': f['name'], 'error': str(e)})
        return {'imported_count': imported_count, 'skipped_count': skipped_count, 'errors': errors, 'conflicts': conflicts}

    def parse_config(self, content: str) -> Dict:
        _, inputs = self._check_config_data_points_from_string(content)
        # A real implementation would parse outputs and agent config too
        return {'inputs': inputs, 'outputs': [], 'agent': ''}

    def update_config(self, config_id: int, name: str, content: str) -> None:
        from models import db, ConfigFile
        config = ConfigFile.query.get(config_id)
        if not config:
            raise ValueError("配置未找到")
        self.check_and_create_new_version(name, content, change_type='manual', change_description='手动更新')

    def delete_config(self, config_id: int) -> None:
        from models import db, ConfigFile, PointInfo
        config = ConfigFile.query.get(config_id)
        if not config:
            raise ValueError("配置未找到")

        # Find all versions of this config file to get their IDs
        all_versions = ConfigFile.query.filter_by(file_name=config.file_name).all()
        all_version_ids = [v.id for v in all_versions]

        # Find and update all associated PointInfo objects
        associated_points = PointInfo.query.filter(PointInfo.config_file_id.in_(all_version_ids)).all()
        for point in associated_points:
            point.config_file_id = None
            point.is_locked = False
        
        # Commit the changes to points before deleting configs
        if associated_points:
            db.session.commit()

        # Now, delete all versions of the config file
        for v in all_versions:
            db.session.delete(v)
        db.session.commit()

    def activate_version(self, config_id: int) -> None:
        from models import db, ConfigFile
        target_version = ConfigFile.query.get(config_id)
        if not target_version:
            raise ValueError("版本未找到")
        
        active_versions = ConfigFile.query.filter_by(file_name=target_version.file_name, is_active=True).all()
        for v in active_versions:
            v.is_active = False
        
        target_version.is_active = True
        db.session.commit()

    def check_and_create_new_version(self, file_name: str, current_content: str, 
                                   change_type: str = 'external', 
                                   change_description: str = None, 
                                   force_overwrite: bool = False,
                                   data_points_synced: bool = False) -> Dict:
        from models import db, ConfigFile
        
        # 查找当前激活的版本
        active_config = ConfigFile.query.filter_by(file_name=file_name, is_active=True).first()
        
        # 计算新内容的哈希值
        current_hash = self.calculate_config_hash(current_content)
        
        # 如果存在激活版本且内容未变，则不执行任何操作
        if active_config and active_config.content_hash == current_hash:
            return {"message": "内容无变化，未创建新版本。", "config": active_config.to_dict()}
        
        # 确定新版本号
        last_version = ConfigFile.query.filter_by(file_name=file_name).order_by(ConfigFile.version.desc()).first()
        new_version_number = (last_version.version + 1) if last_version else 1
        
        # 如果存在激活版本，则停用它
        if active_config:
            active_config.is_active = False
            db.session.add(active_config)
        
        # 创建新版本
        new_config = ConfigFile(
            file_name=file_name,
            content=current_content,
            version=new_version_number,
            is_active=True,
            change_type=change_type,
            change_description=change_description or f"{change_type.capitalize()} change",
            content_hash=current_hash,
            data_points_synced=data_points_synced # 新版本需要重新同步
        )
        db.session.add(new_config)
        db.session.commit()
        
        return {"message": "新版本创建成功。", "config": new_config.to_dict()}

class ConfigVersionService:
    def __init__(self, config_manager):
        self.config_manager = config_manager

    def check_and_create_new_version(self, file_name: str, current_content: str, 
                                   change_type: str = 'external', 
                                   change_description: str = None, 
                                   force_overwrite: bool = False,
                                   data_points_synced: bool = False) -> Dict:
        return self.config_manager.check_and_create_new_version(
            file_name, current_content, change_type, change_description, force_overwrite, data_points_synced
        )

    def get_config_version_history(self, file_name: str) -> List[Dict]:
        from models import ConfigFile
        versions = ConfigFile.query.filter_by(file_name=file_name).order_by(ConfigFile.version.desc()).all()
        return [v.to_dict() for v in versions]

    def get_config_by_version(self, file_name: str, version: int):
        from models import ConfigFile
        return ConfigFile.query.filter_by(file_name=file_name, version=version).first()

    def rollback_to_version(self, file_name: str, target_version: int, 
                          change_description: str = None) -> Dict:
        target_config = self.get_config_by_version(file_name, target_version)
        if not target_config:
            raise ValueError("目标版本不存在")
        
        return self.check_and_create_new_version(
            file_name=file_name,
            current_content=target_config.content,
            change_type='rollback',
            change_description=change_description or f"回滚到版本 {target_version}"
        )

    def activate_config_version(self, config_id: int) -> Dict:
        return self.config_manager.activate_version(config_id)

    def list_files_in_directory(self, directory_path: str, file_filter: str) -> List[Dict]:
        return self.config_manager.list_files_in_directory(directory_path, file_filter)

    def import_from_path(self, file_path: str, force_overwrite: bool = False) -> Dict:
        return self.config_manager.import_from_path(file_path, force_overwrite)

    def import_all_from_directory(self, directory_path: str, file_filter: str, force_overwrite: bool = False) -> Dict:
        return self.config_manager.import_all_from_directory(directory_path, file_filter, force_overwrite)

    def parse_config(self, content: str) -> Dict:
        return self.config_manager.parse_config(content)

    def update_config(self, config_id: int, name: str, content: str) -> None:
        return self.config_manager.update_config(config_id, name, content)

    def delete_config(self, config_id: int) -> None:
        return self.config_manager.delete_config(config_id)

    def activate_version(self, config_id: int) -> None:
        return self.config_manager.activate_version(config_id)

# 创建全局配置管理器实例
config_manager = ConfigManager()

# 创建全局配置版本服务实例
config_version_service = ConfigVersionService(config_manager)
