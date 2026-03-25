/**
 * 系统设置
 */
// ========== 系统设置 ==========
async function loadSystemSettings() {
    try {
        var settings = await API.get('/system/settings');
        var allowCb = document.getElementById('toggleAllowRegistration');
        var allowStatus = document.getElementById('registrationStatus');
        if (allowCb) allowCb.checked = settings.allow_registration;
        if (allowStatus) allowStatus.textContent = settings.allow_registration ? '已开放' : '已关闭注册';

        var checkbox = document.getElementById('toggleApproval');
        var status = document.getElementById('approvalStatus');
        if (checkbox) checkbox.checked = settings.require_registration_approval;
        if (status) status.textContent = settings.require_registration_approval ? '已开启' : '已关闭';

        var secOverview = await API.get('/system/security-overview');
        var blEl = document.getElementById('blacklistSize');
        if (blEl) blEl.textContent = secOverview.token_blacklist_size;
    } catch (e) {
        console.error('加载系统设置失败:', e);
        handle403(e);
    }
}

async function toggleAllowRegistration(checkbox) {
    try {
        var res = await API.put('/system/settings', { allow_registration: checkbox.checked });
        var status = document.getElementById('registrationStatus');
        if (status) status.textContent = res.allow_registration ? '已开放' : '已关闭注册';
        showMessage('设置已更新', 'success');
    } catch (e) {
        checkbox.checked = !checkbox.checked;
        showMessage('更新失败: ' + (e.message || ''), 'error');
    }
}

async function toggleRegistrationApproval(checkbox) {
    try {
        var res = await API.put('/system/settings', {
            require_registration_approval: checkbox.checked
        });
        var status = document.getElementById('approvalStatus');
        if (status) status.textContent = res.require_registration_approval ? '已开启' : '已关闭';
        showMessage('设置已更新', 'success');
    } catch (e) {
        checkbox.checked = !checkbox.checked;
        showMessage('更新失败: ' + (e.message || ''), 'error');
    }
}
