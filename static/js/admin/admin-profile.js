/**
 * 个人中心、会话
 */
// ========== 个人中心（标签页展开，非弹窗） ==========
function loadProfilePageData() {
    var infoEl = document.getElementById('profileInfo');
    if (infoEl && currentUser) {
        var roles = (currentUser.roles || []).map(function(r) { return r.name; }).join('、') || '无角色';
        infoEl.innerHTML = '<div class="profile-field"><label>用户名</label><span>' + escapeHtml(currentUser.username) + '</span></div>' +
            '<div class="profile-field"><label>邮箱</label><span>' + escapeHtml(currentUser.email) + '</span></div>' +
            '<div class="profile-field"><label>姓名</label><span>' + escapeHtml(currentUser.full_name || '-') + '</span></div>' +
            '<div class="profile-field"><label>角色</label><span>' + escapeHtml(roles) + '</span></div>' +
            '<div class="profile-field"><label>状态</label><span class="badge ' + (currentUser.is_active ? 'badge-success' : 'badge-danger') + '">' + (currentUser.is_active ? '已激活' : '未激活') + '</span></div>';
    }
    var form = document.getElementById('changePasswordForm');
    if (form && !form._profileBound) {
        form._profileBound = true;
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            var oldPwd = form.querySelector('[name="old_password"]').value;
            var newPwd = form.querySelector('[name="new_password"]').value;
            var confirmPwd = form.querySelector('[name="confirm_password"]').value;
            if (newPwd !== confirmPwd) {
                showMessage('两次输入的新密码不一致', 'error');
                return;
            }
            try {
                await API.post('/users/me/change-password', { old_password: oldPwd, new_password: newPwd, confirm_password: confirmPwd });
                showMessage('密码修改成功', 'success');
                form.reset();
            } catch (err) {
                showMessage('修改失败: ' + (err.message || ''), 'error');
            }
        });
    }
    loadMySessions();
}

function getCurrentJti() {
    try {
        var token = localStorage.getItem('access_token');
        if (!token) return null;
        var parts = token.split('.');
        if (parts.length !== 3) return null;
        var payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        var pad = payload.length % 4;
        if (pad) payload += new Array(5 - pad).join('=');
        var json = decodeURIComponent(atob(payload).split('').map(function(c) { return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2); }).join(''));
        var data = JSON.parse(json);
        return data.jti || null;
    } catch (e) { return null; }
}

function parseUserAgent(ua) {
    if (!ua || typeof ua !== 'string') return '未知设备';
    var u = ua;
    var os = '未知';
    if (/Windows/.test(u)) os = 'Windows';
    else if (/Android/.test(u)) os = 'Android';
    else if (/iPhone|iPad/.test(u)) os = /iPad/.test(u) ? 'iPad' : 'iPhone';
    else if (/Mac OS X/.test(u)) os = 'macOS';
    else if (/Linux/.test(u)) os = 'Linux';
    var browser = '未知';
    // 主流浏览器识别：Edge/Chrome/Firefox（含 iOS 特例）
    if (/Edg\//.test(u) || /EdgA\//.test(u) || /EdgiOS\//.test(u)) browser = 'Edge';
    else if (/Firefox\//.test(u) || /FxiOS\//.test(u)) browser = 'Firefox';
    else if (/Chrome\//.test(u) && !/Edg|OPR|Brave/.test(u)) browser = 'Chrome';
    else if (/Safari\//.test(u) && !/Chrome/.test(u)) browser = 'Safari';
    else if (/MSIE|Trident/.test(u)) browser = 'IE';
    return os + ' · ' + browser;
}

function renderSessionRow(s, currentJti) {
    var isCurrent = currentJti && s.jti === currentJti;
    var device = parseUserAgent(s.user_agent);
    var statusBadge = s.active ? '<span class="badge badge-success">活跃</span>' : (s.revoked ? '<span class="badge badge-danger">已撤销</span>' : '<span class="badge badge-warning">已过期</span>');
    var currentBadge = isCurrent ? ' <span class="badge badge-current-device">当前设备</span>' : '';
    var op = '-';
    if (s.active && !isCurrent) op = '<button type="button" class="btn btn-sm btn-danger" onclick="revokeSessionInModal(\'' + escapeHtml(s.jti) + '\')">撤销</button>';
    else if (isCurrent) op = '<span class="form-hint">本机请使用右上角登出</span>';
    var rowClass = isCurrent ? ' class="session-row-current"' : '';
    return '<tr' + rowClass + '><td>' + escapeHtml(device) + currentBadge + '</td><td>' + escapeHtml(s.ip || '-') + '</td><td>' + formatBeijingTime(s.created_at) + '</td><td>' + formatBeijingTime(s.expires_at) + '</td><td>' + statusBadge + '</td><td>' + op + '</td></tr>';
}

async function openProfileModal() {
    if (!currentUser) return;
    var sessions = [];
    try {
        sessions = await API.get('/auth/sessions/me');
    } catch (e) { sessions = []; }
    var currentJti = getCurrentJti();
    var roles = (currentUser.roles || []).map(function(r) { return r.name; }).join('、') || '无角色';
    var infoHtml = `
        <div class="profile-field"><label>用户名</label><span>${escapeHtml(currentUser.username)}</span></div>
        <div class="profile-field"><label>邮箱</label><span>${escapeHtml(currentUser.email)}</span></div>
        <div class="profile-field"><label>姓名</label><span>${escapeHtml(currentUser.full_name || '-')}</span></div>
        <div class="profile-field"><label>角色</label><span>${escapeHtml(roles)}</span></div>
        <div class="profile-field"><label>状态</label><span class="badge ${currentUser.is_active ? 'badge-success' : 'badge-danger'}">${currentUser.is_active ? '已激活' : '未激活'}</span></div>
    `;
    var sessionsRows = !sessions || sessions.length === 0
        ? '<tr><td colspan="6">暂无会话</td></tr>'
        : sessions.map(function(s) { return renderSessionRow(s, currentJti); }).join('');
    var content = `
        <div class="profile-modal-sections">
            <div class="profile-section profile-section-inline">
                <h4>基本信息</h4>
                <div class="profile-info">${infoHtml}</div>
            </div>
            <div class="profile-section profile-section-inline">
                <h4>修改密码</h4>
                <form id="profileChangePasswordForm" class="profile-form">
                    <div class="form-group">
                        <label>旧密码</label>
                        <input type="password" name="old_password" required autocomplete="current-password">
                    </div>
                    <div class="form-group">
                        <label>新密码</label>
                        <input type="password" name="new_password" required autocomplete="new-password">
                        <small class="form-hint">至少6位，需包含大写、小写字母和数字</small>
                    </div>
                    <div class="form-group">
                        <label>确认新密码</label>
                        <input type="password" name="confirm_password" required autocomplete="new-password">
                    </div>
                    <button type="submit" class="btn btn-primary">修改密码</button>
                </form>
            </div>
            <div class="profile-section profile-section-inline">
                <h4>活跃会话</h4>
                <p class="form-hint">可撤销不信任的会话，当前设备请使用右上角「登出」。</p>
                <button type="button" class="btn btn-warning btn-sm" id="profileRevokeOthersBtn" style="margin-bottom:10px">一键退出其它设备</button>
                <div class="table-container table-container-scroll">
                    <table class="data-table sessions-table">
                        <thead><tr><th>设备</th><th>IP</th><th>登录时间</th><th>过期时间</th><th>状态</th><th>操作</th></tr></thead>
                        <tbody id="profileModalSessionsBody">${sessionsRows}</tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
    showModal('个人中心', content, async function(form) {
        if (form.id !== 'profileChangePasswordForm') return;
        var fd = new FormData(form);
        var newPwd = fd.get('new_password');
        var confirmPwd = fd.get('confirm_password');
        if (newPwd !== confirmPwd) {
            showMessage('两次输入的新密码不一致', 'error');
            return;
        }
        var res = await API.post('/users/me/change-password', {
            old_password: fd.get('old_password'),
            new_password: newPwd
        });
        showMessage(res.message || '密码修改成功', 'success');
        form.reset();
    });

    var revokeOthersBtn = document.getElementById('profileRevokeOthersBtn');
    if (revokeOthersBtn) {
        revokeOthersBtn.onclick = async function() {
            if (!confirm('确定要退出除本机外的所有设备吗？其它设备需重新登录。')) return;
            try {
                var res = await API.post('/auth/sessions/me/revoke-others', {});
                showMessage(res.message || '已退出其它设备', 'success');
                var tbody = document.getElementById('profileModalSessionsBody');
                if (tbody) {
                    var sessions = await API.get('/auth/sessions/me');
                    var currentJti = getCurrentJti();
                    if (!sessions || sessions.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="6">暂无会话</td></tr>';
                    } else {
                        tbody.innerHTML = sessions.map(function(s) { return renderSessionRow(s, currentJti); }).join('');
                    }
                }
            } catch (e) {
                showMessage('操作失败: ' + (e.message || ''), 'error');
            }
        };
    }
}

async function revokeSessionInModal(jti) {
    if (!jti || !confirm('确定要撤销该会话吗？')) return;
    try {
        await API.request('/auth/sessions/me?jti=' + encodeURIComponent(jti), { method: 'DELETE' });
        showMessage('会话已撤销', 'success');
        var tbody = document.getElementById('profileModalSessionsBody');
        if (tbody) {
            var sessions = await API.get('/auth/sessions/me');
            var currentJti = getCurrentJti();
            if (!sessions || sessions.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6">暂无会话</td></tr>';
            } else {
                tbody.innerHTML = sessions.map(function(s) { return renderSessionRow(s, currentJti); }).join('');
            }
        }
    } catch (e) {
        showMessage('操作失败: ' + (e.message || ''), 'error');
    }
}

function renderSessionsPage() {
    var tbody = document.getElementById('sessionsTableBody');
    var paginationEl = document.getElementById('sessionsPagination');
    if (!tbody) return;
    var currentJti = getCurrentJti();
    var now = new Date();
    var filtered = (sessionsAll || []).filter(function(s) {
        if (sessionsFilter === 'all') return true;
        if (sessionsFilter === 'active') return !!s.active;
        if (sessionsFilter === 'revoked') return !!s.revoked;
        if (sessionsFilter === 'expired') return !s.active && !s.revoked;
        return true;
    });
    var total = filtered.length;
    var maxPage = Math.max(1, Math.ceil(total / sessionsPageSize));
    sessionsPageCurrent = Math.min(sessionsPageCurrent, maxPage);
    var start = (sessionsPageCurrent - 1) * sessionsPageSize;
    var list = filtered.slice(start, start + sessionsPageSize);
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7">暂无会话</td></tr>';
        if (paginationEl) renderPaginationBar(paginationEl, 1, maxPage, sessionsPageGo);
        return;
    }
    tbody.innerHTML = list.map(function(s) {
        var isCurrent = currentJti && s.jti === currentJti;
        var device = parseUserAgent(s.user_agent || '');
        var statusBadge = s.active
            ? '<span class="badge badge-success">活跃</span>'
            : (s.revoked ? '<span class="badge badge-danger">已撤销</span>' : '<span class="badge badge-warning">已过期</span>');
        var rowClass = isCurrent ? ' class="session-row-current"' : '';
        var op = '-';
        if (s.active && !isCurrent) op = '<button type="button" class="btn btn-sm btn-danger" data-jti="' + escapeHtml(s.jti || '') + '" onclick="revokeSession(this.getAttribute(\'data-jti\'))">撤销</button>';
        else if (isCurrent) op = '<span class="form-hint">当前设备不可撤销</span>';
        return '<tr' + rowClass + '>' +
            '<td title="' + escapeHtml(s.jti || '') + '">' + (s.jti ? escapeHtml(s.jti.substring(0, 12)) + '...' : '-') + '</td>' +
            '<td>' + escapeHtml(s.ip || '-') + '</td>' +
            '<td title="' + escapeHtml(s.user_agent || '') + '">' + escapeHtml(device) + (isCurrent ? ' <span class="badge badge-current-device">当前</span>' : '') + '</td>' +
            '<td>' + formatBeijingTime(s.created_at) + '</td>' +
            '<td>' + formatBeijingTime(s.expires_at) + '</td>' +
            '<td>' + statusBadge + '</td>' +
            '<td>' + op + '</td>' +
            '</tr>';
    }).join('');
    if (paginationEl) renderPaginationBar(paginationEl, sessionsPageCurrent, maxPage, sessionsPageGo);
}

function sessionsPageGo(page) {
    if (page < 1) return;
    sessionsPageCurrent = page;
    renderSessionsPage();
}

function applySessionsFilter() {
    var sel = document.getElementById('sessionsStatusFilter');
    if (sel) sessionsFilter = sel.value || 'active';
    sessionsPageCurrent = 1;
    renderSessionsPage();
}

async function loadMySessions() {
    var tbody = document.getElementById('sessionsTableBody');
    if (!tbody) return;
    try {
        tbody.innerHTML = '<tr><td colspan="7">加载中...</td></tr>';
        var sessions = await API.get('/auth/sessions/me');
        sessionsAll = Array.isArray(sessions) ? sessions : [];
        sessionsPageCurrent = 1;
        renderSessionsPage();
    } catch (e) {
        sessionsAll = [];
        tbody.innerHTML = '<tr><td colspan="7">加载失败</td></tr>';
    }
}

async function revokeSession(jti) {
    var currentJti = getCurrentJti();
    if (currentJti && jti === currentJti) {
        showMessage('当前设备会话不可撤销，请使用右上角登出', 'error');
        return;
    }
    if (!confirm('确定要撤销该会话吗？')) return;
    try {
        await API.request('/auth/sessions/me?jti=' + encodeURIComponent(jti), { method: 'DELETE' });
        showMessage('会话已撤销', 'success');
        loadMySessions();
    } catch (e) {
        showMessage('操作失败: ' + (e.message || ''), 'error');
    }
}

async function revokeOtherSessionsOnProfilePage() {
    if (!confirm('确定要撤销除本机外的所有会话吗？其它设备需重新登录。')) return;
    try {
        var res = await API.post('/auth/sessions/me/revoke-others', {});
        showMessage(res.message || '已撤销其它设备会话', 'success');
        loadMySessions();
    } catch (e) {
        showMessage('操作失败: ' + (e.message || ''), 'error');
    }
}
