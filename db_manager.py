# -*- coding: utf-8 -*-
"""
数据库管理工具
功能：数据库备份、恢复和重新初始化
作者：项目开发团队
"""

import os
import shutil
import sqlite3
import logging
import duckdb
from datetime import datetime
from typing import Dict, Optional
from flask import Flask
from models import db, User

# 配置日志记录
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 定义 DuckDB 数据库文件路径
DUCKDB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'database', 'telegraf_logs.duckdb')

def get_duckdb_connection():
    """
    获取一个 DuckDB 数据库连接。
    """
    return duckdb.connect(database=DUCKDB_PATH, read_only=False)

def init_duckdb():
    """
    初始化 DuckDB 数据库，创建所有需要的表（如果不存在）。
    """
    try:
        conn = get_duckdb_connection()
        # 创建 telegraf 进程日志表
        conn.execute("""
            CREATE TABLE IF NOT EXISTS telegraf_logs (
                timestamp TIMESTAMP,
                process_pid INTEGER,
                process_name VARCHAR,
                config_file VARCHAR,
                log_type VARCHAR, -- 'stdout' or 'stderr'
                message VARCHAR
            );
        """)
        # 创建审计日志表
        conn.execute("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id UUID DEFAULT uuid(),
                timestamp TIMESTAMP DEFAULT now(),
                username VARCHAR,
                ip_address VARCHAR,
                action VARCHAR,
                status VARCHAR, -- 'success' or 'failure'
                details VARCHAR
            );
        """)
        
        # --- 新增：创建数据导入历史相关表 ---

        # 1. 导入批次表
        conn.execute("""
            CREATE TABLE IF NOT EXISTS import_batches (
                id UUID DEFAULT uuid(),
                batch_id VARCHAR UNIQUE,
                file_name VARCHAR,
                total_rows INTEGER,
                processed_rows INTEGER DEFAULT 0,
                success_count INTEGER DEFAULT 0,
                failed_count INTEGER DEFAULT 0,
                skipped_count INTEGER DEFAULT 0,
                status VARCHAR DEFAULT 'processing', -- 'processing', 'completed', 'failed'
                start_time TIMESTAMP DEFAULT now(),
                end_time TIMESTAMP,
                user_id VARCHAR,
                conflict_rule VARCHAR,
                PRIMARY KEY (id)
            );
        """)

        # 2. 导入行记录表
        conn.execute("""
            CREATE TABLE IF NOT EXISTS import_log_rows (
                id UUID DEFAULT uuid(),
                batch_id UUID,
                row_number INTEGER,
                row_content VARCHAR, -- Storing as JSON string
                status VARCHAR, -- 'success_created', 'success_updated', 'failure', 'skipped'
                details VARCHAR,
                timestamp TIMESTAMP DEFAULT now(),
                PRIMARY KEY (id),
                FOREIGN KEY (batch_id) REFERENCES import_batches(id)
            );
        """)

        conn.close()
        logger.info(f"DuckDB 数据库及相关表已初始化: {DUCKDB_PATH}")
    except Exception as e:
        logger.error(f"初始化 DuckDB 失败: {e}")
        raise

def insert_log_entry(conn, timestamp, process_pid, process_name, config_file, log_type, message):
    """
    向 DuckDB 插入一条日志记录。
    接受一个已存在的连接对象。
    """
    try:
        conn.execute("""
            INSERT INTO telegraf_logs (timestamp, process_pid, process_name, config_file, log_type, message)
            VALUES (?, ?, ?, ?, ?, ?);
        """, (timestamp, process_pid, process_name, config_file, log_type, message))
    except Exception as e:
        logger.error(f"插入日志到 DuckDB 失败: {e}")

def get_process_logs(pid, limit=500, log_type=None):
    """
    从 DuckDB 查询指定进程的日志。
    """
    try:
        conn = get_duckdb_connection()
        query = "SELECT timestamp, log_type, message FROM telegraf_logs WHERE process_pid = ?"
        params = [pid]
        if log_type and log_type != 'all':
            query += " AND log_type = ?"
            params.append(log_type)
        query += " ORDER BY timestamp DESC LIMIT ?"
        params.append(limit)
        
        logs = conn.execute(query, params).fetchall()
        conn.close()
        
        return {
            'success': True,
            'logs': [{'timestamp': row[0], 'log_type': row[1], 'message': row[2]} for row in logs]
        }
    except Exception as e:
        logger.error(f"从 DuckDB 查询日志失败: {e}")
        return {'success': False, 'error': str(e)}

def get_historical_processes_from_logs():
    """
    从 DuckDB 的日志中聚合历史进程信息。
    """
    try:
        conn = get_duckdb_connection()
        query = """
            SELECT 
                process_pid, 
                FIRST(process_name) as process_name, 
                FIRST(config_file) as config_file, 
                MIN(timestamp) as start_time, 
                MAX(timestamp) as stop_time
            FROM telegraf_logs
            GROUP BY process_pid
            ORDER BY stop_time DESC
        """
        historical_processes = conn.execute(query).fetchall()
        conn.close()
        return [
            {
                'pid': row[0],
                'name': row[1],
                'config_file': row[2],
                'start_time': row[3].isoformat() if row[3] else None,
                'stop_time': row[4].isoformat() if row[4] else None,
                'status': 'stopped' # 默认状态为 stopped
            }
            for row in historical_processes
        ]
    except Exception as e:
        logger.error(f"从 DuckDB 查询历史进程失败: {e}")
        return []

def delete_historical_processes(pids):
    """
    从 DuckDB 删除指定的历史进程日志。
    """
    try:
        conn = get_duckdb_connection()
        conn.execute(f"DELETE FROM telegraf_logs WHERE process_pid IN ({','.join(['?'] * len(pids))})", pids)
        conn.close()
        return {'success': True}
    except Exception as e:
        logger.error(f"从 DuckDB 删除历史进程失败: {e}")
        return {'success': False, 'error': str(e)}

class DatabaseManager:
    """数据库管理器"""
    
    def __init__(self, app: Optional[Flask] = None):
        self.app = app
        
        # 获取脚本所在目录的绝对路径
        self.base_dir = os.path.dirname(os.path.abspath(__file__))
        self.db_file = os.path.join(self.base_dir, 'database', 'telegraf_manager.db')
        self.backup_dir = os.path.join(self.base_dir, 'database', 'backups')
        
        # 确保数据库目录和备份目录存在
        db_dir = os.path.dirname(self.db_file)
        os.makedirs(db_dir, exist_ok=True)
        os.makedirs(self.backup_dir, exist_ok=True)
        
        logger.info(f"数据库文件路径: {self.db_file}")
        logger.info(f"备份目录路径: {self.backup_dir}")
    
    def backup_database(self, backup_name: Optional[str] = None) -> Dict:
        """
        备份数据库
        
        参数:
            backup_name (str): 自定义备份名称，默认使用时间戳
        
        返回:
            dict: 备份结果信息
        """
        try:
            if not os.path.exists(self.db_file):
                return {
                    'success': False,
                    'message': '数据库文件不存在，无需备份',
                    'backup_file': None
                }
            
            # 生成备份文件名
            if backup_name is None:
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                backup_name = f'telegraf_manager_backup_{timestamp}.db'
            
            backup_file = os.path.join(self.backup_dir, backup_name)
            
            # 使用 SQLite 的 VACUUM INTO 命令进行备份（如果支持）
            try:
                conn = sqlite3.connect(self.db_file)
                conn.execute(f"VACUUM INTO '{backup_file}'")
                conn.close()
                logger.info(f"使用 VACUUM INTO 命令备份数据库到: {backup_file}")
            except sqlite3.OperationalError:
                # 如果 VACUUM INTO 不支持，使用文件复制
                shutil.copy2(self.db_file, backup_file)
                logger.info(f"使用文件复制备份数据库到: {backup_file}")
            
            # 获取备份文件大小
            backup_size = os.path.getsize(backup_file)
            
            return {
                'success': True,
                'message': f'数据库备份成功',
                'backup_file': backup_file,
                'backup_size': backup_size,
                'backup_time': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"数据库备份失败: {str(e)}")
            return {
                'success': False,
                'message': f'数据库备份失败: {str(e)}',
                'backup_file': None
            }
    
    def restore_database(self, backup_file: str) -> Dict:
        """
        从备份恢复数据库
        
        参数:
            backup_file (str): 备份文件路径
        
        返回:
            dict: 恢复结果信息
        """
        try:
            if not os.path.exists(backup_file):
                return {
                    'success': False,
                    'message': f'备份文件不存在: {backup_file}'
                }
            
            # 先备份当前数据库
            current_backup = self.backup_database('before_restore_' + 
                                                datetime.now().strftime('%Y%m%d_%H%M%S'))
            
            # 恢复数据库
            shutil.copy2(backup_file, self.db_file)
            
            logger.info(f"数据库已从备份恢复: {backup_file}")
            
            return {
                'success': True,
                'message': '数据库恢复成功',
                'restored_from': backup_file,
                'current_backup': current_backup.get('backup_file'),
                'restore_time': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"数据库恢复失败: {str(e)}")
            return {
                'success': False,
                'message': f'数据库恢复失败: {str(e)}'
            }
    
    def reinitialize_database(self, create_admin: bool = True) -> Dict:
        """
        重新初始化数据库
        
        参数:
            create_admin (bool): 是否创建默认管理员账户
        
        返回:
            dict: 初始化结果信息
        """
        try:
            # 先备份现有数据库
            backup_result = None
            if os.path.exists(self.db_file):
                try:
                    backup_result = self.backup_database('before_reinit_' + 
                                                       datetime.now().strftime('%Y%m%d_%H%M%S'))
                    logger.info("已备份现有数据库")
                except Exception as backup_error:
                    logger.warning(f"备份现有数据库时出错: {str(backup_error)}")
            
            # 删除现有数据库文件
            if os.path.exists(self.db_file):
                try:
                    os.remove(self.db_file)
                    logger.info("已删除现有数据库文件")
                except Exception as remove_error:
                    logger.error(f"删除数据库文件失败: {str(remove_error)}")
                    # 尝试重命名文件而不是删除
                    backup_name = f"{self.db_file}.broken_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
                    os.rename(self.db_file, backup_name)
                    logger.info(f"已将问题数据库重命名为: {backup_name}")
            
            # 确保数据库目录存在
            db_dir = os.path.dirname(self.db_file)
            try:
                os.makedirs(db_dir, exist_ok=True)
                logger.info(f"已确保数据库目录存在: {db_dir}")
            except Exception as mkdir_error:
                logger.error(f"创建数据库目录失败: {str(mkdir_error)}")
                raise Exception(f"无法创建数据库目录: {str(mkdir_error)}")
            
            # 测试数据库文件创建权限
            try:
                # 尝试创建一个测试文件
                test_file = self.db_file + '.test'
                with open(test_file, 'w') as f:
                    f.write('test')
                os.remove(test_file)
                logger.info("数据库目录写入权限检查通过")
            except Exception as perm_error:
                logger.error(f"数据库目录权限检查失败: {str(perm_error)}")
                raise Exception(f"数据库目录没有写入权限: {str(perm_error)}")
            
            # 重新创建数据库表
            if self.app:
                try:
                    with self.app.app_context():
                        from models import db, User
                        
                        # 创建所有表
                        db.create_all()
                        logger.info("已重新创建数据库表结构")
                        
                        # 验证数据库连接
                        try:
                            # 使用新的SQLAlchemy语法进行连接验证
                            from sqlalchemy import text
                            with db.engine.connect() as connection:
                                connection.execute(text('SELECT 1'))
                            logger.info("数据库连接验证成功")
                        except Exception as conn_error:
                            logger.warning(f"数据库连接验证失败，但表已创建: {str(conn_error)}")
                            # 继续执行，因为表已经创建成功
                        
                        # 创建默认管理员账户
                        if create_admin:
                            try:
                                admin = User(username='admin')
                                admin.set_password('admin123')
                                db.session.add(admin)
                                db.session.commit()
                                logger.info("已创建默认管理员账户")
                            except Exception as admin_error:
                                logger.error(f"创建管理员账户失败: {str(admin_error)}")
                                db.session.rollback()
                                # 继续执行，不因为管理员账户创建失败而失败
                
                except Exception as db_error:
                    logger.error(f"数据库表创建失败: {str(db_error)}")
                    raise Exception(f"数据库表创建失败: {str(db_error)}")
            else:
                logger.warning("没有 Flask app 上下文，跳过数据库表创建")
            
            # 最终验证数据库文件是否创建成功
            if not os.path.exists(self.db_file):
                raise Exception("数据库文件创建失败，文件不存在")
            
            logger.info(f"数据库重新初始化成功，文件位于: {self.db_file}")
            
            return {
                'success': True,
                'message': '数据库重新初始化成功',
                'backup_info': backup_result,
                'admin_created': create_admin,
                'database_file': self.db_file,
                'init_time': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"数据库重新初始化失败: {str(e)}")
            return {
                'success': False,
                'message': f'数据库重新初始化失败: {str(e)}',
                'database_file': self.db_file,
                'init_time': datetime.now().isoformat()
            }
    
    def list_backups(self) -> Dict:
        """
        列出所有备份文件
        
        返回:
            dict: 备份文件列表信息
        """
        try:
            if not os.path.exists(self.backup_dir):
                return {
                    'success': True,
                    'backups': [],
                    'total_count': 0
                }
            
            backups = []
            for file in os.listdir(self.backup_dir):
                if file.endswith('.db'):
                    file_path = os.path.join(self.backup_dir, file)
                    file_stat = os.stat(file_path)
                    
                    backups.append({
                        'filename': file,
                        'filepath': file_path,
                        'size': file_stat.st_size,
                        'created_time': datetime.fromtimestamp(file_stat.st_ctime).isoformat(),
                        'modified_time': datetime.fromtimestamp(file_stat.st_mtime).isoformat()
                    })
            
            # 按创建时间排序（最新的在前）
            backups.sort(key=lambda x: x['created_time'], reverse=True)
            
            return {
                'success': True,
                'backups': backups,
                'total_count': len(backups),
                'backup_dir': self.backup_dir
            }
            
        except Exception as e:
            logger.error(f"列出备份文件失败: {str(e)}")
            return {
                'success': False,
                'message': f'列出备份文件失败: {str(e)}',
                'backups': []
            }
    
    def check_database_integrity(self) -> Dict:
        """
        检查数据库完整性
        
        返回:
            dict: 完整性检查结果
        """
        try:
            if not os.path.exists(self.db_file):
                return {
                    'success': False,
                    'message': '数据库文件不存在',
                    'needs_init': True
                }
            
            # 尝试连接数据库并执行基本查询
            conn = sqlite3.connect(self.db_file)
            cursor = conn.cursor()
            
            # 检查表是否存在
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = [row[0] for row in cursor.fetchall()]
            
            # 检查是否有必要的表
            required_tables = ['users', 'input_sources', 'output_sources', 
                             'point_info', 'config_files', 'telegraf_processes']
            missing_tables = [table for table in required_tables if table not in tables]
            
            # 执行完整性检查
            cursor.execute("PRAGMA integrity_check;")
            integrity_result = cursor.fetchone()[0]
            
            conn.close()
            
            is_healthy = integrity_result == 'ok' and len(missing_tables) == 0
            
            return {
                'success': True,
                'is_healthy': is_healthy,
                'integrity_check': integrity_result,
                'existing_tables': tables,
                'missing_tables': missing_tables,
                'needs_init': len(missing_tables) > 0,
                'check_time': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"数据库完整性检查失败: {str(e)}")
            return {
                'success': False,
                'message': f'数据库完整性检查失败: {str(e)}',
                'is_healthy': False,
                'needs_init': True
            }

# 创建全局数据库管理器实例
db_manager = DatabaseManager()