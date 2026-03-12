/**
 * 管理控制台功能脚本
 */

let currentUser = null;
let isAdmin = false;
let myPermissionCodes = [];

document.addEventListener('DOMContentLoaded', async function() {
    const token = localStorage.getItem('access_token');
    if (!token) {
        window.location.href = '/login';
        return;
    }

    await loadCurrentUser();

    initNavigation();
    loadOverview();
});

function hasAdminRole(user) {
    return (user && user.roles && Array.isArray(user.roles)) && user.roles.some(function(r) { return r.name === 'admin'; });
}

function roleDisplayName(user) {
    if (!user || !user.roles || !user.roles.length) return '普通用户';
    if (hasAdminRole(user)) return '管理员';
    return user.roles.map(function(r) { return r.name; }).join('、') || '普通用户';
}

async function loadCurrentUser() {
    try {
        currentUser = await API.get('/users/me');
        isAdmin = hasAdminRole(currentUser);

        const userInfoTopbar = document.getElementById('userInfoTopbar');
        if (userInfoTopbar) {
            userInfoTopbar.innerHTML = `<strong>${currentUser.full_name || currentUser.username}</strong><span class="topbar-role">${roleDisplayName(currentUser)}</span>`;
        }
        const profileBtn = document.getElementById('profileTopbarBtn');
        if (profileBtn && !profileBtn._bound) {
            profileBtn._bound = true;
            profileBtn.addEventListener('click', openProfileModal);
        }

        // 拉取当前用户权限列表，用于控制导航可见性（仅按角色权限，不再使用 is_admin）
        try {
            const res = await API.get('/rbac/me/permissions');
            myPermissionCodes = Array.isArray(res.permission_codes) ? res.permission_codes : [];
        } catch (e) {
            myPermissionCodes = [];
        }

        applyNavVisibility();
    } catch (error) {
        console.error('加载用户信息失败:', error);
        if (error.status === 401 || error.message.includes('401')) {
            localStorage.removeItem('access_token');
            window.location.href = '/login';
        }
    }
}

function applyNavVisibility() {
    const map = {
        users: 'users:manage',
        roles: 'rbac:manage',
        apps: 'apps:manage',
        logs: 'logs:view',
        system: 'system:manage',
    };
    Object.keys(map).forEach(function(page) {
        const items = document.querySelectorAll('.nav-item[data-page="' + page + '"]');
        const needCode = map[page];
        let visible = false;
        if (myPermissionCodes && myPermissionCodes.indexOf(needCode) !== -1) {
            visible = true;
        }
        items.forEach(function(el) {
            el.style.display = visible ? '' : 'none';
        });
    });
}

function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const page = this.getAttribute('data-page');
            switchPage(page);
        });
    });
}

function switchPage(pageName) {
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    const activeNav = document.querySelector(`.nav-item[data-page="${pageName}"]`);
    if (activeNav) activeNav.classList.add('active');

    const titles = {
        'workbench': '工作台',
        'overview': '概览',
        'users': '用户管理',
        'roles': '角色权限管理',
        'apps': '应用管理',
        'logs': '审计日志',
        'system': '系统设置'
    };
    const titleEl = document.getElementById('pageTitle');
    if (titleEl) titleEl.textContent = titles[pageName] || '概览';

    document.querySelectorAll('.page-content').forEach(page => page.classList.remove('active'));
    const pageEl = document.getElementById(`${pageName}Page`);
    if (pageEl) pageEl.classList.add('active');

    switch(pageName) {
        case 'workbench':
            loadWorkbench();
            break;
        case 'overview':
            loadOverview();
            break;
        case 'users':
            loadUserRoleFilterOptions();
            switchUsersTab(document.querySelector('#usersPage .tab-btn.active')?.getAttribute('data-tab') || 'usersList');
            break;
        case 'roles':
            loadRoles();
            break;
        case 'apps':
            loadApps();
            break;
        case 'logs':
            loadLogs();
            break;
        case 'system':
            loadSystemSettings();
            break;
    }
}

async function loadWorkbench() {
    const gridEl = document.getElementById('workbenchGrid');
    if (!gridEl) return;
    try {
        gridEl.innerHTML = '<p class="workbench-loading">加载中...</p>';
        const res = await API.get('/apps/workbench');
        const apps = (res && res.apps) ? res.apps : [];
        const withCallback = apps.filter(function(a) { return a.callback_url && a.callback_url.trim(); });
        if (withCallback.length === 0) {
            gridEl.innerHTML = '<p class="workbench-loading">暂无已接入应用，或您暂无访问权限。</p>';
            return;
        }
        var authOrigin = window.location.origin;
        gridEl.innerHTML = withCallback.map(function(app) {
            var cb = app.callback_url.trim();
            var entryUrl = cb.replace(/\/oauth\/callback\/?$/i, '/') || (cb.split('/').slice(0, -1).join('/') + '/');
            var sep = entryUrl.indexOf('?') >= 0 ? '&' : '?';
            var href = entryUrl + sep + 'auth_origin=' + encodeURIComponent(authOrigin);
            var name = app.app_name || app.app_id || '应用';
            var iconText = name.charAt(0).toUpperCase();
            return '<a class="workbench-card" href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer" title="' + (app.description || name) + '">' +
                '<div class="workbench-card-icon">' + iconText + '</div>' +
                '<span class="workbench-card-name">' + escapeHtml(name) + '</span></a>';
        }).join('');
    } catch (e) {
        console.error('加载工作台失败:', e);
        gridEl.innerHTML = '<p class="workbench-loading">加载失败，请稍后重试。</p>';
    }
}

function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

function formatUserStatus(user) {
    if (!user) return '';
    var lockedUntil = user.locked_until ? parseUtcIso(user.locked_until) : null;
    if (!user.is_active) return { text: '永久禁用', badge: 'badge-danger' };
    if (lockedUntil && lockedUntil.getTime() > Date.now()) {
        var sec = Math.max(0, Math.floor((lockedUntil.getTime() - Date.now()) / 1000));
        var m = Math.floor(sec / 60);
        var h = Math.floor(m / 60);
        var d = Math.floor(h / 24);
        if (d > 0) return { text: '已禁用 (剩余 ' + d + ' 天)', badge: 'badge-danger' };
        if (h > 0) return { text: '已禁用 (剩余 ' + h + ' 小时)', badge: 'badge-danger' };
        if (m > 0) return { text: '已禁用 (剩余 ' + m + ' 分钟)', badge: 'badge-danger' };
        return { text: '已禁用 (剩余 ' + sec + ' 秒)', badge: 'badge-danger' };
    }
    if (user.locked_until != null && user.locked_until !== '') return { text: '已激活（可解封清除）', badge: 'badge-success' };
    return { text: '已激活', badge: 'badge-success' };
}

function isUserLocked(user) {
    if (!user) return false;
    if (!user.is_active) return true;
    if (user.locked_until != null && user.locked_until !== '') return true;
    return false;
}

let loginTrendChartInstance = null;
let actionPieChartInstance = null;

async function loadOverview() {
    var codes = myPermissionCodes || [];
    var grid = document.getElementById('overviewStatsGrid');
    if (grid) {
        grid.querySelectorAll('.stat-card[data-permission]').forEach(function(card) {
            var perm = card.getAttribute('data-permission');
            card.style.display = (perm && codes.indexOf(perm) !== -1) ? '' : 'none';
        });
    }
    document.querySelectorAll('[data-permission]').forEach(function(el) {
        if (el.closest('#overviewStatsGrid')) return;
        var perm = el.getAttribute('data-permission');
        el.style.display = (perm && codes.indexOf(perm) !== -1) ? '' : 'none';
    });

    async function fetchUsers() {
        if (codes.indexOf('users:manage') === -1) return;
        var users = await API.get('/users/');
        var el = document.getElementById('totalUsers');
        if (el) el.textContent = Array.isArray(users) ? users.length : 0;
    }
    async function fetchApps() {
        if (codes.indexOf('apps:manage') === -1) return;
        var apps = await API.get('/apps/');
        var el = document.getElementById('totalApps');
        if (el) el.textContent = Array.isArray(apps) ? apps.length : 0;
    }
    async function fetchRoles() {
        if (codes.indexOf('rbac:manage') === -1) return;
        var roles = await API.get('/rbac/roles');
        var el = document.getElementById('totalRoles');
        if (el) el.textContent = Array.isArray(roles) ? roles.length : 0;
    }
    async function fetchLogs() {
        if (codes.indexOf('logs:view') === -1) return;
        var logs = await API.get('/logs/');
        var el = document.getElementById('todayLogs');
        if (el) {
            var today = new Date();
            today.setHours(0, 0, 0, 0);
            var todayLogs = Array.isArray(logs) ? logs.filter(function(log) { return new Date(log.created_at) >= today; }) : [];
            el.textContent = todayLogs.length;
        }
    }

    var promises = [fetchUsers(), fetchApps(), fetchRoles(), fetchLogs()];

    if (codes.indexOf('logs:view') !== -1) {
        var chartsRow = document.getElementById('overviewChartsRow');
        if (chartsRow && chartsRow.style.display !== 'none') {
            promises.push(loadLoginTrendChart());
            promises.push(loadActionPieChart());
        }
    }
    if (codes.indexOf('users:manage') !== -1) {
        promises.push(loadSecurityOverview());
    }

    try {
        await Promise.allSettled(promises);
    } catch (e) {
        console.error('加载概览数据失败:', e);
    }
}

async function loadLoginTrendChart() {
    try {
        var data = await API.get('/logs/login-trend?days=7');
        var canvas = document.getElementById('loginTrendChart');
        if (!canvas) return;
        var sorted = (data || []).slice().sort(function(a, b) { return (a.date || '').localeCompare(b.date || ''); });
        var labels = sorted.map(function(d) { return d.date; });
        var success = sorted.map(function(d) { return d.success || 0; });
        var fail = sorted.map(function(d) { return d.fail || 0; });
        if (loginTrendChartInstance) {
            loginTrendChartInstance.destroy();
            loginTrendChartInstance = null;
        }
        requestAnimationFrame(function() {
            if (!document.getElementById('loginTrendChart')) return;
            loginTrendChartInstance = new Chart(canvas, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        { label: '登录成功', data: success, borderColor: '#52c41a', backgroundColor: 'rgba(82,196,26,0.1)', tension: 0.3, fill: true },
                        { label: '登录失败', data: fail, borderColor: '#ff4d4f', backgroundColor: 'rgba(255,77,79,0.1)', tension: 0.3, fill: true }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: { padding: { top: 8, bottom: 8 } },
                    plugins: { legend: { position: 'bottom' } },
                    scales: { y: { beginAtZero: true, ticks: { stepSize: 1 }, min: 0 } }
                }
            });
        });
    } catch (e) { console.error('加载登录趋势失败:', e); }
}

async function loadActionPieChart() {
    try {
        var data = await API.get('/logs/action-distribution?days=7');
        var canvas = document.getElementById('actionPieChart');
        if (!canvas) return;
        var labels = (data || []).map(function(d) { return d.label; });
        var counts = (data || []).map(function(d) { return d.count || 0; });
        var total = counts.reduce(function(sum, v) { return sum + (v || 0); }, 0) || 1;
        if (actionPieChartInstance) {
            actionPieChartInstance.destroy();
            actionPieChartInstance = null;
        }
        var colors = ['#1890ff','#52c41a','#faad14','#ff4d4f','#722ed1','#13c2c2','#eb2f96','#fa8c16','#a0d911','#2f54eb','#36cfc9','#f759ab','#597ef7','#9254de','#ffc53d'];
        requestAnimationFrame(function() {
            if (!document.getElementById('actionPieChart')) return;
            actionPieChartInstance = new Chart(canvas, {
                type: 'doughnut',
                data: { labels: labels, datasets: [{ data: counts, backgroundColor: colors.slice(0, labels.length) }] },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: { padding: 8 },
                    plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    var label = context.label || '';
                                    var value = context.parsed || 0;
                                    var dataArr = context.chart.data.datasets[0].data || [];
                                    var sum = dataArr.reduce(function(s, v) { return s + (v || 0); }, 0) || 1;
                                    var pct = ((value / sum) * 100).toFixed(1);
                                    return label + ': ' + value + ' (' + pct + '%)';
                                }
                            }
                        }
                    }
                }
            });
        });
    } catch (e) { console.error('加载操作分布失败:', e); }
}

async function loadSecurityOverview() {
    try {
        var [overview, alerts] = await Promise.all([
            API.get('/system/security-overview'),
            API.get('/logs/security-alerts?days=7&limit=10')
        ]);
        var statsEl = document.getElementById('securityStatsContent');
        if (statsEl) {
            statsEl.innerHTML = `
                <div class="security-stat-row">
                    <span class="security-stat-item"><strong>${overview.token_blacklist_size}</strong> Token黑名单</span>
                    <span class="security-stat-item"><strong>${overview.locked_accounts}</strong> 锁定账户</span>
                    <span class="security-stat-item"><strong>${overview.pending_users}</strong> 待审核用户</span>
                    <span class="security-stat-item"><strong>${overview.recent_alerts}</strong> 近7天告警</span>
                </div>`;
        }
        var listEl = document.getElementById('securityAlertsList');
        if (listEl) {
            if (!alerts || alerts.length === 0) {
                listEl.innerHTML = '<p class="form-hint">近7天无安全告警</p>';
            } else {
                listEl.innerHTML = alerts.map(function(a) {
                    var typeLabel = a.action === 'account_locked' ? '账户锁定' : (a.action === 'login_lock' ? '登录锁定' : '安全告警');
                    var detail = '';
                    try { var d = JSON.parse(a.details || '{}'); detail = d.type === 'ip_change' ? '异地登录 ' + (d.prev_ip||'') + ' → ' + (d.new_ip||'') : (d.reason || ''); } catch(e) {}
                    return '<div class="alert-item"><span class="badge badge-danger">' + typeLabel + '</span> 用户ID:' + (a.actor_user_id||'-') + ' IP:' + (a.ip||'-') + ' ' + detail + ' <small>' + formatBeijingTime(a.created_at) + '</small></div>';
                }).join('');
            }
        }
    } catch (e) { console.error('加载安全概览失败:', e); }
}

// ========== 用户管理 ==========
function switchUsersTab(tabId) {
    var tab = tabId || 'usersList';
    document.querySelectorAll('#usersPage .tab-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
    });
    document.querySelectorAll('#usersPage .tab-content').forEach(function(el) {
        el.classList.toggle('active', el.id === tab + 'Tab');
    });
    if (tab === 'approval') {
        loadPendingUsers();
    } else {
        loadUsers();
    }
}

async function loadUserRoleFilterOptions() {
    var sel = document.getElementById('userRoleFilter');
    if (!sel) return;
    try {
        var roles = await API.get('/rbac/roles');
        var opts = '<option value="">全部</option><option value="__no_role__">无角色</option>';
        if (Array.isArray(roles)) {
            roles.forEach(function(r) {
                opts += '<option value="' + escapeHtml(r.name) + '">' + escapeHtml(r.name) + '</option>';
            });
        }
        sel.innerHTML = opts;
    } catch (e) {
        sel.innerHTML = '<option value="">全部</option><option value="__no_role__">无角色</option>';
    }
}

async function loadUsers() {
    const feedbackEl = document.getElementById('userSearchFeedback');
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    try {
        tbody.innerHTML = '<tr><td colspan="8">加载中...</td></tr>';
        const keyword = document.getElementById('userSearch')?.value?.trim();
        const statusFilter = document.getElementById('userStatusFilter')?.value;
        const roleFilter = document.getElementById('userRoleFilter')?.value;
        let url = '/users/?limit=500&scope=managed';
        if (statusFilter === 'active') url += '&is_active=true';
        else if (statusFilter === 'disabled') url += '&is_active=false';
        if (keyword) url += '&keyword=' + encodeURIComponent(keyword);
        if (roleFilter && roleFilter.trim()) url += '&role_name=' + encodeURIComponent(roleFilter.trim());
        const users = await API.get(url);
        if (feedbackEl) {
            if (keyword) {
                feedbackEl.textContent = users.length === 0 ? '未找到匹配用户，请调整关键词' : '共 ' + users.length + ' 条结果';
            } else {
                feedbackEl.textContent = users.length === 0 ? '暂无用户' : '共 ' + users.length + ' 名用户';
            }
        }
        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8">暂无用户</td></tr>';
            return;
        }
        document.getElementById('usersSelectAll').checked = false;
        tbody.innerHTML = users.map(user => {
            var status = formatUserStatus(user);
            var locked = isUserLocked(user);
            var op = locked
                ? '<button class="btn btn-sm btn-success" onclick="enableUser(' + user.id + ')">解封</button>'
                : '<button class="btn btn-sm btn-warning" onclick="showDisableUserModal(' + user.id + ')">禁用</button>';
            return '<tr>' +
                '<td><input type="checkbox" class="user-row-cb" value="' + user.id + '" aria-label="选择"></td>' +
                '<td>' + user.id + '</td>' +
                '<td>' + escapeHtml(user.username) + '</td>' +
                '<td>' + escapeHtml(user.email) + '</td>' +
                '<td>' + escapeHtml(user.full_name || '-') + '</td>' +
                '<td><span class="badge ' + status.badge + '">' + escapeHtml(status.text) + '</span></td>' +
                '<td>' + (user.roles && user.roles.length ? user.roles.map(function(r){ return r.name; }).join('、') : '无角色') + '</td>' +
                '<td><button class="btn btn-sm btn-primary" onclick="editUser(' + user.id + ')">编辑</button> ' + op + ' <button class="btn btn-sm btn-danger" onclick="deleteUser(' + user.id + ')">删除</button></td>' +
                '</tr>';
        }).join('');
    } catch (error) {
        console.error('加载用户列表失败:', error);
        if (feedbackEl) feedbackEl.textContent = '加载失败';
        if (tbody) tbody.innerHTML = '<tr><td colspan="8">加载失败</td></tr>';
    }
}

async function loadPendingUsers() {
    var tbody = document.getElementById('pendingTableBody');
    if (!tbody) return;
    try {
        tbody.innerHTML = '<tr><td colspan="6">加载中...</td></tr>';
        var users = await API.get('/users/?limit=500&scope=pending');
        if (!users || users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6">暂无待审核用户</td></tr>';
            return;
        }
        tbody.innerHTML = users.map(function(user) {
            var createdAt = user.created_at ? formatBeijingTime(user.created_at) : '-';
            return '<tr>' +
                '<td>' + user.id + '</td>' +
                '<td>' + escapeHtml(user.username) + '</td>' +
                '<td>' + escapeHtml(user.email) + '</td>' +
                '<td>' + escapeHtml(user.full_name || '-') + '</td>' +
                '<td>' + createdAt + '</td>' +
                '<td><button class="btn btn-sm btn-success" onclick="approveUser(' + user.id + ')">通过</button> <button class="btn btn-sm btn-danger" onclick="rejectUser(' + user.id + ')">拒绝</button></td>' +
                '</tr>';
        }).join('');
    } catch (e) {
        console.error('加载待审核列表失败:', e);
        tbody.innerHTML = '<tr><td colspan="6">加载失败</td></tr>';
    }
}

async function approveUser(userId) {
    if (!confirm('确定通过该用户的注册申请？通过后可登录系统。')) return;
    try {
        await API.post('/users/' + userId + '/enable');
        showMessage('已通过，该用户可登录', 'success');
        loadPendingUsers();
    } catch (e) {
        showMessage('操作失败: ' + (e.message || ''), 'error');
    }
}

async function rejectUser(userId) {
    if (!confirm('确定拒绝该用户的注册？拒绝后将删除该账号。')) return;
    try {
        await API.request('/users/' + userId, { method: 'DELETE' });
        showMessage('已拒绝并删除该账号', 'success');
        loadPendingUsers();
    } catch (e) {
        showMessage('操作失败: ' + (e.message || ''), 'error');
    }
}

function searchUsers() {
    loadUsers();
}

function toggleUsersSelectAll(checkbox) {
    document.querySelectorAll('#usersTableBody input.user-row-cb').forEach(function(cb) { cb.checked = checkbox.checked; });
}
function getSelectedUserIds() {
    return Array.from(document.querySelectorAll('#usersTableBody input.user-row-cb:checked')).map(function(cb) { return parseInt(cb.value, 10); });
}
async function batchDeleteUsers() {
    var ids = getSelectedUserIds();
    if (ids.length === 0) { showMessage('请先勾选要删除的用户', 'error'); return; }
    if (!confirm('确定要删除选中的 ' + ids.length + ' 个用户吗？此操作不可恢复！')) return;
    try {
        var res = await API.post('/users/batch-delete', { user_ids: ids });
        loadUsers();
        showMessage(res.message || '批量删除成功', 'success');
    } catch (e) {
        showMessage('操作失败: ' + (e.message || ''), 'error');
    }
}

async function showCreateUserModal() {
    var roles = [];
    try {
        roles = await API.get('/rbac/roles');
    } catch (e) {
        roles = [];
    }
    var rolesHtml = roles.length === 0
        ? '<p class="workbench-loading">暂无角色</p>'
        : roles.map(r => `<label class="assign-perm-item"><input type="checkbox" name="role_id" value="${r.id}"><span class="assign-perm-label">${r.name}${r.description ? '（' + r.description + '）' : ''}</span></label>`).join('');
    showModal('创建用户', `
        <form id="createUserForm">
            <div class="form-group">
                <label>用户名</label>
                <input type="text" name="username" required>
            </div>
            <div class="form-group">
                <label>邮箱</label>
                <input type="email" name="email" required>
            </div>
            <div class="form-group">
                <label>姓名</label>
                <input type="text" name="full_name">
            </div>
            <div class="form-group">
                <label>密码</label>
                <input type="password" name="password" required>
            </div>
            <div class="form-group">
                <label>分配角色</label>
                <div class="assign-permissions-list">${rolesHtml}</div>
            </div>
            <div class="modal-actions">
                <button type="submit" class="btn btn-primary">创建</button>
                <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
            </div>
        </form>
    `, async (form) => {
        const formData = new FormData(form);
        var roleIds = Array.from(form.querySelectorAll('input[name="role_id"]:checked')).map(function(cb) { return parseInt(cb.value, 10); });
        await API.post('/users/', {
            username: formData.get('username'),
            email: formData.get('email'),
            full_name: formData.get('full_name'),
            password: formData.get('password'),
            role_ids: roleIds
        });
        closeModal();
        loadUsers();
        showMessage('用户创建成功', 'success');
    });
}

var DISABLE_DURATIONS = [
    { value: '15m', label: '15 分钟' },
    { value: '1h', label: '1 小时' },
    { value: '1d', label: '1 天' },
    { value: '7d', label: '7 天' },
    { value: '1month', label: '1 个月' },
    { value: '1year', label: '1 年' },
    { value: 'permanent', label: '永久禁用' }
];

function showDisableUserModal(userId) {
    var options = DISABLE_DURATIONS.map(function(d) {
        return '<option value="' + d.value + '">' + d.label + '</option>';
    }).join('');
    showModal('禁用用户', `
        <form id="disableUserForm">
            <input type="hidden" name="user_id" value="${userId}">
            <div class="form-group">
                <label>禁用时长</label>
                <select name="duration" id="disableDurationSelect" onchange="toggleDisableCustom(this)">
                    ${options}
                </select>
            </div>
            <div class="form-group" id="disableCustomGroup" style="display:none">
                <label>自定义时长（分钟）</label>
                <input type="number" name="custom_minutes" id="disableCustomMinutes" min="1" placeholder="例如 120">
            </div>
            <div class="modal-actions">
                <button type="submit" class="btn btn-primary">确定禁用</button>
                <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
            </div>
        </form>
    `, async function(form) {
        var duration = form.querySelector('[name="duration"]').value;
        var customEl = form.querySelector('#disableCustomMinutes');
        var body = {};
        if (form.querySelector('#disableCustomGroup').style.display !== 'none' && customEl && customEl.value) {
            var m = parseInt(customEl.value, 10);
            if (m > 0) body.custom_minutes = m;
        }
        if (!body.custom_minutes) body.duration = duration;
        await API.post('/users/' + userId + '/disable', body);
        closeModal();
        loadUsers();
        showMessage('用户已禁用', 'success');
    });
    window.toggleDisableCustom = function(sel) {
        var show = sel.value === 'custom';
        document.getElementById('disableCustomGroup').style.display = show ? '' : 'none';
    };
    var sel = document.getElementById('disableDurationSelect');
    if (sel) {
        var opt = document.createElement('option');
        opt.value = 'custom';
        opt.textContent = '自定义时长';
        sel.appendChild(opt);
    }
}

async function enableUser(userId) {
    try {
        await API.post('/users/' + userId + '/enable');
        loadUsers();
        showMessage('已解封 / 已启用', 'success');
    } catch (error) {
        showMessage('操作失败: ' + (error.message || ''), 'error');
    }
}

async function deleteUser(userId) {
    if (!confirm('确定要删除该用户吗？此操作不可恢复！')) return;
    try {
        await API.request(`/users/${userId}`, { method: 'DELETE' });
        loadUsers();
        showMessage('用户已删除', 'success');
    } catch (error) {
        showMessage('操作失败: ' + error.message, 'error');
    }
}

async function editUser(userId) {
    try {
        const [user, roles] = await Promise.all([
            API.get(`/users/${userId}`),
            API.get('/rbac/roles')
        ]);
        const userRoleIds = (user.roles || []).map(r => r.id);
        const rolesHtml = roles.length === 0
            ? '<p class="workbench-loading">暂无角色</p>'
            : roles.map(r => `<label class="assign-perm-item"><input type="checkbox" name="role_id" value="${r.id}" ${userRoleIds.indexOf(r.id) >= 0 ? 'checked' : ''}><span class="assign-perm-label">${r.name}${r.description ? '（' + r.description + '）' : ''}</span></label>`).join('');
        showModal('编辑用户', `
            <form id="editUserForm">
                <input type="hidden" name="id" value="${user.id}">
                <div class="form-group">
                    <label>用户名</label>
                    <input type="text" name="username" value="${user.username}" disabled>
                </div>
                <div class="form-group">
                    <label>邮箱</label>
                    <input type="email" name="email" value="${user.email}">
                </div>
                <div class="form-group">
                    <label>姓名</label>
                    <input type="text" name="full_name" value="${user.full_name || ''}">
                </div>
                <div class="form-group form-group-password">
                    <label>修改密码</label>
                    <input type="password" name="password" placeholder="留空表示不修改密码" autocomplete="new-password">
                    <small class="form-hint">如需修改密码请在此输入新密码，不修改则留空</small>
                </div>
                <div class="form-group">
                    <label>分配角色</label>
                    <div class="assign-permissions-list">${rolesHtml}</div>
                </div>
                <div class="modal-actions">
                    <button type="submit" class="btn btn-primary">保存</button>
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
                </div>
            </form>
        `, async (form) => {
            const formData = new FormData(form);
            const data = {
                email: formData.get('email'),
                full_name: formData.get('full_name')
            };
            const pwd = formData.get('password');
            if (pwd && String(pwd).trim()) data.password = String(pwd).trim();
            // 1) 更新基本信息
            await API.put(`/users/${userId}`, data);
            // 2) 更新角色分配
            const roleIds = Array.from(form.querySelectorAll('input[name="role_id"]:checked')).map(function(cb) { return parseInt(cb.value, 10); });
            await API.post(`/rbac/users/${userId}/roles`, { role_ids: roleIds });
            closeModal();
            loadUsers();
            showMessage('用户编辑成功', 'success');
        });
    } catch (error) {
        console.error('加载用户信息失败:', error);
        showMessage('加载用户信息失败', 'error');
    }
}

// ========== 角色管理 ==========
async function loadRoles() {
    try {
        const roles = await API.get('/rbac/roles/');
        const tbody = document.getElementById('rolesTableBody');
        if (!tbody) return;
        if (roles.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6">暂无角色</td></tr>';
            return;
        }
        var rolesSelectAll = document.getElementById('rolesSelectAll');
        if (rolesSelectAll) rolesSelectAll.checked = false;
        tbody.innerHTML = roles.map(role => `
            <tr>
                <td><input type="checkbox" class="role-row-cb" value="${role.id}" aria-label="选择"></td>
                <td>${role.id}</td>
                <td>${role.name}</td>
                <td>${role.description || '-'}</td>
                <td>${role.permission_count != null ? role.permission_count : (role.permissions ? role.permissions.length : 0)}</td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="editRole(${role.id})">编辑</button>
                    <button class="btn btn-sm btn-info" onclick="assignPermissions(${role.id})">分配权限</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteRole(${role.id})">删除</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('加载角色列表失败:', error);
    }
}

function showCreateRoleModal() {
    showModal('创建角色', `
        <form id="createRoleForm">
            <div class="form-group">
                <label>角色名称</label>
                <input type="text" name="name" required>
            </div>
            <div class="form-group">
                <label>描述</label>
                <textarea name="description"></textarea>
            </div>
            <div class="modal-actions">
                <button type="submit" class="btn btn-primary">创建</button>
                <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
            </div>
        </form>
    `, async (form) => {
        const formData = new FormData(form);
        await API.post('/rbac/roles', {
            name: formData.get('name'),
            description: formData.get('description')
        });
        closeModal();
        loadRoles();
        showMessage('角色创建成功', 'success');
    });
}

function toggleRolesSelectAll(checkbox) {
    document.querySelectorAll('#rolesTableBody input.role-row-cb').forEach(function(cb) { cb.checked = checkbox.checked; });
}
function getSelectedRoleIds() {
    return Array.from(document.querySelectorAll('#rolesTableBody input.role-row-cb:checked')).map(function(cb) { return parseInt(cb.value, 10); });
}
async function batchDeleteRoles() {
    var ids = getSelectedRoleIds();
    if (ids.length === 0) { showMessage('请先勾选要删除的角色', 'error'); return; }
    if (!confirm('确定要删除选中的 ' + ids.length + ' 个角色吗？')) return;
    try {
        var res = await API.post('/rbac/roles/batch-delete', { role_ids: ids });
        loadRoles();
        showMessage(res.message || '批量删除成功', 'success');
    } catch (e) {
        showMessage('操作失败: ' + (e.message || ''), 'error');
    }
}

async function deleteRole(roleId) {
    if (!confirm('确定要删除该角色吗？')) return;
    try {
        await API.request(`/rbac/roles/${roleId}`, { method: 'DELETE' });
        loadRoles();
        showMessage('角色已删除', 'success');
    } catch (error) {
        showMessage('操作失败: ' + (error.message || '未知错误'), 'error');
    }
}

async function editRole(roleId) {
    try {
        const role = await API.get(`/rbac/roles/${roleId}`);
        showModal('编辑角色', `
            <form id="editRoleForm">
                <div class="form-group">
                    <label>角色名称</label>
                    <input type="text" name="name" value="${role.name}" required>
                </div>
                <div class="form-group">
                    <label>描述</label>
                    <textarea name="description">${role.description || ''}</textarea>
                </div>
                <div class="modal-actions">
                    <button type="submit" class="btn btn-primary">保存</button>
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
                </div>
            </form>
        `, async (form) => {
            const formData = new FormData(form);
            await API.put(`/rbac/roles/${roleId}`, {
                name: formData.get('name'),
                description: formData.get('description')
            });
            closeModal();
            loadRoles();
            showMessage('角色编辑成功', 'success');
        });
    } catch (error) {
        showMessage('加载角色信息失败', 'error');
    }
}

async function assignPermissions(roleId) {
    try {
        const [role, allPerms, rolePermsRes] = await Promise.all([
            API.get('/rbac/roles/' + roleId),
            API.get('/rbac/permissions'),
            API.get('/rbac/roles/' + roleId + '/permissions')
        ]);
        const rolePermIds = (rolePermsRes && rolePermsRes.permission_ids) ? rolePermsRes.permission_ids : [];
        const checkboxesHtml = (allPerms.length === 0)
            ? '<p class="workbench-loading">暂无权限，请先在权限管理中创建权限。</p>'
            : allPerms.map(p => `<label class="assign-perm-item"><input type="checkbox" name="perm" value="${p.id}" ${rolePermIds.indexOf(p.id) >= 0 ? 'checked' : ''}><span class="assign-perm-label">${p.name || p.code}</span></label>`).join('');
        showModal('为角色「' + (role.name || '') + '」分配权限', `
            <form id="assignPermissionsForm">
                <div class="form-group">
                    <p>勾选该角色拥有的权限：</p>
                    <div class="assign-perm-toolbar">
                        <label><input type="checkbox" id="assignPermSelectAll" onchange="toggleAssignPermSelectAll(this)"> 全选</label>
                    </div>
                    <div class="assign-permissions-list">${checkboxesHtml}</div>
                </div>
                <div class="modal-actions">
                    <button type="submit" class="btn btn-primary">保存</button>
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
                </div>
            </form>
        `, async (form) => {
            const permIds = Array.from(form.querySelectorAll('input[name="perm"]:checked')).map(function(cb) { return parseInt(cb.value, 10); });
            await API.post('/rbac/roles/' + roleId + '/permissions', { permission_ids: permIds });
            closeModal();
            loadRoles();
            loadPermissions();
            showMessage('权限分配已保存', 'success');
        });
    } catch (error) {
        showMessage('加载失败: ' + (error.message || ''), 'error');
    }
}

function toggleAssignPermSelectAll(checkbox) {
    document.querySelectorAll('#assignPermissionsForm input[name="perm"]').forEach(function(cb) {
        cb.checked = checkbox.checked;
    });
}

// ========== 权限管理 ==========
async function loadPermissions() {
    try {
        const list = await API.get('/rbac/permissions');
        const tbody = document.getElementById('permissionsTableBody');
        if (!tbody) return;
        if (list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7">暂无权限</td></tr>';
            return;
        }
        var permSelectAll = document.getElementById('permissionsSelectAll');
        if (permSelectAll) permSelectAll.checked = false;
        tbody.innerHTML = list.map(p => `
            <tr>
                <td><input type="checkbox" class="permission-row-cb" value="${p.id}" aria-label="选择"></td>
                <td>${p.id}</td>
                <td>${p.code}</td>
                <td>${p.name}</td>
                <td>${p.resource_id || '-'}</td>
                <td>${p.description || '-'}</td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="editPermission(${p.id})">编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="deletePermission(${p.id})">删除</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('加载权限列表失败:', error);
    }
}

function showCreatePermissionModal() {
    showModal('创建权限', `
        <form id="createPermissionForm">
            <div class="form-group">
                <label>权限代码</label>
                <input type="text" name="code" placeholder="如: orders:read" required>
            </div>
            <div class="form-group">
                <label>权限名称</label>
                <input type="text" name="name" required>
            </div>
            <div class="form-group">
                <label>资源ID</label>
                <input type="number" name="resource_id" required>
            </div>
            <div class="form-group">
                <label>描述</label>
                <textarea name="description"></textarea>
            </div>
            <div class="modal-actions">
                <button type="submit" class="btn btn-primary">创建</button>
                <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
            </div>
        </form>
    `, async (form) => {
        const formData = new FormData(form);
        await API.post('/rbac/permissions', {
            code: formData.get('code'),
            name: formData.get('name'),
            resource_id: parseInt(formData.get('resource_id')),
            description: formData.get('description')
        });
        closeModal();
        loadPermissions();
        showMessage('权限创建成功', 'success');
    });
}

async function editPermission(permissionId) {
    try {
        const permission = await API.get(`/rbac/permissions/${permissionId}`);
        showModal('编辑权限', `
            <form id="editPermissionForm">
                <div class="form-group">
                    <label>权限代码</label>
                    <input type="text" name="code" value="${permission.code}" required>
                </div>
                <div class="form-group">
                    <label>权限名称</label>
                    <input type="text" name="name" value="${permission.name}" required>
                </div>
                <div class="form-group">
                    <label>资源ID</label>
                    <input type="number" name="resource_id" value="${permission.resource_id}" required>
                </div>
                <div class="form-group">
                    <label>描述</label>
                    <textarea name="description">${permission.description || ''}</textarea>
                </div>
                <div class="modal-actions">
                    <button type="submit" class="btn btn-primary">保存</button>
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
                </div>
            </form>
        `, async (form) => {
            const formData = new FormData(form);
            await API.put(`/rbac/permissions/${permissionId}`, {
                code: formData.get('code'),
                name: formData.get('name'),
                resource_id: parseInt(formData.get('resource_id')),
                description: formData.get('description')
            });
            closeModal();
            loadPermissions();
            showMessage('权限编辑成功', 'success');
        });
    } catch (error) {
        showMessage('加载权限信息失败', 'error');
    }
}

function togglePermissionsSelectAll(checkbox) {
    document.querySelectorAll('#permissionsTableBody input.permission-row-cb').forEach(function(cb) { cb.checked = checkbox.checked; });
}
function getSelectedPermissionIds() {
    return Array.from(document.querySelectorAll('#permissionsTableBody input.permission-row-cb:checked')).map(function(cb) { return parseInt(cb.value, 10); });
}
async function batchDeletePermissions() {
    var ids = getSelectedPermissionIds();
    if (ids.length === 0) { showMessage('请先勾选要删除的权限', 'error'); return; }
    if (!confirm('确定要删除选中的 ' + ids.length + ' 个权限吗？')) return;
    try {
        var res = await API.post('/rbac/permissions/batch-delete', { permission_ids: ids });
        loadPermissions();
        showMessage(res.message || '批量删除成功', 'success');
    } catch (e) {
        showMessage('操作失败: ' + (e.message || ''), 'error');
    }
}

async function deletePermission(permissionId) {
    if (!confirm('确定要删除该权限吗？')) return;
    try {
        await API.request(`/rbac/permissions/${permissionId}`, { method: 'DELETE' });
        loadPermissions();
        showMessage('权限已删除', 'success');
    } catch (error) {
        showMessage('操作失败: ' + (error.message || '未知错误'), 'error');
    }
}

// ========== 资源管理 ==========
async function loadResources() {
    try {
        const list = await API.get('/rbac/resources/');
        const tbody = document.getElementById('resourcesTableBody');
        if (!tbody) return;
        if (list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8">暂无资源</td></tr>';
            return;
        }
        var resSelectAll = document.getElementById('resourcesSelectAll');
        if (resSelectAll) resSelectAll.checked = false;
        tbody.innerHTML = list.map(res => `
            <tr>
                <td><input type="checkbox" class="resource-row-cb" value="${res.id}" aria-label="选择"></td>
                <td>${res.id}</td>
                <td>${res.name}</td>
                <td>${res.resource_type}</td>
                <td>${res.path}</td>
                <td>${res.method || '-'}</td>
                <td>${res.app_id}</td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="editResource(${res.id})">编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteResource(${res.id})">删除</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('加载资源列表失败:', error);
    }
}

function showCreateResourceModal() {
    showModal('新建资源', `
        <form id="createResourceForm">
            <div class="form-group">
                <label>应用ID</label>
                <input type="number" name="app_id" required>
            </div>
            <div class="form-group">
                <label>资源名称</label>
                <input type="text" name="name" required>
            </div>
            <div class="form-group">
                <label>资源类型</label>
                <select name="resource_type" required>
                    <option value="api">API</option>
                    <option value="ui">UI</option>
                    <option value="other">其他</option>
                </select>
            </div>
            <div class="form-group">
                <label>路径</label>
                <input type="text" name="path" placeholder="/api/v1/orders/*" required>
            </div>
            <div class="form-group">
                <label>方法（可选）</label>
                <select name="method">
                    <option value="">无</option>
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="DELETE">DELETE</option>
                </select>
            </div>
            <div class="modal-actions">
                <button type="submit" class="btn btn-primary">创建</button>
                <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
            </div>
        </form>
    `, async (form) => {
        const formData = new FormData(form);
        await API.post('/rbac/resources', {
            app_id: parseInt(formData.get('app_id')),
            name: formData.get('name'),
            resource_type: formData.get('resource_type'),
            path: formData.get('path'),
            method: formData.get('method') || null
        });
        closeModal();
        loadResources();
        showMessage('资源创建成功', 'success');
    });
}

async function editResource(resourceId) {
    try {
        const resource = await API.get(`/rbac/resources/${resourceId}`);
        showModal('编辑资源', `
            <form id="editResourceForm">
                <div class="form-group">
                    <label>应用ID</label>
                    <input type="number" name="app_id" value="${resource.app_id}" required>
                </div>
                <div class="form-group">
                    <label>资源名称</label>
                    <input type="text" name="name" value="${resource.name}" required>
                </div>
                <div class="form-group">
                    <label>资源类型</label>
                    <select name="resource_type" required>
                        <option value="api" ${resource.resource_type === 'api' ? 'selected' : ''}>API</option>
                        <option value="ui" ${resource.resource_type === 'ui' ? 'selected' : ''}>UI</option>
                        <option value="other" ${resource.resource_type === 'other' ? 'selected' : ''}>其他</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>路径</label>
                    <input type="text" name="path" value="${resource.path}" required>
                </div>
                <div class="form-group">
                    <label>方法</label>
                    <select name="method">
                        <option value="" ${!resource.method ? 'selected' : ''}>无</option>
                        <option value="GET" ${resource.method === 'GET' ? 'selected' : ''}>GET</option>
                        <option value="POST" ${resource.method === 'POST' ? 'selected' : ''}>POST</option>
                        <option value="PUT" ${resource.method === 'PUT' ? 'selected' : ''}>PUT</option>
                        <option value="DELETE" ${resource.method === 'DELETE' ? 'selected' : ''}>DELETE</option>
                    </select>
                </div>
                <div class="modal-actions">
                    <button type="submit" class="btn btn-primary">保存</button>
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
                </div>
            </form>
        `, async (form) => {
            const formData = new FormData(form);
            await API.put(`/rbac/resources/${resourceId}`, {
                app_id: parseInt(formData.get('app_id')),
                name: formData.get('name'),
                resource_type: formData.get('resource_type'),
                path: formData.get('path'),
                method: formData.get('method') || null
            });
            closeModal();
            loadResources();
            showMessage('资源编辑成功', 'success');
        });
    } catch (error) {
        showMessage('加载资源信息失败', 'error');
    }
}

function toggleResourcesSelectAll(checkbox) {
    document.querySelectorAll('#resourcesTableBody input.resource-row-cb').forEach(function(cb) { cb.checked = checkbox.checked; });
}
function getSelectedResourceIds() {
    return Array.from(document.querySelectorAll('#resourcesTableBody input.resource-row-cb:checked')).map(function(cb) { return parseInt(cb.value, 10); });
}
async function batchDeleteResources() {
    var ids = getSelectedResourceIds();
    if (ids.length === 0) { showMessage('请先勾选要删除的资源', 'error'); return; }
    if (!confirm('确定要删除选中的 ' + ids.length + ' 个资源吗？')) return;
    try {
        var res = await API.post('/rbac/resources/batch-delete', { resource_ids: ids });
        loadResources();
        showMessage(res.message || '批量删除成功', 'success');
    } catch (e) {
        showMessage('操作失败: ' + (e.message || ''), 'error');
    }
}

async function deleteResource(resourceId) {
    if (!confirm('确定要删除该资源吗？')) return;
    try {
        await API.request(`/rbac/resources/${resourceId}`, { method: 'DELETE' });
        loadResources();
        showMessage('资源已删除', 'success');
    } catch (error) {
        showMessage('操作失败: ' + (error.message || '未知错误'), 'error');
    }
}

// ========== 应用管理 ==========
function toggleAppsSelectAll(checkbox) {
    document.querySelectorAll('#appsTableBody input.app-row-cb').forEach(cb => { cb.checked = checkbox.checked; });
}

function getSelectedAppIds() {
    return Array.from(document.querySelectorAll('#appsTableBody input.app-row-cb:checked')).map(cb => cb.value);
}

async function loadApps() {
    try {
        const statusFilter = document.getElementById('appStatusFilter')?.value || '';
        let url = '/apps/';
        if (statusFilter) url += '?status_filter=' + encodeURIComponent(statusFilter);
        const apps = await API.get(url);
        const tbody = document.getElementById('appsTableBody');
        const selectAll = document.getElementById('appsSelectAll');
        if (selectAll) selectAll.checked = false;
        if (!tbody) return;
        if (apps.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7">暂无应用</td></tr>';
            return;
        }
        tbody.innerHTML = apps.map(app => `
            <tr>
                <td><input type="checkbox" class="app-row-cb" value="${app.app_id}" aria-label="选择"></td>
                <td>${app.id}</td>
                <td>${app.app_id}</td>
                <td>${app.app_name}</td>
                <td>${app.description || '-'}</td>
                <td>
                    <span class="badge ${app.status === 'active' ? 'badge-success' : app.status === 'pending' ? 'badge-warning' : 'badge-danger'}">
                        ${app.status === 'active' ? '已启用' : app.status === 'pending' ? '待审核' : '已禁用'}
                    </span>
                </td>
                <td>
                    ${app.status === 'pending' ? `<button class="btn btn-sm btn-success" onclick="approveApp('${app.app_id}')">审核通过</button>` : ''}
                    ${app.status === 'active' ? `<button class="btn btn-sm btn-warning" onclick="disableApp('${app.app_id}')">禁用</button>` : ''}
                    ${app.status === 'disabled' ? `<button class="btn btn-sm btn-success" onclick="enableApp('${app.app_id}')">启用</button>` : ''}
                    <button class="btn btn-sm btn-primary" onclick="editApp('${app.app_id}')">编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteApp('${app.app_id}')">删除</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('加载应用列表失败:', error);
    }
}

function showBatchRegisterModal() {
    const html = `
        <p class="form-hint">每行一个应用，填写应用名称、描述（可选）、回调地址（可选）。</p>
        <div id="batchRegisterRows">
            <div class="batch-app-row form-row" style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">
                <input type="text" placeholder="应用名称" name="app_name" required style="flex:1;min-width:0;">
                <input type="text" placeholder="描述" name="description" style="flex:1;min-width:0;">
                <input type="url" placeholder="回调地址" name="callback_url" style="flex:1;min-width:0;">
                <button type="button" class="btn btn-sm btn-danger" onclick="removeBatchRow(this)">删除</button>
            </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="addBatchRegisterRow()" style="margin-bottom:12px;">+ 添加一行</button>
        <div class="modal-actions">
            <button type="button" class="btn btn-primary" id="batchRegisterSubmitBtn">提交注册</button>
            <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
        </div>
    `;
    window.addBatchRegisterRow = function() {
        const parent = document.getElementById('batchRegisterRows');
        if (!parent) return;
        const first = parent.querySelector('.batch-app-row');
        if (!first) return;
        const clone = first.cloneNode(true);
        clone.querySelectorAll('input').forEach(i => { i.value = ''; });
        parent.appendChild(clone);
    };
    window.removeBatchRow = function(btn) {
        const parent = document.getElementById('batchRegisterRows');
        if (!parent) return;
        const rows = parent.querySelectorAll('.batch-app-row');
        if (rows.length <= 1) return;
        btn.closest('.batch-app-row').remove();
    };
    showModal('批量注册应用', html, null);
    document.getElementById('batchRegisterSubmitBtn').onclick = async () => {
        const rows = document.querySelectorAll('#batchRegisterRows .batch-app-row');
        const apps = [];
        rows.forEach(row => {
            const name = row.querySelector('input[name="app_name"]').value.trim();
            if (!name) return;
            apps.push({
                app_name: name,
                description: row.querySelector('input[name="description"]').value.trim() || null,
                callback_url: row.querySelector('input[name="callback_url"]').value.trim() || null
            });
        });
        if (apps.length === 0) {
            showMessage('请至少填写一个应用名称', 'error');
            return;
        }
        if (apps.length > 50) {
            showMessage('单次最多 50 个应用', 'error');
            return;
        }
        try {
            const res = await API.post('/apps/batch-register', { apps });
            closeModal();
            const items = res.items || [];
            const text = items.map(i => `app_id: ${i.app_id}\napp_secret: ${i.app_secret}\napp_name: ${i.app_name}\nstatus: ${i.status}\n---`).join('\n');
            const json = JSON.stringify(items, null, 2);
            showModal('批量注册结果（请下载保存密钥，关闭后无法再次查看）', `
                <p>成功注册 ${items.length} 个应用。</p>
                <pre style="max-height:280px;overflow:auto;font-size:12px;">${text.replace(/</g, '&lt;')}</pre>
                <div class="modal-actions">
                    <a href="data:application/json;charset=utf-8,${encodeURIComponent(json)}" download="apps_credentials.json" class="btn btn-primary">下载密钥 JSON</a>
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">关闭</button>
                </div>
            `, null);
            loadApps();
            showMessage('批量注册成功，请下载保存密钥', 'success');
        } catch (e) {
            showMessage('批量注册失败: ' + (e.message || ''), 'error');
        }
    };
}

async function batchApproveApps() {
    const ids = getSelectedAppIds();
    if (ids.length === 0) { showMessage('请先勾选要审核的应用', 'error'); return; }
    try {
        const res = await API.post('/apps/batch-approve', { app_ids: ids });
        loadApps();
        showMessage(res.message || '批量审核成功', 'success');
    } catch (e) {
        showMessage('操作失败: ' + (e.message || ''), 'error');
    }
}

async function batchDisableApps() {
    const ids = getSelectedAppIds();
    if (ids.length === 0) { showMessage('请先勾选要禁用的应用', 'error'); return; }
    if (!confirm('确定禁用选中的 ' + ids.length + ' 个应用？')) return;
    try {
        const res = await API.post('/apps/batch-disable', { app_ids: ids });
        loadApps();
        showMessage(res.message || '已禁用', 'success');
    } catch (e) {
        showMessage('操作失败: ' + (e.message || ''), 'error');
    }
}

async function batchDeleteApps() {
    var ids = getSelectedAppIds();
    if (ids.length === 0) { showMessage('请先勾选要删除的应用', 'error'); return; }
    if (!confirm('确定要删除选中的 ' + ids.length + ' 个应用吗？此操作不可恢复！')) return;
    try {
        var res = await API.post('/apps/batch-delete', { app_ids: ids });
        loadApps();
        showMessage(res.message || '批量删除成功', 'success');
    } catch (e) {
        showMessage('操作失败: ' + (e.message || ''), 'error');
    }
}

async function exportSelectedApps() {
    const ids = getSelectedAppIds();
    const url = ids.length ? '/apps/export?app_ids=' + encodeURIComponent(ids.join(',')) : '/apps/export';
    try {
        const data = await API.get(url);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'apps_export.json';
        a.click();
        URL.revokeObjectURL(a.href);
        showMessage('导出成功', 'success');
    } catch (e) {
        showMessage('导出失败: ' + (e.message || ''), 'error');
    }
}

function showBatchCallbacksModal() {
    const ids = getSelectedAppIds();
    if (ids.length === 0) { showMessage('请先勾选要更新回调地址的应用', 'error'); return; }
    const list = ids.map(id => `<div class="form-group"><label>${id}</label><input type="url" data-app-id="${id}" placeholder="回调地址"></div>`).join('');
    showModal('批量更新回调地址', `
        <p>已选 ${ids.length} 个应用，填写新回调地址（留空则不修改）。</p>
        <div id="batchCallbacksList">${list}</div>
        <div class="modal-actions">
            <button type="button" class="btn btn-primary" id="batchCallbacksSubmit">保存</button>
            <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
        </div>
    `, null);
    document.getElementById('batchCallbacksSubmit').onclick = async () => {
        const updates = [];
        document.querySelectorAll('#batchCallbacksList input[data-app-id]').forEach(inp => {
            const url = inp.value.trim();
            if (url) updates.push({ app_id: inp.getAttribute('data-app-id'), callback_url: url });
        });
        if (updates.length === 0) { showMessage('请至少填写一个回调地址', 'error'); return; }
        try {
            await API.put('/apps/batch-callbacks', { updates });
            closeModal();
            loadApps();
            showMessage('已更新回调地址', 'success');
        } catch (e) {
            showMessage('更新失败: ' + (e.message || ''), 'error');
        }
    };
}

function showCreateAppModal() {
    showModal('注册应用', `
        <form id="createAppForm">
            <div class="form-group">
                <label>应用名称</label>
                <input type="text" name="app_name" required>
            </div>
            <div class="form-group">
                <label>描述</label>
                <textarea name="description"></textarea>
            </div>
            <div class="form-group">
                <label>回调地址（可选）</label>
                <input type="url" name="callback_url">
            </div>
            <div class="modal-actions">
                <button type="submit" class="btn btn-primary">注册</button>
                <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
            </div>
        </form>
    `, async (form) => {
        const formData = new FormData(form);
        const res = await API.post('/apps/register', {
            app_name: formData.get('app_name'),
            description: formData.get('description'),
            callback_url: formData.get('callback_url') || null
        });
        closeModal();
        loadApps();
        var text = 'app_id: ' + (res.app_id || '') + '\napp_secret: ' + (res.app_secret || '') + '\napp_name: ' + (res.app_name || '') + '\nstatus: ' + (res.status || '') + '\n\n请妥善保存 app_secret，关闭后将无法再次查看。';
        var json = JSON.stringify({ app_id: res.app_id, app_secret: res.app_secret, app_name: res.app_name, status: res.status }, null, 2);
        showModal('应用注册成功（请保存密钥）', `
            <pre style="max-height:280px;overflow:auto;font-size:12px;white-space:pre-wrap;">${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
            <div class="modal-actions">
                <a href="data:application/json;charset=utf-8,${encodeURIComponent(json)}" download="app_credentials.json" class="btn btn-primary">下载密钥 JSON</a>
                <button type="button" class="btn btn-secondary" onclick="closeModal()">关闭</button>
            </div>
        `, null);
        showMessage('应用注册成功，请保存上方密钥', 'success');
    });
}

async function approveApp(appId) {
    try {
        await API.post(`/apps/${appId}/approve`);
        loadApps();
        showMessage('应用已审核通过', 'success');
    } catch (error) {
        showMessage('操作失败: ' + error.message, 'error');
    }
}

async function disableApp(appId) {
    try {
        await API.post(`/apps/${appId}/disable`);
        loadApps();
        showMessage('应用已禁用', 'success');
    } catch (error) {
        showMessage('操作失败: ' + error.message, 'error');
    }
}

async function enableApp(appId) {
    try {
        await API.post(`/apps/${appId}/enable`);
        loadApps();
        showMessage('应用已启用', 'success');
    } catch (error) {
        showMessage('操作失败: ' + error.message, 'error');
    }
}

async function deleteApp(appId) {
    if (!confirm('确定要删除该应用吗？此操作不可恢复！')) return;
    try {
        const token = localStorage.getItem('access_token');
        const response = await fetch('/api/v1/apps/' + appId, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.detail || '删除失败');
        }
        loadApps();
        showMessage('应用已删除', 'success');
    } catch (error) {
        showMessage('操作失败: ' + (error.message || '未知错误'), 'error');
    }
}

async function editApp(appId) {
    try {
        const app = await API.get(`/apps/${appId}`);
        showModal('编辑应用', `
            <form id="editAppForm">
                <div class="form-group">
                    <label>应用名称</label>
                    <input type="text" name="app_name" value="${app.app_name}" required>
                </div>
                <div class="form-group">
                    <label>描述</label>
                    <textarea name="description">${app.description || ''}</textarea>
                </div>
                <div class="form-group">
                    <label>回调地址</label>
                    <input type="url" name="callback_url" value="${app.callback_url || ''}">
                </div>
                <div class="modal-actions">
                    <button type="submit" class="btn btn-primary">保存</button>
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
                </div>
            </form>
        `, async (form) => {
            const formData = new FormData(form);
            await API.put(`/apps/${appId}`, {
                app_name: formData.get('app_name'),
                description: formData.get('description'),
                callback_url: formData.get('callback_url') || ''
            });
            closeModal();
            loadApps();
            showMessage('应用编辑成功', 'success');
        });
    } catch (error) {
        showMessage('加载应用信息失败', 'error');
    }
}

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

function parseUtcIso(dateString) {
    if (!dateString) return null;
    var s = String(dateString).trim();
    if (!s.endsWith('Z') && !/[\+\-]\d{2}:?\d{2}$/.test(s)) s = s + 'Z';
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
}

function formatBeijingTime(dateString) {
    var d = parseUtcIso(dateString);
    if (!d) return dateString ? String(dateString) : '-';
    return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

async function loadLogs() {
    const tbody = document.getElementById('logsTableBody');
    if (!tbody) return;
    try {
        tbody.innerHTML = '<tr><td colspan="9">加载中...</td></tr>';
        const startTime = document.getElementById('logStartTime')?.value;
        const endTime = document.getElementById('logEndTime')?.value;
        const action = document.getElementById('logActionFilter')?.value;
        const success = document.getElementById('logSuccessFilter')?.value;
        let url = '/logs/?limit=200';
        if (startTime) url += '&start_time=' + encodeURIComponent(startTime);
        if (endTime) url += '&end_time=' + encodeURIComponent(endTime);
        if (action) url += '&action=' + encodeURIComponent(action);
        if (success === 'true' || success === 'false') url += '&success=' + success;
        const logs = await API.get(url);
        if (logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9">暂无日志</td></tr>';
            return;
        }
        tbody.innerHTML = logs.map(log => `
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
    } catch (error) {
        console.error('加载日志列表失败:', error);
        tbody.innerHTML = '<tr><td colspan="9">加载失败</td></tr>';
    }
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

// ========== 个人中心（右上角弹窗） ==========
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
    if (/Edg\//.test(u)) browser = 'Edge';
    else if (/Chrome\//.test(u) && !/Edg/.test(u)) browser = 'Chrome';
    else if (/Firefox\//.test(u)) browser = 'Firefox';
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

async function loadMySessions() {
    var tbody = document.getElementById('sessionsTableBody');
    if (!tbody) return;
    try {
        var sessions = await API.get('/auth/sessions/me');
        if (!sessions || sessions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7">暂无会话</td></tr>';
            return;
        }
        tbody.innerHTML = sessions.map(function(s) {
            var statusBadge = s.active
                ? '<span class="badge badge-success">活跃</span>'
                : (s.revoked ? '<span class="badge badge-danger">已撤销</span>' : '<span class="badge badge-warning">已过期</span>');
            return '<tr>' +
                '<td title="' + s.jti + '">' + (s.jti ? s.jti.substring(0, 12) + '...' : '-') + '</td>' +
                '<td>' + (s.ip || '-') + '</td>' +
                '<td title="' + (s.user_agent || '') + '">' + (s.user_agent ? s.user_agent.substring(0, 40) + '...' : '-') + '</td>' +
                '<td>' + formatBeijingTime(s.created_at) + '</td>' +
                '<td>' + formatBeijingTime(s.expires_at) + '</td>' +
                '<td>' + statusBadge + '</td>' +
                '<td>' + (s.active ? '<button class="btn btn-sm btn-danger" onclick="revokeSession(\'' + s.jti + '\')">撤销</button>' : '-') + '</td>' +
                '</tr>';
        }).join('');
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="7">加载失败</td></tr>';
    }
}

async function revokeSession(jti) {
    if (!confirm('确定要撤销该会话吗？')) return;
    try {
        await API.request('/auth/sessions/me?jti=' + encodeURIComponent(jti), { method: 'DELETE' });
        showMessage('会话已撤销', 'success');
        loadMySessions();
    } catch (e) {
        showMessage('操作失败: ' + (e.message || ''), 'error');
    }
}

// ========== 系统设置 ==========
async function loadSystemSettings() {
    try {
        var settings = await API.get('/system/settings');
        var checkbox = document.getElementById('toggleApproval');
        var status = document.getElementById('approvalStatus');
        if (checkbox) checkbox.checked = settings.require_registration_approval;
        if (status) status.textContent = settings.require_registration_approval ? '已开启' : '已关闭';

        var secOverview = await API.get('/system/security-overview');
        var blEl = document.getElementById('blacklistSize');
        if (blEl) blEl.textContent = secOverview.token_blacklist_size;
    } catch (e) {
        console.error('加载系统设置失败:', e);
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

// ========== 工具函数 ==========
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    const activeBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    const tabEl = document.getElementById(`${tabName}Tab`);
    if (tabEl) tabEl.classList.add('active');
    switch(tabName) {
        case 'roles':
            loadRoles();
            break;
        case 'permissions':
            loadPermissions();
            break;
        case 'resources':
            loadResources();
            break;
    }
}

function showModal(title, content, onSubmit) {
    closeModal();
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3>${title}</h3>
                <button type="button" class="modal-close" onclick="closeModal()" aria-label="关闭">&times;</button>
            </div>
            <div class="modal-body">
                ${content}
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const form = modal.querySelector('form');
    if (form && onSubmit) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                await onSubmit(form);
            } catch (error) {
                showMessage('操作失败: ' + error.message, 'error');
            }
        });
    }
}

function closeModal() {
    const modals = document.querySelectorAll('body > .modal-overlay');
    modals.forEach(function (m) { m.remove(); });
}

function showMessage(message, type = 'info', duration = 3000) {
    const msg = document.createElement('div');
    msg.className = 'message message-' + type;
    msg.textContent = message;
    document.body.appendChild(msg);

    setTimeout(() => msg.classList.add('show'), 10);
    setTimeout(() => {
        msg.classList.remove('show');
        setTimeout(() => msg.remove(), 300);
    }, duration);
}

document.addEventListener('click', function(e) {
    if (e.target.classList.contains('modal-overlay')) {
        closeModal();
    }
});
