# -*- coding: utf-8 -*-
"""
配置片段处理 API 蓝图
"""

import tomli
from flask import Blueprint, request
from flask_login import login_required

from api_utils import handle_api_error, success_response, error_response

snippets_api_bp = Blueprint('snippets_api', __name__, url_prefix='/api/snippets')

@snippets_api_bp.route('/parse_as_points', methods=['POST'])
@login_required
@handle_api_error
def parse_snippet_as_points():
    """尝试从任意一个配置片段中解析出数据点信息"""
    data = request.get_json()
    content = data.get('content')

    if not content:
        return error_response('没有提供需要解析的内容', 400)

    try:
        config_data = tomli.loads(content)
    except tomli.TOMLDecodeError as e:
        return error_response(f"无效的 TOML 格式: {e}", 400)

    point_previews = []
    
    # 这是一个通用的解析逻辑，尝试从不同的输入插件结构中提取数据点
    # 目前主要针对 opcua 格式，可以扩展以支持更多格式
    for section, section_content in config_data.items():
        if not isinstance(section_content, list):
            continue

        for plugin_instance in section_content:
            # 检查 inputs.opcua 格式
            if 'group' in plugin_instance and isinstance(plugin_instance['group'], list):
                for group in plugin_instance['group']:
                    measurement = group.get('name', 'default_measurement')
                    if 'nodes' in group and isinstance(group['nodes'], list):
                        for node in group['nodes']:
                            point_previews.append({
                                'measurement': measurement,
                                'original_point_name': node.get('nodeId'),
                                'normalized_point_name': node.get('nodeId'), # Placeholder
                                'point_comment': f"从片段解析",
                                'tags': '{"":""}', # Placeholder
                                'fields': '{"":""}', # Placeholder
                                'data_source': 'parsed_snippet',
                                'is_locked': True
                            })
    
    return success_response("片段解析成功", {"point_previews": point_previews})
