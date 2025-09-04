# Gemini 修改日志

## 2025-08-01

**目标**: 修复 `processes.js` 中 `logs.map is not a function` 错误。

**修改内容**:

1.  **后端 API (`app.py`)**:
    *   修改了 `/api/telegraf_processes/<pid>/logs` API 端点，使其在成功和失败的情况下都返回一个包含 `logs` 数组的 JSON 对象。
        *   成功时返回 `{"logs": [...]}`。
        *   失败时返回 `{"logs": [], "error": "..."}`。

2.  **前端 JavaScript (`static/js/processes.js`)**:
    *   修改了 `fetchAndRenderLogs` 函数，使其正确地从 API 响应中获取 `logs` 数组。
        *   现在它会检查 `data.error` 字段来处理错误。
        *   通过 `data.logs` 访问日志数组。

**排查步骤**:

1.  **问题**: 前端报错 `logs.map is not a function`，表明后端返回的数据不是数组。
2.  **分析**: 检查 `app.py` 中 `get_process_logs` 路由的实现，发现其在异常情况下使用了 `error_response` 函数，该函数返回的是一个 JSON 对象，而不是一个数组。同时，前端 `fetchAndRenderLogs` 函数直接将整个响应对象作为 `logs` 参数处理，导致 `logs.map` 报错。
3.  **解决方案**: 
    *   修改 `get_process_logs` 函数，使其在任何情况下都返回一个包含 `logs` 键的 JSON 对象，以符合前端的预期。
    *   修改 `fetchAndRenderLogs` 函数，使其从响应数据中正确地提取 `logs` 数组，并处理 `error` 字段。

---

## 2025-08-01

**目标**: 修复 `name 'logger' is not defined` 错误。

**修改内容**:

1.  **后端 API (`app.py`)**:
    *   在 `app.py` 中导入 `logging` 模块后，添加 `logger = logging.getLogger(__name__)` 来初始化 `logger` 对象，解决 `name 'logger' is not defined` 错误。

**排查步骤**:

1.  **问题**: 后端报错 `name 'logger' is not defined`。
2.  **分析**: `app.py` 中使用了 `logger.error` 但没有初始化 `logger` 对象。
3.  **解决方案**: 在 `app.py` 中导入 `logging` 模块后，添加 `logger = logging.getLogger(__name__)`。

---

## 2025-08-01

**目标**: 修复 `No module named 'numpy'` 错误。

**修改内容**:

1.  **环境配置**:
    *   在项目的虚拟环境中安装 `numpy` 库。

**排查步骤**:

1.  **问题**: 后端报错 `No module named 'numpy'`。
2.  **分析**: `duckdb` 的 `fetchdf()` 方法依赖 `numpy`，但环境中未安装。
3.  **解决方案**: 使用 `pip` 在虚拟环境中安装 `numpy`。

---

## 2025-08-01

**目标**: 修复进程管理页面中启动时间与运行时长无法显示的问题。

**修改内容**:

1.  **后端 (`process_manager.py`)**:
    *   在 `list_processes` 函数中，将 `psutil` 获取到的进程信息字典中的 `create_time` 键名修改为 `start_time`，以与前端 `processes.js` 中期望的字段名保持一致。
    *   同时修改了 `get_process_status` 函数中 `process_info` 字典的 `create_time` 键名为 `start_time`，确保所有进程信息返回的字段名统一。

**排查步骤**:

1.  **问题**: 进程管理页面中“启动时间”和“运行时长”显示为“N/A”或不正确。
2.  **分析**: 
    *   前端 `static/js/processes.js` 中的 `renderProcessesTable` 函数期望从后端获取的进程数据中包含 `start_time` 字段。
    *   后端 `app.py` 通过调用 `process_manager.py` 中的 `list_processes` 函数来获取进程信息。
    *   检查 `process_manager.py` 发现，`list_processes` 函数从 `psutil` 获取到的进程创建时间字段名为 `create_time`，并将其直接放入返回的 `process_info` 字典中，导致前端无法正确识别。
3.  **解决方案**: 将 `process_manager.py` 中 `list_processes` 和 `get_process_status` 函数返回的 `process_info` 字典中的 `create_time` 键名统一修改为 `start_time`。

---

## 2025-08-01

**目标**: 在文件导入时，实现同名文件冲突检测与覆盖提示功能。

**修改内容**:

1.  **后端 (`config_manager.py`)**:
    *   修改 `ConfigVersionService.check_and_create_new_version` 函数签名，增加 `force_overwrite: bool = False` 参数。
    *   在 `check_and_create_new_version` 函数中，当检测到同名文件且内容不同时，如果 `force_overwrite` 为 `False`，则返回一个包含冲突信息的字典（包括现有文件的哈希、新文件的哈希、是否正在运行等），而不是直接创建新版本。
    *   导入 `TelegrafProcess` 模型，用于判断配置文件是否正在被进程使用。

2.  **后端 (`app.py`)**:
    *   修改 `/api/config_files/import_from_directory` API，使其能够接收前端传递的 `force_overwrite` 参数，并将其传递给 `config_version_service.check_and_create_new_version`。
    *   如果 `config_version_service.check_and_create_new_version` 返回冲突信息，则返回 409 Conflict 状态码和冲突详情。
    *   修改 `/api/config_files/import_all_from_directory` API，使其能够接收 `force_overwrite` 参数，并处理批量导入中的冲突，将冲突信息收集到 `conflicts` 列表中返回给前端。

3.  **前端 (`templates/config_files.html`)**:
    *   新增一个 `importConflictModal` 模态框，用于显示单个文件导入时的冲突详情，包括文件名、现有哈希、新哈希和是否正在运行。

4.  **前端 (`static/js/config-directory.js`)**:
    *   修改 `importFileFromDirectory` 函数，当后端返回冲突时，显示 `importConflictModal`，并绑定“确认覆盖”按钮事件，允许用户选择强制覆盖。
    *   修改 `importAllFilesFromDirectory` 函数，使其能够处理批量导入返回的冲突列表，并提供一个总体的强制覆盖选项。

---

## 2025-08-01

**目标**: 启动新进程时，如果数据库中的配置文件与外部文件系统中的同名文件内容一致，则直接启动不提醒。

**修改内容**:

1.  **后端 (`app.py`)**:
    *   在 `manage_processes` 路由的 `start` 动作部分，增加了对数据库中配置文件与外部文件系统同名文件内容一致性的检查。
    *   如果文件名和哈希一致，则直接启动进程，不进行额外提示。
    *   如果外部文件不存在或哈希不一致，则在日志中记录警告信息，但仍使用数据库中的配置文件内容启动进程。

**排查步骤**:

1.  **问题**: 用户希望在启动进程时，如果数据库中的配置文件与外部文件系统中的同名文件内容一致，则直接启动，不进行提示。
2.  **分析**: 
    *   需要修改 `app.py` 中处理启动进程的 API (`/api/telegraf_processes` 的 POST 请求，`action == 'start'`)。
    *   在该逻辑中，获取用户选择的 `config_id` 对应的 `ConfigFile` 对象。
    *   获取“配置文件目录管理”中保存的目录设置，以确定外部文件的路径。
    *   读取外部文件内容并计算哈希，与数据库中 `ConfigFile` 对象的 `content_hash` 进行比较。
3.  **解决方案**: 在 `app.py` 的 `manage_processes` 路由的 `start` 动作部分，添加逻辑来执行上述检查。如果一致，则正常启动；如果不一致，则记录警告日志，但仍继续启动进程，以数据库中的版本为准。