# -*- coding: utf-8 -*-
"""
管理和审计相关的 API 蓝图
"""

import math
from flask import Blueprint, request
from flask_login import login_required

from models import db, User
from db_manager import get_duckdb_connection
from api_utils import success_response, get_pagination_params, error_response, add_audit_log

admin_api_bp = Blueprint('admin_api', __name__, url_prefix='/api')

@admin_api_bp.route('/users', methods=['GET'])
@login_required
def get_users():
    """获取用户列表，支持分页"""
    page, per_page = get_pagination_params(request)
    
    try:
        pagination = db.paginate(db.select(User).order_by(User.id), page=page, per_page=per_page, error_out=False)
        return success_response('Users retrieved successfully', {
            'items': [user.to_dict() for user in pagination.items],
            'pagination': {
                'page': pagination.page,
                'per_page': pagination.per_page,
                'total': pagination.total,
                'pages': pagination.pages,
                'has_next': pagination.has_next,
                'has_prev': pagination.has_prev
            }
        })
    except Exception as e:
        return error_response(f"Failed to retrieve users: {str(e)}", 500)

@admin_api_bp.route('/users', methods=['POST'])
@login_required
def create_user():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')

    if not username or not password:
        return error_response('Username and password are required.', 400)

    if len(password) < 8:
        return error_response('Password must be at least 8 characters long.', 400)

    if User.query.filter_by(username=username).first():
        return error_response(f'User {username} already exists.', 409)

    new_user = User(username=username)
    new_user.set_password(password)
    db.session.add(new_user)
    db.session.commit()
    add_audit_log('user_create', 'success', f'Admin created user: {username}')
    return success_response('User created successfully', new_user.to_dict(), 201)

@admin_api_bp.route('/users/<int:user_id>/password', methods=['PUT'])
@login_required
def reset_user_password(user_id):
    user = User.query.get_or_404(user_id)
    data = request.get_json()
    new_password = data.get('new_password')

    if not new_password or len(new_password) < 8:
        return error_response('New password must be at least 8 characters long.', 400)

    user.set_password(new_password)
    db.session.commit()
    add_audit_log('password_reset', 'success', f'Admin reset password for user: {user.username}')
    return success_response(f"Password for {user.username} has been reset.")

@admin_api_bp.route('/users/<int:user_id>', methods=['DELETE'])
@login_required
def delete_user(user_id):
    user = User.query.get_or_404(user_id)
    if user.username == 'admin':
        add_audit_log('user_delete', 'failure', f'Attempted to delete admin user.')
        return error_response('Cannot delete the primary admin user.', 403)

    username = user.username
    db.session.delete(user)
    db.session.commit()
    add_audit_log('user_delete', 'success', f'Admin deleted user: {username}')
    return success_response('User deleted successfully.')


@admin_api_bp.route('/audit_log', methods=['GET', 'POST'])
@login_required
def get_audit_log():
    """
    获取审计日志记录，为 DataTables 服务器端处理进行优化。
    支持分页、搜索和排序，可通过 GET 或 POST 请求。
    """
    conn = get_duckdb_connection()
    try:
        # 根据请求方法确定参数来源
        if request.method == 'POST':
            params_source = request.form
        else:
            params_source = request.args

        # DataTables parameters
        draw = params_source.get('draw', 1, type=int)
        start = params_source.get('start', 0, type=int)
        length = params_source.get('length', 10, type=int)
        search_value = params_source.get('search[value]', '', type=str)
        order_column_index = params_source.get('order[0][column]', 0, type=int)
        order_dir = params_source.get('order[0][dir]', 'desc', type=str)

        columns = ['timestamp', 'username', 'ip_address', 'action', 'status', 'details']
        order_column_name = columns[order_column_index] if 0 <= order_column_index < len(columns) else 'timestamp'

        # Base query
        base_query = "FROM audit_log"
        
        # Total records
        total_records_result = conn.execute(f"SELECT COUNT(*) {base_query}").fetchone()
        total_records = total_records_result[0] if total_records_result else 0

        # Filtering
        where_clause = ""
        params = []
        if search_value:
            like_term = f'%{search_value}%'
            where_clause = " WHERE username ILIKE ? OR ip_address ILIKE ? OR action ILIKE ? OR status ILIKE ? OR details ILIKE ?"
            params = [like_term] * 5
        
        # Filtered records count
        count_query = f"SELECT COUNT(*) {base_query}{where_clause}"
        filtered_records_result = conn.execute(count_query, params).fetchone()
        records_filtered = filtered_records_result[0] if filtered_records_result else 0

        # Data query
        data_query = f"""
            SELECT id, timestamp, username, ip_address, action, status, details 
            {base_query}
            {where_clause}
            ORDER BY {order_column_name} {order_dir}
            LIMIT ? OFFSET ?
        """
        
        final_params = params + [length, start]
        logs_data = conn.execute(data_query, final_params).fetchall()

        # Format data for response
        items = [
            {
                'id': row[0],
                'timestamp': row[1].isoformat(),
                'username': row[2],
                'ip_address': row[3],
                'action': row[4],
                'status': row[5],
                'details': row[6]
            }
            for row in logs_data
        ]

        # DataTables response format
        response = {
            'draw': draw,
            'recordsTotal': total_records,
            'recordsFiltered': records_filtered,
            'data': items
        }
        
        # Note: We are not using the standard success_response wrapper here
        # because DataTables expects a specific top-level structure.
        return response
    finally:
        conn.close()
