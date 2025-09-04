/**
 * "Generate Default Config Snippets" Modal Logic
 * Lazy-loaded by data_management.js
 */

(function() {
    let telegrafPlugins = {};
    let modalInstance = null;
    let configPreviewModal = null;
    let snippetsCache = []; // Cache for the generated snippets

    // --- Helper Functions ---
    function showAlert(message, type = 'info') {
        const placeholderId = 'alertPlaceholder';
        let alertPlaceholder = document.getElementById(placeholderId);
        if (!alertPlaceholder) {
            alertPlaceholder = document.createElement('div');
            alertPlaceholder.id = placeholderId;
            alertPlaceholder.style.position = 'fixed';
            alertPlaceholder.style.top = '1rem';
            alertPlaceholder.style.right = '1rem';
            alertPlaceholder.style.zIndex = '1060'; // Higher than modals
            document.body.appendChild(alertPlaceholder);
        }
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show" role="alert"><div>${escapeHtml(message)}</div><button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`;
        alertPlaceholder.append(wrapper);
        setTimeout(() => wrapper.querySelector('.alert')?.remove(), 5000);
    }

    function escapeHtml(unsafe) {
        return String(unsafe || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    /**
     * Splits a raw TOML string into structured snippet objects.
     * This logic is now on the frontend to bypass server-side caching issues.
     * @param {string} tomlString - The raw TOML configuration text.
     * @returns {Array<Object>}
     */
    function splitTomlSnippets(tomlString) {
        if (!tomlString) return [];

        // Regex to find main headers, which act as split points.
        // It matches [table] (level 1) and [[array.of.tables]] (level 2).
        const mainHeaderRegex = /^\s*(\[\[[^\]\.]+\.[^\]\.]+\]\]|\[[^\]\.]+\])/m;
        
        // Split the text by the main headers, keeping the headers as delimiters
        const parts = tomlString.split(mainHeaderRegex);

        const rawSnippets = [];
        for (let i = 1; i < parts.length; i += 2) {
            rawSnippets.push((parts[i] + parts[i + 1]).trim());
        }

        const processedSnippets = [];
        for (const content of rawSnippets) {
            if (!content) continue;

            const firstHeaderMatch = content.match(/^\s*\[{1,2}([^\]]+)\]{1,2}/);
            if (firstHeaderMatch) {
                const sectionName = firstHeaderMatch[1].trim();
                const parts = sectionName.split('.');
                const snippet_type = parts[0] || 'unknown';
                const plugin_name = parts.length > 1 ? parts.slice(1).join('.') : sectionName;

                processedSnippets.push({
                    snippet_type,
                    plugin_name,
                    content
                });
            }
        }
        return processedSnippets; // CORRECTED: Changed to camelCase
    }

    // --- API and Rendering Logic ---
    async function loadTelegrafPlugins() {
        const accordionContainer = document.getElementById('pluginAccordion');
        if (!accordionContainer) return;

        if (Object.keys(telegrafPlugins).length > 0) {
            renderPluginSelector(accordionContainer);
            return;
        }

        accordionContainer.innerHTML = '<div class="text-center p-5"><span class="spinner-border"></span> 加载插件列表中...</div>';

        try {
            const response = await fetch('/api/telegraf/plugins');
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`无法加载 Telegraf 插件列表: ${errorText}`);
            }
            
            telegrafPlugins = await response.json();
            renderPluginSelector(accordionContainer);
        } catch (error) {
            accordionContainer.innerHTML = `<div class="alert alert-danger m-3">${error.message}</div>`;
        }
    }

    function renderPluginSelector(container) {
        container.innerHTML = ''; // Clear spinner
        const pluginTypes = telegrafPlugins || {};
        
        let accordionHTML = '';
        const types = ['inputs', 'outputs', 'processors', 'aggregators'];

        types.forEach(type => {
            if (pluginTypes[type] && pluginTypes[type].length > 0) {
                const typeId = `collapse-${type}`;
                const headerId = `heading-${type}`;
                
                const optionsHtml = pluginTypes[type].map(plugin => `
                    <div class="col-md-3">
                        <div class="form-check">
                            <input class="form-check-input" type="checkbox" name="telegraf_plugins" value="${type}.${plugin}" id="plugin-${type}-${plugin}">
                            <label class="form-check-label" for="plugin-${type}-${plugin}">${plugin}</label>
                        </div>
                    </div>
                `).join('');

                accordionHTML += `
                    <div class="accordion-item">
                        <h2 class="accordion-header" id="${headerId}">
                            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#${typeId}" aria-expanded="false" aria-controls="${typeId}">
                                <strong class="text-capitalize">${type}</strong>&nbsp;(${pluginTypes[type].length} 个插件)
                            </button>
                        </h2>
                        <div id="${typeId}" class="accordion-collapse collapse" aria-labelledby="${headerId}" data-bs-parent="#pluginAccordion">
                            <div class="accordion-body">
                                <div class="row">
                                    ${optionsHtml}
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }
        });

        container.innerHTML = accordionHTML;
    }

    function getLevel1Type(level2_type) {
        if (level2_type === 'inputs' || level2_type === 'outputs') {
            return 'data_source';
        }
        if (level2_type === 'processors' || level2_type === 'aggregators') {
            return 'processing_transformation';
        }
        if (level2_type === 'agent' || level2_type === 'global_tags') {
            return 'global_parameter';
        }
        return 'unknown';
    }

    function renderPreview(snippets) {
        const snippetsContainer = document.getElementById('config-snippets-container');
        const selectAllCheckbox = document.getElementById('selectAllSnippetsCheckbox');
        snippetsContainer.innerHTML = ''; 
        snippetsCache = snippets; 

        if (!snippets || snippets.length === 0) {
            snippetsContainer.innerHTML = '<div class="col"><p class="text-muted">没有为所选插件生成配置片段。</p></div>';
            selectAllCheckbox.disabled = true;
            return;
        }
        selectAllCheckbox.disabled = false;
        selectAllCheckbox.checked = true; // Default to all selected

        const componentTypeOptions = `
            <option value="data_source">数据源</option>
            <option value="global_parameter">全局参数</option>
            <option value="processing_transformation">处理转换</option>
        `;

        snippets.forEach((snippet, index) => {
            const col = document.createElement('div');
            col.className = 'col-12 mb-3';
            const defaultName = `${snippet.snippet_type}_${snippet.plugin_name || 'general'}`.replace(/\./g, '_');
            const defaultLevel1Type = getLevel1Type(snippet.snippet_type);

            col.innerHTML = `
                <div class="card snippet-card">
                    <div class="card-header bg-light p-2">
                        <div class="form-check">
                            <input class="form-check-input snippet-checkbox" type="checkbox" value="${index}" id="snippet-check-${index}" checked>
                            <label class="form-check-label fw-bold" for="snippet-check-${index}">
                                ${escapeHtml(snippet.plugin_name || snippet.snippet_type)}
                            </label>
                        </div>
                    </div>
                    <div class="card-body p-2">
                        <div class="row">
                            <div class="col-md-8">
                                <label class="form-label small text-muted">配置内容</label>
                                <pre class="snippet-content bg-white p-2 rounded border" style="max-height: 200px; overflow-y: auto;"><code>${escapeHtml(snippet.content)}</code></pre>
                            </div>
                            <div class="col-md-4">
                                <div class="mb-2">
                                    <label for="snippet-name-${index}" class="form-label small text-muted">新组件名称</label>
                                    <input type="text" id="snippet-name-${index}" class="form-control form-control-sm snippet-name" value="${escapeHtml(defaultName)}">
                                </div>
                                <div class="mb-2">
                                    <label for="level1-type-${index}" class="form-label small text-muted">保存到</label>
                                    <select id="level1-type-${index}" class="form-select form-select-sm level1-type-selector">${componentTypeOptions}</select>
                                </div>
                                <div class="mb-2">
                                    <label class="form-label small text-muted">类型</label>
                                    <p class="form-control-plaintext form-control-sm p-0 m-0">
                                        <span class="badge bg-primary">${escapeHtml(snippet.snippet_type)}</span>
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            snippetsContainer.appendChild(col);
            // Set the default value for the new select dropdown
            document.getElementById(`level1-type-${index}`).value = defaultLevel1Type;
        });

        selectAllCheckbox.onchange = (e) => {
            document.querySelectorAll('.snippet-checkbox').forEach(cb => cb.checked = e.target.checked);
        };
    }

    function attachPreviewAndSaveListeners() {
        const generatePreviewBtn = document.getElementById('generatePreviewBtn');
        const saveSnippetsBtn = document.getElementById('saveConfigSnippetsBtn');

        generatePreviewBtn.addEventListener('click', async () => {
            const selectedPlugins = Array.from(document.querySelectorAll('#pluginAccordion .form-check-input:checked')).map(cb => cb.value);

            if (selectedPlugins.length === 0) {
                showAlert('请至少选择一个插件。', 'warning');
                return;
            }

            generatePreviewBtn.disabled = true;
            generatePreviewBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 生成中...';

            try {
                const response = await fetch('/api/telegraf/generate-sample', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ plugins: selectedPlugins })
                });

                const rawToml = await response.text();

                if (!response.ok) {
                    throw new Error(rawToml || '生成预览失败');
                }

                const snippets = splitTomlSnippets(rawToml);
                renderPreview(snippets);
                
                modalInstance.hide();
                configPreviewModal.show();

            } catch (error) {
                showAlert(error.message, 'danger');
            } finally {
                generatePreviewBtn.disabled = false;
                generatePreviewBtn.innerHTML = '生成预览';
            }
        });

        saveSnippetsBtn.addEventListener('click', async () => {
            const snippetsToSave = [];
            const selectedCheckboxes = document.querySelectorAll('.snippet-checkbox:checked');

            if (selectedCheckboxes.length === 0) {
                showAlert('请至少选择一个要保存的片段。', 'warning');
                return;
            }

            selectedCheckboxes.forEach(checkbox => {
                const index = parseInt(checkbox.value);
                const card = checkbox.closest('.snippet-card');
                const originalSnippet = snippetsCache[index];
                const name = card.querySelector('.snippet-name').value;
                const content = originalSnippet.content;
                const level1_type = card.querySelector('.level1-type-selector').value;
                const level2_type = originalSnippet.snippet_type;

                if (name && content && level1_type !== 'unknown') {
                    snippetsToSave.push({ name, content, level1_type, level2_type });
                }
            });

            if (snippetsToSave.length === 0) {
                showAlert('没有可保存的有效片段。', 'warning');
                return;
            }

            saveSnippetsBtn.disabled = true;
            saveSnippetsBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 保存中...';

            try {
                const response = await fetch('/api/components/create_from_snippets', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ snippets: snippetsToSave })
                });

                const result = await response.json();

                if (!response.ok || response.status === 207) {
                    let message = result.message || '部分或全部组件保存失败。';
                    if (result.data && result.data.errors && result.data.errors.length > 0) {
                        message += ' 详情: ' + result.data.errors.join(', ');
                    }
                    showAlert(message, response.ok ? 'warning' : 'danger');
                } else {
                    showAlert(result.message || '配置片段保存成功！', 'success');
                }

                configPreviewModal.hide();

            } catch (error) {
                showAlert(error.message, 'danger');
            } finally {
                saveSnippetsBtn.disabled = false;
                saveSnippetsBtn.innerHTML = '保存为可复用组件';
            }
        });
    }

    // --- Initialization ---
    function initializeModal() {
        const modalEl = document.getElementById('generateDefaultConfigModal');
        const previewModalEl = document.getElementById('configPreviewModal');
        if (!modalEl || !previewModalEl) return;

        modalInstance = new bootstrap.Modal(modalEl);
        configPreviewModal = new bootstrap.Modal(previewModalEl);
        
        modalEl.addEventListener('show.bs.modal', loadTelegrafPlugins);

        attachPreviewAndSaveListeners();

        modalInstance.show();
    }

    // Expose the initialization function to the global scope
    window.initializeDefaultConfigGenerator = initializeModal;
})();