# -*- coding: utf-8 -*-
"""
Telegraf 管理系统数据库模型
功能：定义数据库表结构和模型类
作者：项目开发团队
"""

from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timezone
from sqlalchemy import text

import logging

import psutil

logger = logging.getLogger(__name__)

# 创建 SQLAlchemy 数据库实例
db = SQLAlchemy()

# --- Helper function for timezone-aware defaults ---
def utcnow_tz():
    return datetime.now(timezone.utc)

# --- 关联表定义 ---
output_source_config_file_association = db.Table(
    'output_source_config_file',
    db.Column('output_source_id', db.Integer, db.ForeignKey('output_source.id'), primary_key=True),
    db.Column('config_file_id', db.Integer, db.ForeignKey('config_files.id'), primary_key=True)
)

global_parameter_config_file_association = db.Table(
    'global_parameter_config_file',
    db.Column('global_parameter_id', db.Integer, db.ForeignKey('global_parameters.id'), primary_key=True),
    db.Column('config_file_id', db.Integer, db.ForeignKey('config_files.id'), primary_key=True)
)

# --- 模型定义 ---

class User(UserMixin, db.Model):
    """用户模型"""
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(120), nullable=False)
    
    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)
    
    def to_dict(self):
        return {'id': self.id, 'username': self.username}

class AuditLog(db.Model):
    """审计日志模型"""
    __tablename__ = 'audit_log'
    id = db.Column(db.Integer, primary_key=True)
    timestamp = db.Column(db.DateTime, nullable=False, default=utcnow_tz)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    username = db.Column(db.String(80), nullable=True) # 冗余存储，方便查询
    action = db.Column(db.String(100), nullable=False)
    status = db.Column(db.String(20), nullable=False) # 'success', 'failure', 'info'
    details = db.Column(db.Text, nullable=True)

    user = db.relationship('User', backref=db.backref('audit_logs', lazy=True))

    def to_dict(self):
        return {
            'id': self.id,
            'timestamp': self.timestamp.replace(tzinfo=timezone.utc).isoformat(),
            'user_id': self.user_id,
            'username': self.username,
            'action': self.action,
            'status': self.status,
            'details': self.details
        }

class OutputSource(db.Model):
    """数据源配置模型"""
    __tablename__ = 'output_source'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    source_type = db.Column(db.String(50), nullable=False, default='output')
    description = db.Column(db.String(255), nullable=True)
    is_enabled = db.Column(db.Boolean, default=True, nullable=False)
    is_locked = db.Column(db.Boolean, default=False, nullable=False)
    config = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow_tz)
    updated_at = db.Column(db.DateTime, default=utcnow_tz, onupdate=utcnow_tz)

    referenced_by_config_files = db.relationship(
        'ConfigFile',
        secondary=output_source_config_file_association,
        back_populates='referenced_output_sources'
    )

    def to_dict(self):
        return {
            'id': self.id, 'name': self.name, 'source_type': self.source_type,
            'description': self.description, 'is_enabled': self.is_enabled,
            'is_locked': self.is_locked,
            'config': self.config, 'created_at': self.created_at.replace(tzinfo=timezone.utc).isoformat(),
            'updated_at': self.updated_at.replace(tzinfo=timezone.utc).isoformat(),
            'referenced_by_count': len(self.referenced_by_config_files)
        }

class PointInfo(db.Model):
    """数据点信息模型"""
    __tablename__ = 'point_info'
    id = db.Column(db.Integer, primary_key=True)
    measurement = db.Column(db.String(80), nullable=False)
    original_point_name = db.Column(db.String(200), nullable=True)
    normalized_point_name = db.Column(db.String(200), nullable=True)
    point_comment = db.Column(db.Text, nullable=True)
    tags = db.Column(db.Text, nullable=False, server_default='{}')
    fields = db.Column(db.Text, nullable=False, server_default='{}')
    timestamp = db.Column(db.DateTime, nullable=False, default=utcnow_tz)
    data_type = db.Column(db.String(20), nullable=True, default='float')
    unit = db.Column(db.String(50), nullable=True)
    data_source = db.Column(db.String(50), nullable=False, default='manual')
    config_file_id = db.Column(db.Integer, db.ForeignKey('config_files.id'), nullable=True)
    is_enabled = db.Column(db.Boolean, nullable=False, default=True)
    is_locked = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow_tz)
    updated_at = db.Column(db.DateTime, nullable=True, onupdate=utcnow_tz)
    import_batch = db.Column(db.String(50), nullable=True)
    import_status = db.Column(db.String(20), nullable=True) # e.g., created, updated

    config_file = db.relationship('ConfigFile', backref=db.backref('data_points', lazy=True))
    history = db.relationship('PointInfoHistory', backref='point_info', lazy='dynamic', order_by='desc(PointInfoHistory.version)')

    def to_dict(self):
        return {
            'id': self.id, 'measurement': self.measurement,
            'original_point_name': self.original_point_name,
            'normalized_point_name': self.normalized_point_name,
            'point_comment': self.point_comment, 'tags': self.tags, 'fields': self.fields,
            'timestamp': self.timestamp.replace(tzinfo=timezone.utc).isoformat() if self.timestamp else None,
            'data_type': self.data_type, 'unit': self.unit, 'data_source': self.data_source,
            'config_file_id': self.config_file_id,
            'config_file_name': self.config_file.file_name if self.config_file else None,
            'is_enabled': self.is_enabled,
            'is_locked': self.is_locked,
            'created_at': self.created_at.replace(tzinfo=timezone.utc).isoformat() if self.created_at else None,
            'updated_at': self.updated_at.replace(tzinfo=timezone.utc).isoformat() if self.updated_at else None,
            'import_batch': self.import_batch,
            'import_status': self.import_status
        }

class PointInfoHistory(db.Model):
    """数据点信息历史版本模型"""
    __tablename__ = 'point_info_history'
    id = db.Column(db.Integer, primary_key=True)
    point_info_id = db.Column(db.Integer, db.ForeignKey('point_info.id'), nullable=False) # 对应 PointInfo 的 ID
    version = db.Column(db.Integer, nullable=False)
    
    # 记录的字段，与 PointInfo 保持一致
    measurement = db.Column(db.String(80), nullable=False)
    original_point_name = db.Column(db.String(200), nullable=True)
    normalized_point_name = db.Column(db.String(200), nullable=True)
    point_comment = db.Column(db.Text, nullable=True)
    tags = db.Column(db.Text, nullable=True)
    fields = db.Column(db.Text, nullable=True)
    timestamp = db.Column(db.DateTime, nullable=True)
    data_type = db.Column(db.String(20), nullable=True)
    unit = db.Column(db.String(50), nullable=True)
    data_source = db.Column(db.String(50), nullable=True)
    config_file_id = db.Column(db.Integer, nullable=True)
    is_enabled = db.Column(db.Boolean, nullable=True)
    is_locked = db.Column(db.Boolean, nullable=True)
    import_batch = db.Column(db.String(50), nullable=True)
    import_status = db.Column(db.String(20), nullable=True)

    # 历史记录的元数据
    archived_at = db.Column(db.DateTime, nullable=False, default=utcnow_tz)
    change_reason = db.Column(db.String(255), nullable=True) # e.g., 'updated by import batch_123'

    def to_dict(self):
        return {
            'id': self.id,
            'point_info_id': self.point_info_id,
            'version': self.version,
            'measurement': self.measurement,
            'original_point_name': self.original_point_name,
            'normalized_point_name': self.normalized_point_name,
            'point_comment': self.point_comment,
            'tags': self.tags,
            'fields': self.fields,
            'timestamp': self.timestamp.replace(tzinfo=timezone.utc).isoformat() if self.timestamp else None,
            'data_type': self.data_type,
            'unit': self.unit,
            'data_source': self.data_source,
            'config_file_id': self.config_file_id,
            'is_enabled': self.is_enabled,
            'is_locked': self.is_locked,
            'import_batch': self.import_batch,
            'import_status': self.import_status,
            'archived_at': self.archived_at.replace(tzinfo=timezone.utc).isoformat(),
            'change_reason': self.change_reason
        }

class ConfigFile(db.Model):
    """配置文件模型"""
    __tablename__ = 'config_files'
    id = db.Column(db.Integer, primary_key=True)
    file_name = db.Column(db.String(255), nullable=False)
    content = db.Column(db.Text, nullable=False)
    content_hash = db.Column(db.String(64), nullable=False)
    version = db.Column(db.Integer, nullable=False, default=1)
    parent_version_id = db.Column(db.Integer, db.ForeignKey('config_files.id'), nullable=True)
    change_type = db.Column(db.String(20), nullable=False, default='system')
    change_description = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow_tz)
    updated_at = db.Column(db.DateTime, nullable=True, onupdate=utcnow_tz)
    is_active = db.Column(db.Boolean, nullable=False, default=False)
    data_points_synced = db.Column(db.Boolean, nullable=False, default=False)
    is_locked = db.Column(db.Boolean, nullable=False, server_default=text('0'))
    
    parent_version = db.relationship('ConfigFile', remote_side=[id], backref='child_versions')

    referenced_output_sources = db.relationship(
        'OutputSource',
        secondary=output_source_config_file_association,
        back_populates='referenced_by_config_files'
    )
    referenced_global_parameters = db.relationship(
        'GlobalParameter',
        secondary=global_parameter_config_file_association,
        back_populates='referenced_by_config_files'
    )

    def to_dict(self):
        return {
            'id': self.id, 'file_name': self.file_name, 'content': self.content,
            'content_hash': self.content_hash, 'version': self.version,
            'parent_version_id': self.parent_version_id, 'change_type': self.change_type,
            'change_description': self.change_description,
            'created_at': self.created_at.replace(tzinfo=timezone.utc).isoformat() if self.created_at else None,
            'updated_at': self.updated_at.replace(tzinfo=timezone.utc).isoformat() if self.updated_at else None,
            'is_active': self.is_active, 'data_points_synced': self.data_points_synced,
            'is_locked': self.is_locked
        }

class ConfigSnippet(db.Model):
    """配置片段模型"""
    __tablename__ = 'config_snippets'
    id = db.Column(db.Integer, primary_key=True)
    config_file_id = db.Column(db.Integer, db.ForeignKey('config_files.id'), nullable=False)
    snippet_type = db.Column(db.String(50), nullable=False)  # e.g., agent, input, output
    plugin_name = db.Column(db.String(100), nullable=True) # e.g., cpu, disk, influxdb_v2
    content = db.Column(db.Text, nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    is_locked = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow_tz)

    config_file = db.relationship('ConfigFile', backref=db.backref('snippets', lazy='dynamic', cascade="all, delete-orphan"))

    def to_dict(self):
        return {
            'id': self.id,
            'config_file_id': self.config_file_id,
            'snippet_type': self.snippet_type,
            'plugin_name': self.plugin_name,
            'content': self.content,
            'is_active': self.is_active,
            'is_locked': self.is_locked,
            'created_at': self.created_at.replace(tzinfo=timezone.utc).isoformat()
        }

class TelegrafProcess(db.Model):
    """Telegraf 进程模型"""
    __tablename__ = 'telegraf_processes'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    pid = db.Column(db.Integer, nullable=True)
    status = db.Column(db.String(50), nullable=False, default='stopped')
    config_file_id = db.Column(db.Integer, db.ForeignKey('config_files.id'), nullable=True)
    log_file_path = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow_tz)
    updated_at = db.Column(db.DateTime, nullable=True, onupdate=utcnow_tz)
    start_time = db.Column(db.DateTime, nullable=True)
    stop_time = db.Column(db.DateTime, nullable=True)
    
    config_file = db.relationship('ConfigFile', backref=db.backref('processes', lazy=True))

    def to_dict(self):
        # Check if the process is still running and update the status if not
        if self.pid and not psutil.pid_exists(self.pid) and self.status == 'running':
            logger.info(f"Process {self.pid} is no longer running. Updating status to 'stopped'.")
            self.status = 'stopped'
            self.stop_time = utcnow_tz()
            db.session.commit()

        data = {
            'id': self.id, 'name': self.name, 'pid': self.pid, 'status': self.status,
            'config_file_id': self.config_file_id,
            'config_file': self.config_file.file_name if self.config_file else None,
            'log_file_path': self.log_file_path,
            'created_at': self.created_at.replace(tzinfo=timezone.utc).isoformat() if self.created_at else None,
            'updated_at': self.updated_at.replace(tzinfo=timezone.utc).isoformat() if self.updated_at else None,
            'start_time': self.start_time.replace(tzinfo=timezone.utc).isoformat() if self.start_time else None,
            'stop_time': self.stop_time.replace(tzinfo=timezone.utc).isoformat() if self.stop_time else None,
            'cpu_percent': None,
            'memory_mb': None
        }
        if self.pid and self.status == 'running':
            try:
                p = psutil.Process(self.pid)
                data['cpu_percent'] = p.cpu_percent(interval=0.1)
                data['memory_mb'] = p.memory_info().rss / (1024 * 1024)
            except psutil.NoSuchProcess:
                # Process might have just died, update status again
                logger.info(f"Process {self.pid} disappeared during stat collection. Updating status to 'stopped'.")
                self.status = 'stopped'
                self.stop_time = utcnow_tz()
                db.session.commit()
                data['status'] = 'stopped'
        return data

class GlobalParameter(db.Model):
    """全局参数模型"""
    __tablename__ = 'global_parameters'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    config = db.Column(db.Text, nullable=False)
    description = db.Column(db.String(255), nullable=True)
    is_locked = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow_tz)
    updated_at = db.Column(db.DateTime, default=utcnow_tz, onupdate=utcnow_tz)

    referenced_by_config_files = db.relationship(
        'ConfigFile',
        secondary=global_parameter_config_file_association,
        back_populates='referenced_global_parameters'
    )

    def to_dict(self):
        return {
            'id': self.id, 'name': self.name, 'config': self.config,
            'description': self.description, 'is_locked': self.is_locked,
            'created_at': self.created_at.replace(tzinfo=timezone.utc).isoformat(),
            'updated_at': self.updated_at.replace(tzinfo=timezone.utc).isoformat(),
            'referenced_by_count': len(self.referenced_by_config_files)
        }

class DirectorySetting(db.Model):
    """目录设置模型"""
    __tablename__ = 'directory_settings'
    id = db.Column(db.Integer, primary_key=True)
    directory_path = db.Column(db.String(255), nullable=False)
    file_filter = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=utcnow_tz)
    updated_at = db.Column(db.DateTime, default=utcnow_tz, onupdate=utcnow_tz)

    def to_dict(self):
        return {
            'id': self.id, 'directory_path': self.directory_path, 'file_filter': self.file_filter,
            'created_at': self.created_at.replace(tzinfo=timezone.utc).isoformat(), 'updated_at': self.updated_at.replace(tzinfo=timezone.utc).isoformat()
        }

class PointTemplate(db.Model):
    """数据点模板模型"""
    __tablename__ = 'point_templates'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    content = db.Column(db.Text, nullable=False)
    description = db.Column(db.String(255), nullable=True)
    is_locked = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow_tz)
    updated_at = db.Column(db.DateTime, default=utcnow_tz, onupdate=utcnow_tz)

    def to_dict(self):
        return {
            'id': self.id, 'name': self.name, 'content': self.content,
            'description': self.description, 'is_locked': self.is_locked,
            'created_at': self.created_at.replace(tzinfo=timezone.utc).isoformat(),
            'updated_at': self.updated_at.replace(tzinfo=timezone.utc).isoformat()
        }

class ProcessingTag(db.Model):
    """处理转换标签模型"""
    __tablename__ = 'processing_tags'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    plugin_type = db.Column(db.String(50), nullable=False)
    config = db.Column(db.Text, nullable=False)
    description = db.Column(db.String(255), nullable=True)
    is_locked = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow_tz)
    updated_at = db.Column(db.DateTime, default=utcnow_tz, onupdate=utcnow_tz)

    def to_dict(self):
        return {
            'id': self.id, 'name': self.name, 'plugin_type': self.plugin_type,
            'config': self.config, 'description': self.description, 'is_locked': self.is_locked,
            'created_at': self.created_at.replace(tzinfo=timezone.utc).isoformat(), 'updated_at': self.updated_at.replace(tzinfo=timezone.utc).isoformat()
        }