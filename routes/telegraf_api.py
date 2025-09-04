# -*- coding: utf-8 -*-
"""
与 Telegraf 可执行文件直接交互的 API 蓝图
"""

import logging
import subprocess
import tempfile
import os
from flask import Blueprint, request, Response
from flask_login import login_required

from api_utils import error_response, success_response
from models import db, ConfigFile

# 获取一个 logger 实例
logger = logging.getLogger(__name__)

telegraf_api_bp = Blueprint('telegraf_api', __name__, url_prefix='/api/telegraf')

@telegraf_api_bp.route('/plugins', methods=['GET'])
@login_required
def get_telegraf_plugins():
    plugin_types = ['inputs', 'outputs', 'processors', 'aggregators']
    plugins = {}
    try:
        for p_type in plugin_types:
            result = subprocess.run(['telegraf', 'plugins', p_type], capture_output=True, text=True, check=True)
            lines = result.stdout.strip().split('\n')
            parsed_plugins = []
            for line in lines:
                if ':' in line or not line.strip():
                    continue
                plugin_name = line.strip().split(' ')[-1].split('.')[-1]
                parsed_plugins.append(plugin_name)
            plugins[p_type] = sorted(list(set(parsed_plugins)))
        return success_response("Plugins loaded successfully", plugins)
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        return error_response(f"Failed to execute telegraf command: {e}", 500)

@telegraf_api_bp.route('/generate-sample', methods=['POST'])
@login_required
def generate_telegraf_sample():
    data = request.get_json()
    if not data or 'plugins' not in data:
        return error_response("Invalid request body, missing 'plugins' key.", 400)

    selected_plugins = data['plugins']
    command = ['telegraf', 'config']
    
    input_plugins = [p.split('.', 1)[1] for p in selected_plugins if p.startswith('inputs.')]
    output_plugins = [p.split('.', 1)[1] for p in selected_plugins if p.startswith('outputs.')]
    proc_plugins = [p.split('.', 1)[1] for p in selected_plugins if p.startswith('processors.')]
    agg_plugins = [p.split('.', 1)[1] for p in selected_plugins if p.startswith('aggregators.')]

    if input_plugins:
        command.extend(['--input-filter', ':'.join(input_plugins)])
    if output_plugins:
        command.extend(['--output-filter', ':'.join(output_plugins)])
    if proc_plugins:
        command.extend(['--processor-filter', ':'.join(proc_plugins)])
    if agg_plugins:
        command.extend(['--aggregator-filter', ':'.join(agg_plugins)])

    if len(command) == 2:
        return Response("", mimetype='text/plain')

    logger.info(f"Executing Telegraf command: {' '.join(command)}")

    try:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
        stdout, stderr = process.communicate()

        if process.returncode != 0:
            logger.error(f"Telegraf command failed with stderr: {stderr}")
            return Response(f"Failed to generate telegraf config: {stderr}", status=500, mimetype='text/plain')

        logger.info(f"Telegraf command stdout length: {len(stdout)}")
        # Return the raw TOML content directly
        return Response(stdout, mimetype='text/plain')

    except FileNotFoundError:
        return error_response("telegraf command not found", 500)

@telegraf_api_bp.route('/validate', methods=['POST'])
@login_required
def validate_telegraf_config():
    """通用配置验证接口，支持通过内容或ID进行验证"""
    data = request.get_json()
    content = data.get('content')
    config_id = data.get('config_id')

    if content is None and config_id is None:
        return error_response('请求必须包含 “content” 或 “config_id”', 400)

    if content is None:
        config_file = ConfigFile.query.get(config_id)
        if not config_file:
            return error_response('配置文件未找到', 404)
        content = config_file.content

    try:
        with tempfile.NamedTemporaryFile(mode='w+', delete=False, suffix='.conf') as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        result = subprocess.run(
            ['telegraf', '--test', '--config', tmp_path, '--once'],
            capture_output=True, text=True, timeout=30
        )

        if result.returncode == 0:
            return success_response("配置有效", {"is_valid": True, "error_type": "none", "error": ""})
        else:
            stderr_text = result.stderr.lower()
            error_type = "runtime"  # 默认为运行时错误
            
            syntax_keywords = ["error parsing", "toml syntax error", "undetermined type", "missing required field"]
            if any(keyword in stderr_text for keyword in syntax_keywords):
                error_type = "syntax"

            error_lines = result.stderr.splitlines()
            specific_error = next((line for line in error_lines if 'error' in line.lower()), None)
            error_to_return = specific_error if specific_error else (result.stderr or '未知验证错误')
            
            return success_response(
                "配置无效", 
                {"is_valid": False, "error_type": error_type, "error": error_to_return}, 
                status_code=200
            )

    except FileNotFoundError:
        return error_response("telegraf 命令未找到。请确认 Telegraf 是否已安装在服务器上。", 500)
    except Exception as e:
        logger.exception("Telegraf 配置测试期间发生错误")
        return error_response(f"验证期间发生意外错误: {str(e)}", 500)
    finally:
        if 'tmp_path' in locals() and os.path.exists(tmp_path):
            os.remove(tmp_path)

