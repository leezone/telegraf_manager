# -*- coding: utf-8 -*-
"""
TOML 交互式提取 API
"""

import tomli
from flask import Blueprint, request
from flask_login import login_required
from api_utils import handle_api_error, success_response, error_response

# --- Blueprint Definition ---
toml_query_api_bp = Blueprint('toml_query_api', __name__, url_prefix='/api/toml_query')

# --- Helper Functions ---

def get_toml_structure(data, path=''):
    """递归地为TOML数据生成一个结构/模式表示"""
    structure = {}
    if isinstance(data, dict):
        for key, value in data.items():
            new_path = f"{path}.{key}" if path else key
            if isinstance(value, dict):
                structure[key] = {'type': 'table', 'path': new_path, 'children': get_toml_structure(value, new_path)}
            elif isinstance(value, list) and value and all(isinstance(i, dict) for i in value):
                # Array of tables. Merge keys from all tables to create a representative structure.
                merged_children_data = {}
                for item in value:
                    if isinstance(item, dict):
                        merged_children_data.update(item)
                structure[key] = {
                    'type': 'array_of_tables',
                    'path': new_path,
                    'children': get_toml_structure(merged_children_data, new_path)
                }
            else:
                structure[key] = {'type': 'key_value', 'path': new_path}
    return structure

def get_value_by_path(data, path_str):
    """
    通过点符号路径从嵌套字典中获取值。
    如果路径中的任何部分是列表，则会尝试从列表中的每个字典中获取后续路径，
    并将结果收集到一个扁平化的列表中。
    """
    keys = path_str.split('.')

    def recursive_get(current_data, current_keys):
        if not current_keys:
            return current_data

        key = current_keys[0]
        remaining_keys = current_keys[1:]

        if isinstance(current_data, list):
            results = []
            for item in current_data:
                # 递归地对列表中的每个项目应用剩余的路径
                res = recursive_get(item, [key] + remaining_keys)
                if res is not None:
                    if isinstance(res, list):
                        results.extend(res)
                    else:
                        results.append(res)
            return results

        if isinstance(current_data, dict) and key in current_data:
            return recursive_get(current_data[key], remaining_keys)

        return None

    return recursive_get(data, keys)

# --- API Routes ---

@toml_query_api_bp.route('/structure', methods=['POST'])
@login_required
@handle_api_error
def get_structure_endpoint():
    """解析TOML内容并返回其结构"""
    data = request.get_json()
    content = data.get('content')
    if not content:
        return error_response('缺少内容', 400)

    try:
        toml_data = tomli.loads(content)
        structure = get_toml_structure(toml_data)
        return success_response("TOML structure parsed successfully", {
            'structure': structure,
            'toml_data': toml_data
        })
    except tomli.TOMLDecodeError as e:
        return error_response(f"无效的TOML格式: {e}", 400)

@toml_query_api_bp.route('/preview_extraction', methods=['POST'])
@login_required
@handle_api_error
def preview_extraction_endpoint():
    """根据用户定义的查询预览数据点提取"""
    data = request.get_json()
    content = data.get('content')
    query = data.get('query')

    if not all([content, query]):
        return error_response('缺少内容或查询', 400)

    try:
        toml_data = tomli.loads(content)
    except tomli.TOMLDecodeError as e:
        return error_response(f"无效的TOML格式: {e}", 400)

    base_list = get_value_by_path(toml_data, query.get('from'))
    if not isinstance(base_list, list):
        # 如果它不是列表，也许它是一个应该成为列表的单个对象
        if isinstance(base_list, dict):
            base_list = [base_list]
        else:
            return error_response(f"路径 '{query.get('from')}' 未找到或不是一个列表", 400)

    select_map = query.get('select', [])
    point_previews = []

    for item in base_list:
        point = {}
        # 假设 item 是一个字典，代表列表中的一个元素
        # TODO: 实现更复杂的父级路径(../)查找
        for mapping in select_map:
            source_path = mapping.get('source_path')
            target_field = mapping.get('target_field')
            if source_path and target_field:
                value = item.get(source_path) # 简化版：只在当前项中查找
                if value is not None:
                    point[target_field] = value
        
        if point: # 只有在提取到数据时才添加
            point_previews.append(point)

    return success_response(f"成功提取 {len(point_previews)} 个数据点进行预览", {'point_previews': point_previews})