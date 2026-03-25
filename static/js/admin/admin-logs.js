/**
 * 审计日志查询与导出
 */
// ========== 日志管理 ==========
const LOG_ACTION_LABELS = {
    login: '登录', logout: '登出', refresh: '刷新令牌',
    user_register: '用户注册', user_update: '用户更新', user_disable: '用户禁用',
    user_enable: '用户启用', user_delete: '用户删除',
    app_register: '应用注册', app_delete: '应用删除', app_approve: '应用审核', app_disable: '应用禁用', app_enable: '应用启用',
    check_permission: '权限检查', introspect: '令牌内省',
    change_password: '修改密码', account_locked: '账户锁定', login_lock: '登录锁定(IP+用户)', security_alert: '安全告警'
};

function formatLogDetails(details) {
    if (!details) return '-';
    const s = String(details);
    if (s.length <= 60) return s.replace(/"/g, "'");
    return s.slice(0, 57).replace(/"/g, "'") + '…';
}

async function loadLogs() {
    var tbody = document.getElementById('logsTableBody');
    var paginationEl = document.getElementById('logsPagination');
    if (!tbody) return;
    try {
        tbody.innerHTML = '<tr><td colspan="9">加载中...</td></tr>';
        if (paginationEl) paginationEl.innerHTML = '';
        var startTime = document.getElementById('logStartTime') && document.getElementById('logStartTime').value ? document.getElementById('logStartTime').value : '';
        var endTime = document.getElementById('logEndTime') && document.getElementById('logEndTime').value ? document.getElementById('logEndTime').value : '';
        var action = document.getElementById('logActionFilter') && document.getElementById('logActionFilter').value ? document.getElementById('logActionFilter').value : '';
        var success = document.getElementById('logSuccessFilter') && document.getElementById('logSuccessFilter').value ? document.getElementById('logSuccessFilter').value : '';
        var skip = (logsPageCurrent - 1) * logsPageSize;
        var url = '/logs/?limit=' + logsPageSize + '&skip=' + skip;
        if (startTime) url += '&start_time=' + encodeURIComponent(startTime);
        if (endTime) url += '&end_time=' + encodeURIComponent(endTime);
        if (action) url += '&action=' + encodeURIComponent(action);
        if (success === 'true' || success === 'false') url += '&success=' + success;
        var res = await API.get(url);
        var list = res && res.items ? res.items : [];
        var total = (res && typeof res.total === 'number') ? res.total : 0;
        var maxPage = Math.max(1, Math.ceil(total / logsPageSize));
        if (list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9">暂无日志</td></tr>';
            if (paginationEl) renderPaginationBar(paginationEl, logsPageCurrent, maxPage, logsPageGo);
            return;
        }
        tbody.innerHTML = list.map(log => `
            <tr>
                <td>${log.id}</td>
                <td>${log.actor_user_id ?? '-'}</td>
                <td>${log.action}</td>
                <td><span class="log-action-desc">${LOG_ACTION_LABELS[log.action] || '-'}</span></td>
                <td>${log.resource || '-'}</td>
                <td>${log.ip || '-'}</td>
                <td><span class="badge ${log.success ? 'badge-success' : 'badge-danger'}">${log.success ? '成功' : '失败'}</span></td>
                <td class="log-details" title="${(log.details || '').replace(/"/g, "'")}">${formatLogDetails(log.details)}</td>
                <td>${formatBeijingTime(log.created_at)}</td>
            </tr>
        `).join('');
        if (paginationEl) renderPaginationBar(paginationEl, logsPageCurrent, maxPage, logsPageGo);
    } catch (error) {
        console.error('加载日志列表失败:', error);
        tbody.innerHTML = '<tr><td colspan="9">加载失败</td></tr>';
        handle403(error);
    }
}

function logsPageGo(page) {
    if (page < 1) return;
    logsPageCurrent = page;
    loadLogs();
}

function queryLogs() {
    logsPageCurrent = 1;
    loadLogs();
}

async function exportLogs() {
    try {
        const startTime = document.getElementById('logStartTime')?.value;
        const endTime = document.getElementById('logEndTime')?.value;
        const action = document.getElementById('logActionFilter')?.value;
        const success = document.getElementById('logSuccessFilter')?.value;
        const params = new URLSearchParams();
        if (startTime) params.set('start_time', startTime);
        if (endTime) params.set('end_time', endTime);
        if (action) params.set('action', action);
        if (success === 'true' || success === 'false') params.set('success', success);
        const token = localStorage.getItem('access_token');
        const response = await fetch('/api/v1/logs/export?' + params.toString(), {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || '导出失败');
        }
        const blob = await response.blob();
        const disposition = response.headers.get('Content-Disposition');
        let filename = 'audit_logs_' + new Date().toISOString().slice(0, 10) + '.csv';
        if (disposition) {
            const m = disposition.match(/filename=(.+)/);
            if (m) filename = m[1].trim().replace(/^["']|["']$/g, '');
        }
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(downloadUrl);
        showMessage('日志导出成功', 'success');
    } catch (error) {
        showMessage('导出失败: ' + (error.message || '未知错误'), 'error');
    }
}
