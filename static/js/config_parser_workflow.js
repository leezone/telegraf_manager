/**
 * 配置文件管理 - 解析与组件化工作流
 * 此文件由主页面按需懒加载
 */

// --- 全局变量和模态框实例 ---
let snippetsCache = [];
let pointsToImportCache = [];
let currentConfigIdForWorkflow = null;

let parsePreviewModalInstance = null;
let snippetContentModalInstance = null;
let saveSnippetsModalInstance = null;

const componentTypeMap = {
    data_source: ['input', 'output'],
    global_parameter: ['agent', 'global_tags'],
    processing_transformation: ['aggregator', 'processor']
};

const componentTypeChineseMap = {
    data_source: '数据源',
    global_parameter: '全局参数',
    processing_transformation: '处理转换配置'
};

/**
 * 初始化工作流并开始解析
 * @param {number} configId - The ID of the configuration file.
 * @param {object} configs - The global configs array from config-main.js
 */
function initializeAndStartParsing(configId) {
    // 初始化模态框实例 (如果尚未初始化)
    if (!parsePreviewModalInstance) {
        const parsePreviewModal = document.getElementById('parsePreviewModal');
        if (parsePreviewModal) {
            parsePreviewModalInstance = new bootstrap.Modal(parsePreviewModal);
            const tabs = parsePreviewModal.querySelectorAll('button[data-bs-toggle="tab"]');
            tabs.forEach(tab => tab.addEventListener('shown.bs.tab', updateParsePreviewFooter));
        }
    }
    if (!snippetContentModalInstance) {
        const snippetContentModal = document.getElementById('snippetContentModal');
        if (snippetContentModal) snippetContentModalInstance = new bootstrap.Modal(snippetContentModal);
    }
    if (!saveSnippetsModalInstance) {
        const saveSnippetsModal = document.getElementById('saveSnippetsModal');
        if (saveSnippetsModal) saveSnippetsModalInstance = new bootstrap.Modal(saveSnippetsModal);
    }

    startParseAndPreview(configId);
}

// 1. 开始解析和预览流程
async function startParseAndPreview(configId) {
    if (!parsePreviewModalInstance) return showAlert('解析模态框未初始化!', 'danger');
    currentConfigIdForWorkflow = configId;
    
    // Show modal immediately with loading state
    document.getElementById('parsePreviewModalLabel').textContent = `解析结果 (ID: ${configId})`;
    const pointsBody = document.getElementById('pointsPreviewTableBody');
    const snippetsBody = document.getElementById('snippetsPreviewTableBody');
    pointsBody.innerHTML = '<tr><td colspan="3" class="text-center"><span class="spinner-border spinner-border-sm"></span> 正在加载配置...</td></tr>';
    snippetsBody.innerHTML = '<tr><td colspan="4" class="text-center"><span class="spinner-border spinner-border-sm"></span> 正在加载配置...</td></tr>';
    parsePreviewModalInstance.show();

    try {
        // Fetch the config details first
        const config = await ApiClient.get(`/api/config_files/${configId}`);
        if (!config) throw new Error('无法加载配置文件详情。');

        document.getElementById('parsePreviewModalLabel').textContent = `解析结果: ${escapeHtml(config.file_name)}`;
        pointsBody.innerHTML = '<tr><td colspan="3" class="text-center"><span class="spinner-border spinner-border-sm"></span> 正在解析...</td></tr>';
        snippetsBody.innerHTML = '<tr><td colspan="4" class="text-center"><span class="spinner-border spinner-border-sm"></span> 正在解析...</td></tr>';

        const triggerTab = document.querySelector('#snippets-preview-tab');
        if (triggerTab) new bootstrap.Tab(triggerTab).show();
        updateParsePreviewFooter();

        const response = await ApiClient.post(`/api/config_files/${configId}/parse_and_preview`);
        pointsToImportCache = response.point_previews || [];
        snippetsCache = response.snippets || [];
        renderPointsPreviewTable(pointsToImportCache);
        renderSnippetsPreviewTable(snippetsCache);
        updateParsePreviewFooter();
    } catch (error) {
        const errorMsg = `解析失败: ${error.message}`;
        showAlert(errorMsg, 'danger', 'parse-preview-alert-container');
        pointsBody.innerHTML = `<tr><td colspan="3" class="text-center text-danger">${errorMsg}</td></tr>`;
        snippetsBody.innerHTML = `<tr><td colspan="4" class="text-center text-danger">${errorMsg}</td></tr>`;
    }
}

// 2. 渲染数据点预览表格
function renderPointsPreviewTable(points) {
    const pointsBody = document.getElementById('pointsPreviewTableBody');
    document.getElementById('points-preview-count').textContent = points.length;
    if (points.length > 0) {
        pointsBody.innerHTML = points.map(p => `<tr><td>${escapeHtml(p.measurement)}</td><td>${escapeHtml(p.original_point_name)}</td><td>${escapeHtml(p.point_comment)}</td></tr>`).join('');
    } else {
        pointsBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">当前无待导入的数据点。</td></tr>';
    }
}

// 3. 渲染配置片段预览表格
function renderSnippetsPreviewTable(snippets) {
    const snippetsBody = document.getElementById('snippetsPreviewTableBody');
    const tableHeaders = document.querySelector('#snippets-preview-panel thead tr');
    document.getElementById('snippets-preview-count').textContent = snippets.length;

    tableHeaders.innerHTML = `
        <th style="width: 5%;"><input class="form-check-input" type="checkbox" id="selectAllSnippets"></th>
        <th>类型</th>
        <th>内容预览</th>
        <th style="width: 15%;">操作</th>
    `;

    if (snippets.length > 0) {
        snippetsBody.innerHTML = snippets.map((s, index) => `
            <tr data-snippet-index="${index}">
                <td><input class="form-check-input snippet-checkbox" type="checkbox" value="${index}"></td>
                <td><span class="badge bg-secondary">${escapeHtml(s.snippet_type)}</span><br><small class="text-muted">${escapeHtml(s.plugin_name || '-')}</small></td>
                <td><pre class="mb-0 bg-light p-1 rounded" style="white-space: pre-wrap; max-width: 400px; overflow-x: auto; font-size: 0.8em;"><code>${escapeHtml(s.content.substring(0, 150))}...</code></pre></td>
                <td>
                    <div class="btn-group-vertical btn-group-sm w-100">
                        <button class="btn btn-outline-secondary" onclick='showFullSnippetContent(${index})'>
                            <i class="bi bi-search me-1"></i>查看内容
                        </button>
                        <button class="btn btn-outline-primary mt-1" onclick='launchTomlExtractorWizard(${index})'>
                            <i class="bi bi-magic me-1"></i>提取数据点位
                        </button>
                    </div>
                </td>
            </tr>`).join('');
        document.getElementById('selectAllSnippets').onchange = (e) => document.querySelectorAll('.snippet-checkbox').forEach(cb => cb.checked = e.target.checked);
    } else {
        snippetsBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">未解析出配置片段。</td></tr>';
    }
}

// 4. 更新解析预览模态框的页脚按钮
function updateParsePreviewFooter() {
    const footerBtn = document.getElementById('parsePreviewFooterBtn');
    if (!footerBtn) return;
    const snippetsTab = document.getElementById('snippets-preview-tab');
    if (snippetsTab && snippetsTab.classList.contains('active')) {
        footerBtn.style.display = 'inline-block';
        footerBtn.innerHTML = '<i class="bi bi-save me-2"></i>保存选中片段为组件';
        footerBtn.onclick = prepareSaveSnippets;
        footerBtn.disabled = snippetsCache.length === 0;
    } else {
        // When on the points preview tab, hide the button as requested
        footerBtn.style.display = 'none';
    }
}

// 5. 显示完整的片段内容
function showFullSnippetContent(index) {
    const snippet = snippetsCache[index];
    if (!snippet || !snippetContentModalInstance) return;
    document.getElementById('fullSnippetContent').textContent = snippet.content;
    snippetContentModalInstance.show();
}

// --- 保存片段为组件 (功能区) ---

/**
 * 检查片段是否包含子表（即，层级大于主标题的标题）
 * @param {string} content - 片段的TOML内容
 * @returns {boolean}
 */
function snippetHasSubTables(content) {
    const lines = content.split('\n');
    const firstHeaderLine = lines.find(line => line.trim().startsWith('['));
    if (!firstHeaderLine) return false;

    const mainSectionName = firstHeaderLine.trim().replace(/^\\\[+/, '').replace(/\\\]+$/, '');
    const mainLevel = mainSectionName.split('.').length;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']') && line !== firstHeaderLine) {
            const currentSectionName = trimmed.replace(/^\\\[+/, '').replace(/\\\]+$/, '');
            const currentLevel = currentSectionName.split('.').length;
            if (currentLevel > mainLevel) {
                return true; // 找到子表
            }
        }
    }
    return false;
}

/**
 * 过滤片段内容，只保留主（二级）片段
 * @param {string} content - 片段的TOML内容
 * @returns {string}
 */
function filterSnippetContent(content) {
    const lines = content.split('\n');
    const resultLines = [];
    let inSubSection = false;

    const firstHeaderLine = lines.find(line => line.trim().startsWith('['));
    if (!firstHeaderLine) return content;

    const mainSectionName = firstHeaderLine.trim().replace(/^\\\[+/, '').replace(/\\\]+$/, '');
    const mainLevel = mainSectionName.split('.').length;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            const currentSectionName = trimmed.replace(/^\\\[+/, '').replace(/\\\]+$/, '');
            const currentLevel = currentSectionName.split('.').length;

            if (currentLevel > mainLevel) {
                inSubSection = true;
            } else {
                if (line !== firstHeaderLine) {
                    break;
                }
                inSubSection = false;
            }
        }

        if (!inSubSection) {
            resultLines.push(line);
        }
    }
    return resultLines.join('\n');
}


// 6. 准备保存片段为组件
function prepareSaveSnippets() {
    const selectedIndices = Array.from(document.querySelectorAll('.snippet-checkbox:checked')).map(cb => parseInt(cb.value));
    if (selectedIndices.length === 0) return showAlert('请至少选择一个要保存的配置片段。', 'warning', 'parse-preview-alert-container');

    const formContainer = document.getElementById('saveSnippetsForm');
    formContainer.innerHTML = '';
    selectedIndices.forEach(index => {
        const snippet = snippetsCache[index];
        const formId = `snippet-form-${index}`;
        const defaultName = `${snippet.snippet_type}_${snippet.plugin_name || 'general'}_${Date.now()}`.replace(/\./g, '_');
        
        const hasSubTables = snippetHasSubTables(snippet.content);
        const filterCheckboxHtml = hasSubTables ? `
            <div class="form-check mt-2">
              <input class="form-check-input extract-level2-only" type="checkbox" id="filter-${formId}">
              <label class="form-check-label" for="filter-${formId}">
                仅提取二级片段 (过滤掉 .group, .nodes 等子片段)
              </label>
            </div>
        ` : '';

        const formHtml = `
            <div class="card mb-3" id="${formId}" data-snippet-index="${index}">
                <div class="card-header">${escapeHtml(snippet.plugin_name || snippet.snippet_type)}</div>
                <div class="card-body">
                    <pre class="bg-light p-2 rounded small"><code>${escapeHtml(snippet.content)}</code></pre>
                    <div class="row mt-3">
                        <div class="col-md-12 mb-2"><label for="name-${formId}" class="form-label">新组件名称 <span class="text-danger">*</span></label><input type="text" id="name-${formId}" class="form-control snippet-name-input" value="${defaultName}" required></div>
                        <div class="col-md-6"><label for="l1-type-${formId}" class="form-label">一级分类</label><select id="l1-type-${formId}" class="form-select level1-type-input" onchange="updateLevel2Options(this)">${Object.keys(componentTypeMap).map(k => `<option value="${k}">${componentTypeChineseMap[k] || k}</option>`).join('')}</select></div>
                        <div class="col-md-6"><label for="l2-type-${formId}" class="form-label">二级分类</label><select id="l2-type-${formId}" class="form-select level2-type-input"></select></div>
                    </div>
                    ${filterCheckboxHtml}
                </div>
            </div>`;
        formContainer.insertAdjacentHTML('beforeend', formHtml);
        updateLevel2Options(document.getElementById(`l1-type-${formId}`));
    });
    saveSnippetsModalInstance.show();
}

// 7. 更新二级分类下拉框
function updateLevel2Options(level1Select) {
    const level2Select = level1Select.closest('.row').querySelector('.level2-type-input');
    const selectedLevel1 = level1Select.value;
    const options = componentTypeMap[selectedLevel1] || [];
    level2Select.innerHTML = options.map(opt => `<option value="${opt}">${opt}</option>`).join('');
}

// 8. 执行保存片段为组件
async function executeSaveSnippets() {
    const form = document.getElementById('saveSnippetsForm');
    const snippetForms = form.querySelectorAll('.card');
    const snippetsToSave = [];
    let isValid = true;
    snippetForms.forEach(card => {
        const nameInput = card.querySelector('.snippet-name-input');
        if (!nameInput.value.trim()) {
            nameInput.classList.add('is-invalid');
            isValid = false;
        }
        const index = parseInt(card.dataset.snippetIndex);
        const filterCheckbox = card.querySelector('.extract-level2-only');
        const shouldFilter = filterCheckbox ? filterCheckbox.checked : false;
        
        let contentToSave = snippetsCache[index].content;
        if (shouldFilter) {
            contentToSave = filterSnippetContent(contentToSave);
        }

        snippetsToSave.push({
            name: nameInput.value.trim(),
            content: contentToSave,
            level1_type: card.querySelector('.level1-type-input').value,
            level2_type: card.querySelector('.level2-type-input').value
        });
    });

    if (!isValid) return showAlert('请为所有选中的组件提供名称。', 'danger', 'save-snippets-alert-container');

    try {
        const response = await ApiClient.post('/api/components/create_from_snippets', { snippets: snippetsToSave });
        showAlert(response.message || '组件保存成功！', 'success');
        if (response.errors && response.errors.length > 0) showAlert(`部分组件保存失败: ${response.errors.join(', ')}`, 'warning');
        saveSnippetsModalInstance.hide();
        parsePreviewModalInstance.hide();
    } catch (error) {
        showAlert(`保存失败: ${error.message}`, 'danger', 'save-snippets-alert-container');
    }
}

// 9. 确认从主文件或向导导入数据点
async function confirmPointImport() {
    if (!currentConfigIdForWorkflow || pointsToImportCache.length === 0) return showAlert('没有可导入的数据点或未指定配置文件。', 'warning', 'parse-preview-alert-container');
    const confirmBtn = document.getElementById('parsePreviewFooterBtn');
    const originalBtnHtml = confirmBtn.innerHTML;
    confirmBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 正在导入...';
    confirmBtn.disabled = true;
    try {
        await ApiClient.post(`/api/config_files/${currentConfigIdForWorkflow}/import_points`, { points: pointsToImportCache });
        showAlert('数据点导入成功!', 'success');
        parsePreviewModalInstance.hide();
        if (window.loadConfigs) window.loadConfigs();
    } catch (error) {
        showAlert('导入数据点失败: ' + error.message, 'danger', 'parse-preview-alert-container');
    } finally {
        confirmBtn.innerHTML = originalBtnHtml;
        confirmBtn.disabled = false;
        pointsToImportCache = [];
        currentConfigIdForWorkflow = null;
    }
}

// 10. 懒加载并启动交互式提取向导
function launchTomlExtractorWizard(snippetIndex) {
    const snippet = snippetsCache[snippetIndex];
    if (!snippet) return;

    const scriptPath = '/static/js/toml_extractor_wizard.js';
    
    const successCallback = () => {
        // The wizard now handles its own import. This callback is just for post-import actions.
        showAlert('点位提取与导入成功！', 'success');
        parsePreviewModalInstance.hide(); // Close the parent modal
        if (window.loadConfigs) {
            window.loadConfigs(); // Refresh the main config file list
        }
    };

    if (window.isTomlWizardScriptLoaded) {
        window.initializeTomlExtractorWizard(snippet.content, successCallback, currentConfigIdForWorkflow);
    } else {
        const script = document.createElement('script');
        script.src = scriptPath;
        script.onload = () => {
            window.isTomlWizardScriptLoaded = true;
            window.initializeTomlExtractorWizard(snippet.content, successCallback, currentConfigIdForWorkflow);
        };
        script.onerror = () => showAlert('加载交互式提取向导失败。', 'danger');
        document.body.appendChild(script);
    }
}

// Expose the entry point function to the global scope
window.initializeParserAndShowModal = initializeAndStartParsing;