/**
 * TOML 交互式提取向导
 * 由 config_parser_workflow.js 按需懒加载
 */

class TomlExtractorWizard {
    constructor() {
        this.modal = new bootstrap.Modal(document.getElementById('tomlExtractorWizardModal'));
        this.alertContainer = document.getElementById('toml-wizard-alert-container');
        this.treeContainer = document.getElementById('toml-structure-tree');
        this.selectedSourcesContainer = document.getElementById('toml-selected-sources');
        this.targetFieldsContainer = document.getElementById('target-point-info-fields');
        this.sourceFieldsContainer = document.getElementById('source-toml-fields');
        this.previewTableHead = document.getElementById('toml-preview-table-head');
        this.previewTableBody = document.getElementById('toml-preview-table-body');
        this.steps = document.querySelectorAll('#toml-wizard-steps .nav-link');
        this.stepPanels = document.querySelectorAll('#toml-wizard-content > div');
        this.nextBtn = document.getElementById('toml-wizard-next-btn');
        this.prevBtn = document.getElementById('toml-wizard-prev-btn');
        this.recheckBtn = document.getElementById('toml-wizard-recheck-btn');

        this.state = this.getInitialState();
        this.addEventListeners();
    }

    getInitialState() {
        return {
            currentStep: 1,
            snippetContent: null,
            tomlStructure: null,
            tomlData: null,
            selectedSources: new Map(),
            primaryListPath: null,
            previewData: [],
            pointStatus: new Map()
        };
    }

    init(snippetContent, successCallback, configId) {
        this.state = this.getInitialState();
        this.state.snippetContent = snippetContent;
        this.state.configId = configId; // Store configId
        this.successCallback = successCallback;
        this.updateUIForStep(1);
        this.loadStructure();
        this.modal.show();
    }

    addEventListeners() {
        this.nextBtn.addEventListener('click', () => this.handleNext());
        this.prevBtn.addEventListener('click', () => this.handlePrev());
        this.recheckBtn.addEventListener('click', () => this.handleRecheck());

        const statusFilter = document.getElementById('toml-wizard-status-filter');
        if (statusFilter) {
            statusFilter.addEventListener('change', () => this.renderPreviewTable());
        }
    }

    showAlert(message, type = 'info') {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show mt-2" role="alert">${message}<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button></div>`;
        this.alertContainer.innerHTML = '';
        this.alertContainer.append(wrapper);
    }

    // --- Step 1: Structure Parsing and Selection ---
    async loadStructure() {
        this.treeContainer.innerHTML = '<div class="text-center text-muted p-5"><span class="spinner-border"></span> 正在解析结构...</div>';
        this.renderSelectedSources();
        try {
            const response = await ApiClient.post('/api/toml_query/structure', { content: this.state.snippetContent });
            this.state.tomlStructure = response.structure;
            this.state.tomlData = response.toml_data;
            this.renderTree(this.state.tomlStructure, this.treeContainer, 0);
        } catch (error) {
            this.showAlert(`结构解析失败: ${error.message}`, 'danger');
            this.treeContainer.innerHTML = `<div class="alert alert-danger">${error.message}</div>`;
        }
    }

    renderTree(node, container, level) {
        if (level === 0) container.innerHTML = '';
        const ul = document.createElement('ul');
        ul.className = `list-unstyled ${level > 0 ? 'ps-4' : ''}`;

        for (const key in node) {
            const item = node[key];
            const li = document.createElement('li');
            li.className = 'my-1';
            
            let icon = 'bi-file-earmark-text';
            if (item.type === 'table') icon = 'bi-folder';
            if (item.type === 'array_of_tables') icon = 'bi-list-ul text-primary';

            const link = document.createElement('a');
            link.href = '#';
            link.className = 'text-decoration-none toml-tree-node';
            link.dataset.path = item.path;
            link.innerHTML = `<i class="bi ${icon} me-2"></i>${key}`;
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.toggleSourceSelection(key, item.path, item.type);
            });
            li.appendChild(link);
            ul.appendChild(li);

            if (item.children) {
                this.renderTree(item.children, li, level + 1);
            }
        }
        container.appendChild(ul);
    }

    toggleSourceSelection(key, path, type) {
        if (this.state.selectedSources.has(path)) {
            this.state.selectedSources.delete(path);
            if (this.state.primaryListPath === path) {
                this.state.primaryListPath = null;
            }
        } else {
            if (type === 'array_of_tables' && !this.state.primaryListPath) {
                this.state.primaryListPath = path;
            }
            this.state.selectedSources.set(path, { key, type });
        }
        this.renderSelectedSources();
    }

    renderSelectedSources() {
        this.selectedSourcesContainer.innerHTML = '';
        if (this.state.selectedSources.size === 0) {
            this.selectedSourcesContainer.innerHTML = '<li class="list-group-item text-center text-muted">尚未选择数据源</li>';
            return;
        }

        this.state.selectedSources.forEach((source, path) => {
            const isPrimary = (path === this.state.primaryListPath);
            const li = document.createElement('li');
            li.className = `list-group-item d-flex justify-content-between align-items-center ${isPrimary ? 'list-group-item-primary' : ''}`;
            li.innerHTML = `
                <div>
                    <i class="bi bi-check-circle-fill text-success me-2"></i>
                    <code>${path}</code>
                    ${isPrimary ? '<span class="badge bg-primary ms-2">主列表</span>' : ''}
                </div>
                <button class="btn btn-sm btn-outline-danger"><i class="bi bi-x-lg"></i></button>
            `;
            li.querySelector('button').addEventListener('click', () => this.toggleSourceSelection(source.key, path, source.type));
            this.selectedSourcesContainer.appendChild(li);
        });
    }

    // --- Step 2: Field Mapping ---
    renderMappingUI() {
        this.targetFieldsContainer.innerHTML = '';
        this.sourceFieldsContainer.innerHTML = '';

        const pointInfoFields = ['measurement', 'original_point_name', 'normalized_point_name', 'point_comment'];
        pointInfoFields.forEach(field => {
            this.targetFieldsContainer.innerHTML += `<li class="list-group-item d-flex justify-content-between align-items-center" data-target-field="${field}">${field}</li>`;
        });

        const availableSourceFields = [];

        this.state.selectedSources.forEach((source, path) => {
            const dataObject = this.getValueByPath(this.state.tomlData, path);
            const isPrimary = (path === this.state.primaryListPath);
            const sampleItem = isPrimary ? (dataObject?.[0] || {}) : dataObject;
            
            if (sampleItem && typeof sampleItem === 'object') {
                const flattenedKeys = this.flattenObjectKeys(sampleItem);
                flattenedKeys.forEach(flatKey => {
                    availableSourceFields.push({
                        displayName: `${source.key}.${flatKey}`,
                        isContext: !isPrimary,
                        contextPath: isPrimary ? null : path,
                        sourceKey: flatKey
                    });
                });
            }
        });
        
        const primaryListData = this.getValueByPath(this.state.tomlData, this.state.primaryListPath);
        if (primaryListData && primaryListData.length > 0) {
            this.sourceFieldsContainer.innerHTML = '<p class="text-muted small mb-1">主列表第一条记录预览:</p><pre class="bg-light p-2 rounded h-100"><code>' + escapeHtml(JSON.stringify(primaryListData[0], null, 2)) + '</code></pre>';
        } else {
            this.sourceFieldsContainer.innerHTML = '<div class="text-center text-muted p-5">主数据列表为空或无效。</div>';
        }

        const targetItems = this.targetFieldsContainer.querySelectorAll('li');
        targetItems.forEach(li => {
            const targetField = li.dataset.targetField;
            const select = document.createElement('select');
            select.className = 'form-select form-select-sm ms-3';
            select.dataset.target = targetField;
            select.innerHTML = '<option value="">-- 映射源 --</option>';
            availableSourceFields.forEach(sf => {
                const optionValue = JSON.stringify({ key: sf.sourceKey, isContext: sf.isContext, path: sf.contextPath });
                select.innerHTML += `<option value='${escapeHtml(optionValue)}'>${escapeHtml(sf.displayName)}</option>`;
            });
            li.appendChild(select);
        });
    }

    // --- Step 3: Preview ---
    async executePreview() {
        const mappings = {};
        this.targetFieldsContainer.querySelectorAll('select').forEach(s => {
            if (s.value) {
                mappings[s.dataset.target] = JSON.parse(s.value);
            }
        });

        const primaryList = this.getValueByPath(this.state.tomlData, this.state.primaryListPath);
        if (!primaryList) {
            this.showAlert('主数据列表无效', 'danger');
            return;
        }

        this.state.previewData = primaryList.map((item, index) => {
            const point = { __id: index }; // Add internal ID
            for (const targetField in mappings) {
                const sourceInfo = mappings[targetField];
                let value;
                if (sourceInfo.isContext) {
                    const contextObject = this.getValueByPath(this.state.tomlData, sourceInfo.path);
                    value = contextObject ? this.getValueByPath(contextObject, sourceInfo.key) : null;
                } else {
                    value = this.getValueByPath(item, sourceInfo.key);
                }
                point[targetField] = value !== undefined && value !== null ? value : '';
            }
            return point;
        });

        await this.checkPointStatus();
        this.renderPreviewTable();
    }

    async checkPointStatus() {
        const newPointStatus = new Map();
        if (this.state.previewData.length === 0) {
            this.state.pointStatus = newPointStatus;
            return;
        }

        const measurementCounts = new Map();
        this.state.previewData.forEach(p => {
            const name = p.measurement;
            if (name) {
                measurementCounts.set(name, (measurementCounts.get(name) || 0) + 1);
            }
        });

        const namesToCheckInDB = [];
        measurementCounts.forEach((count, name) => {
            if (count > 1) {
                newPointStatus.set(name, { status: 'internal_duplicate' });
            } else {
                namesToCheckInDB.push(name);
            }
        });

        if (namesToCheckInDB.length > 0) {
            try {
                const payload = { 
                    names: namesToCheckInDB,
                    config_id: this.state.configId 
                };
                const response = await ApiClient.post('/api/point_info/check_status', payload);
                for (const name in response.status) {
                    newPointStatus.set(name, response.status[name]);
                }
            } catch (error) {
                this.showAlert(`检查指标名状态失败: ${error.message}`, 'warning');
            }
        }
        this.state.pointStatus = newPointStatus;
    }

    renderPreviewTable() {
        const filterValue = document.getElementById('toml-wizard-status-filter')?.value || 'all';

        const dataToRender = (filterValue === 'all')
            ? this.state.previewData
            : this.state.previewData.filter(row => {
                const statusResult = this.state.pointStatus.get(row.measurement) || { status: 'new' };
                return statusResult.status === filterValue;
            });

        this.previewTableBody.innerHTML = ''; // Clear previous content
        if (dataToRender.length === 0) {
            this.previewTableBody.innerHTML = '<tr><td colspan="10" class="text-center text-muted">无匹配状态的数据点。</td></tr>';
            return;
        }
        
        const headers = ['操作', '状态', ...Object.keys(this.state.previewData[0] || {}).filter(h => h !== '__id')];
        this.previewTableHead.innerHTML = `<tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>`;

        const statusInfo = {
            new: { text: '新点位', class: 'bg-success' },
            unlinked: { text: '可合并', class: 'bg-info' },
            linked: { text: '冲突', class: 'bg-danger' },
            internal_duplicate: { text: '内部重复', class: 'bg-warning' },
            synced: { text: '已同步', class: 'bg-secondary' }
        };

        dataToRender.forEach((row) => {
            const tr = document.createElement('tr');
            // Find original index to maintain link to state even after filtering
            const originalIndex = this.state.previewData.findIndex(p => p.__id === row.__id);
            tr.dataset.index = originalIndex;

            const originalMeasurement = row.measurement;
            const statusResult = this.state.pointStatus.get(originalMeasurement) || { status: 'new' };
            const status = statusResult.status;

            if (status === 'linked' || status === 'internal_duplicate') {
                tr.classList.add('table-danger');
            }

            // Action Cell
            let actionHtml = '-';
            if (status === 'unlinked') {
                actionHtml = `<span class="text-info"><i class="bi bi-link-45deg"></i> 自动合并</span>`;
            } else if (status === 'internal_duplicate') {
                actionHtml = `<div class="form-check"><input class="form-check-input import-radio" type="radio" name="dup-group-${originalMeasurement}"> <label class="form-check-label">导入此条</label></div>`;
            } else if (status === 'synced') {
                actionHtml = '<span class="text-muted">无操作</span>';
            }
            const actionTd = document.createElement('td');
            actionTd.innerHTML = actionHtml;
            tr.appendChild(actionTd);

            // Status Cell
            const statusBadge = `<span class="badge ${statusInfo[status]?.class || 'bg-secondary'}">${statusInfo[status]?.text || status}</span>`;
            const statusTd = document.createElement('td');
            statusTd.innerHTML = statusBadge;
            tr.appendChild(statusTd);

            // Data Cells
            for (const header of headers) {
                if (['操作', '状态'].includes(header)) continue;

                const cellTd = document.createElement('td');
                let cellContent = escapeHtml(row[header]);
                if ((header === 'measurement') && (status === 'linked' || status === 'internal_duplicate')) {
                    cellContent = `<input type="text" class="form-control form-control-sm rename-input" value="${escapeHtml(row[header])}">`;
                }
                cellTd.innerHTML = cellContent;
                tr.appendChild(cellTd);
            }
            this.previewTableBody.appendChild(tr);
        });
    }

    updateStep3State() {
        const hasIssues = Array.from(this.state.pointStatus.values()).some(s => s.status === 'linked' || s.status === 'internal_duplicate');
        if (hasIssues) {
            this.showAlert(`发现冲突或内部重复的点位 (已在表格中标红)。请修改后重新检查，或返回上一步。`, 'danger');
            this.nextBtn.disabled = true;
        } else {
            this.showAlert(`所有点位状态正常，可以导入。`, 'success');
            this.nextBtn.disabled = false;
        }
    }

    // --- Wizard Navigation ---
    updateUIForStep(step) {
        this.state.currentStep = step;
        this.steps.forEach(s => {
            const sStep = parseInt(s.dataset.step);
            s.classList.remove('active', 'disabled');
            if (sStep > step) s.classList.add('disabled');
            if (sStep === step) s.classList.add('active');
        });
        this.stepPanels.forEach(p => p.classList.add('d-none'));
        document.getElementById(`toml-wizard-step-${step}`).classList.remove('d-none');

        this.prevBtn.disabled = (step === 1);
        this.nextBtn.innerHTML = (step === 3) ? '<i class="bi bi-check-circle me-2"></i>完成并导入' : '下一步';
        this.recheckBtn.style.display = (step === 3) ? 'inline-block' : 'none';
        
        this.nextBtn.disabled = false;
        if (step === 3) {
            this.updateStep3State();
        }
    }

    async handleRecheck() {
        this.recheckBtn.disabled = true;
        this.recheckBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 正在检查...';

        const rows = this.previewTableBody.querySelectorAll('tr');
        this.state.previewData = Array.from(rows).map((row) => {
            const index = parseInt(row.dataset.index);
            const point = { ...this.state.previewData[index] };
            const renameInput = row.querySelector('.rename-input');
            if (renameInput) {
                point.measurement = renameInput.value;
            }
            return point;
        });

        await this.checkPointStatus();
        this.renderPreviewTable();
        this.updateStep3State();

        this.recheckBtn.disabled = false;
        this.recheckBtn.innerHTML = '<i class="bi bi-arrow-clockwise me-1"></i>重新检查';
    }

    async handleNext() {
        if (this.state.currentStep === 1) {
            if (!this.state.primaryListPath) {
                return this.showAlert('请至少选择一个主数据列表 (带 <i class="bi bi-list-ul"></i> 图标)。', 'warning');
            }
            this.renderMappingUI();
            this.updateUIForStep(2);
        } else if (this.state.currentStep === 2) {
            this.nextBtn.disabled = true;
            await this.executePreview();
            this.updateUIForStep(3);
        } else if (this.state.currentStep === 3) {
            this.nextBtn.disabled = true;

            const pointsToCreate = [];
            const pointsToMerge = [];
            
            const rows = this.previewTableBody.querySelectorAll('tr');
            const finalPoints = Array.from(rows).map((row) => {
                const index = parseInt(row.dataset.index);
                const point = { ...this.state.previewData[index] };
                const renameInput = row.querySelector('.rename-input');
                if (renameInput) {
                    point.measurement = renameInput.value;
                }
                return point;
            });

            const hasIssues = finalPoints.some(p => {
                const status = this.state.pointStatus.get(p.measurement)?.status;
                return status === 'linked' || status === 'internal_duplicate';
            });

            if (hasIssues) {
                this.showAlert('仍有未解决的冲突或重复项，请解决后再试。', 'danger');
                this.nextBtn.disabled = false;
                return;
            }

            rows.forEach((row, index) => {
                const point = finalPoints[index];
                const statusResult = this.state.pointStatus.get(point.measurement) || { status: 'new' };
                const status = statusResult.status;

                if (status === 'unlinked') {
                    point.id = parseInt(statusResult.point_id);
                    pointsToMerge.push(point);
                } else if (status === 'new') {
                    pointsToCreate.push(point);
                } else if (status === 'internal_duplicate') {
                    const importRadio = row.querySelector('.import-radio');
                    if (importRadio && importRadio.checked) {
                        pointsToCreate.push(point);
                    }
                }
            });

            try {
                const payload = {
                    config_file_id: this.state.configId,
                    points_to_create: pointsToCreate,
                    points_to_merge: pointsToMerge
                };
                const importResult = await ApiClient.post('/api/point_info/wizard_import', payload);
                this.showAlert(`导入成功！新增 ${importResult.created_count}, 合并 ${importResult.merged_count} 个点位。`, 'success');
                if (this.successCallback) {
                    this.successCallback();
                }
                this.modal.hide();
            } catch (error) {
                this.showAlert(`导入失败: ${error.message}`, 'danger');
                this.nextBtn.disabled = false;
            }
        }
    }

    handlePrev() {
        if (this.state.currentStep > 1) {
            this.updateUIForStep(this.state.currentStep - 1);
        }
    }
    
    // --- Utilities ---
    getValueByPath(data, pathStr) {
        if (!pathStr) return null;
        const keys = pathStr.split('.');

        function recursiveGet(currentData, currentKeys) {
            if (!currentKeys.length) {
                return currentData;
            }

            const key = currentKeys[0];
            const remainingKeys = currentKeys.slice(1);

            if (Array.isArray(currentData)) {
                const results = [];
                for (const item of currentData) {
                    const res = recursiveGet(item, [key, ...remainingKeys]);
                    if (res !== null && res !== undefined) {
                        if (Array.isArray(res)) {
                            results.push(...res);
                        } else {
                            results.push(res);
                        }
                    }
                }
                return results.length > 0 ? results : null;
            }

            if (typeof currentData === 'object' && currentData !== null && key in currentData) {
                return recursiveGet(currentData[key], remainingKeys);
            }

            return null;
        }

        return recursiveGet(data, keys);
    }

    flattenObjectKeys(obj, pathPrefix = '') {
        let keys = [];
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                const newPath = pathPrefix ? `${pathPrefix}.${key}` : key;
                if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
                    keys = keys.concat(this.flattenObjectKeys(obj[key], newPath));
                } else {
                    keys.push(newPath);
                }
            }
        }
        return keys;
    }
}

// Expose the entry point function to the global scope
window.initializeTomlExtractorWizard = (snippetContent, successCallback, configId) => {
    if (!window.tomlWizardInstance) {
        window.tomlWizardInstance = new TomlExtractorWizard();
    }
    window.tomlWizardInstance.init(snippetContent, successCallback, configId);
};