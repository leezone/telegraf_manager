document.addEventListener('DOMContentLoaded', function() {
    // Global state
    let state = {
        configs: [],
        managedProcesses: [],
        nonManagedProcesses: [],
        history: [],
        pagination: {
            nonManaged: null,
        },
        managedProcessesTable: null, // To hold the DataTable instance
        historyTable: null
    };

    // Modal instances
    const modals = {
        startProcess: new bootstrap.Modal(document.getElementById('startProcessModal')),
        processDetail: new bootstrap.Modal(document.getElementById('processDetailModal')),
        processLog: new bootstrap.Modal(document.getElementById('processLogModal')),
        restartProcess: new bootstrap.Modal(document.getElementById('restartProcessModal')),
        dataSnapshot: new bootstrap.Modal(document.getElementById('dataSnapshotModal'))
    };

    function escapeHtml(unsafe) {
        return String(unsafe === null || typeof unsafe === 'undefined' ? '' : unsafe)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // --- Initialization ---
    function init() {
        setupPagination();
        renderProcessesTable(); // Initial render of managed processes table
        loadAllManagedProcesses().then(() => { // Load all managed processes first
            loadNonManagedProcesses();
            loadHistory();
            loadConfigs();
        });
        setupEventListeners();
        setInterval(loadAllProcesses, 30000);
    }

    function setupPagination() {
        state.pagination.nonManaged = new Pagination('non-managed-processes-pagination', {
            onPageChange: (page, perPage) => loadNonManagedProcesses(page, perPage)
        });
    }

    // --- Initialization ---
    function init() {
        setupPagination();
        renderProcessesTable(); // Initial render of managed processes table
        loadAllManagedProcesses().then(() => { // Load all managed processes first
            loadNonManagedProcesses();
            loadHistory();
            loadConfigs();
        });
        setupEventListeners();
        setInterval(loadAllProcesses, 30000);
    }

    function setupPagination() {
        state.pagination.nonManaged = new Pagination('non-managed-processes-pagination', {
            onPageChange: (page, perPage) => loadNonManagedProcesses(page, perPage)
        });
    }

    function setupEventListeners() {
        document.getElementById('selectAllConfigsCheckbox').addEventListener('change', window.toggleSelectAllConfigs);
        
        // Add listener to update count
        $('#processes-table').on('draw.dt', function() {
            var info = state.managedProcessesTable.page.info();
            $('#managed-processes-count').text(info.recordsTotal);
        });
    }

    // --- Data Loading ---
    function loadAllProcesses() {
        if (state.managedProcessesTable) {
            state.managedProcessesTable.ajax.reload(null, false); // Reload the table data
        }
        loadAllManagedProcesses().then(() => {
            loadNonManagedProcesses();
            renderConfigSelectionTable(); // Re-render the config selection table with updated status
        });
    }

    // --- Data Loading ---
    function loadAllProcesses() {
        if (state.managedProcessesTable) {
            state.managedProcessesTable.ajax.reload(null, false); // Reload the table data
        }
        loadAllManagedProcesses().then(() => {
            loadNonManagedProcesses();
            renderConfigSelectionTable(); // Re-render the config selection table with updated status
        });
    }

        function setupEventListeners() {
        document.getElementById('selectAllConfigsCheckbox').addEventListener('change', window.toggleSelectAllConfigs);
        
        // Add listener to update count
        $('#processes-table').on('draw.dt', function() {
            var info = state.managedProcessesTable.page.info();
            $('#managed-processes-count').text(info.recordsTotal);
        });
    }

    // --- Data Loading ---
    function loadAllProcesses() {
        if (state.managedProcessesTable) {
            state.managedProcessesTable.ajax.reload(null, false); // Reload the table data
        }
        loadAllManagedProcesses().then(() => {
            loadNonManagedProcesses();
            renderConfigSelectionTable(); // Re-render the config selection table with updated status
        });
    }

    async function loadAllManagedProcesses() {
        try {
            const params = { length: -1 };
            const data = await ApiClient.post('/api/processes/managed', params);
            state.managedProcesses = data.data;
        } catch (error) {
            showAlert(`加载所有系统管理进程失败: ${error.message}`, 'danger');
        }
    }

    async function loadNonManagedProcesses(page = 1, perPage = 10) {
        try {
            const url = new URL('/api/processes/non_managed', window.location.origin);
            url.searchParams.append('page', page);
            url.searchParams.append('per_page', perPage);
            const data = await ApiClient.get(url.toString());

            state.nonManagedProcesses = data.items;
            renderNonManagedProcessesTable(state.nonManagedProcesses);
            document.getElementById('non-managed-processes-count').textContent = data.pagination.total;
            
            const paginationContainer = document.getElementById('non-managed-processes-pagination');
            if (data.pagination.total > 0 && data.pagination.pages > 1) {
                paginationContainer.style.display = 'flex';
                state.pagination.nonManaged.render(data.pagination);
            } else {
                paginationContainer.style.display = 'none';
            }

        } catch (error) {
            showAlert(`加载非系统管理进程失败: ${error.message}`, 'danger');
        }
    }

    window.loadHistory = async function() {
        try {
            const data = await ApiClient.get('/api/processes/history');
            state.history = data.history || [];
            renderProcessHistoryTable();
        } catch (error) {
            showAlert(`加载历史记录失败: ${error.message}`, 'danger');
        }
    }

    async function loadConfigs() {
        try {
            const data = await ApiClient.get('/api/config_files?length=1000'); 
            state.configs = data.data || [];
            renderConfigSelectionTable();
        } catch (error) {
            showAlert(`加载配置文件失败: ${error.message}`, 'danger');
        }
    }

    // --- Rendering ---
    function renderProcessesTable() {
        if (state.managedProcessesTable) {
            state.managedProcessesTable.destroy();
        }

        state.managedProcessesTable = new DataTable('#processes-table', {
            responsive: true,
            destroy: true,
            serverSide: true,
            processing: true,
            ajax: {
                url: '/api/processes/managed',
                type: 'POST',
                dataSrc: function(json) {
                    // Store the raw data for detail view
                    state.managedProcesses = json.data;
                    return json.data;
                }
            },
            columns: [
                { data: 'pid', render: (d) => `<code>${d || 'N/A'}</code>` },
                { data: 'config_file', render: (d) => `<strong>${d}</strong>` },
                { data: 'status', render: formatProcessStatus },
                { data: 'start_time', render: formatDateToLocal },
                { data: 'start_time', render: formatRuntime },
                { data: 'cpu_percent', render: (d) => `${d !== null ? d.toFixed(1) : 'N/A'}%` },
                { data: 'memory_mb', render: (d) => `${d !== null ? d.toFixed(2) : 'N/A'} MB` },
                { 
                    data: null, 
                    orderable: false,
                    render: function(data, type, row) {
                        return `
                        <div class="btn-group btn-group-sm" role="group">
                            <button class="btn btn-outline-primary" onclick="showDataSnapshot(${row.config_file_id})" title="数据预览"><i class="bi bi-camera"></i></button>
                            <button class="btn btn-outline-info" onclick="viewProcessDetail(${row.id})" title="详情"><i class="bi bi-info-circle"></i></button>
                            <button class="btn btn-outline-secondary" onclick="viewProcessLogs(${row.pid})" title="日志" ${!row.pid ? 'disabled' : ''}><i class="bi bi-journal-text"></i></button>
                            <button class="btn btn-outline-warning" onclick="openRestartModal(${row.pid}, ${row.config_file_id})" title="安全重启" ${!row.pid ? 'disabled' : ''}><i class="bi bi-arrow-counterclockwise"></i></button>
                            <button class="btn btn-outline-danger" onclick="stopProcess(${row.id})" title="停止" ${!row.pid ? 'disabled' : ''}><i class="bi bi-stop-circle"></i></button>
                        </div>
                        `;
                    }
                }
            ],
            language: {
                url: '/static/js/lib/datatables/zh-CN.json'
            },
            lengthMenu: [
                [10, 25, 50, -1],
                [10, 25, 50, '全部']
            ],
            pageLength: 10,
            order: [[3, 'desc']]
        });
    }

    function renderNonManagedProcessesTable(processes) {
        const tbody = document.getElementById('nonManagedProcessesTableBody');
        tbody.innerHTML = !processes || processes.length === 0
            ? `<tr><td colspan="4" class="text-center text-muted py-4"><i class="bi bi-check-circle-fill fs-1 mb-2 d-block"></i>无非系统管理进程</td></tr>`
            : processes.map(p => `
                <tr>
                    <td><code>${p.pid}</code></td>
                    <td>${formatDateToLocal(p.start_time)}</td>
                    <td><code>${p.cmdline}</code></td>
                    <td><button class="btn btn-sm btn-outline-danger" onclick="stopNonManagedProcess(${p.pid})" title="停止非受管进程"><i class="bi bi-stop-circle"></i></button></td>
                </tr>`).join('');
    }

    function renderProcessHistoryTable() {
        if (state.historyTable) {
            state.historyTable.destroy();
        }

        const tbody = document.getElementById('processHistoryTableBody');
        tbody.innerHTML = state.history.map(h => `
            <tr>
                <td></td>
                <td><code>${h.pid || 'N/A'}</code></td>
                <td>${h.name}</td>
                <td>${h.config_file}</td>
                <td>${formatDateToLocal(h.start_time)}</td>
                <td>${formatDateToLocal(h.stop_time)}</td>
                <td><span class="badge bg-secondary">${h.status || 'stopped'}</span></td>
                <td><button class="btn btn-sm btn-outline-secondary" onclick="viewProcessLogs(${h.pid})" title="查看日志" ${!h.pid ? 'disabled' : ''}><i class="bi bi-journal-text"></i></button></td>
            </tr>`).join('');

        state.historyTable = new DataTable('#processHistoryTable', {
            language: {
                url: '/static/js/lib/datatables/zh-CN.json'
            },
            "order": [[ 4, "desc" ]], // Default sort by start_time descending
            columnDefs: [ { 
                orderable: false,
                className: 'select-checkbox',
                targets:   0,
                render: function (data, type, full, meta){
                    return '<input type="checkbox" class="form-check-input dt-checkboxes">';
                }
            } ],
            select: {
                style:    'multi',
                selector: 'td:first-child input'
            }
        });

        // Handle "select all" checkbox
        document.getElementById('selectAllHistoryHeaderCheckbox').addEventListener('change', function() {
            if (this.checked) {
                state.historyTable.rows().select();
            } else {
                state.historyTable.rows().deselect();
            }
        });
    }

    function renderConfigSelectionTable() {
        const filterText = document.getElementById('configSearchInput').value.toLowerCase();
        const filteredConfigs = state.configs.filter(c => c.file_name.toLowerCase().includes(filterText));
        const tbody = document.getElementById('configSelectionTableBody');
        tbody.innerHTML = filteredConfigs.map(config => {
            const runningProcess = state.managedProcesses.find(p => p.config_file_id === config.id);
            const isRunning = !!runningProcess;
            return `
                <tr>
                    <td><input type="checkbox" class="form-check-input config-checkbox" value="${config.id}" onchange="updateSelectionCounter()" ${isRunning ? 'disabled' : ''}></td>
                    <td>${config.file_name}</td>
                    <td>v${config.version}</td>
                    <td>${renderConfigStatus(isRunning)}</td>
                    <td>${isRunning ? `<button class="btn btn-sm btn-warning" onclick="handleInlineRestart(${runningProcess.pid}, ${runningProcess.config_file_id})">重启</button>` : ''}</td>
                </tr>`;
        }).join('');
        updateSelectionCounter();
    }

    window.openStartProcessModal = () => {
        document.getElementById('configSearchInput').value = '';
        renderConfigSelectionTable();
        modals.startProcess.show();
        document.getElementById('configSearchInput').addEventListener('input', renderConfigSelectionTable);
    };

    window.viewProcessLogs = (pid) => {
        document.getElementById('logModalProcessPid').textContent = pid;
        const logContentElement = document.getElementById('processLogContent');
        const logFilter = document.getElementById('logFilterType');
        logFilter.onchange = () => fetchAndRenderLogs(pid, logFilter.value);
        fetchAndRenderLogs(pid, 'all');
        modals.processLog.show();
    };

    function fetchAndRenderLogs(pid, logType) {
        const logContentElement = document.getElementById('processLogContent');
        logContentElement.textContent = '正在加载日志...';
        ApiClient.get(`/api/processes/${pid}/logs?limit=500&log_type=${logType}`)
            .then(data => {
                const logs = data.logs || [];
                logContentElement.textContent = logs.length > 0 
                    ? logs.map(l => `[${formatDateToLocal(l.timestamp)}] [${l.log_type.toUpperCase()}] ${l.message}`).join('\n')
                    : '无可用日志。';
                logContentElement.scrollTop = logContentElement.scrollHeight;
            })
            .catch(error => { logContentElement.textContent = `加载日志失败: ${error.message}`; });
    }

    window.openRestartModal = (pid, configId) => {
        document.getElementById('restartPid').textContent = pid;
        const testBtn = document.getElementById('testConfigBtn');
        const restartBtn = document.getElementById('restartConfigBtn');
        const testResultOutput = document.getElementById('testResultOutput');

        testBtn.dataset.configId = configId;
        restartBtn.dataset.pid = pid;
        restartBtn.dataset.configId = configId; // 添加这一行！
        restartBtn.disabled = true; // Initially disable restart button
        testResultOutput.style.display = 'none'; // Hide previous test results
        testResultOutput.className = 'alert'; // Reset alert class

        modals.restartProcess.show();
    };

    window.runConfigTestForRestart = async () => {
        const testBtn = document.getElementById('testConfigBtn');
        const restartBtn = document.getElementById('restartConfigBtn');
        const testResultOutput = document.getElementById('testResultOutput');
        const configId = testBtn.dataset.configId;

        if (!configId) {
            showAlert('无法获取配置文件ID进行测试。', 'danger');
            return;
        }

        testBtn.disabled = true;
        restartBtn.disabled = true;
        testResultOutput.style.display = 'none';
        testResultOutput.textContent = '';
        testResultOutput.className = 'alert';

        try {
            const testResponse = await ApiClient.post('/api/telegraf/validate', { config_id: configId });

            if (testResponse.is_valid) {
                testResultOutput.textContent = '配置测试成功：Telegraf 配置有效。';
                testResultOutput.className = 'alert alert-success';
                restartBtn.disabled = false;
            } else {
                const errorType = testResponse.error_type === 'syntax' ? '配置语法错误' : '插件或连接错误';
                const alertType = testResponse.error_type === 'syntax' ? 'alert-danger' : 'alert-warning';
                const errorMessage = testResponse.error || '未知错误。';
                
                testResultOutput.innerHTML = `<strong>测试失败: ${errorType}</strong><pre class="mb-0 mt-2"><code>${escapeHtml(errorMessage)}</code></pre>`;
                testResultOutput.className = `alert ${alertType}`;
                
                // Enable restart button for non-syntax errors
                if (testResponse.error_type !== 'syntax') {
                    restartBtn.disabled = false;
                } else {
                    restartBtn.disabled = true;
                }
            }
        } catch (error) {
            testResultOutput.textContent = `测试过程中发生错误: ${error.message}`;
            testResultOutput.className = 'alert alert-danger';
            restartBtn.disabled = true;
        } finally {
            testResultOutput.style.display = 'block';
            testBtn.disabled = false;
        }
    };

    window.runProcessRestart = async () => {
        console.log("runProcessRestart called"); // 添加这一行
        const restartBtn = document.getElementById('restartConfigBtn');
        const pid = restartBtn.dataset.pid; // 获取 PID
        const configId = restartBtn.dataset.configId; // 获取 configId (如果需要)

        if (!pid) {
            showAlert('无法获取进程ID进行重启。', 'danger');
            return;
        }

        if (!confirm(`确定要重启进程 (PID: ${pid}) 吗？`)) {
            return;
        }

        try {
            // 发送重启请求
            // 假设后端有一个 /api/processes/restart 接口，接收 pid 和 config_id
            const response = await ApiClient.post('/api/processes/restart', { pid: pid, config_id: configId });

            if (response.success) {
                showAlert('进程重启请求已发送。', 'success');
                modals.restartProcess.hide(); // 关闭模态框
                loadAllProcesses(); // 刷新进程列表
            } else {
                showAlert(`进程重启失败: ${response.message || '未知错误'}`, 'danger');
            }
        } catch (error) {
            showAlert(`进程重启失败: ${error.message}`, 'danger');
        }
    };
    
    window.toggleSelectAllConfigs = () => {
        const isChecked = document.getElementById('selectAllConfigsCheckbox').checked;
        document.querySelectorAll('#configSelectionTableBody .config-checkbox:not(:disabled)').forEach(cb => cb.checked = isChecked);
        updateSelectionCounter();
    };

    window.updateSelectionCounter = () => {
        const total = document.querySelectorAll('#configSelectionTableBody .config-checkbox:not(:disabled)').length;
        const selected = document.querySelectorAll('.config-checkbox:checked').length;
        document.getElementById('selectionCounter').textContent = `已勾选: ${selected} / ${total}`;
        document.getElementById('selectAllConfigsCheckbox').checked = selected > 0 && selected === total;
    };

    window.deleteSelectedHistory = () => {
        const selectedData = state.historyTable.rows({ selected: true }).data().toArray();
        const selectedPids = selectedData.map(row => parseInt(row[1].match(/<code>(.*)<\/code>/)[1]));

        if (selectedPids.length === 0) return showAlert('请选择要删除的记录。', 'warning');
        if (!confirm(`确定要删除 ${selectedPids.length} 条历史记录吗？`)) return;
        ApiClient.post('/api/processes/history/delete', { pids: selectedPids })
            .then(() => { showAlert('删除成功。', 'success'); loadHistory(); })
            .catch(err => showAlert(`删除失败: ${err.message}`, 'danger'));
    };

    window.viewProcessDetail = (id) => {
        const process = state.managedProcesses.find(p => p.id === id);
        if (!process) {
            showAlert('找不到指定的进程详情。', 'warning');
            return;
        }
        document.getElementById('processDetailContent').innerHTML = `<h6>进程详情 (PID: ${process.pid})</h6><table class="table table-sm"><tr><td>配置文件</td><td>${process.config_file}</td></tr><tr><td>启动时间</td><td>${formatDateToLocal(process.start_time)}</td></tr><tr><td>CPU</td><td>${process.cpu_percent}%</td></tr><tr><td>内存</td><td>${process.memory_mb.toFixed(2)} MB</td></tr></table>`;
        modals.processDetail.show();
    };

    function formatRuntime(startTime) {
        if (!startTime) return 'N/A';
        const diff = Date.now() - new Date(startTime).getTime();

        if (diff < 0) {
            return '0分';
        }

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        
        let result = '';
        if (days > 0) result += `${days}天 `;
        if (hours > 0) result += `${hours}小时 `;
        result += `${minutes}分`;

        return result.trim();
    }

    function formatDateToLocal(dateString) {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleString('zh-CN');
    }

    function renderConfigStatus(isRunning) {
        return isRunning ? `<span class="badge bg-success">运行中</span>` : `<span class="badge bg-secondary">已停止</span>`;
    }

    function formatProcessStatus(status) {
        const statusMap = { running: 'success', stopped: 'danger', zombie: 'warning' };
        return `<span class="badge bg-${statusMap[status] || 'secondary'}">${status}</span>`;
    }

    function showAlert(message, type = 'info', containerId = 'alert-container') {
        const container = document.getElementById(containerId);
        if (!container) return;
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
        alertDiv.innerHTML = `<div>${message}</div><button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
        container.prepend(alertDiv);
        setTimeout(() => bootstrap.Alert.getOrCreateInstance(alertDiv)?.close(), 5000);
    }

    window.showDataSnapshot = async function(configId) {
        if (!modals.dataSnapshot) return showAlert('数据预览模态框未初始化!', 'danger');
    
        const modalBody = document.getElementById('dataSnapshotBody');
        modalBody.innerHTML = '<div class="text-center p-5"><span class="spinner-border"></span><p class="mt-2">正在生成预览，这可能需要一点时间...</p></div>';
        modals.dataSnapshot.show();
    
        try {
            const result = await ApiClient.post(`/api/config_files/${configId}/snapshot`);
            const metrics = result.metrics;
    
            if (!metrics || metrics.length === 0) {
                modalBody.innerHTML = '<div class="alert alert-warning">未从该配置生成任何数据。请检查输入插件是否正确配置，或稍后再试。</div>';
                return;
            }
    
            let tableHtml = '<table class="table table-sm table-bordered"><thead><tr><th>Measurement</th><th>Tags</th><th>Fields</th><th>Timestamp</th></tr></thead><tbody>';
            metrics.forEach(metric => {
                const tagsHtml = `<pre class="mb-0"><code>${escapeHtml(JSON.stringify(metric.tags, null, 2))}</code></pre>`;
                const fieldsHtml = `<pre class="mb-0"><code>${escapeHtml(JSON.stringify(metric.fields, null, 2))}</code></pre>`;
                tableHtml += `
                    <tr>
                        <td>${escapeHtml(metric.measurement)}</td>
                        <td>${tagsHtml}</td>
                        <td>${fieldsHtml}</td>
                        <td>${formatDateToLocal(new Date(metric.timestamp).toISOString())}</td>
                    </tr>
                `;
            });
            tableHtml += '</tbody></table>';
            modalBody.innerHTML = tableHtml;
    
        } catch (error) {
            let errorHtml = '<div class="alert alert-danger">';
            if (error.details && error.details.summary) {
                errorHtml += `<h6>生成预览失败</h6><p><strong>关键错误:</strong> ${escapeHtml(error.details.summary)}</p>`;
                errorHtml += `
                    <a class="btn btn-sm btn-outline-secondary" data-bs-toggle="collapse" href="#fullErrorLog" role="button">
                        查看完整日志
                    </a>
                    <div class="collapse mt-2" id="fullErrorLog">
                        <pre class="mb-0"><code>${escapeHtml(error.details.full_log)}</code></pre>
                    </div>
                `;
            } else {
                errorHtml += `生成预览失败: ${error.message}`;
            }
            errorHtml += '</div>';
            modalBody.innerHTML = errorHtml;
        }
    }

    window.startSelectedProcesses = () => {
        const selectedConfigs = Array.from(document.querySelectorAll('.config-checkbox:checked')).map(cb => cb.value);
        if (selectedConfigs.length === 0) return showAlert('请至少选择一个配置文件来启动。', 'warning', 'startProcessAlertContainer');
        Promise.all(selectedConfigs.map(configId => ApiClient.post('/api/processes/start', { config_id: configId })))
            .then(results => {
                const successful = results.filter(res => !res.error).length;
                if (successful > 0) modals.startProcess.hide();
                loadAllProcesses(); // Reload both tables
                loadConfigs();
            });
    };

    window.stopProcess = (id) => {
        if (!confirm('确定要停止该进程吗？')) return;
        ApiClient.post(`/api/processes/${id}/stop`, {}).then(() => {
            showAlert('进程已停止', 'success');
            loadAllProcesses(); // Reload both tables
            loadConfigs();
        }).catch(err => showAlert(`停止进程失败: ${err.message}`, 'danger'));
    };

    window.stopNonManagedProcess = (pid) => {
        if (!confirm(`确定要停止这个非系统管理的进程 (PID: ${pid}) 吗？此操作可能无法撤销。`)) return;
        ApiClient.post(`/api/processes/${pid}/stop_non_managed`, {}).then(() => {
            showAlert(`非受管进程 ${pid} 已成功停止。`, 'success');
            loadNonManagedProcesses(); // Reload only the non-managed table
        }).catch(err => showAlert(`停止进程 ${pid} 失败: ${err.message}`, 'danger'));
    };

    init();
});
