/**
 * 配置文件管理 - 主界面功能
 * 使用 DataTables.js 进行重构
 */

// 全局变量
let configsDataTable = null;
let addConfigModalInstance = null;
let viewConfigModalInstance = null;
let diffModalInstance = null;

// 页面初始化
document.addEventListener('DOMContentLoaded', function() {
    initializeModals();
    initializeDataTable();
});

// 初始化模态框
function initializeModals() {
    const addConfigModal = document.getElementById('addConfigModal');
    if (addConfigModal) addConfigModalInstance = new bootstrap.Modal(addConfigModal);
    
    const viewConfigModal = document.getElementById('viewConfigModal');
    if (viewConfigModal) viewConfigModalInstance = new bootstrap.Modal(viewConfigModal);
    
    const diffModal = document.getElementById('diffModal');
    if (diffModal) diffModalInstance = new bootstrap.Modal(diffModal);

    const snapshotModal = document.getElementById('dataSnapshotModal');
    if (snapshotModal) dataSnapshotModalInstance = new bootstrap.Modal(snapshotModal);
}

// 初始化 DataTables
function initializeDataTable() {
    configsDataTable = $('#configFilesTable').DataTable({
        processing: true,
        serverSide: true,
        ajax: {
            url: '/api/config_files',
            type: 'POST',
            dataSrc: 'data' // 告诉 DataTables 数据在响应的 'data' 属性中
        },
        columns: [
            { data: 'file_name', title: '文件名' },
            { data: 'version', title: '版本' },
            { data: 'created_at', title: '创建时间' },
            { data: 'sync_status', title: '数据点同步' },
            { data: 'running_status', title: '运行状态' },
            { data: null, title: '操作', orderable: false, searchable: false }
        ],
        columnDefs: [
            {
                targets: 0, // 文件名
                render: function(data, type, row) {
                    return `<strong>${escapeHtml(data)}</strong>`;
                }
            },
            {
                targets: 1, // 版本
                render: function(data, type, row) {
                    return `<span class="badge bg-info">v${data}</span>`;
                }
            },
            {
                targets: 2, // 创建时间
                render: function(data, type, row) {
                    return formatDateTime(data);
                }
            },
            {
                targets: 3, // 数据点同步
                render: function(data, type, row) {
                    return `<span class="badge ${getSyncStatusBadge(data)} shadow-sm">${escapeHtml(data || '未知')}</span>`;
                }
            },
            {
                targets: 4, // 运行状态
                render: function(data, type, row) {
                    const statusBadge = `<span class="badge ${getRunningStatusBadge(data)}">${getRunningStatusText(data)}</span>`;
                    if (data && data.is_running) {
                        return statusBadge;
                    } else {
                        const startButton = `<button class="btn btn-xs btn-outline-success ms-2" onclick="startProcessFromConfig(${row.id})" title="启动进程"><i class="bi bi-play-fill"></i></button>`;
                        return `<div class="d-flex align-items-center">${statusBadge}${startButton}</div>`;
                    }
                }
            },
            {
                targets: 5, // 操作
                render: function(data, type, row) {
                    const isLocked = row.is_locked;
                    const disabledAttr = isLocked ? 'disabled' : '';
                    const lockIcon = isLocked ? 'bi-lock-fill' : 'bi-unlock-fill';
                    const lockTitle = isLocked ? '解锁' : '锁定';
                    return `
                        <div class="btn-group btn-group-sm" role="group">
                            <button class="btn btn-outline-primary" onclick="openViewConfigModal(${row.id})" title="查看/编辑"><i class="bi bi-eye"></i></button>
                            <button class="btn btn-outline-info" onclick="showDataSnapshot(${row.id})" title="数据预览"><i class="bi bi-camera"></i></button>
                            <button class="btn btn-outline-warning" onclick="lazyLoadAndRunParser(${row.id})" title="解析并导入数据点" ${disabledAttr}><i class="bi bi-magic"></i></button>
                            <button class="btn btn-outline-danger" onclick="confirmDeleteConfig(${row.id})" title="删除" ${disabledAttr}><i class="bi bi-trash"></i></button>
                            <button class="btn btn-outline-secondary" onclick="toggleLockConfig(${row.id})" title="${lockTitle}"><i class="bi ${lockIcon}"></i></button>
                        </div>
                    `;
                }
            }
        ],
        order: [[2, 'desc']], // 默认按创建时间降序
        language: {
            url: '/static/js/lib/datatables/zh-CN.json'
        },
        responsive: true,
        autoWidth: false
    });
}

// 暴露到 window 作用域，供其他脚本或内联事件调用
window.loadConfigs = function() {
    if (configsDataTable) {
        configsDataTable.ajax.reload(null, false); // false to hold pagination
    }
}

// --- 懒加载解析器工作流 ---
function lazyLoadAndRunParser(configId) {
    const scriptPath = '/static/js/config_parser_workflow.js';
    
    if (window.isParserScriptLoaded) {
        window.initializeParserAndShowModal(configId);
    } else {
        const script = document.createElement('script');
        script.src = scriptPath;
        script.onload = () => {
            window.isParserScriptLoaded = true;
            window.initializeParserAndShowModal(configId);
        };
        script.onerror = () => showAlert('加载解析器失败，请检查网络连接或联系管理员。', 'danger');
        document.body.appendChild(script);
    }
}

// --- 辅助及原有功能函数 ---
function getChangeTypeText(changeType) { switch (changeType) { case 'manual': return '手动'; case 'system': return '系统'; case 'wizard': return '向导创建'; default: return '外部'; } }
function getSyncStatusBadge(status) {
    switch (status) {
        case '已同步': return 'bg-success';
        case '部分同步': return 'bg-warning text-dark';
        case '未同步': return 'bg-secondary';
        default: return 'bg-light text-dark';
    }
}
function getRunningStatusBadge(status) {
    if (!status) return 'bg-secondary';
    return status.is_running ? 'bg-success' : 'bg-secondary';
}
function getRunningStatusText(status) {
    if (!status) return '未知';
    if (status.is_running) return `运行中 (${status.managed_by})`;
    return '已停止';
}
function openAddConfigModal() {
    if (!addConfigModalInstance) return;
    const now = new Date();
    const timestamp = now.getFullYear().toString() + (now.getMonth() + 1).toString().padStart(2, '0') + now.getDate().toString().padStart(2, '0') + '_' + now.getHours().toString().padStart(2, '0') + now.getMinutes().toString().padStart(2, '0') + now.getSeconds().toString().padStart(2, '0');
    document.getElementById('configName').value = `telegraf_${timestamp}.conf`;
    document.getElementById('configContent').value = '';
    addConfigModalInstance.show();
}
async function addConfig() {
    try {
        const name = document.getElementById('configName').value;
        const content = document.getElementById('configContent').value;
        if (!name || !content) throw new Error('文件名和内容不能为空');
        const response = await ApiClient.post('/api/config_files/create', { name, content, change_type: 'manual', change_description: '手动创建配置文件' });
        if (response.success) {
            if (response.message && response.message.includes('内容无变化')) {
                showAlert('配置文件内容无变化，未创建新版本。', 'info');
            } else {
                showAlert('配置文件创建成功', 'success');
            }
        } else {
            showAlert('创建配置文件失败: ' + (response.message || '未知错误'), 'danger');
        }
        addConfigModalInstance.hide();
        loadConfigs();
    } catch (error) {
        showAlert('创建配置文件失败: ' + error.message, 'danger');
    }
}
async function openViewConfigModal(id) {
    if (!viewConfigModalInstance) return;
    try {
        const config = await ApiClient.get(`/api/config_files/${id}`);
        document.getElementById('viewConfigId').value = config.id;
        document.getElementById('viewConfigName').value = config.file_name;
        renderEditablePreview(config.content);
        const versionInfo = document.getElementById('configVersionInfo');
        if (versionInfo) {
            versionInfo.innerHTML = `<div class="row">
                <div class="col-md-6"><strong>当前版本:</strong> v${config.version}<br><strong>状态:</strong> ${config.is_active ? '激活' : '非激活'}<br><strong>变更类型:</strong> ${getChangeTypeText(config.change_type)}</div>
                <div class="col-md-6"><strong>创建时间:</strong> ${formatDateTime(config.created_at)}<br><strong>更新时间:</strong> ${formatDateTime(config.updated_at)}<br><strong>数据点同步:</strong> ${escapeHtml(config.sync_status || '未知')}</div>
            </div>`;
        }
        renderLinkedPointsTable(config.linked_points || []);
        const saveBtn = document.getElementById('updateConfigBtn');
        const nameInput = document.getElementById('viewConfigName');
        if (config.is_locked) {
            saveBtn.disabled = true;
            nameInput.readOnly = true;
            showAlert('此配置文件已被锁定，只能查看。如需修改，请先解锁。', 'info', 'viewConfigAlertContainer');
        } else {
            saveBtn.disabled = false;
            nameInput.readOnly = false;
            const alertContainer = document.getElementById('viewConfigAlertContainer');
            if (alertContainer) alertContainer.innerHTML = '';
        }
        viewConfigModalInstance.show();
        await loadConfigHistory(config.file_name);
    } catch (error) {
        showAlert('加载配置文件详情失败: ' + error.message, 'danger');
    }
}
function renderLinkedPointsTable(points) {
    const tbody = document.getElementById('linkedPointsTableBody');
    if (!tbody) return;
    if (points.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">没有关联的数据点位</td></tr>';
        return;
    }
    tbody.innerHTML = points.map(point => `
        <tr>
            <td>${escapeHtml(point.measurement)}</td>
            <td>${escapeHtml(point.original_point_name)}</td>
            <td>${escapeHtml(point.normalized_point_name)}</td>
            <td>${escapeHtml(point.point_comment)}</td>
        </tr>
    `).join('');
}
function renderEditablePreview(content) {
    const tagsContainer = document.getElementById('edit-section-tags');
    const contentContainer = document.getElementById('edit-content-area');
    tagsContainer.innerHTML = '';
    contentContainer.innerHTML = '';

    const sectionRegex = /^	*(\[\[?[\w\.:_]+\]\]?)/gm;
    const parts = content.split(sectionRegex);
    let sections = [];

    if (parts.length <= 1) {
        if (content.trim()) {
            sections.push({ header: '(Global Settings)', content: content.trim() });
        }
    } else {
        if (parts[0] && parts[0].trim()) {
            sections.push({ header: '(Global Settings)', content: parts[0].trim() });
        }

        for (let i = 1; i < parts.length; i += 2) {
            const header = parts[i];
            const sectionContent = (parts[i+1] || '').trim();
            
            const isArray = header.startsWith('[[');
            const level = header.split('.').length;

            let isMainHeader = false;
            if (isArray && level <= 2) isMainHeader = true;
            if (!isArray && level <= 1) isMainHeader = true;

            if (isMainHeader) {
                sections.push({ header: header, content: sectionContent });
            } else {
                if (sections.length > 0) {
                    const lastSection = sections[sections.length - 1];
                    lastSection.content += `\n\n${header}\n${sectionContent}`;
                } else {
                    sections.push({ header: header, content: sectionContent });
                }
            }
        }
    }

    const accordion = document.createElement('div');
    accordion.className = 'accordion';
    accordion.id = 'editAccordion';

    sections.forEach((section, index) => {
        const sectionId = `edit-section-${index}`;
        const headerId = `edit-header-${index}`;
        const cleanHeader = escapeHtml(section.header.replace(/[()[\]]/g, ''));
        
        const tag = document.createElement('a');
        tag.href = `#${sectionId}`;
        tag.className = 'btn btn-sm btn-outline-secondary';
        tag.textContent = cleanHeader;
        tag.onclick = (e) => {
            e.preventDefault();
            const targetEl = document.getElementById(sectionId);
            if (targetEl) {
                const collapseEl = new bootstrap.Collapse(targetEl, { toggle: false });
                collapseEl.show();
                setTimeout(() => document.getElementById(headerId).scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
            }
        };
        tagsContainer.appendChild(tag);

        const accordionItem = document.createElement('div');
        accordionItem.className = 'accordion-item';
        accordionItem.innerHTML = `
            <h2 class="accordion-header" id="${headerId}">
                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#${sectionId}">
                    <span class="section-header-text">${escapeHtml(section.header)}</span>
                </button>
            </h2>
            <div id="${sectionId}" class="accordion-collapse collapse" data-bs-parent="#editAccordion">
                <div class="accordion-body">
                    <textarea class="form-control snippet-content" rows="10">${escapeHtml(section.content)}</textarea>
                </div>
            </div>`;
        accordion.appendChild(accordionItem);
    });

    contentContainer.appendChild(accordion);
}
async function loadConfigHistory(fileName) {
    try {
        const response = await ApiClient.get(`/api/config_files/${encodeURIComponent(fileName)}/versions`);
        const versions = response.versions || [];
        const historyBody = document.getElementById('configHistoryBody');
        if (!historyBody) return;
        if (versions.length === 0) {
            historyBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">无历史版本</td></tr>';
            return;
        }
        historyBody.innerHTML = versions.map(version => `<tr><td>v${version.version}</td><td><span class="badge ${version.is_active ? 'bg-success' : 'bg-secondary'}">${version.is_active ? '激活' : '历史'}</span></td><td>${getChangeTypeText(version.change_type)}</td><td>${formatDateTime(version.created_at)}</td><td>${escapeHtml(version.change_description || '')}</td><td><div class="btn-group btn-group-sm">${!version.is_active ? `<button class="btn btn-outline-success btn-sm" onclick="confirmActivateVersion(${version.id})" title="激活此版本"><i class="bi bi-check-circle"></i></button>` : ''}<button class="btn btn-outline-info btn-sm" onclick="viewConfigDiff(${version.id})" title="查看差异"><i class="bi bi-file-diff"></i></button></div></td></tr>`).join('');
    } catch (error) {
        showAlert('加载版本历史失败: ' + error.message, 'danger');
    }
}
function confirmActivateVersion(configId) {
    confirmAction('确定要激活这个版本吗？这将替换当前激活的版本。', () => activateConfigVersion(configId));
}
async function activateConfigVersion(configId) {
    try {
        await ApiClient.post(`/api/config_files/${configId}/activate`);
        showAlert('版本激活成功', 'success');
        loadConfigs();
        const currentFileName = document.getElementById('viewConfigName').value;
        if (currentFileName) await loadConfigHistory(currentFileName);
    } catch (error) {
        showAlert('激活版本失败: ' + error.message, 'danger');
    }
}
async function viewConfigDiff(versionId) {
    if (!diffModalInstance) diffModalInstance = new bootstrap.Modal(document.getElementById('diffModal'));
    document.getElementById('diffContent').innerHTML = `<div class="alert alert-info"><i class="bi bi-info-circle"></i> 配置差异对比功能正在开发中...<br>版本ID: ${versionId}</div>`;
    diffModalInstance.show();
}
async function updateConfig() {
    const updateBtn = document.getElementById('updateConfigBtn');
    const originalBtnHtml = updateBtn.innerHTML;
    updateBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 保存中...';
    updateBtn.disabled = true;

    try {
        const id = document.getElementById('viewConfigId').value;
        const name = document.getElementById('viewConfigName').value;
        let newContent = '';
        document.querySelectorAll('#edit-content-area .accordion-item').forEach(item => {
            const headerText = item.querySelector('.section-header-text').textContent;
            const snippetContent = item.querySelector('.snippet-content').value;
            if (headerText === '(Global Settings)') {
                newContent += snippetContent + '\n\n';
            } else {
                newContent += headerText + '\n' + snippetContent + '\n\n';
            }
        });
        const content = newContent.trim();

        // Step 1: Save the configuration first
        await ApiClient.put(`/api/config_files/${id}`, { name, content });
        showAlert('配置已成功保存。正在后台进行验证...', 'info');
        viewConfigModalInstance.hide();
        loadConfigs(); // Reload the main table to reflect potential name changes

        // Step 2: Validate in the background
        const validationResult = await ApiClient.post('/api/telegraf/validate', { content });

        if (!validationResult.is_valid) {
            const errorType = validationResult.error_type === 'syntax' ? '配置语法错误' : '插件或连接错误';
            const alertType = validationResult.error_type === 'syntax' ? 'danger' : 'warning';
            const alertMessage = `
                <strong>配置 “${escapeHtml(name)}” 保存成功，但验证发现问题。</strong>
                <p class="mt-2"><strong>错误类型:</strong> ${errorType}</p>
                <div class="mt-1"><strong>详细信息:</strong>
                    <pre class="bg-light p-2 rounded-2 mt-1 mb-0"><code>${escapeHtml(validationResult.error)}</code></pre>
                </div>
            `;
            showHtmlAlert(alertMessage, alertType, 'alertPlaceholder', 15000); // Show for 15 seconds
        } else {
            showAlert(`配置 “${escapeHtml(name)}” 保存并验证通过。`, 'success');
        }

    } catch (error) {
        const errorMsg = '操作失败: ' + error.message;
        showAlert(errorMsg, 'danger', 'viewConfigAlertContainer');
        showAlert(errorMsg, 'danger', 'viewConfigAlertContainerFooter');
    } finally {
        updateBtn.innerHTML = originalBtnHtml;
        updateBtn.disabled = false;
    }
}

function downloadConfig() {
    try {
        const nameInput = document.getElementById('viewConfigName');
        const filename = nameInput.value || 'telegraf.conf';

        let content = '';
        document.querySelectorAll('#edit-content-area .accordion-item').forEach(item => {
            content += item.querySelector('.section-header-text').textContent + '\n' + item.querySelector('.snippet-content').value + '\n\n';
        });
        
        downloadFile(content.trim(), filename, 'text/plain');
    } catch (error) {
        showAlert('下载文件时出错: ' + error.message, 'danger');
    }
}

async function toggleLockConfig(id) {
    try {
        const response = await ApiClient.post(`/api/config_files/${id}/toggle_lock`);
        showAlert(response.message, 'success');
        loadConfigs(); // Reload to reflect the change
    } catch (error) {
        showAlert('切换锁定状态失败: ' + error.message, 'danger');
    }
}

function confirmDeleteConfig(configId) {
    const config = configsDataTable.row($(`button[onclick="confirmDeleteConfig(${configId})"]`).closest('tr')).data();
    if (!config) return;
    confirmAction(`确定要删除配置文件 "${config.file_name}" 及其所有版本吗？此操作不可撤销！`, () => deleteConfig(configId));
}
async function deleteConfig(configId) {
    try {
        await ApiClient.delete(`/api/config_files/${configId}`);
        showAlert('配置文件及其所有版本删除成功', 'success');
        loadConfigs();
    } catch (error) {
        showAlert('删除配置文件失败: ' + error.message, 'danger');
    }
}

async function startProcessFromConfig(configId) {
    if (!confirm(`确定要为该配置文件启动一个新的 Telegraf 进程吗？`)) return;

    try {
        await ApiClient.post('/api/processes/start', { config_id: configId });
        showAlert('启动进程的请求已发送。', 'success');
        // Give a moment for the process to potentially start before reloading
        setTimeout(() => loadConfigs(), 1000);
    } catch (error) {
        showAlert(`启动进程失败: ${error.message}`, 'danger');
    }
}

async function showDataSnapshot(configId) {
    if (!dataSnapshotModalInstance) {
        const snapshotModal = document.getElementById('dataSnapshotModal');
        if (snapshotModal) dataSnapshotModalInstance = new bootstrap.Modal(snapshotModal);
        else return showAlert('数据快照模态框未找到!', 'danger');
    }

    const modalBody = document.getElementById('dataSnapshotBody');
    modalBody.innerHTML = '<div class="text-center p-5"><span class="spinner-border"></span><p class="mt-2">正在生成快照，这可能需要一点时间...</p></div>';
    dataSnapshotModalInstance.show();

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
                    <td>${formatDateTime(new Date(metric.timestamp).toISOString())}</td>
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
