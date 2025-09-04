# -*- coding: utf-8 -*-
"""
主界面Web路由蓝图
"""

from flask import Blueprint, render_template, redirect, url_for
from flask_login import login_required

main_bp = Blueprint('main', __name__)

@main_bp.route('/')
def index():
    return redirect(url_for('auth.login'))

@main_bp.route('/dashboard')
@login_required
def dashboard():
    return render_template('dashboard.html')

@main_bp.route('/data_management')
@login_required
def data_management():
    return render_template('data_management.html')

@main_bp.route('/config_files')
@login_required
def config_files():
    return render_template('config_files.html')

@main_bp.route('/processes')
@login_required
def processes():
    return render_template('processes.html')

@main_bp.route('/admin/management')
@login_required
def admin_management():
    return render_template('admin_management.html')

@main_bp.route('/admin/audit_log')
@login_required
def admin_audit_log():
    return render_template('admin_audit_log.html')

@main_bp.route('/import-export')
@login_required
def import_export_page():
    return render_template('import_export_page.html')
