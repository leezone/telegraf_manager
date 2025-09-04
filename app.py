# -*- coding: utf-8 -*-
"""
Telegraf 管理系统主应用程序 - 工厂模式
"""

import os
import logging
import psutil
from flask import Flask, request
from flask_login import LoginManager, login_required
from flask_migrate import Migrate
from datetime import datetime, timezone

from models import db, User, ConfigFile, TelegrafProcess
from db_manager import db_manager, DUCKDB_PATH
from app_init import init_database_and_admin, print_startup_completion
from process_manager import start_process, stop_process, restart_process # 添加 restart_process
from api_utils import error_response, success_response, add_audit_log
from db_manager import get_process_logs, get_historical_processes_from_logs

def create_app():
    """创建并配置 Flask 应用实例"""
    app = Flask(__name__)
    app.start_time = datetime.now(timezone.utc)

    # --- 应用配置 ---
    db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'database', 'telegraf_manager.db')
    app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_path}'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'a-default-safe-key')
    app.config['DUCKDB_PATH'] = DUCKDB_PATH

    # --- 扩展初始化 ---
    db.init_app(app)
    Migrate(app, db)
    
    login_manager = LoginManager()
    login_manager.init_app(app)
    login_manager.login_view = 'auth.login'  # 蓝图化的路由
    login_manager.login_message = '请先登录以访问此页面'

    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(User, int(user_id))

    # --- 注册蓝图 ---
    from routes.main import main_bp
    from routes.auth import auth_bp
    from routes.config_files_api import config_files_api_bp
    from routes.data_management_api import data_management_api_bp
    from routes.import_export_api import import_export_api_bp
    from routes.admin_api import admin_api_bp
    from routes.config_generator_api import config_generator_api_bp
    from routes.components_api import components_api_bp
    from routes.snippets_api import snippets_api_bp
    from routes.toml_query_api import toml_query_api_bp
    from routes.telegraf_api import telegraf_api_bp # <-- 新增导入
    from routes.system_api import system_api_bp
    from routes.process_api import process_api_bp

    app.register_blueprint(main_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(config_files_api_bp)
    app.register_blueprint(data_management_api_bp, url_prefix='/api')
    app.register_blueprint(import_export_api_bp)
    app.register_blueprint(admin_api_bp)
    app.register_blueprint(config_generator_api_bp)
    app.register_blueprint(components_api_bp)
    app.register_blueprint(snippets_api_bp)
    app.register_blueprint(toml_query_api_bp)
    app.register_blueprint(telegraf_api_bp) # <-- 新增注册
    app.register_blueprint(system_api_bp)
    app.register_blueprint(process_api_bp)

    # --- 初始化数据库和管理员 ---
    with app.app_context():
        if not init_database_and_admin(app, db_manager):
            exit(1)

    return app

app = create_app()

if __name__ == '__main__':
    port = int(os.environ.get('FLASK_PORT', 5000))
    host = os.environ.get('FLASK_HOST', '0.0.0.0')
    debug = os.environ.get('FLASK_DEBUG', 'true').lower() == 'true'

    if debug:
        logging.basicConfig(level=logging.DEBUG,
                            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        app.logger.setLevel(logging.DEBUG)
    else:
        logging.basicConfig(level=logging.INFO,
                            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        app.logger.setLevel(logging.INFO)

    print_startup_completion(host, port)
    app.run(debug=debug, host=host, port=port)