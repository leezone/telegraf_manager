// 更新当前时间
function updateTime() {
    const now = new Date();
    document.getElementById('current-time').textContent = now.toLocaleString('zh-CN');
}

// 工具函数：统一 fetch+json 处理
function fetchJson(url, options = {}) {
    return fetch(url, options).then(res => res.json());
}

// 加载统计数据
function loadStats() {
    // 并行加载所有统计数据
    Promise.all([
        fetchJson('/api/point_info?page=1&per_page=1').catch(() => ({ pagination: { total: 0 } })),
        fetchJson('/api/data_sources?page=1&per_page=1').catch(() => ({ pagination: { total: 0 } })),
        fetchJson('/api/config_files?page=1&per_page=1').catch(() => ({ pagination: { total: 0 } }))
    ]).then(([pointInfo, dataSources, configFiles]) => {
        // The API for point_info and data_sources still uses the old pagination format.
        if (pointInfo && pointInfo.pagination) {
            document.getElementById('input-sources-count').textContent = pointInfo.pagination.total;
        }
        if (dataSources && dataSources.pagination) {
            document.getElementById('data-sources-count').textContent = dataSources.pagination.total;
        }
        
        // The config_files API was refactored for DataTables and uses a different format.
        if (configFiles && typeof configFiles.recordsTotal !== 'undefined') {
            document.getElementById('config-files-count').textContent = configFiles.recordsTotal;
        }
    });
    // 运行进程数量由 loadProcesses() 更新
}

// 模拟最近活动
function loadRecentActivities() {
    // The audit_log API now uses `length` instead of `limit`
    fetchJson('/api/audit_log?length=10')
        .then(response => {
            const container = document.getElementById('recent-activities');
            container.innerHTML = '';
            // The new API response for DataTables has the data in the `data` property
            const data = response.data || [];
            if (!data || !Array.isArray(data) || data.length === 0) {
                container.innerHTML = '<div class="text-center text-muted py-3">无最近活动</div>';
                return;
            }
            data.forEach(log => {
                const activityElement = document.createElement('div');
                activityElement.className = 'd-flex justify-content-between align-items-center py-2 border-bottom';
                const icon = log.status === 'success' 
                    ? '<i class="bi bi-check-circle-fill text-success"></i>' 
                    : '<i class="bi bi-exclamation-triangle-fill text-danger"></i>';
                activityElement.innerHTML = `
                    <div>
                        <span class="me-2">${icon}</span>
                        <strong>${log.username}</strong> ${log.action.replace('_', ' ')}: ${log.details}
                    </div>
                    <small class="text-muted">${new Date(log.timestamp).toLocaleString('zh-CN')}</small>
                `;
                container.appendChild(activityElement);
            });
        })
        .catch(error => {
            console.error('Error loading recent activities:', error);
            const container = document.getElementById('recent-activities');
            container.innerHTML = '<div class="text-center text-danger py-3">加载活动失败</div>';
        });
}

function loadProcesses() {
    fetchJson('/api/processes/summary')
        .then(data => {
            const processes = data.processes_summary || [];
            const totalRunning = data.total_processes || 0;

            document.getElementById('running-processes-count').textContent = totalRunning;

            const tbody = document.getElementById('processesTableBody');
            if (processes.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">无运行中的进程</td></tr>`;
                return;
            }

            tbody.innerHTML = processes.map(process => `
                <tr>
                    <td><code>${process.pid || 'N/A'}</code></td>
                    <td><strong>${process.name || 'N/A'}</strong></td>
                    <td>${formatManagementStatus(process.management_type)}</td>
                    <td>${formatProcessStatus(process.status)}</td>
                    <td>${process.start_time ? formatRuntime(new Date(process.start_time)) : 'N/A'}</td>
                    <td>${process.cpu_percent !== undefined && process.cpu_percent !== null ? process.cpu_percent.toFixed(1) + ' %' : 'N/A'}</td>
                    <td>${process.memory_mb !== undefined && process.memory_mb !== null ? process.memory_mb.toFixed(2) + ' MB' : 'N/A'}</td>
                </tr>
            `).join('');
        })
        .catch(error => {
            console.error('加载进程失败:', error);
            document.getElementById('running-processes-count').textContent = 'Error';
            const tbody = document.getElementById('processesTableBody');
            if(tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">加载进程列表失败</td></tr>`;
        });
}

function formatManagementStatus(type) {
    if (type === 'managed') {
        return `<span class="badge bg-success">系统管理</span>`;
    } else {
        return `<span class="badge bg-warning">非系统管理</span>`;
    }
}

function formatProcessStatus(status) {
    switch (status) {
        case 'running': case 'sleeping': return `<span class="badge bg-primary"><i class="bi bi-play-circle me-1"></i>运行中</span>`;
        case 'stopped': return `<span class="badge bg-secondary"><i class="bi bi-stop-circle me-1"></i>已停止</span>`;
        case 'zombie': return `<span class="badge bg-warning"><i class="bi bi-exclamation-triangle me-1"></i>僵尸进程</span>`;
        default: return `<span class="badge bg-info">${status}</span>`;
    }
}

// 格式化运行时长
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

function formatUptime(seconds) {
    if (seconds < 0) return '-';
    const days = Math.floor(seconds / (3600 * 24));
    seconds %= (3600 * 24);
    const hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    const minutes = Math.floor(seconds / 60);

    let result = '';
    if (days > 0) result += `${days}天 `;
    if (hours > 0) result += `${hours}小时 `;
    if (minutes > 0) result += `${minutes}分`;
    if (result === '') result = '小于1分钟';

    return result.trim();
}

async function loadSystemStatus() {
    try {
        const response = await fetchJson('/api/system/status');
        const { app_status, db_status, dependencies_status } = response;

        // App Status
        document.getElementById('status-app-mode').textContent = app_status.mode;
        document.getElementById('status-app-threads').textContent = app_status.threads;
        document.getElementById('status-app-uptime').textContent = formatUptime(app_status.uptime_seconds);
        document.getElementById('status-app-python').textContent = `v${app_status.python_version.split(' ')[0]}`;

        // Dependencies
        document.getElementById('status-dep-telegraf').textContent = `v${dependencies_status.telegraf_version}`;

        // DB Status
        document.getElementById('status-db-sqlite-size').textContent = `${db_status.sqlite.size_mb} MB`;
        document.getElementById('status-db-sqlite-mtime').textContent = db_status.sqlite.last_modified ? new Date(db_status.sqlite.last_modified).toLocaleString('zh-CN') : '-';
        document.getElementById('status-db-duckdb-size').textContent = `${db_status.duckdb.size_mb} MB`;
        document.getElementById('status-db-duckdb-mtime').textContent = db_status.duckdb.last_modified ? new Date(db_status.duckdb.last_modified).toLocaleString('zh-CN') : '-';

    } catch (error) {
        console.error('Error loading system status:', error);
        document.getElementById('system-status-card').innerHTML = '<div class="alert alert-danger">加载系统状态失败</div>';
    }
}

// 初始化页面
document.addEventListener('DOMContentLoaded', function() {
    updateTime();
    loadStats();
    loadRecentActivities();
    loadProcesses();
    loadSystemStatus();
    
    // 每分钟更新时间
    setInterval(updateTime, 60000);
    
    // 每30秒刷新统计数据
    setInterval(() => {
        loadStats();
        loadSystemStatus();
    }, 30000);
    // 每5秒刷新进程列表
    setInterval(loadProcesses, 5000);
});