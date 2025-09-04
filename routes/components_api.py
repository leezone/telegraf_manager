# -*- coding: utf-8 -*-
"""
可复用组件 API 蓝图
"""

from flask import Blueprint, request
from flask_login import login_required

from models import db, OutputSource, GlobalParameter, ProcessingTag
from api_utils import handle_api_error, success_response, error_response, add_audit_log

components_api_bp = Blueprint('components_api', __name__, url_prefix='/api/components')

@components_api_bp.route('/create_from_snippets', methods=['POST'])
@login_required
@handle_api_error
def create_components_from_snippets():
    """从解析出的配置片段批量创建可复用组件"""
    data = request.get_json()
    snippets_to_save = data.get('snippets')

    if not snippets_to_save:
        return error_response('没有提供要保存的片段', 400)

    saved_count = {
        'data_source': 0,
        'global_parameter': 0,
        'processing_transformation': 0
    }
    errors = []
    # 用来追踪在本次请求中已经处理过的名称，防止同批次内重名
    processed_names = set()

    for snippet in snippets_to_save:
        name = snippet.get('name')
        content = snippet.get('content')
        level1_type = snippet.get('level1_type')
        level2_type = snippet.get('level2_type')

        if not all([name, content, level1_type, level2_type]):
            errors.append(f"片段缺少 name, content, 或分类信息: {str(snippet)[:50]}...")
            continue

        # 检查在本次批量操作中是否已经有同名组件
        if name in processed_names:
            errors.append(f"组件名 '{name}' 在本次提交中重复，已跳过。")
            continue

        try:
            if level1_type == 'data_source':
                if OutputSource.query.filter_by(name=name).first():
                    errors.append(f"数据源组件 '{name}' 已在数据库中存在，已跳过。")
                    continue
                
                # Map plural to singular for consistency
                source_type_singular = level2_type.rstrip('s')

                new_component = OutputSource(
                    name=name,
                    config=content,
                    description=f"从配置文件解析并创建",
                    source_type=source_type_singular # input or output
                )
                db.session.add(new_component)
                saved_count['data_source'] += 1

            elif level1_type == 'global_parameter':
                if GlobalParameter.query.filter_by(name=name).first():
                    errors.append(f"全局参数组件 '{name}' 已在数据库中存在，已跳过。")
                    continue

                new_component = GlobalParameter(
                    name=name,
                    config=content,
                    description=f"从配置文件解析并创建 ({level2_type})"
                )
                db.session.add(new_component)
                saved_count['global_parameter'] += 1

            elif level1_type == 'processing_transformation':
                if ProcessingTag.query.filter_by(name=name).first():
                    errors.append(f"处理转换组件 '{name}' 已在数据库中存在，已跳过。")
                    continue
                
                new_component = ProcessingTag(
                    name=name,
                    config=content,
                    description=f"从配置文件解析并创建",
                    plugin_type=level2_type # processor or aggregator
                )
                db.session.add(new_component)
                saved_count['processing_transformation'] += 1
            else:
                errors.append(f"未知的一级组件类型: {level1_type}")
                continue # 跳过未知类型的处理
            
            # 如果前面的检查都通过，将名称添加到已处理集合中
            processed_names.add(name)

        except Exception as e:
            errors.append(f"保存组件 '{name}' 时出错: {str(e)}")

    if any(v > 0 for v in saved_count.values()):
        db.session.commit()
        add_audit_log(
            'components_create_from_snippet', 
            'success', 
            f"成功创建了 {saved_count['data_source']} 个数据源, "
            f"{saved_count['global_parameter']} 个全局参数, "
            f"和 {saved_count['processing_transformation']} 个处理转换组件。"
        )

    total_saved = sum(saved_count.values())
    if total_saved == 0 and errors:
         error_details = ", ".join(errors)
         return error_response(f"所有组件都未能保存。详情: {error_details}", 400)

    return success_response(
        f"操作完成。成功保存 {total_saved} 个组件。", 
        {'saved_count': saved_count, 'errors': errors},
        201 if not errors else 207 # 201 Created or 207 Multi-Status
    )