/**
 * Reusable Pagination Component
 * 
 * Renders and manages a standardized pagination control.
 */
class Pagination {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error(`Pagination container with id '${containerId}' not found.`);
        }

        this.options = {
            perPageOptions: [20, 50, 100, 200],
            defaultPerPage: 50,
            onPageChange: () => { console.warn('Pagination: onPageChange callback not provided.'); },
            ...options
        };

        this.currentPage = 1;
        this.currentPerPage = this.options.defaultPerPage;

        this.container.addEventListener('click', this.handleClick.bind(this));
        this.container.addEventListener('change', this.handleChange.bind(this));
        this.container.addEventListener('keypress', this.handleKeyPress.bind(this));
    }

    render(paginationData) {
        if (!paginationData || !paginationData.total) {
            this.container.innerHTML = '<p class="text-muted small">无数据</p>';
            return;
        }

        const { page, per_page, total, pages } = paginationData;
        this.currentPage = page;
        this.currentPerPage = per_page;

        const startRecord = total === 0 ? 0 : (page - 1) * per_page + 1;
        const endRecord = Math.min(page * per_page, total);

        const perPageOptionsHtml = this.options.perPageOptions.map(val => 
            `<option value="${val}" ${per_page === val ? 'selected' : ''}>${val}</option>`
        ).join('');

        this.container.innerHTML = `
            <div class="d-flex justify-content-between align-items-center w-100 flex-wrap">
                <div class="d-flex align-items-center my-1">
                    <select class="form-select form-select-sm me-2" style="width: auto;" data-pagination-control="per-page">
                        ${perPageOptionsHtml}
                    </select>
                    <span class="text-muted small">显示 ${startRecord} 到 ${endRecord} 条，共 ${total} 条</span>
                </div>
                <div class="d-flex align-items-center my-1">
                    <button class="btn btn-sm btn-outline-secondary" data-pagination-control="prev" ${!paginationData.has_prev ? 'disabled' : ''}>&laquo;</button>
                    <span class="mx-2">
                        第 <input type="number" class="form-control form-control-sm d-inline-block" style="width: 60px;" value="${page}" min="1" max="${pages}" data-pagination-control="page-input"> / ${pages} 页
                    </span>
                    <button class="btn btn-sm btn-outline-secondary" data-pagination-control="next" ${!paginationData.has_next ? 'disabled' : ''}>&raquo;</button>
                </div>
            </div>
        `;
    }

    clear() {
        this.container.innerHTML = '';
    }

    handleClick(e) {
        const control = e.target.dataset.paginationControl;
        if (control === 'prev') {
            this.options.onPageChange(this.currentPage - 1, this.currentPerPage);
        } else if (control === 'next') {
            this.options.onPageChange(this.currentPage + 1, this.currentPerPage);
        }
    }

    handleChange(e) {
        const control = e.target.dataset.paginationControl;
        if (control === 'per-page') {
            this.currentPerPage = parseInt(e.target.value, 10);
            this.options.onPageChange(1, this.currentPerPage); // Go to first page on per-page change
        } else if (control === 'page-input') {
            const newPage = parseInt(e.target.value, 10);
            this.options.onPageChange(newPage, this.currentPerPage);
        }
    }

    handleKeyPress(e) {
        const control = e.target.dataset.paginationControl;
        if (control === 'page-input' && e.key === 'Enter') {
            e.preventDefault();
            const newPage = parseInt(e.target.value, 10);
            this.options.onPageChange(newPage, this.currentPerPage);
        }
    }
}
