# API 参考

本系统提供了一套完整的 RESTful API 用于与前端交互和系统集成。所有 API 都需要用户登录认证。

## 1. 认证 API (`/api/auth`)

- **POST /api/auth/login**: 用户登录。
- **POST /api/auth/logout**: 用户登出。
- **GET /api/auth/profile**: 获取当前用户信息。

## 2. 配置文件 API (`/api/config_files`)

- **GET, POST /api/config_files**: 获取配置文件列表（支持 DataTables 服务端处理）。
- **POST /api/config_files/create**: 创建一个新的配置文件。
- **GET /api/config_files/<id>**: 获取指定 ID 的配置文件详情。
- **PUT /api/config_files/<id>**: 更新一个配置文件（如果内容或名称变更，会创建新版本）。
- **DELETE /api/config_files/<id>**: 删除一个配置文件及其所有历史版本。
- **POST /api/config_files/<id>/snapshot**: 获取配置文件的单次运行数据快照（数据预览）。
- **POST /api/config_files/<id>/toggle_lock**: 切换配置文件的锁定状态。
- **GET /api/config_files/<file_name>/versions**: 获取指定文件名的所有版本历史。
- **POST /api/config_files/<id>/activate**: 激活一个指定的历史版本。

## 3. 进程管理 API (`/api/processes`)

- **GET /api/processes/summary**: 获取用于仪表盘的进程摘要信息。
- **POST /api/processes/managed**: 获取系统管理的进程列表（支持 DataTables）。
- **GET /api/processes/non_managed**: 获取非系统管理的进程列表。
- **POST /api/processes/start**: 根据配置文件 ID 启动一个新进程。
- **POST /api/processes/<proc_id>/stop**: 停止一个系统管理的进程。
- **POST /api/processes/restart**: 重启一个进程。
- **POST /api/processes/<pid>/stop_non_managed**: 停止一个非系统管理的进程。
- **GET /api/processes/history**: 获取已停止的进程历史记录。
- **GET /api/processes/<pid>/logs**: 获取指定进程的日志。

## 4. 数据点管理 API (`/api/point_info`)

- **GET /api/point_info**: 获取数据点列表（支持分页、搜索、排序）。
- **PUT /api/point_info/<id>**: 更新一个数据点信息。
- **DELETE /api/point_info/<id>**: 删除一个数据点。
- **POST /api/point_info/<id>/toggle_lock**: 切换数据点的锁定状态。
- **GET /api/point_info/<id>/history**: 获取单个数据点的历史版本。
- **POST /api/point_info/check_status**: 检查一组数据点名称的状态（用于提取向导）。
- **POST /api/point_info/wizard_import**: 从提取向导导入数据点（创建和合并）。
- **GET /api/point_info/import_history**: 获取导入批次的历史记录。
- **DELETE /api/point_info/import_history/<batch_id>**: 回滚一个导入批次。

## 5. TOML 工具 API (`/api/toml_query`)

- **POST /api/toml_query/structure**: 解析 TOML 文件内容并返回其结构树，用于提取向导的第一步。

## 6. Telegraf 交互 API (`/api/telegraf`)

- **POST /api/telegraf/validate**: 验证 Telegraf 配置文件的有效性。
- **POST /api/telegraf/test_config**: （旧，已整合）测试配置并返回原始输出。

## 7. 系统 API (`/api/system`)

- **GET /api/system/status**: 获取系统状态，包括应用、数据库和依赖信息。
- **GET /api/audit_log**: 获取审计日志列表（支持 DataTables）。
