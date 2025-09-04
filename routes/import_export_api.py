# -*- coding: utf-8 -*-
"""
批量导入/导出 API 蓝图
"""

import logging
import io
import pandas as pd
from flask import Blueprint, request
from flask_login import login_required

from models import db, PointInfo
from api_utils import error_response, success_response, add_audit_log

logger = logging.getLogger(__name__)

import_export_api_bp = Blueprint('import_export_api', __name__, url_prefix='/api/import')

@import_export_api_bp.route('/upload', methods=['POST'])
@login_required
def import_upload():
    if 'file' not in request.files:
        return error_response('No file part', 400)
    file = request.files['file']
    if file.filename == '':
        return error_response('No selected file', 400)

    if file and file.filename.endswith('.csv'):
        try:
            file_stream = io.StringIO(file.stream.read().decode('utf-8'))
            df = pd.read_csv(file_stream)
            headers = df.columns.tolist()
            file.stream.seek(0)
            file_content = file.stream.read().decode('utf-8')
            return success_response({
                'filename': file.filename,
                'headers': headers,
                'file_content': file_content
            })
        except Exception as e:
            logger.error(f"Error parsing CSV file: {e}")
            return error_response(f'Failed to parse CSV file: {e}', 500)
    else:
        return error_response('Invalid file type, please upload a CSV file.', 400)

@import_export_api_bp.route('/preview', methods=['POST'])
@login_required
def import_preview():
    data = request.json
    file_content = data.get('file_content')
    mapping = data.get('mapping')
    rules = data.get('rules')

    if not all([file_content, mapping, rules]):
        return error_response('Missing data for preview', 400)

    try:
        file_stream = io.StringIO(file_content)
        df = pd.read_csv(file_stream)
        df.rename(columns=mapping, inplace=True)
        
        preview_results = []
        summary = {'new': 0, 'overwrite': 0, 'skip': 0, 'error': 0}
        
        for index, row in df.head().iterrows():
            unique_key = row.get('normalized_point_name')
            status = 'new'
            error_message = None
            
            if pd.isna(unique_key):
                status = 'error'
                error_message = 'Unique key (normalized_point_name) is missing.'
            else:
                existing_point = PointInfo.query.filter_by(normalized_point_name=unique_key).first()
                if existing_point:
                    status = rules.get('conflict', 'skip')
            
            summary[status] += 1
            preview_row = row.to_dict()
            preview_row['_status'] = status
            preview_row['_error'] = error_message
            preview_results.append(preview_row)

        return success_response({
            'preview_data': preview_results,
            'summary': summary
        })

    except Exception as e:
        logger.error(f"Error generating import preview: {e}")
        return error_response(f'Failed to generate preview: {e}', 500)

@import_export_api_bp.route('/process', methods=['POST'])
@login_required
def import_process():
    data = request.json
    file_content = data.get('file_content')
    mapping = data.get('mapping')
    rules = data.get('rules')

    if not all([file_content, mapping, rules]):
        return error_response('Missing data for processing', 400)

    try:
        file_stream = io.StringIO(file_content)
        df = pd.read_csv(file_stream)
        df.rename(columns=mapping, inplace=True)

        summary = {'created': 0, 'updated': 0, 'skipped': 0, 'errors': 0}
        error_details = []

        for index, row in df.iterrows():
            try:
                with db.session.begin_nested():
                    unique_key = row.get('normalized_point_name')
                    if pd.isna(unique_key):
                        raise ValueError('Unique key (normalized_point_name) is missing.')

                    existing_point = PointInfo.query.filter_by(normalized_point_name=unique_key).first()

                    if existing_point:
                        if rules.get('conflict') == 'skip':
                            summary['skipped'] += 1
                            continue
                        elif rules.get('conflict') == 'overwrite':
                            for key, value in row.items():
                                if pd.notna(value) and hasattr(existing_point, key):
                                    setattr(existing_point, key, value)
                            summary['updated'] += 1
                    else:
                        row_data = {k: v for k, v in row.items() if pd.notna(v)}
                        new_point = PointInfo(**row_data)
                        db.session.add(new_point)
                        summary['created'] += 1
            except Exception as e:
                db.session.rollback()
                summary['errors'] += 1
                error_details.append({'index': index + 2, 'error': str(e)})

        db.session.commit()
        add_audit_log('import_data', 'success', f"Import completed. Summary: {summary}")
        return success_response({'summary': summary, 'error_details': error_details})

    except Exception as e:
        db.session.rollback()
        logger.error(f"Fatal error during import process: {e}")
        add_audit_log('import_data', 'failure', f"Fatal error: {e}")
        return error_response(f'An error occurred during the import process: {e}', 500)
