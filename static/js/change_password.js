document.addEventListener('DOMContentLoaded', function() {
    const changePasswordModal = document.getElementById('changePasswordModal');
    const changePasswordForm = document.getElementById('changePasswordForm');
    const changePasswordSaveBtn = document.getElementById('changePasswordSaveBtn');
    const alertPlaceholder = document.getElementById('changePasswordAlertPlaceholder');

    if (!changePasswordSaveBtn) return; // Do nothing if the button isn't on the page

    changePasswordSaveBtn.addEventListener('click', async function() {
        const currentPassword = document.getElementById('current_password').value;
        const newPassword = document.getElementById('new_password').value;
        const confirmNewPassword = document.getElementById('confirm_new_password').value;

        // Basic frontend validation
        if (!currentPassword || !newPassword || !confirmNewPassword) {
            showAlert('所有字段都必须填写。', 'warning');
            return;
        }
        if (newPassword.length < 8) {
            showAlert('新密码长度至少为8位。', 'warning');
            return;
        }
        if (newPassword !== confirmNewPassword) {
            showAlert('新密码和确认密码不匹配。', 'warning');
            return;
        }

        try {
            const response = await fetch('/api/user/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    current_password: currentPassword,
                    new_password: newPassword,
                    confirm_new_password: confirmNewPassword
                })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || '发生未知错误');
            }

            showAlert('密码修改成功！您将在5秒后自动登出。', 'success');
            
            setTimeout(() => {
                // Hide modal and redirect to logout
                const modalInstance = bootstrap.Modal.getInstance(changePasswordModal);
                if (modalInstance) {
                    modalInstance.hide();
                }
                window.location.href = '/logout';
            }, 5000);

        } catch (error) {
            showAlert(error.message, 'danger');
        }
    });

    function showAlert(message, type) {
        if (!alertPlaceholder) return;
        const wrapper = document.createElement('div');
        wrapper.innerHTML = [
            `<div class="alert alert-${type} alert-dismissible fade show" role="alert">`,
            `   <div>${message}</div>`,
            '   <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>',
            '</div>'
        ].join('');
        alertPlaceholder.innerHTML = ''; // Clear previous alerts
        alertPlaceholder.append(wrapper);
    }
});
