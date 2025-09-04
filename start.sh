#!/bin/bash

# Telegraf 管理系统启动脚本
# 功能：使用虚拟环境启动应用，支持端口指定和浏览器打开
# 作者：项目开发团队

# 脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
VENV_DIR="$PROJECT_DIR/.venv"
PYTHON_EXEC="$VENV_DIR/bin/python"
APP_FILE="$PROJECT_DIR/app.py"

# 默认配置
DEFAULT_PORT=5000
DEFAULT_HOST="0.0.0.0"
OPEN_BROWSER=false
PRODUCTION_MODE=false
WORKERS=4

# 颜色输出函数
print_info() {
    echo -e "\033[36m[INFO]\033[0m $1"
}

print_success() {
    echo -e "\033[32m[SUCCESS]\033[0m $1"
}

print_error() {
    echo -e "\033[31m[ERROR]\033[0m $1"
}

print_warning() {
    echo -e "\033[33m[WARNING]\033[0m $1"
}

# 显示帮助信息
show_help() {
    cat << EOF
Telegraf 管理系统启动脚本

用法: $0 [选项]

选项:
  -p, --port PORT     指定启动端口 (默认: $DEFAULT_PORT)
  -h, --host HOST     指定监听地址 (默认: $DEFAULT_HOST)
  -b, --browser       启动后自动打开浏览器
  -d, --debug         启用调试模式 (开发环境)
  --prod              生产环境模式 (使用 Gunicorn)
  -w, --workers NUM   生产环境工作进程数 (默认: $WORKERS)
  --help              显示此帮助信息

环境模式:
  开发模式 (默认):    使用 Flask 内置服务器，支持调试和热重载
  生产模式 (--prod):  使用 Gunicorn WSGI 服务器，适合生产部署

示例:
  $0                    # 开发模式，使用默认设置启动
  $0 -p 8080 -b        # 开发模式，在端口 8080 启动并打开浏览器
  $0 --prod            # 生产模式启动
  $0 --prod -p 8080 -w 8  # 生产模式，端口 8080，8个工作进程
  $0 --prod --workers 6   # 生产模式，6个工作进程

环境要求:
  - Python 虚拟环境位于: $VENV_DIR
  - 应用文件位于: $APP_FILE
  - 生产模式需要安装: gunicorn
  - 此脚本使用 .venv37 虚拟环境 (Python 3.7.9)
EOF
}

# 检查虚拟环境
check_venv() {
    if [ ! -d "$VENV_DIR" ]; then
        print_error "虚拟环境不存在: $VENV_DIR"
        print_info "请先创建虚拟环境:"
        echo "  python3.12 -m venv .venv"
        echo "  source .venv/bin/activate"
        echo "  pip install flask==2.2.5 flask-sqlalchemy==3.0.5 flask-login==0.6.3 psutil==5.9.5"
        exit 1
    fi

    if [ ! -f "$PYTHON_EXEC" ]; then
        print_error "Python 可执行文件不存在: $PYTHON_EXEC"
        exit 1
    fi
}

# 检查应用文件
check_app() {
    if [ ! -f "$APP_FILE" ]; then
        print_error "应用文件不存在: $APP_FILE"
        exit 1
    fi
}

# 检查依赖包
check_dependencies() {
    print_info "检查 Python 依赖包..."
    
    local required_packages=("flask" "flask-sqlalchemy" "flask-login" "psutil")
    local missing_packages=()
    
    # 如果是生产模式，检查 gunicorn
    if [ "$PRODUCTION_MODE" = true ]; then
        required_packages+=("gunicorn")
    fi
    
    for package in "${required_packages[@]}"; do
        # 特殊处理 flask-sqlalchemy 和 flask-login
        local import_name="$package"
        case "$package" in
            "flask-sqlalchemy") import_name="flask_sqlalchemy" ;;
            "flask-login") import_name="flask_login" ;;
        esac
        
        if ! "$PYTHON_EXEC" -c "import $import_name" 2>/dev/null; then
            missing_packages+=("$package")
        fi
    done
    
    if [ ${#missing_packages[@]} -ne 0 ]; then
        print_error "缺少必要的依赖包: ${missing_packages[*]}"
        print_info "请安装缺少的依赖包:"
        echo "  source $VENV_DIR/bin/activate"
        echo "  pip install --find-links=offline_packages/ ${missing_packages[*]}"
        exit 1
    fi
    
    print_success "所有依赖包检查通过"
}

# 打开浏览器
open_browser() {
    local url="http://localhost:$1"
    print_info "尝试打开浏览器: $url"
    
    # 延迟几秒等待服务器启动
    sleep 3
    
    if command -v xdg-open > /dev/null; then
        xdg-open "$url" &
    elif command -v open > /dev/null; then
        open "$url" &
    elif command -v start > /dev/null; then
        start "$url" &
    else
        print_warning "无法自动打开浏览器，请手动访问: $url"
    fi
}

# 启动应用
start_app() {
    local port="$1"
    local host="$2"
    local debug_mode="$3"
    local open_browser_flag="$4"
    local production_mode="$5"
    local workers="$6"
    
    print_info "="*60
    if [ "$production_mode" = true ]; then
        print_info "🚀 启动 Telegraf 管理系统 (生产模式)"
    else
        print_info "🚀 启动 Telegraf 管理系统 (开发模式)"
    fi
    print_info "="*60
    print_info "端口: $port"
    print_info "地址: $host"
    if [ "$production_mode" = true ]; then
        print_info "工作进程数: $workers"
        print_info "WSGI服务器: Gunicorn"
    else
        print_info "调试模式: $debug_mode"
        print_info "WSGI服务器: Flask开发服务器"
    fi
    print_info "虚拟环境: $VENV_DIR "
    print_info "="*60
    
    # 如果需要打开浏览器，在后台启动
    if [ "$open_browser_flag" = true ]; then
        open_browser "$port" &
    fi
    
    # 进入项目目录
    cd "$PROJECT_DIR" || exit 1
    
    if [ "$production_mode" = true ]; then
        # 生产模式：使用 Gunicorn
        start_production_server "$port" "$host" "$workers"
    else
        # 开发模式：使用 Flask 开发服务器
        start_development_server "$port" "$host" "$debug_mode"
    fi
}

# 生产模式启动函数
start_production_server() {
    local port="$1"
    local host="$2"
    local workers="$3"
    
    print_info "使用 Gunicorn 启动生产服务器..."
    
    # 使用 Python 创建 Gunicorn 配置文件
    "$PYTHON_EXEC" -c "
from app_init import create_gunicorn_config
with open('$PROJECT_DIR/gunicorn.conf.py', 'w') as f:
    f.write(create_gunicorn_config('$host', $port, $workers))
"
    
    # 激活虚拟环境并启动 Gunicorn
    source "$VENV_DIR/bin/activate"
    
    # 设置 PYTHONPATH
    export PYTHONPATH="$PROJECT_DIR:$PYTHONPATH"
    
    print_success "正在启动 Gunicorn 服务器..."
    exec gunicorn --config gunicorn.conf.py app:app
}

# 开发模式启动函数  
start_development_server() {
    local port="$1"
    local host="$2"
    local debug_mode="$3"
    
    print_info "使用 Flask 开发服务器启动..."
    
    # 设置环境变量
    export FLASK_PORT="$port"
    export FLASK_HOST="$host"
    export FLASK_DEBUG="$debug_mode"
    
    # 使用虚拟环境中的 Python 启动应用
    print_success "正在启动应用..."
    "$PYTHON_EXEC" "$PROJECT_DIR/app.py"
}

# 解析命令行参数
PORT="$DEFAULT_PORT"
HOST="$DEFAULT_HOST"
DEBUG_MODE="true"

while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--port)
            PORT="$2"
            shift 2
            ;;
        -h|--host)
            HOST="$2"
            shift 2
            ;;
        -b|--browser)
            OPEN_BROWSER=true
            shift
            ;;
        -d|--debug)
            DEBUG_MODE="true"
            shift
            ;;
        --prod)
            PRODUCTION_MODE=true
            DEBUG_MODE="false"
            shift
            ;;
        -w|--workers)
            WORKERS="$2"
            shift 2
            ;;
        --help)
            show_help
            exit 0
            ;;
        *)
            print_error "未知参数: $1"
            show_help
            exit 1
            ;;
    esac
done

# 验证端口号
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
    print_error "无效的端口号: $PORT"
    exit 1
fi

# 验证工作进程数量
if ! [[ "$WORKERS" =~ ^[0-9]+$ ]] || [ "$WORKERS" -lt 1 ] || [ "$WORKERS" -gt 32 ]; then
    print_error "无效的工作进程数量: $WORKERS (应该在 1-32 之间)"
    exit 1
fi

# 主执行流程
main() {
    print_info "检查运行环境..."
    
    check_venv
    check_app
    check_dependencies
    setup_cronjob
    manage_database_migrations
    
    print_success "环境检查通过，正在启动应用..."
    start_app "$PORT" "$HOST" "$DEBUG_MODE" "$OPEN_BROWSER" "$PRODUCTION_MODE" "$WORKERS"
}

# 数据库迁移管理
manage_database_migrations() {
    print_info "检查并执行数据库迁移..."
    
    # 激活虚拟环境
    source "$VENV_DIR/bin/activate"
    export FLASK_APP=app.py

    # 检查 migrations 目录是否存在
    if [ ! -d "$PROJECT_DIR/migrations" ]; then
        print_warning "未找到迁移目录，正在初始化数据库..."
        flask db init
        flask db migrate -m "Initial migration."
        flask db upgrade
        print_success "数据库初始化并迁移完成"
    else
        # 始终尝试升级到最新版本
        flask db upgrade
        print_success "数据库迁移检查完成"
    fi
}

# 设置日志清理定时任务
setup_cronjob() {
    print_info "检查并设置日志清理定时任务..."
    local cron_job="* * * * * /bin/bash $PROJECT_DIR/clear_logs.sh"
    if ! crontab -l | grep -q "$PROJECT_DIR/clear_logs.sh"; then
        (crontab -l 2>/dev/null; echo "$cron_job") | crontab -
        print_success "已添加日志清理定时任务到 crontab"
    else
        print_info "日志清理定时任务已存在"
    fi
}

# 捕获中断信号
trap 'print_info "收到中断信号，正在停止应用..."; exit 0' INT TERM

# 运行主函数
main "$@"