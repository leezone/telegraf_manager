# Gunicorn 配置文件
import multiprocessing
import os

# 服务器绑定
bind = "0.0.0.0:5000"

# 工作进程
workers = 4
worker_class = "sync"
worker_connections = 1000
max_requests = 1000
max_requests_jitter = 100

# 超时设置
timeout = 30
keepalive = 2

# 日志配置
accesslog = "-"
errorlog = "-"
loglevel = "info"
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)s'

# 进程命名
proc_name = "telegraf_manager"

# 预加载应用
preload_app = True

# PID 文件
pidfile = "telegraf_manager.pid"

# 重启前优雅关闭
graceful_timeout = 30

# 临时目录
tmp_upload_dir = None
