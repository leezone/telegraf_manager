document.addEventListener('DOMContentLoaded', function() {
    let userPagination;
    let addUserModal = new bootstrap.Modal(document.getElementById('addUserModal'));
    let resetPasswordModal = new bootstrap.Modal(document.getElementById('resetPasswordModal'));
    let users = [];

    function init() {
        userPagination = new Pagination('users-pagination', {
            onPageChange: (page, perPage) => fetchUsers(page, perPage)
        });
        attachEventListeners();
        fetchUsers();
    }

    async function fetchUsers(page = 1, perPage = 20) {
        try {
            const data = await ApiClient.get(`/api/users?page=${page}&per_page=${perPage}`);
            users = data.items || [];
            renderUsersTable(users);
            userPagination.render(data.pagination);
        } catch (error) {
            showAlert(`加载用户失败: ${error.message}`, 'danger', 'admin-alert-placeholder');
        }
    }

    function renderUsersTable(userList) {
        const tbody = document.getElementById('usersTableBody');
        tbody.innerHTML = !userList || userList.length === 0
            ? '<tr><td colspan="3" class="text-center text-muted">没有用户。</td></tr>'
            : userList.map(user => `
                <tr>
                    <td>${user.id}</td>
                    <td>${user.username}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary me-2 reset-password-btn" data-user-id="${user.id}" data-username="${user.username}"><i class="bi bi-key"></i> 修改密码</button>
                        <button class="btn btn-sm btn-outline-danger delete-user-btn" data-user-id="${user.id}" ${user.username === 'admin' ? 'disabled' : ''}><i class="bi bi-trash"></i> 删除</button>
                    </td>
                </tr>`).join('');
    }

    function attachEventListeners() {
        document.getElementById('addUserBtn').addEventListener('click', () => {
            document.getElementById('addUserForm').reset();
            addUserModal.show();
        });

        document.getElementById('addUserSaveBtn').addEventListener('click', handleAddUser);
        document.getElementById('resetPasswordSaveBtn').addEventListener('click', handleResetPassword);

        document.getElementById('usersTableBody').addEventListener('click', (event) => {
            const resetBtn = event.target.closest('.reset-password-btn');
            const deleteBtn = event.target.closest('.delete-user-btn');

            if (resetBtn) {
                const userId = resetBtn.dataset.userId;
                const username = resetBtn.dataset.username;
                document.getElementById('resetPasswordForm').reset();
                document.getElementById('reset-user-id').value = userId;
                document.getElementById('reset-username').value = username;
                resetPasswordModal.show();
            }

            if (deleteBtn) {
                const userId = deleteBtn.dataset.userId;
                if (confirm('确定要删除这个用户吗？此操作不可撤销。')) {
                    handleDeleteUser(userId);
                }
            }
        });
    }

    async function handleAddUser() {
        const username = document.getElementById('add-username').value;
        const password = document.getElementById('add-password').value;
        const confirmPassword = document.getElementById('add-confirm-password').value;

        if (password !== confirmPassword) {
            return showAlert('两次输入的密码不匹配。', 'warning', 'addUserAlertPlaceholder');
        }

        try {
            await ApiClient.post('/api/users', { username, password });
            showAlert('用户创建成功！', 'success', 'admin-alert-placeholder');
            addUserModal.hide();
            fetchUsers();
        } catch (error) {
            showAlert(`创建用户失败: ${error.message}`, 'danger', 'addUserAlertPlaceholder');
        }
    }

    async function handleResetPassword() {
        const userId = document.getElementById('reset-user-id').value;
        const newPassword = document.getElementById('reset-new-password').value;
        const confirmPassword = document.getElementById('reset-confirm-password').value;

        if (newPassword !== confirmPassword) {
            return showAlert('两次输入的密码不匹配。', 'warning', 'resetPasswordAlertPlaceholder');
        }

        try {
            await ApiClient.put(`/api/users/${userId}/password`, { new_password: newPassword });
            showAlert('密码重置成功！', 'success', 'admin-alert-placeholder');
            resetPasswordModal.hide();
        } catch (error) {
            showAlert(`重置密码失败: ${error.message}`, 'danger', 'resetPasswordAlertPlaceholder');
        }
    }

    async function handleDeleteUser(userId) {
        try {
            await ApiClient.delete(`/api/users/${userId}`);
            showAlert('用户删除成功！', 'success', 'admin-alert-placeholder');
            fetchUsers();
        } catch (error) {
            showAlert(`删除用户失败: ${error.message}`, 'danger', 'admin-alert-placeholder');
        }
    }

    init();
});