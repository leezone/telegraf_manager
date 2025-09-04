#!/bin/bash

LOG_DIR="/home/leezone/project/telegraf_manager/log"
MAX_SIZE=1048576 # 1MB in bytes
PYTHON_EXEC="/home/leezone/project/telegraf_manager/.venv/bin/python"
ARCHIVE_SCRIPT="/home/leezone/project/telegraf_manager/archive_logs.py"

if [ ! -d "$LOG_DIR" ]; then
  echo "Log directory not found: $LOG_DIR"
  exit 1
fi

find "$LOG_DIR" -type f -name "*.log" -print0 | while IFS= read -r -d 
    "$PYTHON_EXEC" "$ARCHIVE_SCRIPT" "$log_file"
done\0' log_file; do
    "$PYTHON_EXEC" "$ARCHIVE_SCRIPT" "$log_file"
done