# -*- coding: utf-8 -*-
"""
应用初始化模块
功能：提供统一的应用初始化逻辑，避免代码重复
作者：项目开发团队
"""

import sys
from datetime import datetime
from db_manager import init_duckdb

def init_database_and_admin(app, db_manager):
    """
    统一的数据库初始化和管理员账户创建逻辑
    
    参数:
        app: Flask应用实例
        db_manager: 数据库管理器实例
    
    返回:
        bool: 初始化是否成功
    """
    # 初始化 DuckDB
    try:
        init_duckdb()
        print("✅ DuckDB 数据库初始化成功")
    except Exception as e:
        print(f"❌ DuckDB 数据库初始化失败: {str(e)}")
        return False

    # 设置数据库管理器的 app 引用
    db_manager.app = app
    
    print("=" * 60)
    print("🚀 Telegraf 管理系统启动中...")
    print("=" * 60)
    
    # 检查数据库完整性
    print("📊 正在检查数据库完整性...")
    
    # 在应用上下文中执行数据库操作
    with app.app_context():
        try:
            from models import User, db
            # 检查管理员用户是否存在
            if not User.query.filter_by(username='admin').first():
                print('👤 正在创建默认管理员账户...')
                admin = User(username='admin')
                admin.set_password('admin123')
                db.session.add(admin)
                db.session.commit()
                print('✅ 默认管理员账户已创建：用户名=admin，密码=admin123')
            else:
                print('👤 管理员账户已存在')
        except Exception as e:
            # 如果在检查或创建用户时发生错误（例如，因为表不存在），
            # 这通常意味着数据库需要初始化。
            print(f"⚠️  检测到数据库问题 (例如，'user' 表可能不存在): {e}")
            print("🔧 将通过 Flask-Migrate 进行数据库初始化或迁移。")
            # 此处不返回 False，因为启动脚本将处理迁移
            pass

    return True


def print_startup_completion(host, port):
    """
    打印启动完成信息
    
    参数:
        host: 主机地址
        port: 端口号
    """
    print("=" * 60)
    print("🎉 系统启动完成！")
    print(f"🌐 访问地址: http://{host}:{port}")
    print("👤 管理员账户: admin / admin123")
    print("=" * 60)


def create_development_launcher(port, host, debug_mode):
    """
    创建开发环境启动器脚本内容
    
    参数:
        port: 端口号
        host: 主机地址
        debug_mode: 调试模式
    
    返回:
        str: 启动器脚本内容
    """
    return f"""#!/usr/bin/env python
# -*- coding: utf-8 -*-
import os
import sys

# 设置端口和主机
port = int(os.environ.get('FLASK_PORT', {port}))
host = os.environ.get('FLASK_HOST', '{host}')
debug = os.environ.get('FLASK_DEBUG', '{debug_mode}').lower() == 'true'

# 导入主应用
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

if __name__ == '__main__':
    from app import app, db_manager
    from app_init import init_database_and_admin, print_startup_completion
    
    # 初始化数据库和管理员账户
    if not init_database_and_admin(app, db_manager):
        sys.exit(1)
    
    # 打印启动完成信息
    print_startup_completion(host, port)
    
    # 启动 Flask 开发服务器
    app.run(debug=debug, host=host, port=port)
"""


def create_gunicorn_config(host, port, workers):
    """
    创建Gunicorn配置文件内容
    
    参数:
        host: 主机地址
        port: 端口号
        workers: 工作进程数
    
    返回:
        str: Gunicorn配置文件内容
    """
    return f"""# Gunicorn 配置文件
import multiprocessing
import os

# 服务器绑定
bind = "{host}:{port}"

# 工作进程
workers = {workers}
worker_class = "sync"
worker_connections = 1000
max_requests = 1000
max_requests_jitter = 100

# 超时设置
timeout = 30
keepalive = 2

# 日志配置
accesslog = "-"
errorlog = "-"
loglevel = "info"
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)s'

# 进程命名
proc_name = "telegraf_manager"

# 预加载应用
preload_app = True

# PID 文件
pidfile = "telegraf_manager.pid"

# 重启前优雅关闭
graceful_timeout = 30

# 临时目录
tmp_upload_dir = None
"""