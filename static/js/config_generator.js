function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

class Pagination {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            return;
        }
        this.options = {
            perPageOptions: [10, 20, 50, 100],
            defaultPerPage: 10,
            onPageChange: () => { console.warn('Pagination: onPageChange callback not provided.'); },
            ...options
        };
        this.container.addEventListener('click', this.handleClick.bind(this));
        this.container.addEventListener('change', this.handleChange.bind(this));
        this.container.addEventListener('keypress', this.handleKeyPress.bind(this));
    }
    render() {
        const { currentPage, totalPages, totalRecords, perPage } = this.options;
        if (!this.container || !totalPages) {
            if(this.container) this.container.innerHTML = '';
            return '';
        }
        const startRecord = totalRecords === 0 ? 0 : (currentPage - 1) * perPage + 1;
        const endRecord = Math.min(currentPage * perPage, totalRecords);
        const perPageOptionsHtml = this.options.perPageOptions.map(val => 
            `<option value="${val}" ${perPage === val ? 'selected' : ''}>${val}</option>`
        ).join('');
        return `
            <div class="d-flex justify-content-between align-items-center w-100 flex-wrap">
                <div class="d-flex align-items-center my-1">
                    <select class="form-select form-select-sm me-2" style="width: auto;" data-pagination-control="per-page">
                        ${perPageOptionsHtml}
                    </select>
                    <span class="text-muted small">显示 ${startRecord} 到 ${endRecord} 条，共 ${totalRecords} 条</span>
                </div>
                <div class="d-flex align-items-center my-1">
                    <button class="btn btn-sm btn-outline-secondary" data-pagination-control="prev" ${currentPage <= 1 ? 'disabled' : ''}>&laquo;</button>
                    <span class="mx-2">
                        第 <input type="number" class="form-control form-control-sm d-inline-block" style="width: 60px;" value="${currentPage}" min="1" max="${totalPages}" data-pagination-control="page-input"> / ${totalPages} 页
                    </span>
                    <button class="btn btn-sm btn-outline-secondary" data-pagination-control="next" ${currentPage >= totalPages ? 'disabled' : ''}>&raquo;</button>
                </div>
            </div>
        `;
    }
    handleClick(e) {
        const control = e.target.dataset.paginationControl;
        if (control === 'prev') {
            this.options.onPageChange(this.options.currentPage - 1, this.options.perPage);
        } else if (control === 'next') {
            this.options.onPageChange(this.options.currentPage + 1, this.options.perPage);
        }
    }
    handleChange(e) {
        const control = e.target.dataset.paginationControl;
        if (control === 'per-page') {
            this.options.onPageChange(1, parseInt(e.target.value, 10));
        } else if (control === 'page-input') {
            this.options.onPageChange(parseInt(e.target.value, 10), this.options.perPage);
        }
    }
    handleKeyPress(e) {
        const control = e.target.dataset.paginationControl;
        if (control === 'page-input' && e.key === 'Enter') {
            e.preventDefault();
            this.options.onPageChange(parseInt(e.target.value, 10), this.options.perPage);
        }
    }
}

function showAlert(message, type = 'info') {
    const alertPlaceholder = document.getElementById('alertPlaceholder');
    if (!alertPlaceholder) {
        console.error('#alertPlaceholder element not found in the DOM.');
        return;
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
 * Configuration Generator Wizard Logic
 * This file is lazy-loaded by data_management.js
 */

// --- STATE MANAGEMENT ---
const wizardState = {
    currentStep: 1,
    selected: {
        input: null,
        outputs: [],
        globals: [],
        templates: [],
        points: [],
        processing_tags: [],
    },
    data: {
        inputs: [],
        outputs: [],
        globals: [],
        templates: [],
        points: [],
        processing_tags: [],
        pointsPagination: {},
    },
    pointsTable: {
        currentPage: 1,
        perPage: 10,
        searchField: 'import_batch',
        searchValue: '',
        unlinkedOnly: true,
    }
};

// --- API CLIENT ---
const wizardApiClient = {
    async get(endpoint) {
        const response = await fetch(endpoint);
        if (!response.ok) throw new Error(`Failed to fetch ${endpoint}`);
        return response.json();
    },
    async post(endpoint, body) {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Request failed');
        }
        return response.json();
    }
};

// --- DOM ELEMENTS ---
let wizardModal;
let wizardModalEl;

function getElements() {
    wizardModalEl = document.getElementById('configGeneratorModal');
    wizardModal = new bootstrap.Modal(wizardModalEl);
}

// --- WIZARD LOGIC ---

function updateWizardNav() {
    const steps = wizardModalEl.querySelectorAll('#config-wizard-tabs .nav-link');
    steps.forEach((step, index) => {
        // Only manage the disabled state. Bootstrap's Tab plugin handles the 'active' state.
        if (index + 1 > wizardState.currentStep) {
            step.classList.add('disabled');
        } else {
            step.classList.remove('disabled');
        }
    });
}

function showStep(stepNumber) {
    wizardState.currentStep = stepNumber;
    const tabTriggerEl = wizardModalEl.querySelector(`#wizard-step${stepNumber}-tab`);
    if (tabTriggerEl) {
        const tab = new bootstrap.Tab(tabTriggerEl);
        tab.show();
    }
    updateWizardNav(); 
    updateWizardButtons();
}

function updateWizardButtons() {
    const prevBtn = wizardModalEl.querySelector('#wizard-prev-btn');
    const nextBtn = wizardModalEl.querySelector('#wizard-next-btn');
    const saveBtn = wizardModalEl.querySelector('#wizard-save-btn');

    prevBtn.style.display = wizardState.currentStep > 1 ? 'inline-block' : 'none';
    nextBtn.style.display = wizardState.currentStep < 4 ? 'inline-block' : 'none';
    saveBtn.style.display = wizardState.currentStep === 4 ? 'inline-block' : 'none';

    if (wizardState.currentStep === 1) {
        nextBtn.disabled = !wizardState.selected.input || wizardState.selected.outputs.length === 0 || wizardState.selected.globals.length === 0;
    } else if (wizardState.currentStep === 2) {
        nextBtn.disabled = wizardState.selected.templates.length === 0;
    } else {
        nextBtn.disabled = false;
    }
}

function nextStep() {
    if (wizardState.currentStep < 4) {
        showStep(wizardState.currentStep + 1);
        if (wizardState.currentStep === 3) {
            fetchPoints();
        } else if (wizardState.currentStep === 4) {
            renderFinalPreview();
        }
    }
}

function prevStep() {
    if (wizardState.currentStep > 1) {
        showStep(wizardState.currentStep - 1);
    }
}

// --- DATA FETCHING AND RENDERING ---

async function loadInitialData() {
    try {
        const [inputs, outputs, globals, templates, processingTags] = await Promise.all([
            wizardApiClient.get('/api/data_sources?source_type=input'),
            wizardApiClient.get('/api/data_sources?source_type=output'),
            wizardApiClient.get('/api/global_parameters'),
            wizardApiClient.get('/api/point_templates'),
            wizardApiClient.get('/api/processing_tags')
        ]);
        wizardState.data.inputs = inputs.items;
        wizardState.data.outputs = outputs.items;
        wizardState.data.globals = globals.items;
        wizardState.data.templates = templates.items;
        wizardState.data.processing_tags = processingTags.items;

        renderStep1();
        renderStep2();
    } catch (error) {
        console.error("Failed to load initial wizard data:", error);
        showAlert('加载向导初始数据失败!', 'danger');
    }
}

function renderStep1() {
    const inputSelect = wizardModalEl.querySelector('#inputSourceSelect');
    const outputSelect = wizardModalEl.querySelector('#outputSourceSelect');
    const globalsSelect = wizardModalEl.querySelector('#globalParamsSelect');
    const processingSelect = wizardModalEl.querySelector('#processingTagsSelect');

    inputSelect.innerHTML = '<option selected disabled value="">选择一个输入源...</option>' + wizardState.data.inputs.map(item => `<option value="${item.id}">${item.name}</option>`).join('');
    outputSelect.innerHTML = '<option selected disabled value="">选择一个输出源...</option>' + wizardState.data.outputs.map(item => `<option value="${item.id}">${item.name}</option>`).join('');
    globalsSelect.innerHTML = wizardState.data.globals.map(item => `<option value="${item.id}">${item.name}</option>`).join('');
    
    if(processingSelect) {
        processingSelect.innerHTML = wizardState.data.processing_tags.map(item => `<option value="${item.id}">${item.name}</option>`).join('');
    }
}

function renderStep2() {
    const templatesContainer = wizardModalEl.querySelector('#pointTemplateContainer');
    templatesContainer.innerHTML = wizardState.data.templates.map(item => `
        <div class="list-group-item list-group-item-action" data-template-id="${item.id}" style="cursor: pointer;">
            ${item.name}
        </div>
    `).join('');
}

async function fetchPoints() {
    const { currentPage, perPage, searchField, searchValue, unlinkedOnly } = wizardState.pointsTable;
    const tableBody = wizardModalEl.querySelector('#pointInfoContainer');
    tableBody.innerHTML = '<div class="text-center p-5"><span class="spinner-border spinner-border-sm"></span></div>';

    try {
        const url = new URL('/api/point_info', window.location.origin);
        url.searchParams.append('page', currentPage);
        url.searchParams.append('per_page', perPage);
        url.searchParams.append('unlinked_only', unlinkedOnly);
        if (searchValue) {
            url.searchParams.append('search_field', searchField);
            url.searchParams.append('search', searchValue);
        }
        
        const response = await wizardApiClient.get(url);
        wizardState.data.points = response.items;
        wizardState.data.pointsPagination = response.pagination;
        renderPointsTable();
        renderPointsPagination();
    } catch (error) {
        console.error("Failed to fetch points:", error);
        tableBody.innerHTML = '<div class="alert alert-danger">加载数据点失败</div>';
    }
}

function renderPointsTable() {
    const tableContainer = wizardModalEl.querySelector('#pointInfoContainer');
    if (wizardState.data.points.length === 0) {
        tableContainer.innerHTML = '<div class="text-center p-5 text-muted">没有可用的数据点</div>';
        return;
    }
    tableContainer.innerHTML = `
        <table class="table table-sm table-hover">
            <thead><tr>
                <th><input class="form-check-input" type="checkbox" id="wizard-points-select-all"></th>
                <th>指标名称</th><th>注释</th><th>导入批次</th>
            </tr></thead>
            <tbody>
                ${wizardState.data.points.map(p => `
                    <tr>
                        <td><input class="form-check-input wizard-point-checkbox" type="checkbox" value="${p.id}" ${wizardState.selected.points.includes(p.id) ? 'checked' : ''}></td>
                        <td>${p.measurement}</td>
                        <td>${p.point_comment || '-'}</td>
                        <td>${p.import_batch || '-'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function renderPointsPagination() {
    const paginationData = wizardState.data.pointsPagination;
    const oldContainer = wizardModalEl.querySelector('#pointInfoPagination');
    if (!oldContainer) return;

    // Clone the container to remove all event listeners before re-rendering
    const newContainer = oldContainer.cloneNode(false);
    oldContainer.parentNode.replaceChild(newContainer, oldContainer);

    // Create a new Pagination instance on the clean container and render its content
    newContainer.innerHTML = new Pagination('pointInfoPagination', { 
        currentPage: paginationData.page, 
        totalPages: paginationData.pages, 
        totalRecords: paginationData.total, 
        perPage: wizardState.pointsTable.perPage, 
        onPageChange: handlePointPageChange 
    }).render();
}

function handlePointPageChange(newPage, newPerPage) {
    wizardState.pointsTable.currentPage = newPage;
    wizardState.pointsTable.perPage = newPerPage;
    fetchPoints();
}

async function renderLivePreview() {
    const previewContainer = wizardModalEl.querySelector('#configPreview');
    previewContainer.innerHTML = '<div class="text-center p-5"><span class="spinner-border spinner-border-sm"></span></div>';
    try {
        const { selected } = wizardState;
        const response = await wizardApiClient.post('/api/config/generate_from_components', {
            input_source_id: selected.input,
            output_source_id: selected.outputs,
            global_parameter_ids: selected.globals,
            point_template_ids: selected.templates,
            point_info_ids: selected.points,
            processing_tag_ids: selected.processing_tags
        });
        previewContainer.innerHTML = `<pre class="mb-0"><code>${escapeHtml(response.config)}</code></pre>`;
    } catch (error) {
        previewContainer.innerHTML = `<div class="alert alert-danger">生成预览失败: ${error.message}</div>`;
    }
}

async function renderFinalPreview() {
    const finalPreviewContainer = wizardModalEl.querySelector('#finalConfigPreview');
    const livePreviewContent = wizardModalEl.querySelector('#configPreview').innerHTML;
    finalPreviewContainer.innerHTML = livePreviewContent;
}

async function saveConfiguration() {
    const saveBtn = wizardModalEl.querySelector('#wizard-save-btn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 保存中...';

    try {
        const fileNameInput = wizardModalEl.querySelector('#newConfigName');
        const fileName = fileNameInput.value.trim();
        if (!fileName) {
            showAlert('配置文件名不能为空!', 'warning');
            fileNameInput.classList.add('is-invalid');
            return;
        }
        fileNameInput.classList.remove('is-invalid');

        const finalFileName = fileName.endsWith('.conf') ? fileName : `${fileName}.conf`;
        const configContent = wizardModalEl.querySelector('#finalConfigPreview pre code').innerText;

        const saveResponse = await wizardApiClient.post('/api/config_files/create', {
            name: finalFileName,
            content: configContent,
            change_type: 'wizard',
            change_description: '通过向导创建'
        });
        
        const configFileId = saveResponse.config.id;

        if (configFileId && wizardState.selected.points.length > 0) {
            await wizardApiClient.post('/api/point_info/link_and_lock', {
                config_file_id: configFileId,
                point_ids: wizardState.selected.points
            });
        }

        showAlert('配置保存成功！请到配置文件管理菜单查看。', 'success');
        wizardModal.hide();
        if (window.loadConfigs) window.loadConfigs();

    } catch (error) {
        console.error("Failed to save configuration:", error);
        showAlert(`保存失败: ${error.message}`, 'danger');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '保存配置';
    }
}


// --- EVENT HANDLING ---

function attachWizardEventListeners() {
    wizardModalEl.querySelector('#wizard-next-btn').addEventListener('click', nextStep);
    wizardModalEl.querySelector('#wizard-prev-btn').addEventListener('click', prevStep);
    wizardModalEl.querySelector('#wizard-save-btn').addEventListener('click', saveConfiguration);

    // Step 1 listeners
    wizardModalEl.querySelector('#inputSourceSelect').addEventListener('change', e => {
        wizardState.selected.input = parseInt(e.target.value, 10);
        updateWizardButtons();
    });
    wizardModalEl.querySelector('#outputSourceSelect').addEventListener('change', e => {
        wizardState.selected.outputs = parseInt(e.target.value, 10);
        updateWizardButtons();
    });
    wizardModalEl.querySelector('#globalParamsSelect').addEventListener('change', e => {
        wizardState.selected.globals = Array.from(e.target.selectedOptions).map(opt => parseInt(opt.value, 10));
        updateWizardButtons();
    });
    const processingSelect = wizardModalEl.querySelector('#processingTagsSelect');
    if(processingSelect) {
        processingSelect.addEventListener('change', e => {
            wizardState.selected.processing_tags = Array.from(e.target.selectedOptions).map(opt => parseInt(opt.value, 10));
            updateWizardButtons();
        });
    }

    // Step 2 listeners
    wizardModalEl.querySelector('#pointTemplateContainer').addEventListener('click', e => {
        const item = e.target.closest('.list-group-item');
        if (!item) return;
        const templateId = parseInt(item.dataset.templateId, 10);
        const template = wizardState.data.templates.find(t => t.id === templateId);
        if (template) {
            wizardModalEl.querySelector('#templatePreview').textContent = template.content;
        }
        // Single selection logic
        wizardModalEl.querySelectorAll('#pointTemplateContainer .list-group-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        wizardState.selected.templates = [templateId];
        updateWizardButtons();
    });

    // Step 3 listeners (Points)
    const pointsTable = wizardState.pointsTable;
    const pointInfoContainer = wizardModalEl.querySelector('#pointInfoContainer');
    pointInfoContainer.addEventListener('change', e => {
        if (e.target.id === 'wizard-points-select-all') {
            const isChecked = e.target.checked;
            pointInfoContainer.querySelectorAll('.wizard-point-checkbox').forEach(cb => {
                cb.checked = isChecked;
                const pointId = parseInt(cb.value, 10);
                const alreadySelected = wizardState.selected.points.includes(pointId);
                if (isChecked && !alreadySelected) {
                    wizardState.selected.points.push(pointId);
                } else if (!isChecked && alreadySelected) {
                    wizardState.selected.points = wizardState.selected.points.filter(id => id !== pointId);
                }
            });
        } else if (e.target.classList.contains('wizard-point-checkbox')) {
            const pointId = parseInt(e.target.value, 10);
            if (e.target.checked) {
                if (!wizardState.selected.points.includes(pointId)) wizardState.selected.points.push(pointId);
            } else {
                wizardState.selected.points = wizardState.selected.points.filter(id => id !== pointId);
            }
        }
        renderLivePreview();
    });

    const searchInput = wizardModalEl.querySelector('#pointInfoSearchInput');
    searchInput.addEventListener('keyup', debounce(() => {
        pointsTable.searchValue = searchInput.value;
        pointsTable.currentPage = 1;
        fetchPoints();
    }, 300));

    wizardModalEl.querySelector('#point-info-search-field').addEventListener('change', e => {
        pointsTable.searchField = e.target.value;
        if (pointsTable.searchValue) fetchPoints();
    });
    wizardModalEl.querySelector('#filter-unlinked-points').addEventListener('change', e => {
        pointsTable.unlinkedOnly = e.target.checked;
        pointsTable.currentPage = 1;
        fetchPoints();
    });

    
}

// --- INITIALIZATION ---
function initWizardForConfigGenerator() {
    getElements();
    
    // Reset state
    Object.assign(wizardState, {
        currentStep: 1,
        selected: { input: null, outputs: [], globals: [], templates: [], points: [], processing_tags: [] },
    });
    const configNameInput = wizardModalEl.querySelector('#newConfigName');
    const initialName = `Telegraf_${Date.now()}`;
    if(configNameInput) configNameInput.value = initialName;

    loadInitialData().then(() => {
        attachWizardEventListeners();
        showStep(1);
        wizardModal.show();
    });
}

// Add a global escapeHtml function if it doesn't exist, for the preview
if (typeof escapeHtml === 'undefined') {
    window.escapeHtml = function(unsafe) {
        return String(unsafe || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }
}

window.initWizardForConfigGenerator = initWizardForConfigGenerator;
