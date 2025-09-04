/**
 * Telegraf Manager - Point Info Import/Export Script
 * V11: Overhauls import history with detailed logging.
 */

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('importExportTabs')) {
        new ImportExportManager();
    }
});

class ImportExportManager {
    constructor() {
        this.state = {
            currentBatchId: null, // Used for modal pagination
            file: null,
            fileContent: '',
            headers: [],
            headerRowNumber: 1,
            fullData: [],
            mappings: {},
            conflictRule: 'skip',
            generatedFieldsCount: { normalized_point_name: 0, measurement: 0 },
            db_fields: [
                { key: 'measurement', label: '测量' },
                { key: 'original_point_name', label: '原始点位名' },
                { key: 'normalized_point_name', label: '标准点位名' },
                { key: 'point_comment', label: '点位注释' },
                { key: 'tags', label: '标签 (JSON格式)' },
                { key: 'fields', label: '字段 (JSON格式)' },
                { key: 'timestamp', label: '时间戳 (ISO 8601)' },
                { key: 'data_type', label: '数据类型' },
                { key: 'unit', label: '单位' },
                { key: 'data_source', label: '数据源' },
                { key: 'is_enabled', label: '是否启用' },
                { key: 'import_batch', label: '导入批次' },
            ]
        };

        this.cacheDOMElements();
        if (this.dropZone) {
            this.originalDropZoneHTML = this.dropZone.innerHTML;
        }
        this.addEventListeners();
        this.initializePagination();
        this.loadImportHistory(); // Initial load
    }

    initializePagination() {
        this.batchDetailsPagination = new Pagination('batch-details-pagination', {
            onPageChange: (page, perPage) => {
                if (this.state.currentBatchId) {
                    this.fetchAndRenderBatchDetails(this.state.currentBatchId, page, perPage);
                }
            }
        });
    }

    cacheDOMElements() {
        // Import Wizard Elements
        this.dropZone = document.getElementById('drop-zone');
        this.fileInput = document.getElementById('csv-file-input');
        this.fileInfoDiv = document.getElementById('file-info');
        this.parsingOptionsDiv = document.getElementById('parsing-options');
        this.rawPreviewContainer = document.getElementById('raw-preview-container');
        this.encodingSelect = document.getElementById('file-encoding-select');
        this.headerRowInput = document.getElementById('header-row-input');
        this.nextStep1Btn = document.getElementById('next-step1');
        this.mappingContainer = document.getElementById('mapping-table-container');
        this.nextStep2Btn = document.getElementById('next-step2');
        this.previewContainer = document.getElementById('preview-table-container');
        this.startImportBtn = document.getElementById('start-import');
        this.importProgress = document.querySelector('#import-progress .progress-bar');
        this.importSummary = document.getElementById('import-summary');
        this.stepLinks = document.querySelectorAll('#pills-tab .nav-link');
        this.stepPanes = document.querySelectorAll('#pills-tabContent .tab-pane');
        this.conflictRuleRadios = document.querySelectorAll('input[name="conflict-rule"]');
        this.renameRuleRadio = document.getElementById('rule-rename');
        this.renameRuleInput = document.getElementById('rename-rule-input');
        this.renameRuleOptionsDiv = document.getElementById('rename-rule-options');

        // History Tab Elements
        this.refreshHistoryBtn = document.getElementById('refresh-history-btn');
        this.importHistoryTableBody = document.getElementById('import-history-table-body');
        
        // Details Modal
        const modalElement = document.getElementById('batchDetailsModal');
        if (modalElement) {
            this.batchDetailsModal = new bootstrap.Modal(modalElement);
            this.modalBatchId = document.getElementById('modal-batch-id');
            this.batchDetailsTableBody = document.getElementById('batch-details-table-body');
            this.rollbackBtn = document.getElementById('rollback-batch-btn');
        }

        const historyModalElement = document.getElementById('pointHistoryModal');
        if (historyModalElement) {
            this.pointHistoryModal = new bootstrap.Modal(historyModalElement);
            this.modalHistoryMeasurement = document.getElementById('modal-history-measurement');
            this.pointHistoryTableBody = document.getElementById('point-history-table-body');
        }
    }

    addEventListeners() {
        if (this.dropZone) {
            this.dropZone.addEventListener('click', () => this.fileInput.click());
            this.dropZone.addEventListener('dragover', e => { e.preventDefault(); this.dropZone.classList.add('border-primary'); });
            this.dropZone.addEventListener('dragleave', e => { e.preventDefault(); this.dropZone.classList.remove('border-primary'); });
            this.dropZone.addEventListener('drop', this.handleDrop.bind(this));
            this.fileInput.addEventListener('change', this.handleFileSelect.bind(this));
            this.encodingSelect.addEventListener('change', () => this.readFileContent());
            this.nextStep1Btn.addEventListener('click', () => this.goToStep(2));
            this.nextStep2Btn.addEventListener('click', () => this.goToStep(3));
            this.startImportBtn.addEventListener('click', () => this.goToStep(4));
            this.previewContainer.addEventListener('change', this.handleSyncCheckboxChange.bind(this));
            this.conflictRuleRadios.forEach(radio => {
                radio.addEventListener('change', () => {
                    this.renameRuleOptionsDiv.style.display = this.renameRuleRadio.checked ? 'block' : 'none';
                });
            });
        }

        if (this.refreshHistoryBtn) {
            this.refreshHistoryBtn.addEventListener('click', () => this.loadImportHistory());
        }

        if (this.importHistoryTableBody) {
            this.importHistoryTableBody.addEventListener('click', e => {
                const target = e.target.closest('.view-details-btn');
                if (target) {
                    const batchId = target.dataset.batchId;
                    this.state.currentBatchId = batchId;
                    this.fetchAndRenderBatchDetails(batchId);
                }
            });
        }

        if (this.rollbackBtn) {
            this.rollbackBtn.addEventListener('click', () => this.rollbackBatch());
        }

        if (this.batchDetailsTableBody) {
            this.batchDetailsTableBody.addEventListener('click', e => {
                const target = e.target.closest('.view-point-history-btn');
                if (target) {
                    const pointId = target.closest('tr').dataset.pointId;
                    this.fetchAndRenderPointHistory(pointId);
                }
            });
        }
    }

    formatKey(value) {
        if (typeof value !== 'string') return '';
        return value.replace(/[^a-zA-Z0-9_]/g, '_');
    }

    // --- Import History Methods ---
    async loadImportHistory() {
        if (!this.importHistoryTableBody) return;
        this.importHistoryTableBody.innerHTML = `<tr><td colspan="4" class="text-center"><div class="spinner-border spinner-border-sm" role="status"><span class="visually-hidden">Loading...</span></div></td></tr>`;
        try {
            const response = await fetch('/api/point_info/import_history');
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Failed to fetch history');
            this.renderImportHistory(result.items); // Corrected: result.items
        } catch (error) {
            this.importHistoryTableBody.innerHTML = `<tr><td colspan="4" class="text-center text-danger">加载失败: ${error.message}</td></tr>`;
        }
    }

    renderImportHistory(historyData) {
        if (!this.importHistoryTableBody) return;
        if (!historyData || historyData.length === 0) {
            this.importHistoryTableBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">没有找到导入记录。</td></tr>';
            return;
        }
        let rowsHtml = '';
        historyData.forEach(item => {
            const importTime = new Date(item.last_imported_at).toLocaleString();
            rowsHtml += `
                <tr>
                    <td><code>${item.import_batch}</code></td>
                    <td>${importTime}</td>
                    <td class="text-end">${item.point_count}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary view-details-btn" data-batch-id="${item.import_batch}" title="查看详情">
                            <i class="bi bi-list-ul"></i> 详情
                        </button>
                    </td>
                </tr>
            `;
        });
        this.importHistoryTableBody.innerHTML = rowsHtml;
    }

    async fetchAndRenderBatchDetails(batchId, page = 1, perPage = 50) {
        if (!this.batchDetailsModal) return;
        
        // Show modal on first load
        if (page === 1) {
            this.modalBatchId.textContent = '加载中...';
            this.batchDetailsTableBody.innerHTML = `<tr><td colspan="5" class="text-center"><div class="spinner-border spinner-border-sm"></div></td></tr>`;
            this.batchDetailsPagination.clear();
            this.batchDetailsModal.show();
        }

        try {
            const response = await fetch(`/api/point_info/import_history/${batchId}?page=${page}&per_page=${perPage}`);
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Failed to fetch details');

            this.modalBatchId.textContent = result.batch_id;
            
            let rowsHtml = '';
            if (result.points.length === 0) {
                rowsHtml = '<tr><td colspan="5" class="text-center text-muted">没有找到此批次的详细数据点。</td></tr>';
            } else {
                result.points.forEach(point => {
                    const isLocked = point.is_locked ? '<span class="badge bg-secondary">已锁定</span>' : '<span class="badge bg-success">未锁定</span>';
                    let importStatusBadge = '';
                    if (point.import_status === 'created') {
                        importStatusBadge = '<span class="badge bg-primary">新增</span>';
                    } else if (point.import_status === 'updated') {
                        importStatusBadge = '<span class="badge bg-info">覆盖</span>';
                    } else {
                        importStatusBadge = `<span class="badge bg-light text-dark">${point.import_status || 'N/A'}</span>`;
                    }

                    rowsHtml += `
                        <tr data-point-id="${point.id}">
                            <td>${point.measurement || ''}</td>
                            <td>${point.original_point_name || ''}</td>
                            <td>${point.normalized_point_name || ''}</td>
                            <td>${importStatusBadge}</td>
                            <td>${isLocked}</td>
                            <td>
                                <button class="btn btn-xs btn-outline-info view-point-history-btn" title="查看此数据点的历史版本">
                                    <i class="bi bi-clock-history"></i>
                                </button>
                            </td>
                        </tr>
                    `;
                });
            }
            this.batchDetailsTableBody.innerHTML = rowsHtml;
            this.batchDetailsPagination.render(result.pagination);

        } catch (error) {
            this.batchDetailsTableBody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">加载详情失败: ${error.message}</td></tr>`;
            this.batchDetailsPagination.clear();
        }
    }

    async rollbackBatch() {
        const batchId = this.state.currentBatchId;
        if (!batchId) return;

        if (!confirm(`你确定要回滚批次 “${batchId}” 吗？\n此操作将永久删除该批次导入的所有数据点，且无法撤销。`)) {
            return;
        }

        try {
            const response = await fetch(`/api/point_info/import_history/${batchId}`, {
                method: 'DELETE',
            });
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || '回滚失败');
            }

            this.batchDetailsModal.hide();
            // TODO: Add a global alert function
            alert(`批次 ${batchId} 已成功回滚。`);
            this.loadImportHistory(); // Refresh the main history list

        } catch (error) {
            console.error('Rollback failed:', error);
            alert(`回滚失败: ${error.message}`);
        }
    }

    // --- Import Wizard Methods ---

    updateUIForFileSelect(file) {
        this.dropZone.classList.remove('p-5', 'border-dashed');
        this.dropZone.classList.add('p-3');
        this.dropZone.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <i class="bi bi-check-circle-fill text-success me-2"></i>
                    <span>已选择文件: <strong>${file.name}</strong> (${(file.size / 1024).toFixed(2)} KB)</span>
                </div>
                <button id="cancel-upload-btn" class="btn btn-sm btn-outline-danger">更换文件</button>
            </div>
        `;
        this.fileInfoDiv.classList.add('d-none');

        document.getElementById('cancel-upload-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.resetUploadUI();
        });
    }

    resetUploadUI() {
        this.state.file = null;
        this.state.fileContent = '';
        this.fileInput.value = '';
        this.dropZone.classList.remove('p-3');
        this.dropZone.classList.add('p-5', 'border-dashed');
        this.dropZone.innerHTML = this.originalDropZoneHTML;
        this.parsingOptionsDiv.classList.add('d-none');
        this.nextStep1Btn.disabled = true;
        this.rawPreviewContainer.innerHTML = '';
    }

    handleDrop(e) {
        e.preventDefault();
        this.dropZone.classList.remove('border-primary');
        if (e.dataTransfer.files.length) this.handleNewFile(e.dataTransfer.files[0]);
    }

    handleFileSelect(e) {
        if (e.target.files.length) this.handleNewFile(e.target.files[0]);
    }

    handleNewFile(file) {
        if (!file.name.toLowerCase().endsWith('.csv')) {
            alert('请上传 CSV 格式的文件。');
            return;
        }
        this.state.file = file;
        this.updateUIForFileSelect(file);
        this.readFileContent();
    }

    readFileContent() {
        if (!this.state.file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            this.state.fileContent = e.target.result;
            this.renderRawPreview();
            this.parsingOptionsDiv.classList.remove('d-none');
            this.nextStep1Btn.disabled = false;
        };
        reader.onerror = () => {
            this.resetUploadUI();
            alert('文件读取失败。');
        };
        reader.readAsText(this.state.file, this.encodingSelect.value);
    }

    renderRawPreview() {
        const lines = this.state.fileContent.trim().split(/\r?\n/).slice(0, 20);
        let tableHtml = '<table class="table table-striped table-hover table-sm"><thead><tr><th>行号</th>';
        if (lines.length > 0) {
            lines[0].split(',').forEach(header => { tableHtml += `<th>${header.trim()}</th>`; });
        }
        tableHtml += '</tr></thead><tbody>';
        lines.forEach((line, index) => {
            tableHtml += `<tr><td class="text-muted text-end user-select-none">${index + 1}</td>`;
            line.split(',').forEach(value => {
                tableHtml += `<td>${value.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>`;
            });
            tableHtml += '</tr>';
        });
        tableHtml += '</tbody></table>';
        this.rawPreviewContainer.innerHTML = tableHtml;
    }

    renderMappingTable() {
        let tableHtml = '<table class="table table-bordered"><thead><tr><th>CSV 列头</th><th>预览值</th><th>映射到数据库字段</th></tr></thead><tbody>';
        const lines = this.state.fileContent.trim().split(/\r?\n/);
        const headerRowIndex = this.state.headerRowNumber - 1;
        const firstDataValues = (lines[headerRowIndex + 1] || '').split(',').map(v => v.trim());

        this.state.headers.forEach((header, index) => {
            const sampleValue = firstDataValues[index] || '';
            tableHtml += `<tr><td>${header}</td><td><span class="text-muted">${sampleValue}</span></td><td><select class="form-select" data-csv-header="${header}">`;
            tableHtml += '<option value="__ignore__">-- 忽略此列 --</option>';
            this.state.db_fields.forEach(dbField => {
                const selected = this.formatKey(header.toLowerCase()) === dbField.key ? 'selected' : '';
                tableHtml += `<option value="${dbField.key}" ${selected}>${dbField.label} (${dbField.key})</option>`;
            });
            tableHtml += '</select></td></tr>';
        });
        tableHtml += '</tbody></table>';
        this.mappingContainer.innerHTML = tableHtml;
    }

    preparePreviewData() {
        this.state.mappings = {};
        this.mappingContainer.querySelectorAll('select').forEach(select => {
            if (select.value !== '__ignore__') {
                this.state.mappings[select.dataset.csvHeader] = select.value;
            }
        });

        if (!Object.values(this.state.mappings).includes('original_point_name')) {
            alert('必须映射 “原始点位名” 字段才能继续。');
            return false;
        }

        this.transformData();
        return true;
    }

    transformData() {
        const lines = this.state.fileContent.trim().split(/\r?\n/);
        const headerRowIndex = this.state.headerRowNumber - 1;
        const headers = lines[headerRowIndex].split(',').map(h => h.trim());
        const dataRows = lines.slice(headerRowIndex + 1);

        this.state.generatedFieldsCount = { normalized_point_name: 0, measurement: 0 };

        this.state.fullData = dataRows.map(line => {
            if (!line.trim()) return null;
            const values = line.split(',').map(v => v.trim());
            const rowObject = { _meta: { normalized_point_name: {}, measurement: {} } };

            headers.forEach((header, index) => {
                const dbField = this.state.mappings[header];
                if (dbField) rowObject[dbField] = values[index] || '';
            });

            const originalName = rowObject.original_point_name;
            if (!originalName) return rowObject;

            if (rowObject.normalized_point_name) {
                rowObject._meta.normalized_point_name.source = 'mapped';
            } else {
                rowObject.normalized_point_name = this.formatKey(originalName);
                rowObject._meta.normalized_point_name.source = 'generated';
                this.state.generatedFieldsCount.normalized_point_name++;
            }

            if (rowObject.measurement) {
                rowObject._meta.measurement.source = 'mapped';
            } else {
                rowObject.measurement = this.formatKey(originalName);
                rowObject._meta.measurement.source = 'generated';
                this.state.generatedFieldsCount.measurement++;
            }

            return rowObject;
        }).filter(Boolean);
    }

    renderPreviewTable() {
        const previewData = this.state.fullData.slice(0, 20);
        const mappedDbFields = this.state.db_fields.filter(f => Object.values(this.state.mappings).includes(f.key));

        let tableHtml = '<table class="table table-striped table-hover table-sm"><thead><tr>';
        mappedDbFields.forEach(field => { tableHtml += `<th>${field.label}</th>`; });
        tableHtml += '<th>同步为标准点位名</th><th>同步为测量</th></tr></thead><tbody>';

        previewData.forEach((row, index) => {
            tableHtml += `<tr>`;
            mappedDbFields.forEach(field => {
                const value = row[field.key] || '';
                const isGenerated = row._meta[field.key]?.source === 'generated';
                tableHtml += `<td ${isGenerated ? 'class="bg-warning-subtle"' : ''}>${value}</td>`;
            });

            const normMeta = row._meta.normalized_point_name;
            tableHtml += '<td><div class="form-check d-flex justify-content-center">';
            tableHtml += `<input class="form-check-input" type="checkbox" data-row-index="${index}" data-field="normalized_point_name" ${normMeta.source === 'mapped' ? 'disabled checked' : 'checked'}>`;
            tableHtml += '</div></td>';

            const measMeta = row._meta.measurement;
            tableHtml += '<td><div class="form-check d-flex justify-content-center">';
            tableHtml += `<input class="form-check-input" type="checkbox" data-row-index="${index}" data-field="measurement" ${measMeta.source === 'mapped' ? 'disabled checked' : 'checked'}>`;
            tableHtml += '</div></td>';

            tableHtml += '</tr>';
        });

        tableHtml += '</tbody></table>';
        this.previewContainer.innerHTML = tableHtml;
        const summary = `<p>将导入总计 <strong>${this.state.fullData.length}</strong> 条记录。以下为前 ${previewData.length} 条预览：</p><p>系统将自动生成 <strong>${this.state.generatedFieldsCount.normalized_point_name}</strong> 个“标准点位名”和 <strong>${this.state.generatedFieldsCount.measurement}</strong> 个“测量”字段。</p>`;
        this.previewContainer.insertAdjacentHTML('afterbegin', summary);
    }
    
    handleSyncCheckboxChange(e) {
        if (e.target.type !== 'checkbox') return;
        const rowIndex = parseInt(e.target.dataset.rowIndex, 10);
        const field = e.target.dataset.field;
        const isChecked = e.target.checked;
        const dataRow = this.state.fullData[rowIndex];
        if (!dataRow) return;

        if (isChecked) {
            dataRow[field] = this.formatKey(dataRow.original_point_name);
        } else {
            dataRow[field] = '';
        }
        
        const mappedDbFields = this.state.db_fields.filter(f => Object.values(this.state.mappings).includes(f.key));
        const cellIndex = mappedDbFields.findIndex(f => f.key === field);
        if (cellIndex > -1) {
            const cell = e.target.closest('tr').children[cellIndex];
            if(cell) cell.textContent = dataRow[field];
        }
    }

    async runImport() {
        const conflictRule = document.querySelector('input[name="conflict-rule"]:checked').value;
        const renameRule = conflictRule === 'rename' ? this.renameRuleInput.value : null;
        const pointsToImport = this.state.fullData.map(row => { const cleanRow = { ...row }; delete cleanRow._meta; return cleanRow; });

        try {
            this.importProgress.style.width = '50%';
            this.importProgress.textContent = '50%';
            this.importProgress.classList.add('progress-bar-animated');

            const response = await fetch('/api/point_info/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    points: pointsToImport, 
                    conflict_rule: conflictRule, 
                    rename_rule: renameRule,
                    file_name: this.state.file.name
                })
            });

            const result = await response.json();
            if (!response.ok) {
                 const errorDetails = result.data?.batch_id ? `<p>批次ID: <code>${result.data.batch_id}</code></p>` : '';
                 throw new Error((result.error || '未知错误') + errorDetails);
            }

            this.importProgress.style.width = '100%';
            this.importProgress.textContent = '100%';
            this.importProgress.classList.remove('progress-bar-animated', 'bg-danger');

            let summaryHtml = `<div class="alert alert-success"><h4>导入完成！</h4>
                <p>批次ID: <code>${result.data.batch_id}</code></p>
                <p>总行数: <strong>${result.data.total_rows}</strong></p>
                <p>新增: <strong>${result.data.imported_count}</strong>, 更新: <strong>${result.data.updated_count}</strong>, 跳过: <strong>${result.data.skipped_count}</strong>, 失败: <strong>${result.data.failed_count}</strong></p>
            </div>`;
            
            this.importSummary.innerHTML = summaryHtml;
            
            // Automatically switch to the history tab to show the new record
            const historyTab = new bootstrap.Tab(document.getElementById('import-history-tab'));
            historyTab.show();
            this.loadImportHistory(); // Refresh history

        } catch (error) {
            this.importProgress.style.width = '100%';
            this.importProgress.classList.remove('progress-bar-animated');
            this.importProgress.classList.add('bg-danger');
            this.importSummary.innerHTML = `<div class="alert alert-danger"><h4>导入失败</h4><p>${error.message}</p></div>`;
        }
    }

    goToStep(stepNumber) {
        if (stepNumber === 2) {
            const headerRow = parseInt(this.headerRowInput.value, 10);
            if (isNaN(headerRow) || headerRow < 1) { alert('请输入一个有效的行号。'); return; }
            this.state.headerRowNumber = headerRow;
            const lines = this.state.fileContent.trim().split(/\r?\n/);
            if (lines.length < headerRow) { alert(`指定的行号 (${headerRow}) 超出文件总行数。`); return; }
            this.state.headers = lines[headerRow - 1].split(',').map(h => h.trim());
            this.renderMappingTable();
        } else if (stepNumber === 3) {
            if (!this.preparePreviewData()) return;
            this.renderPreviewTable();
        } else if (stepNumber === 4) {
            this.runImport();
        }

        this.stepLinks.forEach((link, index) => {
            link.classList.remove('active', 'disabled', 'completed');
            if (index + 1 < stepNumber) {
                link.classList.add('completed');
                link.classList.remove('disabled');
            } else if (index + 1 === stepNumber) {
                link.classList.add('active');
                link.classList.remove('disabled');
            } else {
                link.classList.add('disabled');
            }
        });

        this.stepPanes.forEach(pane => {
            const paneStep = parseInt(pane.id.replace('step', ''), 10);
            const isActive = paneStep === stepNumber;
            pane.classList.toggle('show', isActive);
            pane.classList.toggle('active', isActive);
        });
    }

    async fetchAndRenderPointHistory(pointId) {
        if (!this.pointHistoryModal) return;

        this.modalHistoryMeasurement.textContent = '加载中...';
        this.pointHistoryTableBody.innerHTML = `<tr><td colspan="6" class="text-center"><div class="spinner-border spinner-border-sm"></div></td></tr>`;
        this.pointHistoryModal.show();

        try {
            const result = await ApiClient.get(`/api/point_info/${pointId}/history`);
            this.modalHistoryMeasurement.textContent = result.measurement;
            
            let rowsHtml = '';
            if (result.history.length === 0) {
                rowsHtml = '<tr><td colspan="6" class="text-center text-muted">没有找到此数据点的历史版本。</td></tr>';
            } else {
                result.history.forEach(h => {
                    rowsHtml += `
                        <tr>
                            <td><span class="badge bg-secondary">v${h.version}</span></td>
                            <td>${new Date(h.archived_at).toLocaleString()}</td>
                            <td>${h.change_reason || 'N/A'}</td>
                            <td>${h.original_point_name || ''}</td>
                            <td>${h.normalized_point_name || ''}</td>
                            <td>${h.point_comment || ''}</td>
                        </tr>
                    `;
                });
            }
            this.pointHistoryTableBody.innerHTML = rowsHtml;

        } catch (error) {
            this.pointHistoryTableBody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">加载历史失败: ${error.message}</td></tr>`;
        }
    }
}