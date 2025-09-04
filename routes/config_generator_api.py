# -*- coding: utf-8 -*-
"""
配置生成器 API 蓝图
"""

from flask import Blueprint, request
from flask_login import login_required

from models import db, OutputSource, GlobalParameter, PointTemplate, ProcessingTag, PointInfo
from api_utils import success_response, error_response

config_generator_api_bp = Blueprint('config_generator_api', __name__, url_prefix='/api/config')

@config_generator_api_bp.route('/generate_from_components', methods=['POST'])
@login_required
def generate_from_components():
    """根据选择的组件生成 Telegraf 配置文件"""
    data = request.get_json()
    if not data:
        return error_response('Request body must be JSON', 400)

    # --- Fetch components from DB based on IDs ---
    input_source_id = data.get('input_source_id')
    output_source_id = data.get('output_source_id')
    global_parameter_ids = data.get('global_parameter_ids', [])
    processing_tag_ids = data.get('processing_tag_ids', [])
    point_template_ids = data.get('point_template_ids', []) # Added this line
    point_info_ids = data.get('point_info_ids', [])

    # --- Basic Validation ---
    if not input_source_id or not output_source_id:
        return error_response('Input and Output sources are required', 400)

    # --- Assemble Config String ---
    config_parts = []

    # 1. Agent Section (from Global Parameters)
    if global_parameter_ids:
        params = GlobalParameter.query.filter(GlobalParameter.id.in_(global_parameter_ids)).all()
        config_parts.append("# Global Agent Configuration")
        for param in params:
            config_parts.append(param.config)
        config_parts.append("\n")

    # 2. Output Section
    output_source = OutputSource.query.get(output_source_id)
    if output_source:
        config_parts.append("# Output Configuration")
        config_parts.append(output_source.config)
        config_parts.append("\n")

    # 3. Processor Sections
    if processing_tag_ids:
        tags = ProcessingTag.query.filter(ProcessingTag.id.in_(processing_tag_ids)).all()
        config_parts.append("# Processor & Aggregator Plugins")
        for tag in tags:
            config_parts.append(tag.config)
        config_parts.append("\n")

    # 4. Input Section
    input_source = OutputSource.query.get(input_source_id)
    if input_source:
        config_parts.append("# Input Configuration")
        config_parts.append(input_source.config)
        config_parts.append("\n")

    # 5. Point Templates Section
    if point_template_ids:
        templates = PointTemplate.query.filter(PointTemplate.id.in_(point_template_ids)).all()
        points = PointInfo.query.filter(PointInfo.id.in_(point_info_ids)).all()
        config_parts.append("# Data Point Definitions based on Templates")
        for template in templates:
            for point in points:
                # Basic placeholder replacement
                point_config = template.content
                point_config = point_config.replace("{{measurement}}", point.measurement or '')
                point_config = point_config.replace("{{original_point_name}}", point.original_point_name or '')
                point_config = point_config.replace("{{normalized_point_name}}", point.normalized_point_name or '')
                point_config = point_config.replace("{{point_comment}}", point.point_comment or '')
                point_config = point_config.replace("{{unit}}", point.unit or '')
                point_config = point_config.replace("{{tags}}", point.tags or '{}')
                point_config = point_config.replace("{{fields}}", point.fields or '{}')
                config_parts.append(point_config)
        config_parts.append("\n")

    # 6. Data Points (as comments for reference)
    elif point_info_ids: # Only add this if no templates were used
        points = PointInfo.query.filter(PointInfo.id.in_(point_info_ids)).all()
        config_parts.append("# Selected Data Points for Reference")
        for point in points:
            config_parts.append(f"# - {point.measurement}: {point.fields}")
        config_parts.append("\n")

    final_config = "\n".join(config_parts)
    
    return success_response("Config generated successfully", {'config': final_config})
