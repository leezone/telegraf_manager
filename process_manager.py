# -*- coding: utf-8 -*-
"""
Telegraf 进程管理器
功能：管理 Telegraf 进程的启动、停止和监控
作者：项目开发团队
"""

import subprocess  # 子进程管理
import os  # 操作系统接口
import signal  # 信号处理
import psutil  # 进程和系统信息
import time  # 时间处理
from datetime import datetime, timezone  # 日期时间
import logging  # 日志记录
import threading # 多线程
from queue import Queue # 队列
from config_manager import config_manager  # 配置文件管理器
from db_manager import insert_log_entry, DUCKDB_PATH, get_duckdb_connection # DuckDB 日志管理器
from models import TelegrafProcess, db # 导入 TelegrafProcess 模型和 db 实例

# 定义项目内部的日志目录
LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'log')
CONFIG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'configs')
# 确保日志目录存在
os.makedirs(LOG_DIR, exist_ok=True)

# 配置日志记录
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def test_config(config_path):
    """
    使用 telegraf --test 测试配置文件的有效性。
    """
    try:
        if not os.path.exists(config_path):
            return {'success': False, 'output': f'配置文件不存在: {config_path}'}
        
        cmd = ['telegraf', '--config', config_path, '--test']
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode == 0:
            return {'success': True, 'output': '配置文件测试通过。\n' + result.stdout}
        else:
            return {'success': False, 'output': f'配置文件测试失败 (Exit Code: {result.returncode}):\n{result.stderr}'}
            
    except FileNotFoundError:
        return {'success': False, 'output': 'Telegraf 命令未找到，请确保已安装并加入系统 PATH。'}
    except subprocess.TimeoutExpired:
        return {'success': False, 'output': '配置文件测试超时 (30秒)。'}
    except Exception as e:
        return {'success': False, 'output': f'测试配置文件时发生未知错误: {str(e)}'}

def start_process(config_file_path, config_file_name, process_name=None):
    """
    启动 Telegraf 进程，采用可靠的 subprocess.Popen 方法。
    """
    try:
        if not os.path.exists(config_file_path):
            return {'success': False, 'error': f'配置文件不存在: {config_file_path}'}

        if not _check_telegraf_installed():
            return {'success': False, 'error': 'Telegraf 未安装或不在 PATH 中'}

        # 为新进程准备日志文件
        log_file_name = f"telegraf_{config_file_name.replace('.conf', '')}_{int(time.time())}.log"
        log_file_path = os.path.join(LOG_DIR, log_file_name)
        
        cmd = ['telegraf', '--config', config_file_path]

        # 使用 Popen 直接启动，并重定向输出
        with open(log_file_path, 'wb') as log_file:
            process = subprocess.Popen(
                cmd,
                stdout=log_file,
                stderr=log_file,
                preexec_fn=os.setsid  # 关键：创建新的进程会话，实现守护化
            )

        # 立即获取 PID，无需等待或搜索
        telegraf_pid = process.pid

        # 快速检查进程是否仍在运行，以防它因配置错误等原因立即崩溃
        time.sleep(0.5)
        if not psutil.pid_exists(telegraf_pid):
            with open(log_file_path, 'r') as f:
                error_output = f.read()
            return {'success': False, 'error': f'进程启动后立即退出。日志输出:\n{error_output}'}

        logger.info(f"Telegraf 进程启动成功，PID: {telegraf_pid}")
        
        actual_process_name = process_name or f'telegraf_{config_file_name}_{telegraf_pid}'

        # 启动日志读取线程
        log_conn = get_duckdb_connection()
        log_thread = threading.Thread(
            target=_log_reader,
            args=(log_conn, log_file_path, telegraf_pid, actual_process_name, config_file_path, 'stdout')
        )
        log_thread.daemon = True
        log_thread.start()

        return {
            'success': True,
            'pid': telegraf_pid,
            'process_name': actual_process_name,
            'config_file': config_file_path,
            'start_time': datetime.now(timezone.utc).isoformat(),
            'log_db_path': DUCKDB_PATH,
            'log_file_path': log_file_path
        }
            
    except Exception as e:
        logger.exception(f"启动 Telegraf 进程时发生异常")
        return {'success': False, 'error': f'启动进程时发生异常: {str(e)}'}


def _log_reader(conn, log_file_path, process_pid, process_name, config_file, log_type):
    """
    在单独的线程中读取进程的日志文件，并将日志写入 DuckDB。
    """
    try:
        while not os.path.exists(log_file_path):
            time.sleep(0.1)

        with open(log_file_path, 'r', encoding='utf-8', errors='ignore') as f:
            while psutil.pid_exists(process_pid):
                line = f.readline()
                if line:
                    message = line.strip()
                    if message:
                        insert_log_entry(conn, datetime.now(timezone.utc), process_pid, process_name, config_file, log_type, message)
                else:
                    time.sleep(0.5) # 文件末尾，稍作等待
    except Exception as e:
        logger.error(f"日志读取线程异常 (PID: {process_pid}): {e}")
    finally:
        conn.close()

def stop_process(process_id):
    """
    停止指定的 Telegraf 进程
    """
    if not isinstance(process_id, int):
        try:
            process_id = int(process_id)
        except (ValueError, TypeError):
            return {'success': False, 'error': f'Invalid process_id type: {type(process_id)}'}

    if not psutil.pid_exists(process_id):
        return {'success': True, 'message': f'进程 {process_id} 已不存在。'}
    
    try:
        proc = psutil.Process(process_id)
        proc.terminate() # 发送 SIGTERM
        try:
            proc.wait(timeout=5) # 等待5秒
            return {'success': True, 'message': f'进程 {process_id} 已优雅停止。'}
        except psutil.TimeoutExpired:
            proc.kill() # 强制发送 SIGKILL
            proc.wait(timeout=5)
            return {'success': True, 'message': f'进程 {process_id} 已被强制停止。'}
    except psutil.NoSuchProcess:
         return {'success': True, 'message': f'进程 {process_id} 在操作期间已消失。'}
    except Exception as e:
        logger.exception(f"停止进程 {process_id} 时发生错误")
        return {'success': False, 'error': f'无法停止进程 {process_id}: {e}'}


def list_processes(managed_pids):
    """
    列出所有 Telegraf 进程，并区分为系统管理和非系统管理。
    """
    managed_processes, non_managed_processes = [], []
    managed_pids_set = set(managed_pids)

    for proc in psutil.process_iter(['pid', 'name', 'cmdline', 'create_time', 'status', 'ppid', 'cpu_percent', 'memory_info']):
        try:
            if proc.info['name'] and 'telegraf' in proc.info['name'].lower():
                process_info = _collect_process_info(proc)
                if proc.info['pid'] in managed_pids_set:
                    process_record = TelegrafProcess.query.filter_by(pid=proc.info['pid']).first()
                    if process_record:
                        process_info['config_id'] = process_record.config_file_id
                    managed_processes.append(process_info)
                else:
                    non_managed_processes.append(process_info)
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
    
    return {
        'managed_processes': managed_processes,
        'non_managed_processes': non_managed_processes
    }

def _collect_process_info(proc):
    """从 psutil.Process 对象收集标准化的进程信息。"""
    config_file = None
    cmdline = proc.info.get('cmdline', [])
    if cmdline:
        for i, arg in enumerate(cmdline):
            if arg == '--config' and i + 1 < len(cmdline):
                config_file = cmdline[i + 1]
                break

    return {
        'pid': proc.info['pid'],
        'name': proc.info['name'],
        'status': proc.info['status'],
        'config_file': config_file,
        'start_time': datetime.fromtimestamp(proc.info['create_time'], tz=timezone.utc).isoformat(),
        'cmdline': ' '.join(cmdline),
        'ppid': proc.info['ppid'],
        'cpu_percent': proc.info['cpu_percent'],
        'memory_mb': proc.info['memory_info'].rss / (1024 * 1024) if proc.info['memory_info'] else 0,
        'config_id': None
    }

def _check_telegraf_installed():
    """
    检查 Telegraf 是否已安装并可执行
    """
    try:
        result = subprocess.run(['telegraf', '--version'], capture_output=True, text=True, timeout=5)
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.SubprocessError):
        return False

def restart_process(process_id):
    """
    重启指定的 Telegraf 进程
    
    Args:
        process_id: 要重启的进程ID
        
    Returns:
        dict: 包含操作结果和消息的字典
    """
    try:
        # 获取进程信息
        process = TelegrafProcess.query.filter_by(pid=process_id).first()
        if not process:
            return {'success': False, 'error': f'进程不存在: {process_id}'}
        
        # 停止进程
        stop_result = stop_process(process_id)
        if not stop_result['success']:
            return {'success': False, 'error': f'停止进程失败: {stop_result.get("error")}'}
        
        # 等待进程完全停止
        time.sleep(2)
        
        # 重新启动进程
        if not process.config_file:
            return {'success': False, 'error': f'进程 {process_id} 没有关联的配置文件。'}
            
        config_filename = process.config_file.file_name
        config_filepath = os.path.join(CONFIG_DIR, config_filename)
        
        start_result = start_process(config_filepath, config_filename)
        if not start_result['success']:
            error_msg = start_result.get('error', 'Unknown error')
            return {'success': False, 'error': f'启动进程失败: {error_msg}'}
        
        new_pid = start_result.get('pid')
        new_name = start_result.get('process_name')
        
        # 更新数据库记录
        process.pid = new_pid
        process.name = new_name
        process.start_time = datetime.now(timezone.utc)
        process.status = 'running'
        db.session.commit()

        return {'success': True, 'message': f'进程重启成功: {process_id}', 'new_pid': new_pid}
        
    except Exception as e:
        logger.exception(f"重启进程失败 {process_id}")
        return {'success': False, 'error': f'重启进程失败: {str(e)}'}