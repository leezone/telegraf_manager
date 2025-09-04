#!/usr/bin/env python
# -*- coding: utf-8 -*-

import sys
import os
from datetime import datetime
from db_manager import get_duckdb_connection, insert_log_entry

def archive_log_file(log_file_path):
    """
    读取指定的日志文件，将其内容存入 DuckDB，然后清空该文件。
    """
    if not os.path.exists(log_file_path):
        print(f"Error: Log file not found: {log_file_path}")
        return

    # 从文件名中解析元数据
    # 文件名格式: telegraf_{config_file_name}_{pid}_{timestamp}.log
    try:
        parts = os.path.basename(log_file_path).removesuffix('.log').split('_')
        config_file_name = parts[1]
        pid = int(parts[2])
        process_name = f"archived_{config_file_name}_{pid}"
        config_file = "unknown" # 无法从文件名中得知确切的配置文件路径
        log_type = "archived"
    except (IndexError, ValueError) as e:
        print(f"Error: Could not parse metadata from log file name: {os.path.basename(log_file_path)} - {e}")
        # 使用默认值
        pid = None
        process_name = "archived_log"
        config_file = "unknown"
        log_type = "archived"

    conn = None
    try:
        conn = get_duckdb_connection()
        with open(log_file_path, 'r', encoding='utf-8') as f:
            for line in f:
                message = line.strip()
                if message:
                    insert_log_entry(conn, datetime.now(), pid, process_name, config_file, log_type, message)
        
        # 删除文件
        os.remove(log_file_path)
            
        print(f"Successfully archived and deleted log file: {log_file_path}")

    except Exception as e:
        print(f"Error archiving log file {log_file_path}: {e}")
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python archive_logs.py <log_file_path>")
        sys.exit(1)
    
    log_file_path = sys.argv[1]
    archive_log_file(log_file_path)