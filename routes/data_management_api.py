import re
import json
from flask import Blueprint, request, jsonify
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from werkzeug.utils import secure_filename
import pandas as pd
import uuid
from datetime import datetime, timezone

from models import db, PointInfo, PointTemplate, ProcessingTag, OutputSource, GlobalParameter, ConfigFile, PointInfoHistory
from api_utils import handle_api_error, add_audit_log, get_pagination_params


data_management_api_bp = Blueprint('data_management_api', __name__)

ALLOWED_EXTENSIONS = {'csv', 'xlsx'}

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@data_management_api_bp.route('/point_info', methods=['GET'])
@handle_api_error
def get_point_info():
    page, per_page = get_pagination_params(request)
    offset = (page - 1) * per_page
    
    query = PointInfo.query

    # Search
    search = request.args.get('search')
    if search:
        search_term = f"%{search}%"
        # Join with ConfigFile to allow searching by config file name
        query = query.outerjoin(ConfigFile, PointInfo.config_file_id == ConfigFile.id)
        query = query.filter(
            db.or_(
                PointInfo.measurement.ilike(search_term),
                PointInfo.original_point_name.ilike(search_term),
                PointInfo.normalized_point_name.ilike(search_term),
                PointInfo.point_comment.ilike(search_term),
                PointInfo.import_batch.ilike(search_term),
                ConfigFile.file_name.ilike(search_term)
            )
        )

    # Sorting
    sort_by = request.args.get('sort_by', 'id')
    sort_dir = request.args.get('sort_dir', 'asc')
    if hasattr(PointInfo, sort_by):
        if sort_dir == 'desc':
            query = query.order_by(db.desc(getattr(PointInfo, sort_by)))
        else:
            query = query.order_by(db.asc(getattr(PointInfo, sort_by)))

    total_items = query.count()
    paginated_items = query.offset(offset).limit(per_page).all()

    results = [item.to_dict() for item in paginated_items]

    return jsonify({
        'items': results,
        'pagination': {
            'total': total_items,
            'page': page,
            'per_page': per_page,
            'pages': (total_items + per_page - 1) // per_page
        }
    })

@data_management_api_bp.route('/point_info/<int:item_id>', methods=['PUT'])
@handle_api_error
def update_point_info(item_id):
    item = PointInfo.query.get_or_404(item_id)
    data = request.get_json()

    # Update fields
    item.measurement = data.get('measurement', item.measurement)
    item.original_point_name = data.get('original_point_name', item.original_point_name)
    item.normalized_point_name = data.get('normalized_point_name', item.normalized_point_name)
    item.point_comment = data.get('point_comment', item.point_comment)
    item.data_type = data.get('data_type', item.data_type)
    item.unit = data.get('unit', item.unit)
    item.data_source = data.get('data_source', item.data_source)
    item.is_enabled = data.get('is_enabled', item.is_enabled)

    # Handle JSON fields (tags and fields)
    if 'tags' in data:
        item.tags = data['tags']
    if 'fields' in data:
        item.fields = data['fields']

    db.session.commit()
    add_audit_log(
        action='更新数据点',
        status='success',
        details=f"更新数据点位 {item.measurement} (ID: {item.id})"
    )
    return jsonify(item.to_dict()), 200

@data_management_api_bp.route('/point_info/<int:item_id>', methods=['DELETE'])
@handle_api_error
def delete_point_info(item_id):
    item = PointInfo.query.get_or_404(item_id)
    db.session.delete(item)
    db.session.commit()
    add_audit_log(
        action='删除数据点',
        status='success',
        details=f"删除数据点位 (ID: {item_id})"
    )
    return jsonify({"message": "PointInfo deleted successfully"}), 200

@data_management_api_bp.route('/point_info/<int:item_id>/toggle_lock', methods=['POST'])
@handle_api_error
def toggle_lock_point_info(item_id):
    item = PointInfo.query.get_or_404(item_id)
    item.is_locked = not item.is_locked
    db.session.commit()
    add_audit_log(
        action='切换数据点锁定状态',
        status='success',
        details=f"切换数据点 {item.measurement} (ID: {item.id}) 的锁定状态为: {item.is_locked}"
    )
    return jsonify(item.to_dict()), 200

@data_management_api_bp.route('/point_info/<int:point_id>/history', methods=['GET'])
@handle_api_error
def get_point_info_history(point_id):
    """获取单个数据点的所有历史版本"""
    point = PointInfo.query.get_or_404(point_id)
    history_records = PointInfoHistory.query.filter_by(point_info_id=point_id).order_by(PointInfoHistory.version.desc()).all()
    
    return jsonify({
        "point_id": point_id,
        "measurement": point.measurement,
        "history": [h.to_dict() for h in history_records]
    })

@data_management_api_bp.route('/point_info/import', methods=['POST'])
@handle_api_error
def import_point_info():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    points_to_process = data.get('points')
    conflict_rule = data.get('conflict_rule', 'overwrite') # 'overwrite' or 'skip'

    if not isinstance(points_to_process, list):
        return jsonify({"error": "Invalid data format: 'points' should be a list"}), 400

    batch_id = f"batch_{int(datetime.now(timezone.utc).timestamp())}"
    
    summary = {'created': 0, 'updated': 0, 'skipped': 0, 'errors': 0}
    error_details = []

    for index, item in enumerate(points_to_process):
        try:
            measurement = item.get('measurement')
            if not measurement:
                error_details.append({'index': index, 'error': 'Missing required field: measurement'})
                summary['errors'] += 1
                continue

            # Use measurement as the unique key for checking existence
            existing_point = PointInfo.query.filter_by(measurement=measurement).first()

            if existing_point:
                if conflict_rule == 'skip':
                    summary['skipped'] += 1
                    continue

                # Save current state to history before updating
                history_record = PointInfoHistory(
                    point_info_id=existing_point.id,
                    version=(PointInfoHistory.query.filter_by(point_info_id=existing_point.id).count() + 1),
                    measurement=existing_point.measurement,
                    original_point_name=existing_point.original_point_name,
                    normalized_point_name=existing_point.normalized_point_name,
                    point_comment=existing_point.point_comment,
                    tags=existing_point.tags,
                    fields=existing_point.fields,
                    timestamp=existing_point.timestamp,
                    data_type=existing_point.data_type,
                    unit=existing_point.unit,
                    data_source=existing_point.data_source,
                    config_file_id=existing_point.config_file_id,
                    is_enabled=existing_point.is_enabled,
                    is_locked=existing_point.is_locked,
                    import_batch=existing_point.import_batch,
                    import_status=existing_point.import_status,
                    change_reason=f"updated by import batch {batch_id}"
                )
                db.session.add(history_record)

                # Update existing point
                existing_point.original_point_name = item.get('original_point_name', existing_point.original_point_name)
                existing_point.normalized_point_name = item.get('normalized_point_name', existing_point.normalized_point_name)
                existing_point.point_comment = item.get('point_comment', existing_point.point_comment)
                existing_point.data_type = item.get('data_type', existing_point.data_type)
                existing_point.unit = item.get('unit', existing_point.unit)
                existing_point.data_source = item.get('data_source', existing_point.data_source)
                existing_point.is_enabled = item.get('is_enabled', existing_point.is_enabled)
                existing_point.tags = json.dumps(item.get('tags', existing_point.tags))
                existing_point.fields = json.dumps(item.get('fields', existing_point.fields))
                existing_point.import_batch = batch_id
                existing_point.is_locked = True # Lock point after import/update
                existing_point.import_status = 'updated'
                summary['updated'] += 1
            else:
                # Create new point
                new_point = PointInfo(
                    measurement=measurement,
                    original_point_name=item.get('original_point_name'),
                    normalized_point_name=item.get('normalized_point_name'),
                    point_comment=item.get('point_comment'),
                    data_type=item.get('data_type'),
                    unit=item.get('unit'),
                    data_source=item.get('data_source'),
                    is_enabled=item.get('is_enabled', True),
                    tags=json.dumps(item.get('tags', {})),
                    fields=json.dumps(item.get('fields', {})),
                    import_batch=batch_id,
                    is_locked=True, # Lock point on creation
                    import_status='created'
                )
                db.session.add(new_point)
                summary['created'] += 1

        except Exception as e:
            summary['errors'] += 1
            error_details.append({'index': index, 'error': str(e)})

    try:
        db.session.commit()
        add_audit_log(
            action='批量导入数据点',
            status='success' if summary['errors'] == 0 else 'partial_failure',
            details=f"导入完成. 创建: {summary['created']}, 更新: {summary['updated']}, 错误: {summary['errors']}. 批次ID: {batch_id}"
        )
        return jsonify({
            "message": "Import process completed.",
            "data": {
                "batch_id": batch_id,
                "total_rows": len(points_to_process),
                "imported_count": summary['created'],
                "updated_count": summary['updated'],
                "failed_count": summary['errors'],
                "skipped_count": summary['skipped'],
                "error_details": error_details
            }
        }), 200
    except Exception as e:
        db.session.rollback()
        add_audit_log('批量导入数据点', 'failure', f"数据库提交失败: {str(e)}")
        return jsonify({"error": f"Database commit failed: {str(e)}"}), 500

@data_management_api_bp.route('/point_info/link_and_lock', methods=['POST'])
@handle_api_error
def link_and_lock_points():
    data = request.get_json()
    if not data or 'config_file_id' not in data or 'point_ids' not in data:
        return jsonify({'error': 'Missing config_file_id or point_ids'}), 400

    config_file_id = data['config_file_id']
    point_ids = data['point_ids']

    if not isinstance(point_ids, list):
        return jsonify({'error': 'point_ids must be a list'}), 400

    try:
        updated_count = 0
        for point_id in point_ids:
            point = PointInfo.query.get(point_id)
            if point:
                point.config_file_id = config_file_id
                point.is_locked = True
                updated_count += 1
        
        db.session.commit()
        add_audit_log(
            action='关联并锁定数据点',
            status='success',
            details=f"将 {updated_count} 个数据点关联到配置文件ID {config_file_id} 并锁定。"
        )
        return jsonify({'message': f'Successfully linked and locked {updated_count} points.'}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"An unexpected error occurred: {str(e)}"}), 500



@data_management_api_bp.route('/point_info/check_status', methods=['POST'])
@handle_api_error
def check_point_info_status():
    data = request.get_json()
    if not data or 'names' not in data or 'config_id' not in data:
        return jsonify({"error": "Missing required fields: names and config_id"}), 400

    names_to_check = data['names']
    config_id = data['config_id']
    
    # Query for existing points and order them to handle duplicates deterministically
    # Prioritize points linked to *any* config file over unlinked ones.
    existing_points = PointInfo.query.filter(PointInfo.measurement.in_(names_to_check)).order_by(PointInfo.config_file_id.desc(), PointInfo.id).all()
    
    status_map = {}
    processed_measurements = set()

    for point in existing_points:
        if point.measurement in processed_measurements:
            continue # Only process the first result for each measurement name

        if point.config_file_id == config_id:
            status_map[point.measurement] = {"status": "synced", "point_id": point.id}
        elif point.config_file_id is not None:
            status_map[point.measurement] = {"status": "linked", "point_id": point.id}       
        else: # config_file_id is None
            status_map[point.measurement] = {"status": "unlinked", "point_id": point.id}
        
        processed_measurements.add(point.measurement)
            
    # 对于数据库中不存在的点位，标记为新点位
    for name in names_to_check:
        if name not in status_map:
            status_map[name] = {"status": "new"}
            
    return jsonify({"status": status_map})


@data_management_api_bp.route('/point_info/wizard_import', methods=['POST'])
@handle_api_error
def wizard_import_point_info():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    config_file_id = data.get('config_file_id')
    if not config_file_id:
        return jsonify({"error": "Missing config_file_id"}), 400

    items_to_create = data.get('points_to_create', [])
    items_to_merge = data.get('points_to_merge', [])
    
    created_results = []
    merged_results = []
    
    batch_id = f"batch_{int(datetime.now(timezone.utc).timestamp())}"

    # Process items to create
    for item in items_to_create:
        required_fields = ['measurement', 'original_point_name', 'normalized_point_name']
        missing_fields = [field for field in required_fields if not item.get(field)]
        if missing_fields:
            return jsonify({"error": f"Missing required fields for creation: {', '.join(missing_fields)}"}), 400
        
        new_point = PointInfo(
            measurement=item['measurement'],
            original_point_name=item['original_point_name'],
            normalized_point_name=item['normalized_point_name'],
            data_type=item.get('data_type'),
            tags=json.dumps(item.get('tags', {})),
            fields=json.dumps(item.get('fields', {})),
            point_comment=item.get('point_comment'),
            config_file_id=config_file_id,
            is_locked=True,
            import_batch=batch_id
        )
        db.session.add(new_point)
        created_results.append(item)

    # Process items to merge
    for item in items_to_merge:
        required_fields = ['id', 'measurement']
        missing_fields = [field for field in required_fields if not item.get(field)]
        if missing_fields:
            return jsonify({"error": f"Missing required fields for merge: {', '.join(missing_fields)}"}), 400

        point_to_update = PointInfo.query.get(item['id'])
        if point_to_update:
            # Create a history record before updating
            history_record = PointInfoHistory(
                point_info_id=point_to_update.id,
                version=(PointInfoHistory.query.filter_by(point_info_id=point_to_update.id).count() + 1),
                measurement=point_to_update.measurement,
                original_point_name=point_to_update.original_point_name,
                normalized_point_name=point_to_update.normalized_point_name,
                point_comment=point_to_update.point_comment,
                tags=point_to_update.tags,
                fields=point_to_update.fields,
                timestamp=point_to_update.timestamp,
                data_type=point_to_update.data_type,
                unit=point_to_update.unit,
                data_source=point_to_update.data_source,
                config_file_id=point_to_update.config_file_id,
                is_enabled=point_to_update.is_enabled,
                is_locked=point_to_update.is_locked,
                import_batch=point_to_update.import_batch,
                import_status=point_to_update.import_status,
                change_reason=f"updated by wizard import batch {batch_id}"
            )
            db.session.add(history_record)

            # Update fields from the item, keeping existing values if new ones are not provided
            point_to_update.original_point_name = item.get('original_point_name', point_to_update.original_point_name)
            point_to_update.normalized_point_name = item.get('normalized_point_name', point_to_update.normalized_point_name)
            point_to_update.data_type = item.get('data_type', point_to_update.data_type)
            point_to_update.point_comment = item.get('point_comment', point_to_update.point_comment)
            point_to_update.config_file_id = config_file_id
            point_to_update.is_locked = True
            point_to_update.import_batch = batch_id
            point_to_update.import_status = 'updated'
            
            # For dict fields, merge them
            if isinstance(item.get('tags'), dict):
                existing_tags = json.loads(point_to_update.tags or '{}')
                existing_tags.update(item.get('tags'))
                point_to_update.tags = json.dumps(existing_tags)
            if isinstance(item.get('fields'), dict):
                existing_fields = json.loads(point_to_update.fields or '{}')
                existing_fields.update(item.get('fields'))
                point_to_update.fields = json.dumps(existing_fields)

            merged_results.append(item)

    try:
        config_file = ConfigFile.query.get(config_file_id)
        if config_file:
            config_file.data_points_synced = True

        db.session.commit()
        add_audit_log(
            action='向导导入数据点',
            status='success',
            details=f"创建 {len(created_results)} 个, 合并 {len(merged_results)} 个数据点. 批次ID: {batch_id}"
        )
        return jsonify({"message": "Import completed successfully", "created": created_results, "merged": merged_results}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"An unexpected error occurred: {str(e)}"}), 500


@data_management_api_bp.route('/point_info/import_history', methods=['GET'])
@handle_api_error
def get_import_history():
    page, per_page = get_pagination_params(request)
    offset = (page - 1) * per_page
    
    # Subquery to get distinct batch IDs
    distinct_batches_subq = db.session.query(PointInfo.import_batch).filter(PointInfo.import_batch.isnot(None)).distinct().subquery()

    # Main query to get the latest timestamp for each batch
    history_query = db.session.query(
        distinct_batches_subq.c.import_batch,
        db.func.max(func.coalesce(PointInfo.updated_at, PointInfo.created_at)).label('last_imported_at'),
        db.func.count(PointInfo.id).label('point_count')
    ).join(PointInfo, PointInfo.import_batch == distinct_batches_subq.c.import_batch)    .group_by(distinct_batches_subq.c.import_batch)    .order_by(db.func.max(func.coalesce(PointInfo.updated_at, PointInfo.created_at)).desc())

    total_items = history_query.count()
    paginated_history = history_query.offset(offset).limit(per_page).all()

    history_list = [
        {
            "import_batch": row.import_batch,
            "last_imported_at": row.last_imported_at.isoformat(),
            "point_count": row.point_count
        } for row in paginated_history
    ]

    return jsonify({
        'items': history_list,
        'total': total_items,
        'page': page,
        'per_page': per_page
    })


@data_management_api_bp.route('/point_info/import_history/<batch_id>', methods=['GET'])
@handle_api_error
def get_import_batch_details(batch_id):
    """获取特定导入批次的详细信息，支持分页"""
    page, per_page = get_pagination_params(request)
    
    query = PointInfo.query.filter_by(import_batch=batch_id)
    
    total_items = query.count()
    paginated_points = query.offset((page - 1) * per_page).limit(per_page).all()
    
    if not paginated_points and page == 1:
        return jsonify({"error": "Batch not found or no points in batch"}), 404
    
    return jsonify({
        "batch_id": batch_id,
        "points": [p.to_dict() for p in paginated_points],
        "pagination": {
            "total": total_items,
            "page": page,
            "per_page": per_page,
            "pages": (total_items + per_page - 1) // per_page
        }
    })

@data_management_api_bp.route('/point_info/import_history/<batch_id>', methods=['DELETE'])
@handle_api_error
def rollback_import_batch(batch_id):
    """回滚（删除或恢复）一个完整的导入批次"""
    try:
        points_in_batch = PointInfo.query.filter_by(import_batch=batch_id).all()
        if not points_in_batch:
            return jsonify({"error": "Batch not found or already empty"}), 404

        restored_count = 0
        deleted_count = 0

        for point in points_in_batch:
            if point.import_status == 'created':
                # This point was created by this batch, so it's safe to delete.
                db.session.delete(point)
                deleted_count += 1
            elif point.import_status == 'updated':
                # This point was updated. We need to restore it from its history.
                last_version = PointInfoHistory.query.filter(
                    PointInfoHistory.point_info_id == point.id
                ).order_by(PointInfoHistory.version.desc()).first()

                if last_version:
                    # Restore from the most recent history entry
                    point.original_point_name = last_version.original_point_name
                    point.normalized_point_name = last_version.normalized_point_name
                    point.point_comment = last_version.point_comment
                    point.tags = last_version.tags
                    point.fields = last_version.fields
                    point.timestamp = last_version.timestamp
                    point.data_type = last_version.data_type
                    point.unit = last_version.unit
                    point.data_source = last_version.data_source
                    point.config_file_id = last_version.config_file_id
                    point.is_enabled = last_version.is_enabled
                    point.is_locked = last_version.is_locked
                    point.import_batch = last_version.import_batch
                    point.import_status = last_version.import_status
                    
                    # After restoring, we can delete the history record that was created by this batch
                    db.session.delete(last_version)
                    restored_count += 1
                else:
                    # Edge case: an "updated" point with no history. 
                    # This shouldn't happen with the new logic, but for safety,
                    # we'll just nullify the batch info rather than deleting.
                    point.import_batch = None
                    point.import_status = None

        db.session.commit()
        
        add_audit_log(
            action='回滚导入批次',
            status='success',
            details=f"成功回滚批次 {batch_id}，恢复 {restored_count} 个, 删除 {deleted_count} 个数据点。"
        )
        return jsonify({"message": f"Successfully rolled back batch {batch_id}, restoring {restored_count} and deleting {deleted_count} points."}), 200

    except Exception as e:
        db.session.rollback()
        add_audit_log('回滚导入批次', 'failure', f"回滚批次 {batch_id} 失败: {str(e)}")
        return jsonify({"error": f"An unexpected error occurred: {str(e)}"}), 500

# --- OutputSource (Data Sources) API --- #

@data_management_api_bp.route('/data_sources', methods=['GET'])
@handle_api_error
def get_data_sources():
    page, per_page = get_pagination_params(request)
    offset = (page - 1) * per_page
    
    query = OutputSource.query

    # Filter by source_type if provided
    source_type = request.args.get('source_type')
    if source_type:
        query = query.filter_by(source_type=source_type)

    # Search
    search = request.args.get('search')
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            db.or_(
                OutputSource.name.ilike(search_term),
                OutputSource.description.ilike(search_term)
            )
        )

    # Sorting
    sort_by = request.args.get('sort_by', 'id')
    sort_dir = request.args.get('sort_dir', 'asc')
    if hasattr(OutputSource, sort_by):
        if sort_dir == 'desc':
            query = query.order_by(db.desc(getattr(OutputSource, sort_by)))
        else:
            query = query.order_by(db.asc(getattr(OutputSource, sort_by)))

    total_items = query.count()
    paginated_items = query.offset(offset).limit(per_page).all()

    results = [item.to_dict() for item in paginated_items]

    return jsonify({
        'items': results,
        'pagination': {
            'total': total_items,
            'page': page,
            'per_page': per_page,
            'pages': (total_items + per_page - 1) // per_page
        }
    })

@data_management_api_bp.route('/data_sources', methods=['POST'])
@handle_api_error
def create_data_source():
    data = request.get_json()
    if not data or not data.get('name') or not data.get('config'):
        return jsonify({'error': 'Missing name or config'}), 400

    new_source = OutputSource(
        name=data['name'],
        source_type=data.get('source_type', 'output'),
        description=data.get('description'),
        is_enabled=data.get('is_enabled', True),
        config=data['config']
    )
    db.session.add(new_source)
    try:
        db.session.commit()
        add_audit_log('create_data_source', 'success', f"创建数据源: {new_source.name}")
        return jsonify(new_source.to_dict()), 201
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': '同名数据源已存在'}), 409

@data_management_api_bp.route('/data_sources/<int:item_id>', methods=['GET'])
@handle_api_error
def get_data_source(item_id):
    item = OutputSource.query.get_or_404(item_id)
    return jsonify(item.to_dict())

@data_management_api_bp.route('/data_sources/<int:item_id>', methods=['PUT'])
@handle_api_error
def update_data_source(item_id):
    item = OutputSource.query.get_or_404(item_id)
    data = request.get_json()

    item.name = data.get('name', item.name)
    item.source_type = data.get('source_type', item.source_type)
    item.description = data.get('description', item.description)
    item.is_enabled = data.get('is_enabled', item.is_enabled)
    item.config = data.get('config', item.config)
    
    db.session.commit()
    add_audit_log('update_data_source', 'success', f"更新数据源: {item.name}")
    return jsonify(item.to_dict()), 200

@data_management_api_bp.route('/data_sources/<int:item_id>', methods=['DELETE'])
@handle_api_error
def delete_data_source(item_id):
    item = OutputSource.query.get_or_404(item_id)
    db.session.delete(item)
    db.session.commit()
    add_audit_log('delete_data_source', 'success', f"删除数据源: {item.name}")
    return jsonify({'message': '数据源删除成功'}), 200

# --- GlobalParameter API --- #

@data_management_api_bp.route('/global_parameters', methods=['GET'])
@handle_api_error
def get_global_parameters():
    page, per_page = get_pagination_params(request)
    offset = (page - 1) * per_page
    
    query = GlobalParameter.query

    # Search
    search = request.args.get('search')
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            db.or_(
                GlobalParameter.name.ilike(search_term),
                GlobalParameter.description.ilike(search_term)
            )
        )

    # Sorting
    sort_by = request.args.get('sort_by', 'id')
    sort_dir = request.args.get('sort_dir', 'asc')
    if hasattr(GlobalParameter, sort_by):
        if sort_dir == 'desc':
            query = query.order_by(db.desc(getattr(GlobalParameter, sort_by)))
        else:
            query = query.order_by(db.asc(getattr(GlobalParameter, sort_by)))

    total_items = query.count()
    paginated_items = query.offset(offset).limit(per_page).all()

    results = [item.to_dict() for item in paginated_items]

    return jsonify({
        'items': results,
        'pagination': {
            'total': total_items,
            'page': page,
            'per_page': per_page,
            'pages': (total_items + per_page - 1) // per_page
        }
    })

@data_management_api_bp.route('/global_parameters', methods=['POST'])
@handle_api_error
def create_global_parameter():
    data = request.get_json()
    if not data or not data.get('name') or not data.get('config'):
        return jsonify({'error': 'Missing name or config'}), 400

    new_item = GlobalParameter(
        name=data['name'],
        description=data.get('description'),
        config=data['config']
    )
    db.session.add(new_item)
    try:
        db.session.commit()
        add_audit_log('create_global_parameter', 'success', f"Created global parameter: {new_item.name}")
        return jsonify(new_item.to_dict()), 201
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Global parameter with this name already exists'}), 409

@data_management_api_bp.route('/global_parameters/<int:item_id>', methods=['GET'])
@handle_api_error
def get_global_parameter(item_id):
    item = GlobalParameter.query.get_or_404(item_id)
    return jsonify(item.to_dict())

@data_management_api_bp.route('/global_parameters/<int:item_id>', methods=['PUT'])
@handle_api_error
def update_global_parameter(item_id):
    item = GlobalParameter.query.get_or_404(item_id)
    data = request.get_json()

    item.name = data.get('name', item.name)
    item.description = data.get('description', item.description)
    item.config = data.get('config', item.config)
    
    db.session.commit()
    add_audit_log('update_global_parameter', 'success', f"Updated global parameter: {item.name}")
    return jsonify(item.to_dict()), 200

@data_management_api_bp.route('/global_parameters/<int:item_id>', methods=['DELETE'])
@handle_api_error
def delete_global_parameter(item_id):
    item = GlobalParameter.query.get_or_404(item_id)
    db.session.delete(item)
    db.session.commit()
    add_audit_log('delete_global_parameter', 'success', f"Deleted global parameter: {item.name}")
    return jsonify({'message': 'Global parameter deleted successfully'}), 200

# --- PointTemplate API --- #

@data_management_api_bp.route('/point_templates', methods=['GET'])
@handle_api_error
def get_point_templates():
    page, per_page = get_pagination_params(request)
    offset = (page - 1) * per_page
    
    query = PointTemplate.query

    # Search
    search = request.args.get('search')
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            db.or_(
                PointTemplate.name.ilike(search_term),
                PointTemplate.description.ilike(search_term)
            )
        )

    # Sorting
    sort_by = request.args.get('sort_by', 'id')
    sort_dir = request.args.get('sort_dir', 'asc')
    if hasattr(PointTemplate, sort_by):
        if sort_dir == 'desc':
            query = query.order_by(db.desc(getattr(PointTemplate, sort_by)))
        else:
            query = query.order_by(db.asc(getattr(PointTemplate, sort_by)))

    total_items = query.count()
    paginated_items = query.offset(offset).limit(per_page).all()

    results = [item.to_dict() for item in paginated_items]

    return jsonify({
        'items': results,
        'pagination': {
            'total': total_items,
            'page': page,
            'per_page': per_page,
            'pages': (total_items + per_page - 1) // per_page
        }
    })

@data_management_api_bp.route('/point_templates', methods=['POST'])
@handle_api_error
def create_point_template():
    data = request.get_json()
    if not data or not data.get('name') or not data.get('content'):
        return jsonify({'error': 'Missing name or content'}), 400

    new_item = PointTemplate(
        name=data['name'],
        description=data.get('description'),
        content=data['content']
    )
    db.session.add(new_item)
    try:
        db.session.commit()
        add_audit_log('create_point_template', 'success', f"Created point template: {new_item.name}")
        return jsonify(new_item.to_dict()), 201
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Point template with this name already exists'}), 409

@data_management_api_bp.route('/point_templates/<int:item_id>', methods=['GET'])
@handle_api_error
def get_point_template(item_id):
    item = PointTemplate.query.get_or_404(item_id)
    return jsonify(item.to_dict())

@data_management_api_bp.route('/point_templates/<int:item_id>', methods=['PUT'])
@handle_api_error
def update_point_template(item_id):
    item = PointTemplate.query.get_or_404(item_id)
    data = request.get_json()

    item.name = data.get('name', item.name)
    item.description = data.get('description', item.description)
    item.content = data.get('content', item.content)
    
    db.session.commit()
    add_audit_log('update_point_template', 'success', f"Updated point template: {item.name}")
    return jsonify(item.to_dict()), 200

@data_management_api_bp.route('/point_templates/<int:item_id>', methods=['DELETE'])
@handle_api_error
def delete_point_template(item_id):
    item = PointTemplate.query.get_or_404(item_id)
    db.session.delete(item)
    db.session.commit()
    add_audit_log('delete_point_template', 'success', f"Deleted point template: {item.name}")
    return jsonify({'message': 'Point template deleted successfully'}), 200

# --- ProcessingTag API --- #

@data_management_api_bp.route('/processing_tags', methods=['GET'])
@handle_api_error
def get_processing_tags():
    page, per_page = get_pagination_params(request)
    offset = (page - 1) * per_page
    
    query = ProcessingTag.query

    # Search
    search = request.args.get('search')
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            db.or_(
                ProcessingTag.name.ilike(search_term),
                ProcessingTag.description.ilike(search_term)
            )
        )

    # Sorting
    sort_by = request.args.get('sort_by', 'id')
    sort_dir = request.args.get('sort_dir', 'asc')
    if hasattr(ProcessingTag, sort_by):
        if sort_dir == 'desc':
            query = query.order_by(db.desc(getattr(ProcessingTag, sort_by)))
        else:
            query = query.order_by(db.asc(getattr(ProcessingTag, sort_by)))

    total_items = query.count()
    paginated_items = query.offset(offset).limit(per_page).all()

    results = [item.to_dict() for item in paginated_items]

    return jsonify({
        'items': results,
        'pagination': {
            'total': total_items,
            'page': page,
            'per_page': per_page,
            'pages': (total_items + per_page - 1) // per_page
        }
    })

@data_management_api_bp.route('/processing_tags', methods=['POST'])
@handle_api_error
def create_processing_tag():
    data = request.get_json()
    if not data or not data.get('name') or not data.get('config'):
        return jsonify({'error': 'Missing name or config'}), 400

    new_item = ProcessingTag(
        name=data['name'],
        plugin_type=data.get('plugin_type'),
        description=data.get('description'),
        config=data['config']
    )
    db.session.add(new_item)
    try:
        db.session.commit()
        add_audit_log('create_processing_tag', 'success', f"Created processing tag: {new_item.name}")
        return jsonify(new_item.to_dict()), 201
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Processing tag with this name already exists'}), 409

@data_management_api_bp.route('/processing_tags/<int:item_id>', methods=['GET'])
@handle_api_error
def get_processing_tag(item_id):
    item = ProcessingTag.query.get_or_404(item_id)
    return jsonify(item.to_dict())

@data_management_api_bp.route('/processing_tags/<int:item_id>', methods=['PUT'])
@handle_api_error
def update_processing_tag(item_id):
    item = ProcessingTag.query.get_or_404(item_id)
    data = request.get_json()

    item.name = data.get('name', item.name)
    item.plugin_type = data.get('plugin_type', item.plugin_type)
    item.description = data.get('description', item.description)
    item.config = data.get('config', item.config)
    
    db.session.commit()
    add_audit_log('update_processing_tag', 'success', f"Updated processing tag: {item.name}")
    return jsonify(item.to_dict()), 200

@data_management_api_bp.route('/processing_tags/<int:item_id>', methods=['DELETE'])
@handle_api_error
def delete_processing_tag(item_id):
    item = ProcessingTag.query.get_or_404(item_id)
    db.session.delete(item)
    db.session.commit()
    add_audit_log('delete_processing_tag', 'success', f"Deleted processing tag: {item.name}")
    return jsonify({'message': 'Processing tag deleted successfully'}), 200
