# -*- coding: utf-8 -*-
"""
通用工具函数
功能：提供项目中通用的工具函数和装饰器
作者：项目开发团队
"""

import logging
from functools import wraps

logger = logging.getLogger(__name__)


def handle_exceptions(default_return=None, log_prefix="操作"):
    """
    通用异常处理装饰器
    
    参数:
        default_return: 异常时的默认返回值
        log_prefix: 日志前缀
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                logger.error(f"{log_prefix}时发生异常: {str(e)}")
                if default_return is not None:
                    if callable(default_return):
                        return default_return(e)
                    return default_return
                # 如果没有指定默认返回值，重新抛出异常
                raise
        return wrapper
    return decorator


def create_error_response(success=False, error_msg="", **kwargs):
    """
    创建错误响应格式
    
    参数:
        success: 操作是否成功
        error_msg: 错误消息
        **kwargs: 其他响应字段
    
    返回:
        dict: 格式化的响应
    """
    response = {
        'success': success,
        'error': error_msg
    }
    response.update(kwargs)
    return response


def create_success_response(success=True, message="", **kwargs):
    """
    创建成功响应格式
    
    参数:
        success: 操作是否成功
        message: 成功消息
        **kwargs: 其他响应字段
    
    返回:
        dict: 格式化的响应
    """
    response = {
        'success': success,
        'message': message
    }
    response.update(kwargs)
    return response


def safe_int_convert(value, default=0):
    """
    安全的整数转换
    
    参数:
        value: 要转换的值
        default: 转换失败时的默认值
    
    返回:
        int: 转换后的整数值
    """
    try:
        return int(value)
    except (ValueError, TypeError):
        return default


def safe_bool_convert(value, default=False):
    """
    安全的布尔值转换
    
    参数:
        value: 要转换的值
        default: 转换失败时的默认值
    
    返回:
        bool: 转换后的布尔值
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in ('true', '1', 'yes', 'on')
    if isinstance(value, (int, float)):
        return bool(value)
    return default


def format_file_size(size_bytes):
    """
    格式化文件大小
    
    参数:
        size_bytes: 字节数
    
    返回:
        str: 格式化的文件大小
    """
    if size_bytes == 0:
        return "0B"
    
    size_names = ["B", "KB", "MB", "GB", "TB"]
    import math
    i = int(math.floor(math.log(size_bytes, 1024)))
    p = math.pow(1024, i)
    s = round(size_bytes / p, 2)
    
    return f"{s} {size_names[i]}"


def validate_port(port):
    """
    验证端口号是否有效
    
    参数:
        port: 端口号
    
    返回:
        bool: 端口号是否有效
    """
    try:
        port_int = int(port)
        return 1 <= port_int <= 65535
    except (ValueError, TypeError):
        return False


def sanitize_filename(filename):
    """
    清理文件名，移除不安全字符
    
    参数:
        filename: 原始文件名
    
    返回:
        str: 清理后的文件名
    """
    import re
    # 移除或替换不安全字符
    filename = re.sub(r'[<>:"/\\|?*]', '_', filename)
    # 移除连续的下划线
    filename = re.sub(r'_+', '_', filename)
    # 移除首尾的点和空格
    filename = filename.strip('. ')
    return filename or 'unnamed'