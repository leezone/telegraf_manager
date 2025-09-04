/**
 * 配置文件管理 - 文件目录管理功能
 * 包含：目录设置、文件扫描、批量导入等功能
 */

// 模态框实例
let configDirectoryModalInstance = null;

// 打开配置文件目录管理模态框
async function openConfigDirectoryModal() {
    if (!configDirectoryModalInstance) {
        configDirectoryModalInstance = ModalManager.getModal('configDirectoryModal');
    }
    
    if (!configDirectoryModalInstance) {
        console.error('配置文件目录管理模态框未找到');
        return;
    }
    
    try {
        // 加载当前目录设置
        const settings = await ApiClient.get('/api/config_files/directory_settings');
        
        // 填充表单
        document.getElementById('configDirPath').value = settings.directory_path || '/etc/telegraf/';
        document.getElementById('configFileFilter').value = settings.file_filter || '.conf';
        
        configDirectoryModalInstance.show();
        
        // 加载目录文件列表
        await loadDirectoryFiles();
        
    } catch (error) {
        console.error('加载目录设置失败:', error);
        showAlert('加载目录设置失败: ' + error.message, 'danger', 'configDirectoryAlertContainer');
    }
}

// 保存配置文件目录设置
async function saveDirectorySettings() {
    try {
        const directoryPath = FormValidator.validateRequired(
            document.getElementById('configDirPath').value,
            '目录路径'
        );
        const fileFilter = document.getElementById('configFileFilter').value || '.conf';
        
        await ApiClient.post('/api/config_files/directory_settings', {
            directory_path: directoryPath,
            file_filter: fileFilter
        });
        
        showAlert('目录设置保存成功', 'success', 'configDirectoryAlertContainer');
        
        // 重新加载文件列表
        await loadDirectoryFiles();
        
    } catch (error) {
        console.error('保存目录设置失败:', error);
        showAlert('保存目录设置失败: ' + error.message, 'danger', 'configDirectoryAlertContainer');
    }
}

// 加载指定目录下的文件列表
async function loadDirectoryFiles() {
    const tbody = document.getElementById('directoryFilesBody');
    if (!tbody) return;
    
    try {
        const directoryPath = document.getElementById('configDirPath').value;
        const fileFilter = document.getElementById('configFileFilter').value;
        
        if (!directoryPath) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">请先设置目录路径</td></tr>';
            return;
        }
        
        const data = await ApiClient.post('/api/config_files/list_directory', {
            directory_path: directoryPath,
            file_filter: fileFilter
        });
        
        if (data.files && data.files.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">目录中没有找到匹配的文件</td></tr>';
            return;
        }
        
        tbody.innerHTML = data.files.map(file => `
            <tr>
                <td>
                    <strong>${escapeHtml(file.name)}</strong>
                    <br>
                    <small class="text-muted">${escapeHtml(file.path)}</small>
                </td>
                <td>${formatFileSize(file.size)}</td>
                <td>
                    <small class="text-monospace">${escapeHtml(file.hash.substring(0, 8))}...</small>
                </td>
                <td>
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-primary btn-sm" 
                                onclick="importFileFromDirectory('${escapeJsStringLiteral(file.path)}', '${escapeJsStringLiteral(file.name)}')"
                                title="导入此文件">
                            <i class="bi bi-upload"></i> 导入
                        </button>
                        <button class="btn btn-outline-info btn-sm" 
                                onclick="previewDirectoryFile('${escapeJsStringLiteral(file.path)}')"
                                title="预览文件内容">
                            <i class="bi bi-eye"></i> 预览
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
        
    } catch (error) {
        console.error('加载目录文件失败:', error);
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-danger">加载文件失败: ${escapeHtml(error.message)}</td></tr>`;
        showAlert('加载目录文件失败: ' + error.message, 'danger', 'configDirectoryAlertContainer');
    }
}

// 从目录导入单个文件到数据库
async function importFileFromDirectory(filePath, fileName, forceOverwrite = false) {
    try {
        const response = await ApiClient.post('/api/config_files/import_from_directory', {
            file_path: filePath,
            file_name: fileName,
            force_overwrite: forceOverwrite
        });

        if (response.error === 'Conflict') {
            const conflictModal = ModalManager.getModal('importConflictModal');
            document.getElementById('conflictFileName').textContent = fileName;
            document.getElementById('conflictExistingHash').textContent = response.existing_config.content_hash;
            document.getElementById('conflictNewHash').textContent = response.new_config_hash;
            document.getElementById('conflictIsRunning').textContent = response.existing_config.is_running ? '是' : '否';
            
            const confirmBtn = document.getElementById('confirmOverwriteBtn');
            confirmBtn.onclick = async () => {
                conflictModal.hide();
                await importFileFromDirectory(filePath, fileName, true);
            };
            conflictModal.show();
            return;
        } else if (response.message && response.message.includes('内容无变化')) {
            showAlert(`文件 ${fileName} 内容无变化，已跳过导入。`, 'info', 'configDirectoryAlertContainer');
        } else {
            showAlert(`文件 ${fileName} 导入成功！`, 'success', 'configDirectoryAlertContainer');
        }

        if (typeof loadConfigs === 'function') {
            await loadConfigs();
        }
        
    } catch (error) {
        console.error('导入文件失败:', error);
        showAlert('导入文件失败: ' + error.message, 'danger', 'configDirectoryAlertContainer');
    }
}

// 批量导入目录中的所有文件到数据库
async function importAllFilesFromDirectory(forceOverwrite = false) {
    try {
        const directoryPath = FormValidator.validateRequired(
            document.getElementById('configDirPath').value,
            '目录路径'
        );
        const fileFilter = document.getElementById('configFileFilter').value;

        if (!forceOverwrite) {
            const confirmed = confirm(
                `确定要导入目录 "${directoryPath}" 下所有匹配的文件吗？这将创建或更新数据库中的配置文件。`
            );
            if (!confirmed) return;
        }

        const data = await ApiClient.post('/api/config_files/import_all_from_directory', {
            directory_path: directoryPath,
            file_filter: fileFilter,
            force_overwrite: forceOverwrite
        });

        let summary = [];
        if (data.imported_count > 0) summary.push(`成功导入 ${data.imported_count} 个新版本`);
        if (data.skipped_count > 0) summary.push(`跳过 ${data.skipped_count} 个未变化的文件`);
        let message = summary.join('，') + '。';

        if (data.errors && data.errors.length > 0) {
            const errorDetails = data.errors.map(e => `- ${e.file}: ${e.error}`).join('\n');
            const errorMessage = `有 ${data.errors.length} 个文件导入失败。\n\n错误详情:\n${errorDetails}`;
            showAlert(errorMessage, 'warning', 'configDirectoryAlertContainer');
        }

        if (data.conflicts && data.conflicts.length > 0) {
            let conflictMessage = `有 ${data.conflicts.length} 个文件存在冲突，未导入。`;
            conflictMessage += `\n冲突文件：\n` + data.conflicts.map(c => `- ${c.file} (正在运行: ${c.existing_config.is_running ? '是' : '否'}, ...)`).join('\n');
            conflictMessage += `\n是否强制覆盖所有冲突文件？`;

            const confirmedOverwriteAll = confirm(conflictMessage);
            if (confirmedOverwriteAll) {
                await importAllFilesFromDirectory(true);
                return;
            }
        }

        if (summary.length > 0 && data.errors.length === 0 && data.conflicts.length === 0) {
            showAlert(message, 'success', 'configDirectoryAlertContainer');
        }

        if (typeof loadConfigs === 'function') {
            await loadConfigs();
        }
        await loadDirectoryFiles();

    } catch (error) {
        console.error('批量导入文件失败:', error);
        showAlert('批量导入文件失败: ' + error.message, 'danger', 'configDirectoryAlertContainer');
    }
}


// 预览目录中的文件内容
async function previewDirectoryFile(filePath) {
    const modalEl = document.getElementById('filePreviewModal');
    if (!modalEl) {
        console.error('File preview modal element not found.');
        return;
    }
    const previewModal = bootstrap.Modal.getOrCreateInstance(modalEl);
    const titleEl = document.getElementById('filePreviewModalLabel');
    const tagsContainer = document.getElementById('preview-section-tags');
    const contentContainer = document.getElementById('preview-content-area');

    // Reset and show loading state
    titleEl.textContent = `文件预览: ${escapeHtml(filePath.split('/').pop())}`;
    tagsContainer.innerHTML = '';
    contentContainer.innerHTML = '<div class="text-center"><div class="spinner-border"></div></div>';
    previewModal.show();

    try {
        const response = await ApiClient.post('/api/config_files/preview_file', { file_path: filePath });
        renderFilePreview(response.content);
    } catch (error) {
        contentContainer.innerHTML = `<div class="alert alert-danger">加载文件内容失败: ${error.message}</div>`;
    }
}

function renderFilePreview(content) {
    const tagsContainer = document.getElementById('preview-section-tags');
    const contentContainer = document.getElementById('preview-content-area');
    tagsContainer.innerHTML = '';
    contentContainer.innerHTML = '';

    // Regex to find [section] or [[section]] headers
    const sectionRegex = /^\s*(\[\[?[\w\.:_]+\]\]?)/gm;
    const snippets = content.split(sectionRegex);
    
    let sections = [];
    for (let i = 1; i < snippets.length; i += 2) {
        sections.push({
            header: snippets[i],
            content: (snippets[i+1] || '').trim()
        });
    }

    if (sections.length === 0 && content) { // Handle files with no sections
        sections.push({ header: '完整文件内容', content: content.trim() });
    }

    const accordion = document.createElement('div');
    accordion.className = 'accordion';
    accordion.id = 'previewAccordion';

    sections.forEach((section, index) => {
        const sectionId = `section-${index}`;
        const headerId = `header-${index}`;
        const cleanHeader = escapeHtml(section.header.replace(/[\[\]]/g, ''));

        // Create navigation tag
        const tag = document.createElement('a');
        tag.href = `#${sectionId}`;
        tag.className = 'btn btn-sm btn-outline-secondary';
        tag.textContent = cleanHeader;
        tag.onclick = (e) => {
            e.preventDefault();
            const targetEl = document.getElementById(sectionId);
            if (targetEl) {
                // Ensure the accordion item is shown before scrolling
                const collapseEl = new bootstrap.Collapse(targetEl, { toggle: false });
                collapseEl.show();
                setTimeout(() => targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
            }
        };
        tagsContainer.appendChild(tag);

        // Create accordion item
        const accordionItem = document.createElement('div');
        accordionItem.className = 'accordion-item';
        accordionItem.innerHTML = `
            <h2 class="accordion-header" id="${headerId}">
                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#${sectionId}">
                    ${escapeHtml(section.header)}
                </button>
            </h2>
            <div id="${sectionId}" class="accordion-collapse collapse" data-bs-parent="#previewAccordion">
                <div class="accordion-body">
                    <pre><code>${escapeHtml(section.content)}</code></pre>
                </div>
            </div>
        `;
        accordion.appendChild(accordionItem);
    });

    contentContainer.appendChild(accordion);
}

// 刷新目录文件列表
function refreshDirectoryFiles() {
    loadDirectoryFiles();
}

// 搜索目录文件
const searchDirectoryFiles = debounce(function(searchTerm) {
    const tbody = document.getElementById('directoryFilesBody');
    if (!tbody) return;
    
    const rows = tbody.querySelectorAll('tr');
    const term = searchTerm.toLowerCase();
    
    rows.forEach(row => {
        const fileName = row.querySelector('td:first-child strong')?.textContent?.toLowerCase() || '';
        const filePath = row.querySelector('td:first-child small')?.textContent?.toLowerCase() || '';
        
        if (fileName.includes(term) || filePath.includes(term)) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}, 300);

// 目录路径输入框失焦时自动加载文件列表
function onDirectoryPathChange() {
    const directoryPath = document.getElementById('configDirPath').value;
    if (directoryPath) {
        loadDirectoryFiles();
    }
}

// 文件过滤器输入框失焦时自动加载文件列表
function onFileFilterChange() {
    loadDirectoryFiles();
}