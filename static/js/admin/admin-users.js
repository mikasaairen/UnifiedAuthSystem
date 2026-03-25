/**
 * 用户管理、注册审核
 */
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
    var feedbackEl = document.getElementById('userSearchFeedback');
    var tbody = document.getElementById('usersTableBody');
    var paginationEl = document.getElementById('usersPagination');
    if (!tbody) return;
    try {
        tbody.innerHTML = '<tr><td colspan="8">加载中...</td></tr>';
        if (paginationEl) paginationEl.innerHTML = '';
        var keyword = document.getElementById('userSearch') && document.getElementById('userSearch').value ? document.getElementById('userSearch').value.trim() : '';
        var statusFilter = document.getElementById('userStatusFilter') && document.getElementById('userStatusFilter').value ? document.getElementById('userStatusFilter').value : '';
        var roleFilter = document.getElementById('userRoleFilter') && document.getElementById('userRoleFilter').value ? document.getElementById('userRoleFilter').value.trim() : '';
        var skip = (usersPageCurrent - 1) * usersPageSize;
        var url = '/users/?limit=' + usersPageSize + '&skip=' + skip + '&scope=managed';
        if (statusFilter === 'active') url += '&is_active=true';
        else if (statusFilter === 'disabled') url += '&is_active=false';
        if (keyword) url += '&keyword=' + encodeURIComponent(keyword);
        if (roleFilter) url += '&role_name=' + encodeURIComponent(roleFilter);
        var res = await API.get(url);
        var list = res && res.items ? res.items : [];
        var total = (res && typeof res.total === 'number') ? res.total : 0;
        var maxPage = Math.max(1, Math.ceil(total / usersPageSize));
        if (feedbackEl) {
            if (keyword) {
                feedbackEl.textContent = list.length === 0 ? '未找到匹配用户，请调整关键词' : '第 ' + (skip + 1) + '-' + (skip + list.length) + ' 条，共 ' + total + ' 条';
            } else {
                feedbackEl.textContent = list.length === 0 ? '暂无用户' : '第 ' + (skip + 1) + '-' + (skip + list.length) + ' 条，共 ' + total + ' 条';
            }
        }
        if (list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8">暂无用户</td></tr>';
            if (paginationEl) renderPaginationBar(paginationEl, usersPageCurrent, maxPage, usersPageGo);
            return;
        }
        var usersSelectAll = document.getElementById('usersSelectAll');
        if (usersSelectAll) usersSelectAll.checked = false;
        tbody.innerHTML = list.map(user => {
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
                '<td><button class="btn btn-sm btn-primary" onclick="showEditUserPanel(' + user.id + ')">编辑</button> ' + op + ' <button class="btn btn-sm btn-danger" onclick="deleteUser(' + user.id + ')">删除</button></td>' +
                '</tr>';
        }).join('');
        if (paginationEl) renderPaginationBar(paginationEl, usersPageCurrent, maxPage, usersPageGo);
    } catch (error) {
        console.error('加载用户列表失败:', error);
        if (feedbackEl) feedbackEl.textContent = '加载失败';
        if (tbody) tbody.innerHTML = '<tr><td colspan="8">加载失败</td></tr>';
        handle403(error);
    }
}

function usersPageGo(page) {
    if (page < 1) return;
    usersPageCurrent = page;
    loadUsers();
}

/**
 * 通用分页条：相邻5页、跳转输入、显示最大页；过大跳最后一页，过小跳第一页
 * @param {HTMLElement} container - 挂载容器
 * @param {number} currentPage - 当前页
 * @param {number} maxPage - 最大页
 * @param {function(number)} onPageChange - 跳页回调
 */
function renderPaginationBar(container, currentPage, maxPage, onPageChange) {
    if (!container) return;
    if (maxPage < 1) maxPage = 1;
    var cur = Math.max(1, Math.min(currentPage, maxPage));
    var start = Math.max(1, cur - 2);
    var end = Math.min(maxPage, cur + 2);
    if (end - start + 1 < 5) {
        if (start === 1) end = Math.min(maxPage, start + 4);
        else end = Math.min(maxPage, cur + (5 - (cur - start)) - 1);
        start = Math.max(1, end - 4);
    }
    var parts = [];
    parts.push('<button type="button" class="btn btn-sm btn-secondary" data-page="1">首页</button>');
    parts.push('<button type="button" class="btn btn-sm btn-secondary" data-page="' + (cur - 1) + '">上一页</button>');
    for (var p = start; p <= end; p++) {
        var cls = 'btn btn-sm btn-secondary pagination-num' + (p === cur ? ' current' : '');
        parts.push('<button type="button" class="' + cls + '" data-page="' + p + '">' + p + '</button>');
    }
    parts.push('<button type="button" class="btn btn-sm btn-secondary" data-page="' + (cur + 1) + '">下一页</button>');
    parts.push('<span class="pagination-info">共 ' + maxPage + ' 页</span>');
    parts.push('<span class="pagination-jump">跳至 <input type="number" class="pagination-jump-input" min="1" max="' + maxPage + '" value="' + cur + '"> 页</span>');
    container.innerHTML = '<div class="pagination-bar">' + parts.join('') + '</div>';
    container.querySelectorAll('.pagination-bar button[data-page]').forEach(function(btn) {
        var p = parseInt(btn.getAttribute('data-page'), 10);
        btn.addEventListener('click', function() {
            if (p < 1) p = 1;
            if (p > maxPage) p = maxPage;
            onPageChange(p);
        });
    });
    var jumpInput = container.querySelector('.pagination-jump-input');
    if (jumpInput) {
        jumpInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                var val = parseInt(jumpInput.value, 10);
                if (isNaN(val) || val < 1) val = 1;
                if (val > maxPage) val = maxPage;
                onPageChange(val);
            }
        });
        jumpInput.addEventListener('change', function() {
            var val = parseInt(jumpInput.value, 10);
            if (isNaN(val) || val < 1) val = 1;
            if (val > maxPage) val = maxPage;
            onPageChange(val);
        });
    }
}

async function loadPendingUsers() {
    var tbody = document.getElementById('pendingTableBody');
    if (!tbody) return;
    try {
        tbody.innerHTML = '<tr><td colspan="6">加载中...</td></tr>';
        var res = await API.get('/users/?limit=500&skip=0&scope=pending');
        var users = res && res.items ? res.items : [];
        if (!users.length) {
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
        handle403(e);
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
    usersPageCurrent = 1;
    loadUsers();
}

function initUserSearchDebounce() {
    var input = document.getElementById('userSearch');
    if (!input || input._debounceBound) return;
    input._debounceBound = true;
    var timer;
    input.addEventListener('input', function() {
        clearTimeout(timer);
        timer = setTimeout(function() {
            usersPageCurrent = 1;
            loadUsers();
        }, 300);
    });
}

function hideUserFormPanel() {
    var listSec = document.getElementById('usersListSection');
    var formSec = document.getElementById('usersFormSection');
    if (listSec) listSec.style.display = '';
    if (formSec) formSec.style.display = 'none';
}

async function showCreateUserPanel() {
    var listSec = document.getElementById('usersListSection');
    var formSec = document.getElementById('usersFormSection');
    var titleEl = document.getElementById('usersFormTitle');
    var form = document.getElementById('userFormInPage');
    if (!form || !formSec) return;
    var roles = [];
    try {
        roles = await API.get('/rbac/roles');
    } catch (e) { roles = []; }
    var rolesContainer = document.getElementById('userFormRoles');
    if (rolesContainer) {
        rolesContainer.innerHTML = roles.length === 0
            ? '<p class="form-hint">暂无角色</p>'
            : roles.map(function(r) {
                return '<label class="assign-perm-item"><input type="checkbox" name="role_id" value="' + r.id + '"><span class="assign-perm-label">' + escapeHtml(r.name) + (r.description ? '（' + escapeHtml(r.description) + '）' : '') + '</span></label>';
            }).join('');
    }
    if (titleEl) titleEl.textContent = '新建用户';
    form.querySelector('#userFormId').value = '';
    form.querySelector('#userFormUsername').value = '';
    form.querySelector('#userFormUsername').removeAttribute('readonly');
    form.querySelector('#userFormEmail').value = '';
    form.querySelector('#userFormFullName').value = '';
    form.querySelector('#userFormPassword').value = '';
    form.querySelector('#userFormPassword').setAttribute('required', 'required');
    if (listSec) listSec.style.display = 'none';
    formSec.style.display = 'block';
}

async function showEditUserPanel(userId) {
    var listSec = document.getElementById('usersListSection');
    var formSec = document.getElementById('usersFormSection');
    var titleEl = document.getElementById('usersFormTitle');
    var form = document.getElementById('userFormInPage');
    if (!form || !formSec) return;
    try {
        var user = await API.get('/users/' + userId);
        var roles = await API.get('/rbac/roles');
        var userRoleIds = (user.roles || []).map(function(r) { return r.id; });
        var rolesContainer = document.getElementById('userFormRoles');
        if (rolesContainer) {
            rolesContainer.innerHTML = roles.length === 0
                ? '<p class="form-hint">暂无角色</p>'
                : roles.map(function(r) {
                    var checked = userRoleIds.indexOf(r.id) >= 0 ? ' checked' : '';
                    return '<label class="assign-perm-item"><input type="checkbox" name="role_id" value="' + r.id + '"' + checked + '><span class="assign-perm-label">' + escapeHtml(r.name) + (r.description ? '（' + escapeHtml(r.description) + '）' : '') + '</span></label>';
                }).join('');
        }
        if (titleEl) titleEl.textContent = '编辑用户';
        form.querySelector('#userFormId').value = user.id;
        form.querySelector('#userFormUsername').value = user.username || '';
        form.querySelector('#userFormUsername').setAttribute('readonly', 'readonly');
        form.querySelector('#userFormEmail').value = user.email || '';
        form.querySelector('#userFormFullName').value = user.full_name || '';
        form.querySelector('#userFormPassword').value = '';
        form.querySelector('#userFormPassword').removeAttribute('required');
        if (listSec) listSec.style.display = 'none';
        formSec.style.display = 'block';
    } catch (e) {
        showMessage('加载用户信息失败', 'error');
    }
}

function initUserFormInPage() {
    var form = document.getElementById('userFormInPage');
    if (!form || form._inPageBound) return;
    form._inPageBound = true;
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        var idEl = form.querySelector('#userFormId');
        var userId = idEl && idEl.value ? idEl.value.trim() : '';
        var roleIds = Array.from(form.querySelectorAll('input[name="role_id"]:checked')).map(function(cb) { return parseInt(cb.value, 10); });
        var username = form.querySelector('#userFormUsername').value.trim();
        var email = form.querySelector('#userFormEmail').value.trim();
        var fullName = (form.querySelector('#userFormFullName').value || '').trim();
        var password = (form.querySelector('#userFormPassword').value || '').trim();
        try {
            if (userId) {
                var data = { email: email, full_name: fullName };
                if (password) data.password = password;
                await API.put('/users/' + userId, data);
                await API.post('/rbac/users/' + userId + '/roles', { role_ids: roleIds });
                showMessage('用户已更新', 'success');
            } else {
                await API.post('/users/', {
                    username: username,
                    email: email,
                    full_name: fullName,
                    password: password,
                    role_ids: roleIds
                });
                showMessage('用户创建成功', 'success');
            }
            hideUserFormPanel();
            loadUsers();
        } catch (err) {
            showMessage('操作失败: ' + (err.message || ''), 'error');
        }
    });
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
                <select name="duration" id="disableDurationSelect" required onchange="toggleDisableCustom(this)">
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
        var g = document.getElementById('disableCustomGroup');
        var inp = document.getElementById('disableCustomMinutes');
        if (g) g.style.display = show ? '' : 'none';
        if (inp) {
            if (show) {
                inp.setAttribute('required', 'required');
            } else {
                inp.removeAttribute('required');
                inp.value = '';
            }
        }
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
                    <input type="email" name="email" value="${user.email}" required>
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
