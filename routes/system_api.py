# -*- coding: utf-8 -*-
"""
系统状态 API 蓝图
"""

import os
import threading
import sys
import psutil
import subprocess
from datetime import datetime, timezone

from flask import Blueprint, jsonify, current_app
from flask_login import login_required

from models import db
from api_utils import handle_api_error, success_response

system_api_bp = Blueprint('system_api', __name__, url_prefix='/api/system')

# --- Helper Functions ---

def get_file_stats(path):
    """获取文件的大小和最后修改时间"""
    if not path or not os.path.exists(path):
        return { "size_mb": 0, "last_modified": None }
    try:
        size_bytes = os.path.getsize(path)
        mtime = os.path.getmtime(path)
        return {
            "size_mb": round(size_bytes / (1024 * 1024), 2),
            "last_modified": datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
        }
    except Exception:
        return { "size_mb": 0, "last_modified": None }

def get_telegraf_version():
    """获取 Telegraf 版本号"""
    try:
        result = subprocess.run(['telegraf', '--version'], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            # The output is typically "Telegraf 1.xx.x ..."
            return result.stdout.split(' ')[1]
        return "Not Found"
    except Exception:
        return "Not Found"

# --- API Endpoint ---

@system_api_bp.route('/status', methods=['GET'])
@login_required
@handle_api_error
def get_system_status():
    """获取系统整体运行状态"""
    
    # 1. 应用状态
    app_status = {
        "mode": 'Development' if current_app.debug else 'Production',
        "threads": threading.active_count(),
        "python_version": sys.version,
        "uptime_seconds": (datetime.now(timezone.utc) - current_app.start_time).total_seconds() if hasattr(current_app, 'start_time') else 0
    }

    # 2. 数据库状态
    db_path = current_app.config.get('SQLALCHEMY_DATABASE_URI', '').replace('sqlite:///', '')
    duckdb_path = current_app.config.get('DUCKDB_PATH', '')
    db_status = {
        "sqlite": get_file_stats(db_path),
        "duckdb": get_file_stats(duckdb_path)
    }

    # 3. 依赖组件状态
    dependencies_status = {
        "telegraf_version": get_telegraf_version()
    }

    return success_response("System status retrieved successfully", {
        "app_status": app_status,
        "db_status": db_status,
        "dependencies_status": dependencies_status
    })
