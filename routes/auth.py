# -*- coding: utf-8 -*-
"""
认证蓝图
"""

from flask import Blueprint, request, render_template, redirect, url_for, flash
from flask_login import login_user, logout_user, login_required, current_user

from models import db, User
from api_utils import add_audit_log, success_response, error_response

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/api/user/change-password', methods=['POST'])
@login_required
def change_password():
    data = request.get_json()
    current_password = data.get('current_password')
    new_password = data.get('new_password')
    confirm_new_password = data.get('confirm_new_password')

    if not all([current_password, new_password, confirm_new_password]):
        return error_response('所有字段都是必填的。', 400)

    if not current_user.check_password(current_password):
        add_audit_log('change_password', 'failure', f'User {current_user.username} failed to change password: incorrect current password.')
        return error_response('当前密码不正确。', 403)

    if len(new_password) < 8:
        return error_response('新密码长度不能少于8位。', 400)

    if new_password != confirm_new_password:
        return error_response('新密码和确认密码不匹配。', 400)

    current_user.set_password(new_password)
    db.session.commit()
    
    add_audit_log('change_password', 'success', f'User {current_user.username} successfully changed their password.')
    return success_response('密码修改成功！')


@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('main.dashboard'))
        
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        user = User.query.filter_by(username=username).first()
        
        if user and user.check_password(password):
            login_user(user)
            add_audit_log('user_login', 'success', f'User {username} logged in.')
            # 登录成功后，重定向到之前请求的页面或仪表盘
            next_page = request.args.get('next')
            return redirect(next_page or url_for('main.dashboard'))
        else:
            add_audit_log('user_login', 'failure', f'Failed login for user {username}.')
            flash('用户名或密码错误')
            
    return render_template('login.html')

@auth_bp.route('/logout')
@login_required
def logout():
    username = current_user.username
    logout_user()
    add_audit_log('user_logout', 'success', f'User {username} logged out.')
    flash('您已成功登出。')
    return redirect(url_for('auth.login'))
