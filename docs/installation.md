# 安装与部署指南

本文档提供了 Telegraf 配置管理系统的详细安装和部署步骤，适用于开发环境和生产环境。

## 📋 目录

- [系统要求](#系统要求)
- [安装方式](#安装方式)
- [开发环境安装](#开发环境安装)
- [生产环境部署](#生产环境部署)
- [Docker 部署](#docker-部署)
- [配置验证](#配置验证)
- [故障排除](#故障排除)

## 🖥️ 系统要求

### 最低系统要求
- **操作系统**: Linux/Unix (Ubuntu 20.04+, CentOS 8+, Debian 11+)
- **Python**: 3.11 或更高版本
- **内存**: 512MB RAM
- **存储**: 1GB 可用空间
- **网络**: 访问互联网以下载依赖包

### 推荐系统配置
- **操作系统**: Ubuntu 22.04+ 或 CentOS 9+
- **Python**: 3.12
- **内存**: 2GB+ RAM
- **存储**: 5GB+ 可用空间 (SSD 推荐)
- **网络**: 稳定的互联网连接
- **CPU**: 2核以上处理器

### 支持的操作系统
- ✅ Ubuntu 20.04, 22.04
- ✅ CentOS 8, 9
- ✅ Debian 11, 12
- ✅ Red Hat Enterprise Linux 8, 9
- ✅ Rocky Linux 8, 9
- ✅ Fedora 38, 39
- ⚠️ macOS (开发环境支持)
- ❌ Windows (仅支持 WSL2)

## 🚀 安装方式

### 方式一：一键安装脚本（推荐）

```bash
# 克隆项目
git clone <项目仓库地址>
cd telegraf_manager

# 运行安装脚本
chmod +x install.sh
./install.sh
```

安装脚本会自动完成：
- 系统环境检查
- Python 虚拟环境创建
- 依赖包安装
- 数据库初始化
- 系统服务配置
- 启动测试

### 方式二：手动安装

#### 1. 准备系统环境

```bash
# 更新系统包管理器
sudo apt update && sudo apt upgrade -y  # Ubuntu/Debian
# 或
sudo yum update -y                       # CentOS/RHEL

# 安装必要的系统依赖
sudo apt install -y python3 python3-pip python3-venv git  # Ubuntu/Debian
# 或  
sudo yum install -y python3 python3-pip git                # CentOS/RHEL
```

#### 2. 创建项目目录

```bash
# 创建项目目录
sudo mkdir -p /opt/telegraf_manager
sudo chown $USER:$USER /opt/telegraf_manager
cd /opt/telegraf_manager

# 克隆项目
git clone https://github.com/your-username/telegraf_manager.git .
```

#### 3. 设置 Python 虚拟环境

```bash
# 创建虚拟环境
python3 -m venv .venv

# 激活虚拟环境
source .venv/bin/activate

# 验证 Python 版本
python --version  # 应显示 3.11+
```

#### 4. 安装 Python 依赖

```bash
# 升级 pip
pip install --upgrade pip

# 安装项目依赖
pip install -r requirements.txt

# 安装生产环境依赖（可选）
pip install gunicorn
```

#### 5. 创建必要的目录

```bash
# 创建数据库目录
mkdir -p database/backups
mkdir -p log
mkdir -p configs

# 设置目录权限
chmod 755 database
chmod 755 log
chmod 755 configs
```

#### 6. 初始化数据库

```bash
# 激活虚拟环境
source .venv/bin/activate

# 初始化数据库
python -c "from app import app, db; app.app_context().push(); db.create_all()"

# 运行数据库迁移（如果存在迁移文件）
flask db upgrade
```

## 🛠️ 开发环境安装

### 快速启动（推荐）

```bash
# 克隆项目
git clone <项目仓库地址>
cd telegraf_manager

# 激活虚拟环境并启动
source .venv/bin/activate
./start.sh --debug --browser
```

### 详细步骤

#### 1. 环境配置

```bash
# 设置环境变量
export FLASK_APP=app.py
export FLASK_ENV=development
export FLASK_DEBUG=1
export SECRET_KEY="your-secret-key-here"
```

#### 2. 启动开发服务器

```bash
# 方式一：使用启动脚本
./start.sh --debug

# 方式二：直接使用 Flask
flask run --host=0.0.0.0 --port=5000 --debug

# 方式三：使用 Python
python app.py
```

#### 3. 验证安装

```bash
# 检查应用状态
curl http://localhost:5000/health

# 或在浏览器中访问
# http://localhost:5000
```

### 开发环境特性

- **热重载**: 代码修改后自动重启
- **调试模式**: 详细的错误信息和调试工具
- **详细日志**: 完整的请求和错误日志
- **交互式调试器**: Flask 内置的调试器

## 🏭 生产环境部署

### 方式一：使用 Gunicorn（推荐）

#### 1. 配置 Gunicorn

创建 Gunicorn 配置文件 `gunicorn.conf.py`:

```python
# gunicorn.conf.py
import multiprocessing

bind = "0.0.0.0:5000"
workers = multiprocessing.cpu_count() * 2 + 1
worker_class = "sync"
worker_connections = 1000
max_requests = 1000
max_requests_jitter = 100
timeout = 30
keepalive = 2
preload_app = True
accesslog = "log/gunicorn_access.log"
errorlog = "log/gunicorn_error.log"
loglevel = "info"
```

#### 2. 创建 systemd 服务

创建服务文件 `/etc/systemd/system/telegraf-manager.service`:

```ini
[Unit]
Description=Telegraf Manager Service
After=network.target

[Service]
Type=notify
User=telegraf
Group=telegraf
WorkingDirectory=/opt/telegraf_manager
Environment=PATH=/opt/telegraf_manager/.venv/bin
ExecStart=/opt/telegraf_manager/.venv/bin/gunicorn --config gunicorn.conf.py app:app
ExecReload=/bin/kill -s HUP $MAINPID
KillMode=mixed
TimeoutStopSec=5
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

#### 3. 创建专用用户

```bash
# 创建专用用户
sudo useradd -r -s /bin/false telegraf

# 设置目录权限
sudo chown -R telegraf:telegraf /opt/telegraf_manager
sudo chmod -R 755 /opt/telegraf_manager
```

#### 4. 启动服务

```bash
# 重新加载 systemd 配置
sudo systemctl daemon-reload

# 启用并启动服务
sudo systemctl enable telegraf-manager
sudo systemctl start telegraf-manager

# 检查服务状态
sudo systemctl status telegraf-manager

# 查看服务日志
sudo journalctl -u telegraf-manager -f
```

### 方式二：使用 Nginx + Gunicorn

#### 1. 安装 Nginx

```bash
# Ubuntu/Debian
sudo apt install nginx -y

# CentOS/RHEL  
sudo yum install nginx -y
```

#### 2. 配置 Nginx

创建 Nginx 配置文件 `/etc/nginx/sites-available/telegraf-manager`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 10M;
    
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    location /static/ {
        alias /opt/telegraf_manager/static/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

#### 3. 启用配置

```bash
# 创建符号链接
sudo ln -s /etc/nginx/sites-available/telegraf-manager /etc/nginx/sites-enabled/

# 测试 Nginx 配置
sudo nginx -t

# 重启 Nginx
sudo systemctl restart nginx

# 启用防火墙（如果需要）
sudo ufw allow 'Nginx Full'
```

### 方式三：使用 Docker

#### 1. 创建 Dockerfile

```dockerfile
FROM python:3.12-slim

# 设置工作目录
WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY requirements.txt .

# 安装 Python 依赖
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY . .

# 创建必要的目录
RUN mkdir -p database/backups log configs

# 设置权限
RUN chmod 755 database log configs

# 暴露端口
EXPOSE 5000

# 设置环境变量
ENV FLASK_APP=app.py
ENV FLASK_ENV=production

# 启动命令
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "4", "app:app"]
```

#### 2. 创建 docker-compose.yml

```yaml
version: '3.8'

services:
  telegraf-manager:
    build: .
    ports:
      - "5000:5000"
    volumes:
      - ./database:/app/database
      - ./log:/app/log
      - ./configs:/app/configs
    environment:
      - FLASK_ENV=production
      - SECRET_KEY=your-secret-key-here
    restart: unless-stopped
    networks:
      - telegraf-network

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - telegraf-manager
    restart: unless-stopped
    networks:
      - telegraf-network

networks:
  telegraf-network:
    driver: bridge
```

#### 3. 构建和运行

```bash
# 构建镜像
docker-compose build

# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

## 🔍 配置验证

### 应用健康检查

```bash
# 检查应用状态
curl http://localhost:5000/health

# 检查 API 端点
curl http://localhost:5000/api/system/status

# 检查静态资源
curl -I http://localhost:5000/static/css/style.css
```

### 数据库连接测试

```bash
# 激活虚拟环境
source .venv/bin/activate

# 测试数据库连接
python -c "
from app import app, db
with app.app_context():
    try:
        db.session.execute('SELECT 1')
        print('数据库连接正常')
    except Exception as e:
        print(f'数据库连接失败: {e}')
"
```

### 进程状态检查

```bash
# 检查 Gunicorn 进程
ps aux | grep gunicorn

# 检查端口占用
netstat -tlnp | grep :5000

# 检查系统资源使用
htop
```

## 🚨 故障排除

### 常见安装问题

#### 问题1：Python 版本不兼容
```bash
# 检查 Python 版本
python3 --version

# 如果版本过低，安装新版本
# Ubuntu 22.04
sudo apt install python3.11 python3.11-venv python3.11-pip

# 创建指定版本的虚拟环境
python3.11 -m venv .venv
```

#### 问题2：虚拟环境创建失败
```bash
# 确保 python3-venv 已安装
sudo apt install python3.11-venv

# 手动创建虚拟环境
python3 -m venv --system-site-packages .venv
```

#### 问题3：依赖包安装失败
```bash
# 升级 pip
pip install --upgrade pip

# 清理缓存
pip cache purge

# 重新安装
pip install -r requirements.txt --no-cache-dir
```

#### 问题4：数据库初始化失败
```bash
# 检查数据库文件权限
ls -la database/

# 重新创建数据库
rm -f database/telegraf_manager.db
python -c "from app import app, db; app.app_context().push(); db.create_all()"
```

### 启动问题

#### 问题1：端口被占用
```bash
# 查看端口占用
netstat -tlnp | grep :5000
sudo lsof -i :5000

# 终止占用进程
sudo kill -9 <PID>
```

#### 问题2：权限错误
```bash
# 检查目录权限
ls -la /opt/telegraf_manager/

# 修复权限
sudo chown -R $USER:$USER /opt/telegraf_manager/
chmod -R 755 /opt/telegraf_manager/
```

#### 问题3：系统服务启动失败
```bash
# 查看服务状态
sudo systemctl status telegraf-manager

# 查看详细日志
sudo journalctl -u telegraf-manager --no-pager

# 重新启动服务
sudo systemctl restart telegraf-manager
```

### 性能优化建议

#### 1. 系统级优化
```bash
# 调整文件描述符限制
echo "* soft nofile 65536" | sudo tee -a /etc/security/limits.conf
echo "* hard nofile 65536" | sudo tee -a /etc/security/limits.conf

# 优化内核参数
echo "net.core.somaxconn = 65536" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

#### 2. Gunicorn 优化
```python
# 生产环境 gunicorn.conf.py 优化配置
workers = multiprocessing.cpu_count() * 2 + 1
worker_class = "gevent"  # 使用异步 worker
worker_connections = 1000
timeout = 30
keepalive = 2
max_requests = 1000
max_requests_jitter = 100
preload_app = True
```

#### 3. 数据库优化
```bash
# 定期清理日志
find log/ -name "*.log" -mtime +30 -delete

# 数据库备份策略
crontab -e
# 添加：0 2 * * * /opt/telegraf_manager/.venv/bin/python /opt/telegraf_manager/db_manager.py backup
```

## 📞 获取支持

如果在安装过程中遇到问题，请：

1. 查看本文档的故障排除部分
2. 检查项目的 [GitHub Issues](https://github.com/your-username/telegraf_manager/issues)
3. 提交新的 Issue 并提供详细的错误信息
4. 联系技术支持

---

**祝您安装顺利！** 🎉