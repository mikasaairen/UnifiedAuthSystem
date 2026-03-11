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
    // 工作台、概览：所有登录用户可见
    const map = {
        users: 'users:manage',
        roles: 'rbac:manage',
        apps: 'apps:manage',
        logs: 'logs:view',
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
        'logs': '审计日志'
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
            loadUsers();
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

async function loadOverview() {
    var codes = myPermissionCodes || [];
    var grid = document.getElementById('overviewStatsGrid');
    if (grid) {
        grid.querySelectorAll('.stat-card[data-permission]').forEach(function(card) {
            var perm = card.getAttribute('data-permission');
            card.style.display = (perm && codes.indexOf(perm) !== -1) ? '' : 'none';
        });
    }
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
    try {
        await Promise.allSettled(promises);
    } catch (e) {
        console.error('加载概览数据失败:', e);
    }
}

// ========== 用户管理 ==========
async function loadUsers() {
    const feedbackEl = document.getElementById('userSearchFeedback');
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    try {
        tbody.innerHTML = '<tr><td colspan="8">加载中...</td></tr>';
        const keyword = document.getElementById('userSearch')?.value?.trim();
        const roleFilter = document.getElementById('userRoleFilter')?.value;
        let url = '/users/?limit=500';
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
        tbody.innerHTML = users.map(user => `
            <tr>
                <td><input type="checkbox" class="user-row-cb" value="${user.id}" aria-label="选择"></td>
                <td>${user.id}</td>
                <td>${user.username}</td>
                <td>${user.email}</td>
                <td>${user.full_name || '-'}</td>
                <td><span class="badge ${user.is_active ? 'badge-success' : 'badge-danger'}">${user.is_active ? '已激活' : '已禁用'}</span></td>
                <td>${(user.roles && user.roles.length) ? user.roles.map(r => r.name).join('、') : '无角色'}</td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="editUser(${user.id})">编辑</button>
                    ${user.is_active ?
                        `<button class="btn btn-sm btn-warning" onclick="disableUser(${user.id})">禁用</button>` :
                        `<button class="btn btn-sm btn-success" onclick="enableUser(${user.id})">启用</button>`
                    }
                    <button class="btn btn-sm btn-danger" onclick="deleteUser(${user.id})">删除</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('加载用户列表失败:', error);
        if (feedbackEl) feedbackEl.textContent = '加载失败';
        if (tbody) tbody.innerHTML = '<tr><td colspan="8">加载失败</td></tr>';
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

async function disableUser(userId) {
    if (!confirm('确定要禁用该用户吗？')) return;
    try {
        await API.post(`/users/${userId}/disable`);
        loadUsers();
        showMessage('用户已禁用', 'success');
    } catch (error) {
        showMessage('操作失败: ' + error.message, 'error');
    }
}

async function enableUser(userId) {
    try {
        await API.post(`/users/${userId}/enable`);
        loadUsers();
        showMessage('用户已启用', 'success');
    } catch (error) {
        showMessage('操作失败: ' + error.message, 'error');
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
    check_permission: '权限检查', introspect: '令牌内省'
};

function formatLogDetails(details) {
    if (!details) return '-';
    const s = String(details);
    if (s.length <= 60) return s.replace(/"/g, "'");
    return s.slice(0, 57).replace(/"/g, "'") + '…';
}

function formatBeijingTime(dateString) {
    if (!dateString) return '-';
    //时区后缀，补 Z 让 JS 正确按 UTC 解析，再转为北京时间显示
    let s = String(dateString).trim();
    if (!s.endsWith('Z') && !/[\+\-]\d{2}:?\d{2}$/.test(s)) {
        s = s + 'Z';
    }
    const date = new Date(s);
    if (isNaN(date.getTime())) return dateString;
    return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
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
