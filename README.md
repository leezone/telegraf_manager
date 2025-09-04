# Telegraf 配置管理系统

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.11+-blue.svg)
![Flask](https://img.shields.io/badge/flask-3.1+-green.svg)
![Status](https://img.shields.io/badge/status-active-brightgreen.svg)

一个用于管理 Telegraf 监控配置和进程的完整 Python Flask Web 应用程序。该系统提供了直观的 Web 界面来配置、监控和管理 Telegraf 实例，支持输入源、输出源、数据点信息的统一管理，以及智能的进程监控和版本控制功能。

## 🌟 主要特性

### 📊 配置管理
- **版本控制与追溯**: 自动记录配置文件的每次变更，形成完整的版本历史，支持一键回滚到任意历史版本。
- **在线编辑器与预览**: 提供强大的在线编辑器，支持分段编辑、语法高亮，并能实时预览单次采集的数据快照，确保配置正确性。
- **锁定与解锁**: 可锁定重要配置文件，防止在进程运行时被意外修改，保证生产环境稳定。
- **模板化与模块化**: （规划中）支持将通用配置保存为模板或片段，方便快速复用和组合。

### 🎯 数据点管理
- **向导式提取**: 提供交互式向导，可从复杂配置文件中智能解析并提取数据点（measurement），自动填充关键信息。
- **状态智能检查**: 在导入前自动检查数据点状态（如：新点位、可合并、已存在、内部重复），并提供解决方案。
- **安全导入与回滚**: 支持对数据点进行批量创建和合并，并为每次导入操作提供安全的回滚机制，防止误操作导致数据丢失。
- **历史追溯**: 详细记录每个数据点的变更历史，包括由哪个批次、何时导入或更新。

### 🚀 进程管理
- **统一进程视图**: 集中展示由本系统管理的进程和在操作系统中发现的“非系统管理”进程。
- **实时状态监控**: 实时监控所有Telegraf进程的运行状态（运行中、已停止）、PID、运行时长、CPU及内存使用率。
- **生命周期控制**: 支持对进程进行安全的启动、停止、重启操作，并能在重启前进行配置测试。
- **日志在线查看**: 提供在线工具，可实时查看指定进程的最新日志输出，方便快速排错。

### 🗄️ 数据库管理
- **自动完整性检查**: 启动时自动检查数据库完整性
- **智能备份机制**: 定期自动备份数据库到指定目录
- **一键恢复**: 支持从备份文件快速恢复数据库
- **版本迁移**: 支持数据库结构的版本管理和迁移

### 🛠️ 开发工具
- **智能启动脚本**: 支持开发/生产环境切换
- **环境检查**: 自动检查虚拟环境和依赖包
- **浏览器集成**: 支持启动后自动打开浏览器
- **调试模式**: 完整的开发调试支持

## 🚀 安装指南

本项目提供一个统一的安装脚本 (`install.sh`) 来处理所有安装事宜，从系统环境检查到数据库初始化。

### 系统要求

- **操作系统**: Linux (已在 Ubuntu 20.04+, Debian 10+, CentOS 8+ 测试)
- **必需工具**: `curl`, `tar`, `gzip`, 以及标准编译工具 (`gcc`, `make` 等)。安装脚本会自动检查这些工具。
- **网络访问**: 首次安装或创建离线包时需要网络连接以下载 Python 和相关依赖。

### 安装命令

`install.sh` 脚本为不同场景提供了多个安装选项。

#### 1. 全新完整安装 (推荐)

此命令用于在新服务器上从零开始完整部署应用。它将执行以下操作：
1.  检查系统环境依赖。
2.  安装 `pyenv` 和特定版本的 Python (`3.12.11`)。
3.  在虚拟环境中安装所有必需的 Python 依赖包。
4.  初始化应用数据库（会删除旧数据）。

```bash
# 赋予脚本执行权限
chmod +x install.sh

# 运行完整安装
./install.sh --full-install
```
脚本执行完毕后，您可能需要重启终端 (`exec $SHELL`) 来使 `pyenv` 环境生效。

#### 2. 仅安装/更新依赖

如果您已经手动配置好了 Python 环境，可以使用此命令来创建虚拟环境并安装项目所需的 Python 依赖包。

```bash
./install.sh --install-deps
```

#### 3. 仅初始化数据库

当您需要重置应用数据库时（例如在开发过程中或重大更新后），可使用此命令。
**警告：** 此操作将永久删除所有现存数据。

```bash
./install.sh --init-db
```

#### 4. 创建离线安装包

此命令会将整个应用（不包含数据库和日志）打包成一个单独的 `telegraf_manager_offline.tar.gz` 文件。您可以将此文件传输到一台没有网络的服务器上，然后在那台服务器上执行 `--full-install` 命令进行部署。

```bash
./install.sh --create-package
```

#### 5. 下载离线资源

如果您需要准备或更新用于离线安装的全部资源，可以运行此命令。它会下载 Pyenv、指定的 Python 版本以及 `requirements.txt` 中所有的依赖包。

```bash
./install.sh --download-assets
```

### 启动应用

安装完成后，您可以使用 `start.sh` 脚本来启动应用：

```bash
# 以开发模式启动
./start.sh

# 或以生产模式 (Gunicorn) 启动
./start.sh --prod
```

## 📖 详细文档

我们的文档系统包含以下内容：

### 📋 安装部署指南
- [安装与部署](docs/installation.md) - 详细的安装步骤和部署说明
- [系统配置](docs/configuration.md) - 系统配置和环境变量说明
- [生产环境部署](docs/deployment.md) - 生产环境部署的最佳实践

### 👥 用户使用指南
- [快速入门](docs/quickstart.md) - 新用户快速上手指南
- [用户手册](docs/user-guide.md) - 完整的用户操作手册
- [功能特性](docs/features.md) - 系统功能特性详细介绍
- [最佳实践](docs/best-practices.md) - 使用最佳实践和建议

### 🔌 API 文档
- [REST API 参考](docs/api-reference.md) - 完整的 API 接口文档
- [数据模型](docs/data-models.md) - 数据库模型和数据结构说明
- [认证与权限](docs/authentication.md) - 用户认证和权限管理

### 🛠️ 开发指南
- [开发环境搭建](docs/development.md) - 开发环境配置和搭建
- [代码结构](docs/code-structure.md) - 项目代码结构和架构说明
- [贡献指南](docs/contributing.md) - 如何参与项目开发
- [测试指南](docs/testing.md) - 单元测试和集成测试

### 🔧 故障排除
- [常见问题](docs/troubleshooting.md) - 常见问题及其解决方案
- [调试指南](docs/debugging.md) - 系统调试和问题排查
- [日志分析](docs/logging.md) - 日志分析和错误处理

## 🎯 核心功能模块

### 📊 仪表盘
- 系统总览和状态监控
- 关键指标实时展示
- 快速操作入口
- 告警和通知中心

### 📈 数据源管理
- 输入插件配置（OPC UA、MQTT、HTTP 等）
- 输出插件配置（InfluxDB、HTTP、Kafka 等）
- 模板库和变量替换
- 配置预览和验证

### 📝 配置文件管理
- 配置文件的 CRUD 操作
- 版本控制和历史记录
- 在线编辑和语法检查
- 配置文件生成和导出

### 🎯 数据点管理
- 数据点的统一管理
- 批量导入和导出
- 智能同步和状态追踪
- 搜索和筛选功能

### 🚀 进程管理
- 实时进程监控
- 启动、停止、重启控制
- 日志查看和分析
- 性能监控图表

## 🔧 技术栈

### 后端技术
- **Python 3.11+**: 现代化的 Python 编程语言
- **Flask 3.1**: 轻量级 Web 框架
- **SQLAlchemy 2.0**: 对象关系映射 (ORM) 框架
- **Flask-Login**: 用户会话管理
- **Flask-Migrate**: 数据库迁移工具
- **SQLite**: 轻量级关系数据库
- **DuckDB**: 日志数据存储和分析
- **Alembic**: 数据库迁移工具

### 前端技术
- **Bootstrap 5**: 响应式 CSS 框架
- **jQuery 3**: JavaScript 库
- **DataTables**: 数据表格插件
- **Bootstrap Icons**: 图标库
- **PapaParse**: CSV 解析库

### 系统工具
- **Gunicorn**: 生产级 WSGI 服务器
- **psutil**: 系统和进程监控库
- **toml/tomli**: TOML 配置文件解析
- **pandas**: 数据处理和分析

## 🏗️ 项目结构

```
telegraf_manager/
├── app.py                 # 主应用程序入口
├── models.py              # 数据库模型定义
├── config_manager.py      # 配置文件管理器
├── process_manager.py     # 进程管理器
├── db_manager.py          # 数据库管理器
├── start.sh              # 启动脚本
├── requirements.txt      # Python 依赖包
├── routes/              # API 路由模块
│   ├── main.py          # 主页面路由
│   ├── auth.py          # 认证路由
│   ├── config_files_api.py    # 配置文件 API
│   ├── data_management_api.py # 数据管理 API
│   └── ...
├── static/              # 静态资源
│   ├── css/            # 样式文件
│   ├── js/             # JavaScript 文件
│   └── lib/           # 第三方库
├── templates/          # HTML 模板
│   ├── base.html       # 基础模板
│   ├── dashboard.html  # 仪表盘页面
│   ├── config_files.html # 配置文件页面
│   └── ...
├── database/           # 数据库文件
│   ├── telegraf_manager.db     # 主数据库
│   ├── backups/               # 备份文件
│   └── ...
├── configs/            # 配置文件示例
├── migrations/        # 数据库迁移文件
├── docs/              # 文档目录
└── log/               # 日志文件
```

## 🔄 更新日志

查看 [CHANGELOG.md](CHANGELOG.md) 了解详细的版本更新历史。

## 🤝 贡献指南

我们欢迎所有形式的贡献！请查看 [贡献指南](docs/contributing.md) 了解如何参与项目开发。

### 开发流程
1. Fork 项目
2. 创建功能分支
3. 提交代码变更
4. 推送到分支
5. 创建 Pull Request

## 📄 许可证

本项目采用 MIT 许可证。详情请查看 [LICENSE](LICENSE) 文件。

## 🙏 致谢

感谢以下开源项目和社区的支持：
- [Flask](https://flask.palletsprojects.com/) - 优秀的 Web 框架
- [Bootstrap](https://getbootstrap.com/) - 美观的 UI 框架
- [Telegraf](https://www.influxdata.com/time-series-platform/telegraf/) - 强大的数据收集代理
- [InfluxDB](https://www.influxdata.com/) - 时序数据库

## 声明与支持

本项目由我个人在 AI 辅助下开发完成，主要用于学习和技术探索。

- **无社区或商业支持**: 本项目不提供任何形式的官方社区支持或商业服务。
- **问题与讨论**: 您仍然可以通过 [GitHub Issues](https://github.com/leezone/telegraf_manager/issues) 提交您发现的问题，或在 [GitHub Discussions](https://github.com/leezone/telegraf_manager/discussions) 中发起讨论，我会不定期查看。
- **自由修改**: 本项目采用 MIT 许可，您可以自由 Fork 本项目进行修改和二次开发，以满足您的个人需求。

## 🔗 相关链接

- [Telegraf 官方文档](https://docs.influxdata.com/telegraf/)
- [InfluxData 官方网站](https://www.influxdata.com/)
- [Flask 官方文档](https://flask.palletsprojects.com/)
- [Bootstrap 官方文档](https://getbootstrap.com/docs/)

---

**注意**: 这是一个开源项目，仅供学习和参考使用。在生产环境使用前，请充分测试并确保符合您的安全要求。