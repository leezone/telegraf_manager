$(document).ready(function() {
    function renderStatusBadge(status) {
        let badgeClass = 'bg-secondary';
        if (status === 'success') {
            badgeClass = 'bg-success';
        } else if (status === 'failure' || status === 'error') {
            badgeClass = 'bg-danger';
        } else if (status === 'initiated') {
            badgeClass = 'bg-warning text-dark';
        }
        return `<span class="badge ${badgeClass}">${status}</span>`;
    }

    $('#auditLogTable').DataTable({
        processing: true,
        serverSide: true,
        ajax: {
            url: '/api/audit_log',
            type: 'POST',
            dataSrc: 'data' // Tell DataTables to use the 'data' property of the response
        },
        columns: [
            { 
                data: 'timestamp',
                render: function(data, type, row) {
                    return new Date(data).toLocaleString();
                }
            },
            { data: 'username' },
            { data: 'ip_address' },
            { 
                data: 'action',
                render: function(data, type, row) {
                    return `<span class="badge bg-info text-dark">${data}</span>`;
                }
            },
            { 
                data: 'status',
                render: function(data, type, row) {
                    return renderStatusBadge(data);
                }
            },
            { 
                data: 'details',
                render: function(data, type, row) {
                    // Use pre-wrap to respect newlines and break long words
                    return `<div style="white-space: pre-wrap; word-break: break-all;">${data}</div>`;
                }
            }
        ],
        order: [[0, 'desc']], // Default sort by timestamp descending
        language: {
            url: '/static/js/lib/datatables/zh-CN.json'
        },
        pageLength: 50,
        lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, "全部"]],
        responsive: true,
        autoWidth: false
    });
});