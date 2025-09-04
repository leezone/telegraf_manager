# -*- coding: utf-8 -*-
"""
API 工具函数
功能：提供通用的API辅助函数，减少代码重复
作者：项目开发团队
"""

import logging
from flask import jsonify, request
from functools import wraps
from flask_login import current_user
from db_manager import get_duckdb_connection

logger = logging.getLogger(__name__)

def add_audit_log(action, status, details=""):
    try:
        username = current_user.username if current_user.is_authenticated else 'anonymous'
        ip_address = request.remote_addr
        conn = get_duckdb_connection()
        conn.execute(
            "INSERT INTO audit_log (username, ip_address, action, status, details) VALUES (?, ?, ?, ?, ?)",
            (username, ip_address, action, status, details)
        )
        conn.close()
    except Exception as e:
        logger.error(f"Failed to add audit log: {e}")


def handle_api_error(func):
    """
    API错误处理装饰器
    
    用于统一处理API函数中的异常
    """
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    return wrapper


def success_response(message, data=None, status_code=200):
    """
    成功响应格式化
    
    参数:
        message (str): 成功消息
        data (dict): 返回数据
        status_code (int): HTTP状态码
    
    返回:
        Response: Flask JSON响应
    """
    response = {'success': True, 'message': message}
    if data:
        response.update(data)
    return jsonify(response), status_code


def error_response(message, status_code=400, details=None):
    """
    错误响应格式化
    
    参数:
        message (str): 错误消息
        status_code (int): HTTP状态码
        details (dict): 额外的错误详情
    
    返回:
        Response: Flask JSON响应
    """
    response = {'error': message}
    if details:
        response['details'] = details
    return jsonify(response), status_code


def validate_json_fields(data, required_fields):
    """
    验证JSON数据中的必需字段
    
    参数:
        data (dict): 请求数据
        required_fields (list): 必需字段列表
    
    返回:
        tuple: (is_valid, missing_fields)
    """
    if not data:
        return False, ['JSON data is required']
    
    missing_fields = []
    for field in required_fields:
        if field not in data or data[field] is None:
            missing_fields.append(field)
    
    return len(missing_fields) == 0, missing_fields


def get_pagination_params(request, default_page=1, default_per_page=50):
    """
    获取分页参数
    
    参数:
        request: Flask请求对象
        default_page: 默认页码
        default_per_page: 默认每页数量
    
    返回:
        tuple: (page, per_page)
    """
    try:
        page = int(request.args.get('page', default_page))
        # 同时兼容 'per_page' 和 'limit' 参数
        per_page_str = request.args.get('per_page') or request.args.get('limit')
        per_page = int(per_page_str) if per_page_str else default_per_page
        
        # Handle 'fetch all' case
        if per_page == -1:
            return page, -1

        # 验证参数范围
        page = max(1, page)
        per_page = min(max(1, per_page), 1000)  # 最大1000条
        
        return page, per_page
    except (ValueError, TypeError):
        return default_page, default_per_page


def format_pagination_response(paginated_data, items_key='items'):
    """
    格式化分页响应
    
    参数:
        paginated_data: SQLAlchemy分页对象
        items_key: 数据项的键名
    
    返回:
        dict: 格式化的响应数据
    """
    return {
        items_key: [item.to_dict_brief() if hasattr(item, 'to_dict_brief') 
                   else item.to_dict() for item in paginated_data.items],
        'pagination': {
            'page': paginated_data.page,
            'per_page': paginated_data.per_page,
            'total': paginated_data.total,
            'pages': paginated_data.pages,
            'has_next': paginated_data.has_next,
            'has_prev': paginated_data.has_prev
        }
    }