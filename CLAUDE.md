# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在此代码库中工作时提供指导。

## 开发环境配置

这是一个用于管理 Telegraf 配置和进程的 Python Flask 网络应用程序。项目使用位于 `.venv/` 的虚拟环境。

**必要命令：**
```bash
# 激活虚拟环境（所有 Python 操作都必须先执行此命令）
source .venv/bin/activate

# 安装依赖包（开发环境）
pip install flask flask-sqlalchemy flask-login psutil

# 安装依赖包（生产环境，额外需要）
pip install gunicorn

# 开发环境启动（推荐）
./start.sh                    # 开发模式，默认设置（5000端口）
./start.sh -p 8080            # 开发模式，指定端口
./start.sh -p 8080 -b         # 开发模式，指定端口并自动打开浏览器
./start.sh -d --port 3000 --browser  # 开发模式，完整参数启动

# 生产环境启动
./start.sh --prod             # 生产模式，默认设置（5000端口，4个工作进程）
./start.sh --prod -p 8080     # 生产模式，指定端口
./start.sh --prod -p 8080 -w 8  # 生产模式，指定端口和工作进程数
./start.sh --prod --workers 6   # 生产模式，指定工作进程数

# 传统启动方式（不推荐）
python app.py

# 初始化数据库（现在会自动处理）
python -c "from app import app, db; app.app_context().push(); db.create_all()"
```

**环境模式说明：**
- **开发模式（默认）**：使用 Flask 内置服务器，支持调试模式、热重载，适合开发和测试
- **生产模式（--prod）**：使用 Gunicorn WSGI 服务器，支持多工作进程，适合生产部署，不会出现开发服务器警告

## 架构概述

这是一个基于 Flask 的 REST API，用于管理 Telegraf 监控配置：

- **app.py**：主 Flask 应用程序，包含管理输入源、输出源、数据点信息、配置文件和 Telegraf 进程的 REST 端点
- **models.py**：SQLAlchemy 数据库模型（User、InputSource、OutputSource、PointInfo、ConfigFile、TelegrafProcess），使用 SQLite 后端
- **process_manager.py**：完整的 Telegraf 进程管理工具，支持启动、停止、监控和状态查询，自动过滤 systemd 管理的进程
- **config_manager.py**：配置文件管理器，处理 systemd 服务检查、配置文件解析、数据点提取和版本控制管理
- **db_manager.py**：数据库管理工具，提供数据库备份、恢复、重新初始化和完整性检查功能
- **start.sh**：智能启动脚本，支持端口指定、浏览器自动打开、环境检查和依赖验证，支持开发和生产模式切换
- **templates/config_template.conf**：Telegraf 配置文件模板

应用程序提供完整的 CRUD API：
- 用户认证和会话管理
- 输入/输出源配置管理
- 数据点信息管理
- 配置文件存储和版本控制
- Telegraf 进程生命周期管理
- systemd 服务状态监控和警告

数据库使用 SQLite（`database/telegraf_manager.db`），应用启动时自动创建表结构。

## 关键实现要点

- 使用 subprocess.Popen 启动 Telegraf 进程（后台运行）
- 进程停止使用信号机制（SIGTERM/SIGKILL）实现优雅关闭
- 使用 psutil 库进行进程监控和管理
- **智能进程管理**：自动识别并过滤 systemd 管理的 Telegraf 进程，避免冲突
- **systemd 服务监控**：检查系统级 Telegraf 服务状态，如果发现活跃服务会发出警告
- **配置文件版本控制**：支持配置文件的版本管理，自动检测外部修改并创建新版本
- **数据点自动同步**：从配置文件中自动提取数据点信息并同步到数据库
- 所有模型都包含 to_dict() 方法用于 JSON 序列化
- Flask 应用包含用户认证系统（Flask-Login）
- 数据库初始化在应用上下文启动时进行
- 默认管理员账户：用户名=admin，密码=admin123

## 新增功能特性

### 1. SystemD 服务管理
- 自动检测系统中的 systemd telegraf 服务
- 解析服务配置文件路径
- 检查服务状态（激活/启用状态）
- 分析默认配置文件中的数据点信息
- 如果 systemd 服务激活且包含数据点，会发出冲突警告

### 2. 智能进程过滤
- 进程列表自动区分本系统管理的进程和 systemd 管理的进程
- 通过配置文件路径和父进程关系判断进程归属
- 防止误操作 systemd 管理的 Telegraf 进程

### 3. 配置文件版本控制
- 每次配置文件修改都会创建新版本
- 支持手动修改、系统修改、外部修改三种变更类型
- 使用 SHA256 哈希检测配置文件变更
- 维护完整的版本历史链
- 支持版本回滚功能

### 4. 外部变更检测
- 定期检查配置文件是否被外部程序修改
- 自动创建新版本记录外部变更
- 保留变更历史和变更说明

### 5. 完善的数据点管理系统
- **智能数据同步功能**：
  - 从配置文件中自动解析输入和输出插件，提取数据点的 measurement、tags、fields 信息
  - 智能识别系统插件（cpu、mem、disk等）并自动创建多个相关数据点
  - 支持数据类型推断（float、string、boolean）和单位自动识别
  - 点位名称自动标准化（特殊字符转换、格式统一）
- **丰富的数据模型**：
  - 支持原始点位名称、标准化点位名称、点位注释、数据类型、单位等丰富元数据
  - 多种数据来源标识（config_sync、manual、excel_import）
  - 批量导入支持（导入批次标识、批量启用/禁用、批量删除）
- **高级管理功能**：
  - 数据点与配置文件建立外键关系，支持配置文件变更时的数据点追踪
  - 完整的 CRUD API 和批量操作接口
  - 强大的搜索和筛选功能（支持分页、多条件筛选）
  - 详细的统计分析（按类型、来源、配置文件等维度统计）
- **版本兼容性**：与配置文件版本控制系统深度集成，支持配置变更时的数据点自动同步

### 6. 模板化配置管理系统
- **分类模板设计**：
  - 将Telegraf配置拆分为四种独立模板类型
  - `agent_template.conf`：全局代理配置模板
  - `input_template.conf`：输入插件配置模板
  - `input_group_template.conf`：输入节点组和节点配置模板
  - `output_template.conf`：输出插件配置模板
- **变量替换机制**：
  - 使用`${变量名:默认值}`格式定义可配置变量
  - 支持在Web界面中设置变量值
  - 自动应用默认值处理未设置的变量
- **Web界面模板管理**：
  - 在Web界面中直接编辑模板内容
  - 支持模板预览和语法检查
  - 模板版本管理和历史记录
- **模板组合生成**：
  - 自动组合多个模板生成完整配置文件
  - 智能处理模板间的依赖关系
  - 支持批量应用模板生成多个配置文件

### 7. 智能数据库管理系统
- **自动完整性检查**：启动时自动检查数据库完整性，检测损坏或缺失的表结构
- **智能备份机制**：
  - 自动备份问题数据库到 `database/backups/` 目录
  - 支持手动创建备份，使用时间戳命名
  - 提供备份文件列表和管理功能
- **一键重新初始化**：
  - 检测到数据库问题时自动重新初始化
  - 保留原数据库备份，确保数据安全
  - 自动创建默认管理员账户
- **Web API 管理**：提供完整的数据库管理 REST API 接口

### 8. 便捷启动脚本系统
- **智能启动脚本（start.sh）**：
  - 自动检查虚拟环境和依赖包
  - 支持端口指定（-p/--port）和主机绑定（-h/--host）
  - 自动打开浏览器功能（-b/--browser）
  - 调试模式切换（-d/--debug）
  - 生产模式切换（--prod）和工作进程配置（-w/--workers）
  - 详细的启动日志和错误提示
- **参数化启动**：支持环境变量配置，灵活适应不同部署环境

## 前后端接口需求详细说明

基于最新的页面布局调整（输入源和输出源合并），重新设计后端API结构，确保前后端数据交互的完整性和高效性。

### 页面布局与API映射

#### 1. 数据源管理页面（合并输入源和输出源）
**页面功能**：统一管理 Telegraf 的输入插件和输出插件配置
**核心功能**：
- **模板化配置管理**：根据不同插件类型分别定义独立模板
- **Web界面模板编辑**：支持在Web界面中编写和管理模板
- **变量替换支持**：模板中的关键配置项可使用变量代替，提高灵活性
- **智能配置向导**：根据插件类型自动加载对应的配置模板
- **数据格式支持**：集成 Telegraf 官方支持的所有数据格式（参考：https://docs.influxdata.com/telegraf/v1/data_formats/）

**模板类型划分**：
1. **全局配置模板**：`agent_template.conf` - 定义 `[agent]` 全局配置
2. **输入插件模板**：`input_template.conf` - 定义 `[[inputs.opcua]]` 等输入插件配置
3. **输入节点组模板**：`input_group_template.conf` - 定义 `[[inputs.opcua.group]]` 和 `[[inputs.opcua.group.nodes]]` 配置
4. **输出插件模板**：`output_template.conf` - 定义 `[[outputs.http]]` 等输出插件配置

**对应API**：
- `GET /api/data_sources` - 获取所有数据源（输入源+输出源）
- `POST /api/data_sources` - 创建新数据源
- `PUT /api/data_sources/<id>` - 更新数据源
- `DELETE /api/data_sources/<id>` - 删除数据源
- `GET /api/data_sources/types` - 获取支持的数据源类型列表
- `GET /api/templates` - 获取所有配置模板
- `GET /api/templates/<template_type>` - 获取指定类型的模板（agent/input/input_group/output）
- `POST /api/templates` - 创建新模板
- `PUT /api/templates/<id>` - 更新模板
- `DELETE /api/templates/<id>` - 删除模板

**模板变量设计**：
```
# 全局配置模板变量示例 (agent_template.conf)
interval = "${interval:10s}"         # 默认值为10s
flush_interval = "${flush_interval:5s}" # 默认值为5s
hostname = "${hostname:}"            # 空默认值

# 输入插件模板变量示例 (input_template.conf)
endpoint = "${endpoint:opc.tcp://localhost:4840}"
connect_timeout = "${connect_timeout:10s}"

# 输出插件模板变量示例 (output_template.conf)
url = "${url:http://localhost:8086/write}"
username = "${username:}"
password = "${password:}"
```

**API响应格式**：
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "CPU监控",
      "type": "input",  // input 或 output
      "plugin": "cpu",  // 插件类型
      "config": {...},  // 配置参数
      "enabled": true,
      "created_at": "2025-07-24T10:00:00Z",
      "updated_at": "2025-07-24T10:00:00Z"
    }
  ],
  "total": 10,
  "page": 1,
  "per_page": 20
}
```

#### 2. 配置文件管理页面（增强功能）
**页面功能**：管理 Telegraf 配置文件，支持版本控制和在线编辑，显示运行状态和日志
**核心功能**：
- **运行状态指示**：显示每个配置文件是否正在运行
- **启动日志记录**：记录每次配置文件启动的详细日志
- **错误诊断**：启动失败时提供详细的错误信息和排查建议
- **日志历史查看**：查看配置文件的历史启动日志和运行记录
- **配置验证**：启动前自动验证配置文件语法正确性

**示例配置文件**：templates\telegraf11.conf
- **固定参数**：[agent] 无特殊情况无需调整
- **输入插件**：[[inputs.opcua]] 本示例中使用opcua协议读取SIS系统数据，在专业任务中配置一般固定不变
- **输出插件**：[[outputs.http]] 本示例中使用http协议将数据发送到中台涛思数据库，在专业任务中配置一般固定不变
- **转换配置**：[[inputs.opcua.group]] 本示例中使用group插件将opcua协议读取的数据进行提取，是本应用重点处理部分
- **转换配置**：[[inputs.opcua.group.nodes]] 本示例中使用从group插件提取的数据转换为涛思数据库格式，是本应用重点处理部分

**对应API**：
- `GET /api/configs` - 获取配置文件列表（包含运行状态）
- `POST /api/configs` - 创建新配置文件
- `GET /api/configs/<id>` - 获取配置文件详情
- `PUT /api/configs/<id>` - 更新配置文件
- `DELETE /api/configs/<id>` - 删除配置文件
- `POST /api/configs/<id>/generate` - 根据数据源生成配置文件
- `GET /api/configs/<id>/versions` - 获取配置文件版本历史
- `POST /api/configs/<id>/rollback` - 回滚到指定版本
- `GET /api/configs/<id>/status` - 获取配置文件运行状态
- `GET /api/configs/<id>/logs` - 获取配置文件启动日志
- `POST /api/configs/<id>/validate` - 验证配置文件语法

**配置文件状态响应格式**：
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "telegraf11.conf",
      "description": "第11批监控点位",
      "file_path": "/etc/telegraf/telegraf11.conf", 
      "is_running": true,
      "process_id": "managed_001",
      "last_start_time": "2025-07-24T08:00:00Z",
      "last_start_status": "success",
      "error_count": 0,
      "created_at": "2025-07-23T10:00:00Z",
      "updated_at": "2025-07-24T07:55:00Z"
    },
    {
      "id": 2,
      "name": "database_monitoring.conf",
      "is_running": false,
      "last_start_time": "2025-07-24T06:00:00Z",
      "last_start_status": "failed",
      "last_error": "配置文件语法错误：第15行缺少闭合括号",
      "error_count": 3,
      "needs_attention": true
    }
  ]
}
```

**启动日志记录结构**：
```json
{
  "log_id": "log_20250724_080000",
  "config_id": 1,
  "start_time": "2025-07-24T08:00:00Z",
  "status": "success",  // success, failed, warning
  "process_id": "managed_001",
  "duration_ms": 1250,
  "output_lines": [
    "2025-07-24T08:00:00Z I! Starting Telegraf",
    "2025-07-24T08:00:01Z I! Loaded inputs: cpu mem disk",
    "2025-07-24T08:00:01Z I! Loaded outputs: influxdb",
    "2025-07-24T08:00:01Z I! Tags enabled: host=server01",
    "2025-07-24T08:00:01Z I! Agent Config: Interval:10s"
  ],
  "error_lines": [],
  "warnings": ["某些插件配置可能需要调整"],
  "config_validation": {
    "syntax_valid": true,
    "plugin_count": {"inputs": 3, "outputs": 1},
    "warnings": []
  }
}
```

#### 3. 数据点管理页面（增强功能）
**页面功能**：管理监控数据点信息，支持批量操作和搜索，显示配置文件关联状态
**核心功能**：
- **配置文件关联追踪**：显示每个数据点是否已写入配置文件，标记遗漏项
- **状态可视化**：已配置/未配置/冲突状态的颜色标识
- **快速修复**：一键将遗漏的数据点添加到指定配置文件
- **配置文件覆盖检查**：检测数据点在多个配置文件中的重复定义

**对应API**：
- `GET /api/data_points` - 获取数据点列表（包含配置文件关联状态）
- `POST /api/data_points` - 手动创建数据点
- `PUT /api/data_points/<id>` - 更新数据点信息
- `DELETE /api/data_points/<id>` - 删除数据点
- `POST /api/data_points/batch` - 批量操作（启用/禁用/删除）
- `POST /api/data_points/sync` - 从配置文件同步数据点
- `GET /api/data_points/statistics` - 获取数据点统计信息
- `GET /api/data_points/config_status` - 获取数据点配置文件关联状态
- `POST /api/data_points/fix_missing` - 修复遗漏的数据点配置

#### 4. 进程管理页面（增强功能）
**页面功能**：管理 Telegraf 进程的启动、停止和监控，特别标注 systemd 管理的进程
**核心功能**：
- **进程分类显示**：明确区分本系统管理进程和 systemd 系统进程
- **systemd 进程标注**：特殊标识 systemd 管理的进程，禁止误操作
- **状态实时监控**：显示进程运行状态、CPU、内存使用情况
- **日志集成查看**：直接查看进程启动和运行日志
- **冲突检测警告**：检测并警告 systemd 服务与本系统的冲突

**对应API**：
- `GET /api/processes` - 获取进程列表和状态（包含 systemd 标注）
- `POST /api/processes/start` - 启动 Telegraf 进程
- `POST /api/processes/<id>/stop` - 停止指定进程
- `POST /api/processes/<id>/restart` - 重启指定进程
- `GET /api/processes/<id>/logs` - 获取进程日志
- `GET /api/processes/systemd/status` - 获取 systemd 服务状态
- `GET /api/processes/conflicts` - 检测系统冲突

**进程状态响应格式**：
```json
{
  "success": true,
  "data": [
    {
      "id": "managed_001",
      "config_file": "/etc/telegraf/telegraf11.conf",
      "pid": 12345,
      "status": "running",
      "cpu_percent": 2.5,
      "memory_mb": 45.2,
      "start_time": "2025-07-24T08:00:00Z",
      "managed_by": "application",  // "application" 或 "systemd"
      "systemd_service": null,
      "can_control": true
    },
    {
      "id": "systemd_001",
      "config_file": "/etc/telegraf/telegraf.conf",
      "pid": 1234,
      "status": "running", 
      "cpu_percent": 1.8,
      "memory_mb": 38.5,
      "start_time": "2025-07-24T07:00:00Z",
      "managed_by": "systemd",
      "systemd_service": "telegraf.service",
      "can_control": false,  // 不允许通过本系统控制
      "warning": "此进程由 systemd 管理，请使用系统命令控制"
    }
  ]
}
```

#### 6. 系统设置页面（新增）
**页面功能**：系统全局配置和管理设置
**核心功能**：
- **配置文件目录管理**：设置和管理Telegraf配置文件存储目录
- **系统参数配置**：全局系统参数设置（刷新间隔、日志级别等）
- **用户权限管理**：用户账户和权限配置
- **系统维护**：数据库备份、日志清理、系统重启等维护操作
- **集成配置**：外部系统集成配置（通知渠道、监控系统等）

**对应API**：
- `GET /api/system/settings` - 获取系统设置
- `PUT /api/system/settings` - 更新系统设置
- `GET /api/system/directories` - 获取配置文件目录列表
- `POST /api/system/directories` - 添加配置文件目录
- `PUT /api/system/directories/<id>` - 更新目录配置
- `DELETE /api/system/directories/<id>` - 删除目录配置
- `POST /api/system/directories/<id>/scan` - 扫描目录中的配置文件
- `POST /api/system/maintenance/cleanup` - 系统清理操作

**配置目录管理响应格式**：
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "默认配置目录",
      "path": "/etc/telegraf/",
      "description": "系统默认Telegraf配置目录",
      "is_default": true,
      "auto_scan": true,
      "scan_interval": 300,
      "file_count": 5,
      "last_scan": "2025-07-24T10:00:00Z",
      "permissions": "read_write",
      "created_at": "2025-07-23T10:00:00Z"
    },
    {
      "id": 2,
      "name": "应用配置目录",
      "path": "/opt/app/telegraf/",
      "description": "应用专用配置目录",
      "is_default": false,
      "auto_scan": false,
      "file_count": 3,
      "permissions": "read_only"
    }
  ]
}
```

#### 7. 模板管理页面（新增）
**页面功能**：管理不同类型的配置模板
**核心功能**：
- **模板分类管理**：分别管理全局配置、输入插件、输入节点组和输出插件四类模板
- **模板编辑器**：支持在Web界面中编辑模板内容，带语法高亮
- **变量定义**：支持在模板中定义变量及其默认值
- **模板预览**：实时预览变量替换后的模板效果
- **模板版本控制**：记录模板修改历史，支持回滚
- **模板导出导入**：支持模板的导出和导入功能

**对应API**：
- `GET /api/templates` - 获取所有模板列表
- `GET /api/templates/<type>` - 获取指定类型的模板列表
- `GET /api/templates/<id>` - 获取指定模板详情
- `POST /api/templates` - 创建新模板
- `PUT /api/templates/<id>` - 更新模板
- `DELETE /api/templates/<id>` - 删除模板
- `GET /api/templates/<id>/versions` - 获取模板版本历史
- `POST /api/templates/<id>/preview` - 预览变量替换后的模板
- `POST /api/templates/export` - 导出模板
- `POST /api/templates/import` - 导入模板

**模板响应格式**：
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "标准OPC UA输入模板",
    "type": "input",
    "content": "[[inputs.opcua]]\n  name = \"${name:opcua}\"\n  endpoint = \"${endpoint:opc.tcp://localhost:4840}\"\n  connect_timeout = \"${connect_timeout:10s}\"",
    "description": "标准OPC UA输入插件配置模板",
    "variables": [
      {
        "name": "name",
        "default_value": "opcua",
        "description": "插件名称"
      },
      {
        "name": "endpoint",
        "default_value": "opc.tcp://localhost:4840",
        "description": "OPC UA服务器端点"
      },
      {
        "name": "connect_timeout",
        "default_value": "10s",
        "description": "连接超时时间"
      }
    ],
    "created_at": "2025-07-24T10:00:00Z",
    "updated_at": "2025-07-24T10:00:00Z"
  }
}
```

#### 8. 数据导入页面
**页面功能**：数据点信息的批量导入功能
**核心功能**：
- **Excel导入**：支持.xlsx和.xls格式的数据点信息导入
- **CSV导入**：支持CSV格式的批量数据导入
- **模板下载**：提供标准导入模板下载
- **数据预览**：导入前预览和验证数据格式
- **字段映射**：自定义Excel/CSV列与数据库字段的映射关系
- **导入历史**：查看历史导入记录和结果统计

**对应API**：
- `GET /api/import/templates` - 获取导入模板列表
- `GET /api/import/templates/<type>/download` - 下载导入模板文件
- `POST /api/import/preview` - 预览导入数据
- `POST /api/import/execute` - 执行数据导入
- `GET /api/import/history` - 获取导入历史记录
- `GET /api/import/history/<id>` - 获取导入记录详情
- `POST /api/import/validate` - 验证导入数据格式

**导入预览响应格式**：
```json
{
  "success": true,
  "data": {
    "file_info": {
      "filename": "data_points.xlsx",
      "size": 12486,
      "sheet_count": 1,
      "row_count": 150,
      "upload_time": "2025-07-24T10:00:00Z"
    },
    "field_mapping": {
      "A": "original_name",
      "B": "standardized_name", 
      "C": "description",
      "D": "data_type",
      "E": "unit"
    },
    "preview_data": [
      {
        "row": 2,
        "data": {
          "original_name": "cpu.usage_idle",
          "standardized_name": "cpu_usage_idle",
          "description": "CPU空闲率",
          "data_type": "float",
          "unit": "percent"
        },
        "validation_status": "valid"
      },
      {
        "row": 3,
        "data": {
          "original_name": "mem.available",
          "standardized_name": "memory_available",
          "description": "可用内存",
          "data_type": "integer",
          "unit": "bytes"
        },
        "validation_status": "warning",
        "validation_message": "单位建议使用MB"
      }
    ],
    "statistics": {
      "total_rows": 150,
      "valid_rows": 145,
      "warning_rows": 4,
      "error_rows": 1
    }
  }
}
```

#### 8. 系统状态页面（原第5页面）
**页面功能**：显示系统状态、systemd服务状态和数据库状态
**对应API**：
- `GET /api/system/status` - 获取系统整体状态
- `GET /api/system/systemd` - 获取systemd服务状态
- `GET /api/system/database` - 获取数据库状态
- `POST /api/system/database/backup` - 创建数据库备份

### 页面间跳转关系和数据关联设计

#### 核心导航流程

##### 1. 主要页面导航关系
```
仪表盘(Dashboard) 
├── 数据源管理 → 配置文件管理 → 进程管理
├── 数据点管理 → 配置文件管理 → 进程管理  
├── 配置文件管理 → 进程管理 → 日志查看
├── 进程管理 → 配置文件管理 → 数据点管理
├── 系统设置 → 数据导入 → 数据点管理
├── 数据导入 → 数据点管理 → 配置文件管理
├── 模板管理 → 数据源管理 → 配置文件管理
└── 模板管理 → 配置文件管理 → 进程管理
```

##### 2. 详细页面跳转逻辑

###### A. 数据源管理 → 其他页面
- **点击"生成配置"** → 跳转到配置文件管理页面，自动创建新配置文件
- **查看关联数据点** → 跳转到数据点管理页面，筛选该数据源的数据点
- **查看运行状态** → 跳转到进程管理页面，显示使用该数据源的进程
- **选择模板** → 跳转到模板管理页面，选择适用的模板

###### B. 数据点管理 → 其他页面
- **点击"配置文件"列** → 跳转到配置文件管理页面，打开对应配置文件
- **点击"添加到配置"** → 弹出配置文件选择框，或跳转到配置文件管理
- **查看进程状态** → 跳转到进程管理页面，显示使用该数据点的进程
- **批量导入** → 跳转到数据导入页面

###### C. 配置文件管理 → 其他页面
- **点击"查看数据点"** → 跳转到数据点管理页面，显示该配置文件的数据点
- **点击"启动进程"** → 跳转到进程管理页面，启动该配置文件对应的进程
- **查看运行日志** → 在当前页面展开日志面板，或跳转到专门的日志页面
- **编辑数据源** → 跳转到数据源管理页面，编辑相关数据源

###### D. 进程管理 → 其他页面
- **点击"配置文件"列** → 跳转到配置文件管理页面，打开对应配置文件
- **查看数据点** → 跳转到数据点管理页面，显示进程相关的数据点
- **编辑数据源** → 跳转到数据源管理页面
- **查看详细日志** → 跳转到专门的日志查看页面

###### E. 模板管理 → 其他页面
- **应用模板到数据源** → 跳转到数据源管理页面，使用选定模板创建数据源
- **应用模板到配置文件** → 跳转到配置文件管理页面，使用选定模板生成配置
- **查看使用此模板的配置** → 跳转到配置文件管理页面，筛选使用该模板的配置文件
- **查看模板变量使用情况** → 显示模板变量在不同配置中的使用统计

##### 3. 数据关联关系图

```
模板 (Template)
├── 1:N → 数据源 (DataSource)
├── 1:N → 配置文件 (Config)
└── 包含变量定义 (Variables)

数据源 (DataSource)
├── N:1 → 模板 (Template)
├── 1:N → 数据点 (DataPoint)
├── 1:N → 配置文件 (Config) 
└── 1:N → 进程 (Process)

数据点 (DataPoint)
├── N:1 → 数据源 (DataSource)
├── N:M → 配置文件 (Config)
└── 通过配置文件 → 进程 (Process)

配置文件 (Config)
├── N:1 → 模板 (Template)
├── N:1 → 数据源 (DataSource)
├── N:M → 数据点 (DataPoint)
└── 1:1 → 进程 (Process)

进程 (Process)
├── 1:1 → 配置文件 (Config)
├── 通过配置文件 → 数据源 (DataSource)
└── 通过配置文件 → 数据点 (DataPoint)
```

#### 页面状态管理和上下文传递

##### 1. URL参数设计
```javascript
// 数据源管理
/data-sources
/data-sources/:id/edit
/data-sources/create?template_id=5  // 基于模板创建数据源

// 数据点管理
/data-points
/data-points?config_id=123        // 显示特定配置文件的数据点
/data-points?source_id=456        // 显示特定数据源的数据点
/data-points?status=missing       // 显示未配置的数据点

// 配置文件管理
/configs
/configs/:id/edit
/configs/:id/versions            // 版本历史
/configs/create?source_ids=1,2,3  // 基于数据源创建
/configs/create?template_id=5     // 基于模板创建配置文件

// 进程管理
/processes
/processes?config_id=123         // 显示特定配置文件的进程
/processes/:id/logs              // 进程日志详情

// 模板管理
/templates                       // 所有模板列表
/templates?type=input            // 按类型筛选模板
/templates/:id/edit              // 编辑模板
/templates/:id/versions          // 模板版本历史
/templates/create                // 创建新模板

// 数据导入
/import
/import/history
/import/:id/result               // 导入结果详情
```

##### 2. 页面间状态传递示例

###### A. 从数据点管理跳转到配置文件管理
```javascript
// 用户在数据点管理页面点击"配置文件"列
const jumpToConfig = (dataPoint) => {
  // 携带上下文信息跳转
  router.push({
    path: '/configs',
    query: {
      id: dataPoint.config_id,
      highlight_point: dataPoint.id,  // 高亮显示相关数据点
      tab: 'editor'                   // 直接打开编辑器标签
    }
  });
};
```

###### B. 从配置文件管理跳转到进程管理
```javascript
// 用户在配置文件管理页面点击"启动进程"
const startProcess = (config) => {
  // 先启动进程，然后跳转
  processAPI.start(config.id).then(() => {
    router.push({
      path: '/processes',
      query: {
        config_id: config.id,
        auto_refresh: true,           // 自动刷新状态
        highlight: true               // 高亮新启动的进程
      }
    });
  });
};
```

###### C. 从模板管理跳转到数据源管理
```javascript
// 用户在模板管理页面点击"应用模板到数据源"
const applyTemplateToDataSource = (template) => {
  router.push({
    path: '/data-sources/create',
    query: {
      template_id: template.id,
      template_type: template.type,   // 模板类型(agent/input/output)
      prefill: true                   // 自动填充模板默认值
    }
  });
};
```

##### 3. 面包屑导航设计
```javascript
// 动态面包屑，显示用户的导航路径
const breadcrumbItems = [
  { text: '首页', path: '/' },
  { text: '数据点管理', path: '/data-points' },
  { text: 'CPU监控配置', path: '/configs/123', params: { from: 'data-points' } },
  { text: '进程详情', path: '/processes/456', current: true }
];
```

#### 具体交互场景设计

##### 场景1：新用户配置流程
1. **数据源管理** → 选择插件类型 → 配置数据源
2. **自动跳转到配置文件管理** → 根据数据源生成配置文件
3. **自动跳转到数据点管理** → 显示从配置文件解析的数据点
4. **手动跳转到进程管理** → 启动配置文件对应的进程

##### 场景1-B：基于模板的配置流程
1. **模板管理** → 选择适合的模板类型 → 查看模板详情
2. **点击"应用模板到数据源"** → 跳转到数据源管理 → 使用模板预填充表单
3. **配置数据源特定参数** → 生成配置文件 → 自动跳转到配置文件管理
4. **检查配置文件** → 跳转到进程管理 → 启动进程

##### 场景2：问题排查流程
1. **进程管理** → 发现进程异常 → 点击查看日志
2. **日志显示配置文件错误** → 点击跳转到配置文件管理
3. **配置文件管理** → 修复配置 → 点击查看相关数据点
4. **数据点管理** → 验证数据点配置正确性 → 返回进程管理重启

##### 场景3：数据点批量管理流程
1. **数据导入页面** → 上传Excel文件 → 预览和验证数据
2. **执行导入** → 自动跳转到数据点管理 → 显示新导入的数据点
3. **批量选择数据点** → 点击"添加到配置文件" → 跳转到配置文件管理
4. **生成或更新配置文件** → 跳转到进程管理启动进程

##### 场景4：模板批量应用流程
1. **模板管理** → 选择模板 → 点击"批量应用"
2. **选择应用目标** → 可选择多个数据源或配置文件
3. **预览变更** → 查看模板应用后的配置差异
4. **确认应用** → 批量更新配置文件 → 跳转到进程管理
5. **批量重启进程** → 应用新配置

#### 页面状态保持和恢复

##### 1. 用户操作上下文保存
```javascript
// 在跳转前保存当前页面状态
const savePageContext = () => {
  const context = {
    page: 'data-points',
    filters: { type: 'input', status: 'configured' },
    selectedItems: [1, 2, 3],
    scrollPosition: window.scrollY,
    timestamp: Date.now()
  };
  sessionStorage.setItem('pageContext', JSON.stringify(context));
};

// 返回时恢复页面状态
const restorePageContext = () => {
  const context = JSON.parse(sessionStorage.getItem('pageContext'));
  if (context && Date.now() - context.timestamp < 300000) { // 5分钟内有效
    // 恢复筛选条件、选中项、滚动位置等
    applyFilters(context.filters);
    selectItems(context.selectedItems);
  }
};
```

##### 2. 模板管理页面状态保持
```javascript
// 保存模板编辑状态
const saveTemplateEditState = (template) => {
  const editState = {
    template_id: template.id,
    template_type: template.type,
    editor_content: monacoEditor.getValue(),
    cursor_position: monacoEditor.getPosition(),
    variables: extractVariablesFromTemplate(monacoEditor.getValue()),
    unsaved_changes: true,
    timestamp: Date.now()
  };
  localStorage.setItem('template_edit_state', JSON.stringify(editState));
};

// 恢复模板编辑状态
const restoreTemplateEditState = () => {
  const editState = JSON.parse(localStorage.getItem('template_edit_state'));
  if (editState && Date.now() - editState.timestamp < 86400000) { // 24小时内有效
    // 恢复编辑器内容、光标位置、变量列表等
    monacoEditor.setValue(editState.editor_content);
    monacoEditor.setPosition(editState.cursor_position);
    populateVariablesList(editState.variables);
    
    // 提示用户有未保存的更改
    if (editState.unsaved_changes) {
      showUnsavedChangesWarning();
    }
  }
};
    window.scrollTo(0, context.scrollPosition);
  }
};
```

##### 2. 跨页面数据缓存
```javascript
// 使用Pinia/Vuex管理跨页面数据
const useDataStore = defineStore('data', {
  state: () => ({
    recentlyViewedConfigs: [],
    selectedDataPoints: [],
    currentProcess: null,
    navigationHistory: []
  }),
  
  actions: {
    addToHistory(pageInfo) {
      this.navigationHistory.unshift(pageInfo);
      if (this.navigationHistory.length > 10) {
        this.navigationHistory = this.navigationHistory.slice(0, 10);
      }
    },
    
    getLastVisitedPage(pageType) {
      return this.navigationHistory.find(item => item.type === pageType);
    }
  }
});
```

### 统一API响应格式

#### 成功响应格式
```json
{
  "success": true,
  "data": {...},  // 或 [...]
  "message": "操作成功",
  "timestamp": "2025-07-24T10:00:00Z"
}
```

#### 分页响应格式
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "total": 100,
    "page": 1,
    "per_page": 20,
    "total_pages": 5
  },
  "message": "获取成功"
}
```

#### 错误响应格式
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "参数验证失败",
    "details": {...}
  },
  "timestamp": "2025-07-24T10:00:00Z"
}
```

#### 标准错误代码
```
// 通用错误
INVALID_REQUEST      - 请求格式或参数无效
UNAUTHORIZED         - 未授权访问
FORBIDDEN            - 权限不足
NOT_FOUND            - 资源不存在
CONFLICT             - 资源冲突
INTERNAL_ERROR       - 服务器内部错误

// 数据源相关错误
DS_TYPE_NOT_SUPPORTED - 不支持的数据源类型
DS_CONFIG_INVALID    - 数据源配置无效
DS_CONNECTION_ERROR  - 数据源连接失败

// 配置文件相关错误
CONFIG_SYNTAX_ERROR  - 配置文件语法错误
CONFIG_VALIDATION_ERROR - 配置验证失败
CONFIG_EXTERNAL_CHANGED - 配置文件被外部修改
CONFIG_VERSION_NOT_FOUND - 配置版本不存在

// 进程相关错误
PROCESS_START_FAILED - 进程启动失败
PROCESS_STOP_FAILED  - 进程停止失败
PROCESS_NOT_RUNNING  - 进程未运行
SYSTEMD_CONFLICT     - 与SystemD服务冲突

// 数据点相关错误
POINT_VALIDATION_ERROR - 数据点验证失败
POINT_DUPLICATE      - 数据点重复
POINT_SYNC_FAILED    - 数据点同步失败

// 数据库相关错误
DB_BACKUP_FAILED     - 数据库备份失败
DB_RESTORE_FAILED    - 数据库恢复失败
DB_INTEGRITY_ERROR   - 数据库完整性错误
```
```

### 网页界面设计详细说明

#### 整体界面布局
- **响应式设计**：支持桌面端和移动端适配
- **深色/浅色主题**：支持主题切换功能
- **侧边导航栏**：固定侧边栏，包含主要功能模块
- **面包屑导航**：显示当前页面层级位置
- **全局搜索**：顶部搜索框，支持跨模块搜索

#### 1. 数据源管理界面
**布局特点**：
- **卡片式布局**：每个数据源显示为独立卡片
- **分类标签**：输入源（蓝色）、输出源（绿色）区分
- **快速操作按钮**：启用/禁用、编辑、删除、复制配置
- **模板选择器**：下拉选择插件类型，自动加载官方模板
- **配置预览**：实时预览生成的配置文件内容

**交互功能**：
- **拖拽排序**：支持数据源的拖拽重新排序
- **批量选择**：多选checkbox，全选、反选按钮，支持批量操作
- **筛选功能**：按类型、状态、插件类型筛选
- **模板库**：弹窗展示官方模板库，支持搜索和预览

#### 2. 配置文件管理界面
**布局特点**：
- **双栏布局**：左侧文件列表，右侧编辑器
- **编辑器**：集成配置文件编辑器，支持语法高亮、简单错误识别
- **状态指示器**：运行状态（绿色圆点）、错误状态（红色感叹号）
- **版本历史侧栏**：可折叠的版本历史面板
- **日志查看器**：底部可展开的日志面板

**交互功能**：
- **实时验证**：编辑时实时语法检查和错误提示
- **快捷键支持**：Ctrl+S保存、Ctrl+Z撤销等
- **版本对比**：支持任意两个版本的差异对比
- **一键生成**：根据选择的数据源自动生成配置文件
- **启动测试**：配置保存后可直接测试启动
- **STAND OUT配置识别**：检测并提醒配置文件中的STAND OUT配置项，会导致数据写入系统默认/var/log/MESSAGE文件，导致系统盘爆满。

#### 3. 数据点管理界面
**布局特点**：
- **表格布局**：虚拟滚动表格，支持大数据量
- **状态色彩编码**：已配置（绿色）、未配置（灰色）、重复配置（红色）
- **配置文件关联列**：显示关联的配置文件名称
- **批量操作工具栏**：选中行数显示，批量操作按钮
- **高级筛选面板**：可折叠的多条件筛选器

**交互功能**：
- **多选模式**：支持单选、多选、全选、反选操作
- **快速搜索**：实时搜索过滤，可根据状态、数据点名称、插件类型、配置文件、运行状态进行搜索，支持正则表达式
- **列排序**：点击列头排序，支持多列排序
- **行内编辑**：双击单元格直接编辑
- **右键菜单**：提供快捷操作菜单

#### 4. 进程管理界面
**布局特点**：
- **卡片+表格混合**：重要进程用卡片，详细信息用表格
- **实时监控面板**：CPU、内存使用率实时图表
- **systemd进程标识**：特殊徽章标识系统管理进程
- **操作按钮组**：启动、停止、重启按钮，systemd进程禁用
- **日志流显示**：实时滚动显示进程日志

**交互功能**：
- **实时刷新**：自动刷新进程状态（可配置间隔）
- **WebSocket连接**：实时推送状态变更通知
- **日志搜索**：支持日志内容搜索和过滤
- **警告弹窗**：操作systemd进程时的确认提示
- **批量控制**：选择多个进程进行批量操作

#### 5. 系统状态界面
**布局特点**：
- **仪表盘风格**：使用图表和指标卡片
- **分区显示**：系统状态、数据库状态、服务状态分区
- **告警中心**：集中显示系统警告和错误
- **历史趋势**：系统指标的历史趋势图表
- **快速操作面板**：常用维护操作的快捷入口

**交互功能**：
- **自动刷新**：定时刷新系统状态数据
- **告警通知**：浏览器通知API，重要事件提醒
- **一键修复**：常见问题的一键修复功能
- **数据导出**：系统状态报告导出功能

#### 通用UI组件设计

##### 1. 状态指示器
```css
.status-indicator {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 8px;
}
.status-running { background-color: #52c41a; }
.status-stopped { background-color: #d9d9d9; }
.status-error { background-color: #ff4d4f; }
.status-warning { background-color: #faad14; }
```

##### 2. 进程管理类型标识
```css
.process-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}
.badge-application { 
  background: #e6f7ff; 
  color: #1890ff; 
  border: 1px solid #91d5ff;
}
.badge-systemd { 
  background: #fff1f0; 
  color: #cf1322; 
  border: 1px solid #ffa39e;
}
```

##### 3. 配置文件关联状态
```css
.config-status {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
}
.status-configured { 
  background: #f6ffed; 
  color: #52c41a; 
  border: 1px solid #b7eb8f;
}
.status-missing { 
  background: #fafafa; 
  color: #8c8c8c; 
  border: 1px solid #d9d9d9;
}
.status-conflict { 
  background: #fff2f0; 
  color: #ff4d4f; 
  border: 1px solid #ffccc7;
}
```

#### 响应式断点设计
```css
/* 移动端 */
@media (max-width: 768px) {
  .sidebar { transform: translateX(-100%); }
  .main-content { margin-left: 0; }
  .table-responsive { overflow-x: auto; }
}

/* 平板端 */
@media (min-width: 768px) and (max-width: 1024px) {
  .sidebar { width: 200px; }
  .card-grid { grid-template-columns: repeat(2, 1fr); }
}

/* 桌面端 */
@media (min-width: 1024px) {
  .sidebar { width: 250px; }
  .card-grid { grid-template-columns: repeat(3, 1fr); }
}
```

### 其他必要功能扩展

#### 1. 数据备份与恢复系统
**功能描述**：全面的数据保护机制
- **自动备份**：定时备份数据库、配置文件、日志文件
- **增量备份**：支持增量备份策略，节省存储空间
- **一键恢复**：快速恢复到任意时间点的系统状态
- **备份验证**：定期验证备份文件完整性
- **云端同步**：支持备份文件上传到云存储

#### 2. 安全与权限管理
**功能描述**：企业级安全控制
- **角色权限系统**：管理员、操作员、只读用户等角色
- **操作审计日志**：记录所有用户操作和系统变更
- **API密钥管理**：支持API访问的密钥生成和管理
- **会话超时控制**：可配置的会话超时和强制登出
- **IP白名单**：限制系统访问的IP地址范围

#### 3. 监控告警系统
**功能描述**：主动监控和告警通知
- **健康检查**：定期检查系统各组件健康状态
- **阈值监控**：CPU、内存、磁盘空间等资源监控
- **进程监控**：Telegraf进程异常退出自动告警
- **多渠道通知**：邮件、短信、企业微信、钉钉通知
- **告警抑制**：避免告警风暴的智能抑制机制

#### 4. 性能优化与缓存
**功能描述**：系统性能优化方案
- **Redis缓存集成**：缓存频繁查询的数据
- **API响应缓存**：缓存API响应，提高响应速度
- **数据库连接池**：优化数据库连接管理
- **异步任务队列**：大批量操作使用异步处理
- **CDN集成**：静态资源CDN加速

#### 5. 系统集成接口
**功能描述**：与其他系统的集成能力
- **Webhook支持**：系统事件触发外部webhook
- **消息队列集成**：支持RabbitMQ、Kafka消息队列
- **LDAP/AD集成**：企业用户身份认证集成
- **监控系统集成**：与Prometheus、Grafana集成
- **CI/CD集成**：支持配置文件的版本控制和自动部署

#### 6. 数据分析与报表
**功能描述**：系统使用情况分析
- **使用统计**：数据源、配置文件使用频率统计
- **性能分析**：系统性能指标趋势分析
- **错误分析**：错误日志的自动分类和分析
- **定期报表**：自动生成日/周/月系统报表
- **数据可视化**：丰富的图表展示系统状态

#### 7. 移动端支持
**功能描述**：移动设备适配和APP
- **PWA支持**：渐进式Web应用，支持离线访问
- **移动端优化**：针对移动设备的界面优化
- **推送通知**：移动端推送通知支持
- **快捷操作**：移动端常用功能快捷入口
- **Touch友好**：触摸屏操作优化

#### 8. 国际化与本地化
**功能描述**：多语言和地区适配
- **多语言支持**：中文、英文界面切换
- **时区处理**：自动处理不同时区的时间显示
- **数字格式化**：根据地区格式化数字和日期
- **文档本地化**：帮助文档的多语言版本
- **配置模板本地化**：基于地区的配置模板优化

#### 9. 插件扩展系统
**功能描述**：可扩展的插件架构
- **插件市场**：第三方插件的发现和安装
- **自定义插件**：支持用户开发自定义功能插件
- **插件管理**：插件的启用、禁用、更新管理
- **API扩展**：插件可以扩展系统API功能
- **主题插件**：支持自定义界面主题

#### 10. 容器化与微服务
**功能描述**：现代化部署架构
- **Docker支持**：提供Docker镜像和compose文件
- **Kubernetes部署**：K8s部署配置和Helm charts
- **微服务拆分**：核心功能模块化，支持独立部署
- **服务发现**：微服务间的自动发现和负载均衡
- **配置中心**：集中化的配置管理

### 技术栈建议

#### 后端技术栈升级
- **Python 3.11+**：使用最新Python版本
- **FastAPI替代Flask**：更好的性能和自动API文档
- **SQLAlchemy 2.0**：使用最新ORM版本
- **Redis**：缓存和会话存储
- **Celery**：异步任务处理
- **pytest**：完善的单元测试覆盖

#### 前端技术栈建议
- **Vue 3 + TypeScript**：现代化前端框架
- **Vite**：快速的构建工具
- **Pinia**：状态管理
- **Element Plus**：UI组件库
- **Monaco Editor**：代码编辑器
- **ECharts**：数据可视化

#### 部署和运维
- **Nginx**：反向代理和静态文件服务
- **Supervisor/Systemd**：进程管理
- **Docker**：容器化部署
- **Prometheus + Grafana**：监控和告警
- **ELK Stack**：日志收集和分析

### 数据模型扩展

#### 新增数据表设计

##### 1. 系统配置表 (system_config)
```sql
CREATE TABLE system_config (
    id INTEGER PRIMARY KEY,
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT,
    description TEXT,
    category VARCHAR(50),
    data_type VARCHAR(20) DEFAULT 'string',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

##### 2. 操作日志表 (audit_log)
```sql
CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(100),
    details TEXT,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

##### 3. 告警规则表 (alert_rules)
```sql
CREATE TABLE alert_rules (
    id INTEGER PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    condition_type VARCHAR(50),
    condition_config TEXT,
    notification_channels TEXT,
    enabled BOOLEAN DEFAULT TRUE,
    severity VARCHAR(20) DEFAULT 'warning',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

##### 4. 插件信息表 (plugins)
```sql
CREATE TABLE plugins (
    id INTEGER PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    version VARCHAR(20),
    description TEXT,
    author VARCHAR(100),
    enabled BOOLEAN DEFAULT FALSE,
    config TEXT,
    install_path VARCHAR(500),
    plugin_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

##### 5. 配置文件版本表 (config_versions)
```sql
CREATE TABLE config_versions (
    id INTEGER PRIMARY KEY,
    config_id INTEGER NOT NULL,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    comment TEXT,
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (config_id) REFERENCES config_files(id),
    UNIQUE(config_id, version)
);
```

### 前端组件与API集成方案
- **列表组件**：调用 `GET /api/data_sources` 获取数据，支持实时刷新
- **表单组件**：调用 `POST/PUT /api/data_sources` 进行CRUD操作
- **类型选择器**：调用 `GET /api/data_sources/types` 获取支持的插件类型

#### 2. 配置文件编辑器
- **Monaco编辑器集成**：实时语法高亮和错误检查
- **版本历史组件**：调用版本API展示历史记录
- **配置生成器**：根据选择的数据源自动生成配置

#### 3. 数据点管理表格
- **虚拟滚动**：处理大量数据点的性能优化
- **多选操作**：支持批量启用/禁用/删除
- **智能搜索**：支持多字段模糊匹配

#### 4. 进程监控面板
- **实时状态更新**：WebSocket或定时轮询更新进程状态
- **日志查看器**：支持日志搜索和过滤
- **操作按钮**：一键启动/停止/重启

### API实现优先级

#### P0级（核心功能，必须实现）
1. `GET /api/data_sources` - 获取数据源列表
2. `POST /api/data_sources` - 创建数据源
3. `PUT /api/data_sources/<id>` - 更新数据源
4. `DELETE /api/data_sources/<id>` - 删除数据源
5. `GET /api/configs` - 获取配置文件列表
6. `GET /api/configs/<id>` - 获取配置文件内容
7. `PUT /api/configs/<id>` - 更新配置文件
8. `POST /api/configs/<id>/generate` - 根据数据源生成配置文件
9. `GET /api/processes` - 获取进程列表
10. `POST /api/processes/start` - 启动进程
11. `POST /api/processes/<id>/stop` - 停止进程
12. `GET /api/point_info` - 获取数据点列表

#### P1级（重要功能，应当实现）
1. `POST /api/point_info/batch_operation` - 数据点批量操作
2. `GET /api/configs/<id>/versions` - 配置文件版本历史
3. `POST /api/configs/<id>/rollback` - 回滚配置文件版本
4. `GET /api/processes/<id>/logs` - 获取进程日志
5. `GET /api/systemd/telegraf/status` - 获取SystemD服务状态
6. `GET /api/database/status` - 获取数据库状态
7. `POST /api/database/backup` - 创建数据库备份
8. `POST /api/database/restore` - 从备份恢复数据库

#### P2级（增强功能，计划实现）
1. `POST /api/point_info/batch_import` - 批量导入数据点
2. `POST /api/point_info/export` - 导出数据点信息
3. `GET /api/system/status` - 系统状态监控
4. `GET /api/system/statistics` - 系统统计分析
5. `POST /api/configs/<id>/validate` - 配置文件验证
6. `GET /api/configs/<id>/check_external_changes` - 检查外部变更

#### P3级（扩展功能，视情况实现）
1. `GET /api/users` - 用户管理
2. `POST /api/alert_rules` - 告警规则管理
3. `GET /api/plugins` - 插件管理
4. `GET /api/audit_logs` - 操作日志查询

## API 端点说明

### 重新设计的核心API

#### 统一数据源管理API
- `GET /api/data_sources` - 获取所有数据源（包括输入插件和输出插件）
- `POST /api/data_sources` - 创建新数据源
- `PUT /api/data_sources/<id>` - 更新数据源
- `DELETE /api/data_sources/<id>` - 删除数据源
- `GET /api/data_sources/types` - 获取支持的数据源类型
- `GET /api/data_sources/templates` - 获取官方数据源模板

#### 配置文件管理API
- `GET /api/configs` - 获取配置文件列表
- `POST /api/configs` - 创建配置文件
- `GET /api/configs/<id>` - 获取配置文件内容
- `PUT /api/configs/<id>` - 更新配置文件
- `DELETE /api/configs/<id>` - 删除配置文件
- `POST /api/configs/<id>/generate` - 根据数据源生成配置
- `GET /api/configs/<id>/status` - 获取配置文件状态（包括语法检查结果）

#### 进程管理API
- `GET /api/processes` - 获取进程列表（自动过滤SystemD管理的进程）
- `POST /api/processes/start` - 启动Telegraf进程
- `POST /api/processes/<id>/stop` - 停止进程
- `POST /api/processes/<id>/restart` - 重启进程
- `GET /api/processes/<id>/status` - 获取进程详细状态

#### 数据点管理API
- `GET /api/point_info` - 获取数据点列表
- `POST /api/point_info` - 创建数据点
- `PUT /api/point_info/<id>` - 更新数据点
- `DELETE /api/point_info/<id>` - 删除数据点

### 数据点管理扩展API

#### 已实现的数据点API
- `GET /api/point_info/search` - 数据点搜索和筛选（支持分页和多条件过滤）
- `GET /api/point_info/statistics` - 数据点统计分析（总数、类型、来源等）
- `POST /api/point_info/batch_operation` - 批量操作（启用/禁用/删除）
- `GET /api/point_info/by_config/<config_id>` - 按配置文件获取关联数据点
- `POST /api/point_info/normalize_names` - 批量标准化数据点名称
- `POST /api/point_info/sync_from_config/<config_id>` - 从配置文件同步数据点

#### 计划实现的数据点API
- `POST /api/point_info/batch_import` - 批量导入数据点（支持Excel/CSV）
- `GET /api/point_info/export` - 导出数据点信息（支持Excel/CSV/JSON格式）
- `GET /api/point_info/validation` - 数据点信息验证和检查
- `GET /api/point_info/duplicates` - 检测重复数据点
- `POST /api/point_info/auto_categorize` - 自动分类数据点

### 配置文件版本控制API
- `GET /api/configs/<id>/versions` - 获取配置文件版本历史
- `GET /api/configs/<id>/versions/<version>` - 获取特定版本的配置文件
- `POST /api/configs/<id>/rollback/<version>` - 回滚配置文件到指定版本
- `GET /api/configs/<id>/diff/<version1>/<version2>` - 比较两个版本的差异
- `POST /api/configs/<id>/check_external_changes` - 检查外部变更

### 系统服务管理API
- `GET /api/system/services/telegraf` - 获取SystemD管理的Telegraf服务状态
- `POST /api/system/services/telegraf/start` - 启动SystemD管理的Telegraf服务
- `POST /api/system/services/telegraf/stop` - 停止SystemD管理的Telegraf服务
- `POST /api/system/services/telegraf/restart` - 重启SystemD管理的Telegraf服务
- `GET /api/system/services` - 获取所有相关系统服务状态

### 数据库管理API
- `GET /api/database/status` - 获取数据库状态和统计信息
- `POST /api/database/backup` - 创建数据库备份
- `POST /api/database/restore/<backup_id>` - 从指定备份恢复数据库
- `POST /api/database/optimize` - 优化数据库（清理、压缩等）
- `GET /api/database/backups` - 获取所有数据库备份列表
- `DELETE /api/database/backups/<backup_id>` - 删除指定备份

### 系统监控API
- `GET /api/system/status` - 获取系统整体状态（CPU、内存、磁盘等）
- `GET /api/system/logs` - 获取系统日志
- `GET /api/system/alerts` - 获取系统告警信息
- `POST /api/system/alerts/acknowledge/<alert_id>` - 确认系统告警



## 最新更新（2025-07-23 至 2025-01-19）

### 前端模块化改进（2025-01-19）

14. **JavaScript 代码重构和模块化**：
   - **解决语法错误**：修复了 config_files.js 中的 JavaScript 语法错误和重复内容问题
   - **模块化拆分**：将原来440KB的巨大JS文件按功能拆分为4个独立模块：
     - `config-utils.js` - 通用工具函数（提示消息、API客户端、表单验证等）
     - `config-main.js` - 配置文件主界面功能（CRUD操作、版本管理、差异对比）
     - `config-directory.js` - 文件目录管理功能（目录设置、文件扫描、批量导入）
     - `config-parser.js` - 配置文件解析功能（插件解析、关联管理、导出功能）
   - **代码质量提升**：消除了重复代码（同一函数重复15次以上的问题），提高了代码可维护性
   - **HTML模板优化**：更新了 config_files.html 模板，添加了缺失的模态框和元素ID
   - **错误修复**：解决了配置文件管理界面中所有按钮点击报错的问题

### 历史更新（2025-07-23）

1. **代码注释完成**：所有核心文件已添加详细中文注释
2. **进程管理增强**：process_manager.py 已完全重构，新增功能：
   - 配置文件存在性检查
   - Telegraf 安装检查
   - 优雅进程停止（SIGTERM + SIGKILL）
   - 进程状态监控和详细信息获取
   - 完整的错误处理和日志记录
   - **SystemD 进程过滤**：自动识别并排除 systemd 管理的进程
3. **数据库模型优化**：增加了时间戳字段和外键关系
4. **API 响应改进**：返回更详细的操作结果和错误信息
5. **数据库文件夹调整**：数据库文件现存放在 `database/` 文件夹中，便于管理和备份
6. **SystemD 服务监控**：新增 systemd telegraf 服务状态检查和冲突警告
7. **配置文件版本控制**：完整的版本管理系统，支持变更检测和版本回滚
8. **外部变更检测**：自动检测配置文件的外部修改并创建新版本
9. **数据点管理系统完善**：
   - 完整重构的数据点模型，支持17个字段的丰富元数据（原始名称、标准化名称、注释、数据类型、单位等）
   - 智能配置解析器，支持从 Telegraf 配置文件自动提取和创建数据点
   - 系统插件智能识别（cpu、mem、disk等），自动创建多个相关指标数据点
   - 数据类型和单位自动推断，点位名称自动标准化
   - 完善的数据来源标识（配置同步、手动录入、Excel导入）
   - 与配置文件版本控制系统的深度集成，支持配置变更时的数据点自动同步
   - 实现了8个完整的扩展 API 接口，支持搜索、统计、批量操作等高级功能
10. **数据点自动同步**：从配置文件自动提取并同步数据点信息到数据库
11. **智能数据库管理系统**：
   - 新增 db_manager.py 数据库管理工具，提供完整的备份、恢复、重新初始化功能
   - 启动时自动检查数据库完整性，自动处理数据库问题
   - 智能备份机制，确保数据安全
   - 提供完整的数据库管理 REST API（5个接口）
   - 友好的启动提示和错误处理
12. **便捷启动脚本系统**：
   - 创建智能启动脚本 start.sh，支持端口指定、浏览器打开、环境检查
   - 支持开发和生产环境切换，使用Gunicorn作为生产WSGI服务器
   - 支持命令行参数和环境变量配置
   - 自动检查虚拟环境和依赖包
13. **增强的 API 接口**：新增多个 API 端点支持版本控制、systemd 管理、数据点管理和数据库管理功能

## 安全考虑

- 系统会自动检测 systemd 管理的 Telegraf 服务，避免与系统服务冲突
- 配置文件变更都会记录完整的版本历史，支持审计追踪
- 外部修改会被自动检测并记录，防止配置丢失
- 所有 API 操作都需要用户认证