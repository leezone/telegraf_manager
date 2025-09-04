function escapeHtml(unsafe) {
    return String(unsafe === null || typeof unsafe === 'undefined' ? '' : unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

const config = {
    data_sources: {
        endpoint: '/api/data_sources',
        tableId: 'data-sources-table',
        label: '数据源',
        columns: [
            { data: 'id', title: 'ID' },
            { data: 'name', title: '名称' },
            { data: 'source_type', title: '类型' },
            { data: 'description', title: '描述' },
            { data: 'is_enabled', title: '状态', render: (d) => d ? '<span class="badge bg-success">启用</span>' : '<span class="badge bg-secondary">禁用</span>' },
            { data: 'updated_at', title: '最后更新', render: (d) => new Date(d).toLocaleString() },
        ],
        formFields: [
            { name: 'name', label: '数据源名称' },
            { name: 'source_type', label: '类型', type: 'select', options: ['input', 'output'] },
            { name: 'description', label: '描述' },
            { name: 'config', label: '配置内容', type: 'textarea' },
            { name: 'is_enabled', label: '是否启用', type: 'checkbox' }
        ]
    },
    global_parameters: {
        endpoint: '/api/global_parameters',
        tableId: 'global-parameters-table',
        label: '全局参数',
        columns: [
            { data: 'id', title: 'ID' },
            { data: 'name', title: '名称' },
            { data: 'config', title: '配置', render: (d) => `<pre class="mb-0"><code>${escapeHtml(String(d).substring(0, 70))}...</code></pre>` },
            { data: 'description', title: '描述' },
            { data: 'updated_at', title: '最后更新', render: (d) => new Date(d).toLocaleString() },
        ],
        formFields: [
            { name: 'name', label: '参数名称' },
            { name: 'config', label: '配置内容', type: 'textarea' },
            { name: 'description', label: '描述' }
        ]
    },
    point_templates: {
        endpoint: '/api/point_templates',
        tableId: 'point-templates-table',
        label: '数据点模板',
        columns: [
            { data: 'id', title: 'ID' },
            { data: 'name', title: '模板名称' },
            { data: 'description', title: '描述' },
            { data: 'updated_at', title: '更新时间', render: (d) => new Date(d).toLocaleString() },
        ],
        formFields: [
            { name: 'name', label: '模板名称' },
            { name: 'content', label: '模板内容', type: 'textarea' },
            { name: 'description', label: '描述' }
        ]
    },
    processing_tags: {
        endpoint: '/api/processing_tags',
        tableId: 'processing-tags-table',
        label: '处理转换配置',
        columns: [
            { data: 'id', title: 'ID' },
            { data: 'name', title: '配置名称' },
            { data: 'plugin_type', title: '插件类型' },
            { data: 'description', title: '描述' },
            { data: 'updated_at', title: '更新时间', render: (d) => new Date(d).toLocaleString() },
        ],
        formFields: [
            { name: 'name', label: '配置名称' },
            { name: 'plugin_type', label: '插件类型', type: 'select', options: ['processor', 'aggregator'] },
            { name: 'config', label: '配置内容', type: 'textarea' },
            { name: 'description', label: '描述' }
        ]
    },
    point_info: {
        endpoint: '/api/point_info',
        tableId: 'point-info-table',
        label: '数据点位',
        defaultOrder: [[7, 'desc']], // Default sort by 'updated_at' descending
        // searchId: 'point-info-search', // Custom search for this table only
        columns: [
            { data: 'id', title: 'ID' },
            { data: 'measurement', title: '指标名称' },
            { data: 'original_point_name', title: '原始点位名' },
            { data: 'unit', title: '单位', render: (d) => d || '-' },
            { data: 'point_comment', title: '注释' },
            { data: 'import_batch', title: '导入批次' },
            { data: 'config_file_name', title: '关联配置', render: (d) => d ? d : '-' },
            { data: 'updated_at', title: '修改时间', render: function(data, type, row) { const dateToShow = row.updated_at || row.created_at; return dateToShow ? new Date(dateToShow).toLocaleString('zh-CN') : '-'; } },
        ],
        formFields: [
            { name: 'measurement', label: '指标名称', readonly: true },
            { name: 'original_point_name', label: '原始点位名' },
            { name: 'normalized_point_name', label: '标准化点位名' },
            { name: 'point_comment', label: '点位注释', type: 'textarea' },
            { name: 'tags', label: '标签 (JSON)', type: 'textarea' },
            { name: 'fields', label: '字段 (JSON)', type: 'textarea' },
            { name: 'data_type', label: '数据类型' },
            { name: 'unit', label: '单位' },
            { name: 'data_source', label: '数据来源' },
            { name: 'is_enabled', label: '是否启用', type: 'checkbox' },
            { name: 'import_batch', label: '导入批次', readonly: true }
        ]
    }
};

document.addEventListener('DOMContentLoaded', function () {
    const state = {
        dataTableInstances: {}
    };

    function initializeDataTableForType(type) {
        const typeConfig = config[type];
        if (!typeConfig || state.dataTableInstances[type]) return;

        // The columns from the config are already in the correct format.
        // We just need to add the actions column.
        const dtColumns = [
            ...typeConfig.columns,
            {
                title: '操作',
                data: null,
                orderable: false,
                searchable: false,
                render: function (data, _type, row) {
                    const isLocked = row.is_locked;
                    const editButton = `<button class="btn btn-sm btn-outline-primary me-2 edit-btn" data-type="${type}" data-id="${row.id}" ${isLocked ? 'disabled' : ''}><i class="bi bi-pencil-square"></i></button>`;
                    const deleteButton = `<button class="btn btn-sm btn-outline-danger me-2 delete-btn" data-type="${type}" data-id="${row.id}" ${isLocked ? 'disabled' : ''}><i class="bi bi-trash"></i></button>`;
                    const lockButton = row.hasOwnProperty('is_locked') ? `<button class="btn btn-sm btn-outline-secondary toggle-lock-btn" data-type="${type}" data-id="${row.id}" title="${isLocked ? '解锁' : '锁定'}"><i class="bi ${isLocked ? 'bi-lock-fill' : 'bi-unlock-fill'}"></i></button>` : '';
                    return `${editButton}${deleteButton}${lockButton}`;
                }
            }
        ];

        state.dataTableInstances[type] = new DataTable(`#${typeConfig.tableId}`, {
            processing: true,
            serverSide: true,
            ajax: {
                url: typeConfig.endpoint,
                data: function (d) {
                    const params = {
                        page: Math.floor(d.start / d.length) + 1,
                        per_page: d.length,
                        search: d.search.value
                    };
                    if (d.order && d.order.length > 0) {
                        const order = d.order[0];
                        const columnIndex = order.column;
                        // Ensure the column index is valid and the column has a data property
                        if (d.columns && d.columns[columnIndex] && d.columns[columnIndex].data) {
                            const columnData = d.columns[columnIndex].data;
                            params.sort_by = columnData;
                            params.sort_dir = order.dir;
                        }
                    }
                    return params;
                },
                dataSrc: function (json) {
                    json.recordsTotal = json.pagination.total;
                    json.recordsFiltered = json.pagination.total;
                    return json.items;
                }
            },
            columns: dtColumns,
            order: typeConfig.defaultOrder || [[0, 'asc']], // Use default order from config or fallback
            language: { url: '/static/js/lib/datatables/zh-CN.json' },
            searching: !typeConfig.searchId, // Use DataTables search unless a custom one is defined
            initComplete: function () {
                const api = this.api();
                api.columns().every(function (colIdx) {
                    const column = this;
                    const header = column.header();
                    const columnConfig = dtColumns[colIdx];

                    if (columnConfig && columnConfig.filterable) {
                        const title = header.textContent;
                        header.innerHTML = ''; // Clear header

                        const label = document.createElement('div');
                        label.textContent = title;
                        header.appendChild(label);

                        const select = document.createElement('select');
                        select.classList.add('form-select', 'form-select-sm', 'mt-1');
                        select.innerHTML = '<option value="">全部</option>';
                        header.appendChild(select);

                        select.addEventListener('change', (e) => {
                            e.stopPropagation(); // Prevent sorting when clicking the select
                            const val = select.value;
                            column.search(val ? '^' + val + '$' : '', true, false).draw();
                        });
                        
                        header.addEventListener('click', (e) => {
                            // Prevent sorting when clicking on the select element itself
                            if (e.target.tagName === 'SELECT') {
                                e.stopPropagation();
                            }
                        });

                        if (columnConfig.filter_options) {
                            columnConfig.filter_options.forEach(val => {
                                const option = document.createElement('option');
                                option.value = val;
                                option.textContent = val;
                                select.appendChild(option);
                            });
                        }
                    }
                });
            }
        });
    }

    function attachEventListeners() {
        document.querySelectorAll('#dataManagementTabs .nav-link').forEach(tab => {
            tab.addEventListener('show.bs.tab', event => {
                const type = event.target.getAttribute('href').substring(1).replace(/-/g, '_');
                initializeDataTableForType(type);
                history.pushState(null, null, event.target.href);
            });
        });

        document.getElementById('dataManagementTabsContent').addEventListener('click', function(event) {
            const button = event.target.closest('button');
            if (!button) return;

            const type = button.dataset.type;
            const id = button.dataset.id;

            if (button.classList.contains('add-btn')) openModal(type);
            else if (button.classList.contains('edit-btn')) openModal(type, id);
            else if (button.classList.contains('delete-btn')) deleteItem(type, id);
            else if (button.classList.contains('toggle-lock-btn')) toggleLock(type, id);
        });
        
        const pointInfoSearch = document.getElementById('point-info-search');
        if(pointInfoSearch) {
            let debounceTimer;
            pointInfoSearch.addEventListener('keyup', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    if (state.dataTableInstances.point_info) {
                        state.dataTableInstances.point_info.search(pointInfoSearch.value).draw();
                    }
                }, 300);
            });
        }

        document.getElementById('genericModalSaveBtn').addEventListener('click', saveForm);
        
        document.querySelectorAll('.lazy-load-btn').forEach(button => {
            button.addEventListener('click', () => lazyLoadScript(button));
        });
    }

    function openModal(type, id = null) {
        const typeConfig = config[type];
        const modal = new bootstrap.Modal(document.getElementById('genericModal'));
        const form = document.getElementById('genericModalForm');
        const formBody = document.getElementById('genericFormBody');
        
        form.reset();
        form.dataset.type = type;
        form.dataset.id = id || '';
        document.getElementById('genericModalLabel').textContent = id ? `编辑 ${typeConfig.label || type}` : `添加 ${typeConfig.label || type}`;
        
        formBody.innerHTML = '';

        const itemData = id ? (state.dataTableInstances[type].rows({ search: 'applied' }).data().toArray().find(i => i.id == id) || {}) : {};

        typeConfig.formFields.forEach(field => {
            const fieldKey = field.name;
            const label = field.label || fieldKey;
            const fieldType = field.type || 'text';
            const readonly = field.readonly ? 'readonly' : '';
            const value = itemData[fieldKey] === null || typeof itemData[fieldKey] === 'undefined' ? '' : itemData[fieldKey];
            let fieldHtml = '<div class="mb-3">';

            if (fieldType === 'checkbox') {
                fieldHtml += `<div class="form-check"><input class="form-check-input" type="checkbox" id="form-${fieldKey}" name="${fieldKey}" ${value ? 'checked' : ''} ${readonly}><label class="form-check-label" for="form-${fieldKey}">${label}</label></div>`;
            } else if (fieldType === 'textarea') {
                fieldHtml += `<label for="form-${fieldKey}" class="form-label">${label}</label><textarea class="form-control" id="form-${fieldKey}" name="${fieldKey}" rows="5" ${readonly}>${escapeHtml(value)}</textarea>`;
            } else if (fieldType === 'select') {
                const optionsHtml = field.options.map(opt => `<option value="${escapeHtml(opt)}" ${value === opt ? 'selected' : ''}>${escapeHtml(opt)}</option>`).join('');
                fieldHtml += `<label for="form-${fieldKey}" class="form-label">${label}</label><select class="form-select" id="form-${fieldKey}" name="${fieldKey}" ${readonly}>${optionsHtml}</select>`;
            } else {
                fieldHtml += `<label for="form-${fieldKey}" class="form-label">${label}</label><input type="text" class="form-control" id="form-${fieldKey}" name="${fieldKey}" value="${escapeHtml(value)}" ${readonly}>`;
            }
            fieldHtml += '</div>';
            formBody.innerHTML += fieldHtml;
        });

        if (type === 'point_templates') {
            const contentTextarea = formBody.querySelector('#form-content');
            if (contentTextarea) {
                const variables = [
                    { name: '指标名称', value: 'measurement' },
                    { name: '原始点位名', value: 'original_point_name' },
                    { name: '标准点位名', value: 'normalized_point_name' },
                    { name: '点位注释', value: 'point_comment' },
                    { name: '单位', value: 'unit' },
                    { name: '标签(JSON)', value: 'tags' },
                    { name: '字段(JSON)', value: 'fields' }
                ];
                const variablesHtml = `
                    <div class="mt-2">
                        <small class="text-muted">点击插入变量到模板内容:</small>
                        <div class="d-flex flex-wrap gap-1 mt-1">
                            ${variables.map(v => `<button type="button" class="btn btn-sm btn-outline-secondary insert-variable-btn" data-value="{{${v.value}}}">${v.name}</button>`).join('')}
                        </div>
                    </div>
                `;
                contentTextarea.parentElement.insertAdjacentHTML('beforeend', variablesHtml);

                formBody.querySelectorAll('.insert-variable-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const cursorPos = contentTextarea.selectionStart;
                        const currentValue = contentTextarea.value;
                        const variableToInsert = btn.dataset.value;
                        const newValue = currentValue.substring(0, cursorPos) + variableToInsert + currentValue.substring(cursorPos);
                        contentTextarea.value = newValue;
                        contentTextarea.focus();
                        contentTextarea.setSelectionRange(cursorPos + variableToInsert.length, cursorPos + variableToInsert.length);
                    });
                });
            }
        }

        modal.show();
    }

    async function saveForm() {
        const form = document.getElementById('genericModalForm');
        const type = form.dataset.type;
        const id = form.dataset.id;
        const typeConfig = config[type];

        const body = {};
        typeConfig.formFields.forEach(field => {
            const input = form.elements[field.name];
            if (input) {
                body[field.name] = input.type === 'checkbox' ? input.checked : input.value;
            }
        });

        try {
            const endpoint = id ? `${typeConfig.endpoint}/${id}` : typeConfig.endpoint;
            const method = id ? 'PUT' : 'POST';
            const response = await fetch(endpoint, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || '保存失败');
            
            showAlert('保存成功!', 'success');
            bootstrap.Modal.getInstance(document.getElementById('genericModal')).hide();
            state.dataTableInstances[type].ajax.reload(null, false); // Reload the table data without resetting pagination
        } catch (error) {
            showAlert(`保存失败: ${error.message}`, 'danger');
        }
    }

    async function deleteItem(type, id) {
        if (!confirm('确定要删除吗？此操作无法撤销。')) return;
        const typeConfig = config[type];
        try {
            const response = await fetch(`${typeConfig.endpoint}/${id}`, { method: 'DELETE' });
            if (!response.ok) {
                const result = await response.json();
                throw new Error(result.error || '删除失败');
            }
            showAlert('删除成功!', 'success');
            state.dataTableInstances[type].ajax.reload(null, false);
        } catch (error) {
            showAlert(`删除失败: ${error.message}`, 'danger');
        }
    }

    async function toggleLock(type, id) {
        const typeConfig = config[type];
        try {
            const response = await fetch(`${typeConfig.endpoint}/${id}/toggle_lock`, { method: 'POST' });
            if (!response.ok) {
                const result = await response.json();
                throw new Error(result.error || '操作失败');
            }
            showAlert('状态切换成功!', 'success');
            state.dataTableInstances[type].ajax.reload(null, false);
        } catch (error) {
            showAlert(`操作失败: ${error.message}`, 'danger');
        }
    }

    function lazyLoadScript(button) {
        const scriptPath = button.dataset.scriptPath;
        const initFunction = button.dataset.initFunction;
        if (!scriptPath || !initFunction) return;
        if (button.disabled) return;
        button.disabled = true;
        const originalButtonHtml = button.innerHTML;
        button.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 加载中...';

        if (window[initFunction] && typeof window[initFunction] === 'function') {
            button.disabled = false;
            button.innerHTML = originalButtonHtml;
            window[initFunction]();
        } else {
            const script = document.createElement('script');
            script.src = scriptPath;
            script.onload = () => {
                button.disabled = false;
                button.innerHTML = originalButtonHtml;
                if (window[initFunction]) window[initFunction]();
            };
            script.onerror = () => {
                button.disabled = false;
                button.innerHTML = originalButtonHtml;
                showAlert(`加载脚本失败: ${scriptPath}`, 'danger');
            };
            document.body.appendChild(script);
        }
    }

    function showAlert(message, type = 'info') {
        const alertPlaceholder = document.getElementById('alertPlaceholder');
        if (!alertPlaceholder) return;
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show" role="alert"><div>${escapeHtml(message)}</div><button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`;
        alertPlaceholder.append(wrapper);
        setTimeout(() => wrapper.querySelector('.alert')?.remove(), 5000);
    }

    function init() {
        const firstTab = document.querySelector('#dataManagementTabs .nav-link.active');
        const firstTabType = firstTab.getAttribute('href').substring(1).replace(/-/g, '_');
        initializeDataTableForType(firstTabType);
        attachEventListeners();

        const hash = window.location.hash;
        if (hash) {
            const tab = document.querySelector(`.nav-tabs a[href="${hash}"]`);
            if (tab) new bootstrap.Tab(tab).show();
        }
    }

    init();
});