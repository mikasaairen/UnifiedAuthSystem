/**
 * 角色、权限、资源
 */
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
                    <button class="btn btn-sm btn-primary" onclick="showEditRolePanel(${role.id})">编辑</button>
                    <button class="btn btn-sm btn-info" onclick="showAssignPermissionsPanel(${role.id})">分配权限</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteRole(${role.id})">删除</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('加载角色列表失败:', error);
        handle403(error);
    }
}

function showCreateRolePanel() {
    var listEl = document.getElementById('rolesListSection');
    var formEl = document.getElementById('rolesFormSection');
    var titleEl = document.getElementById('rolesFormTitle');
    var container = document.getElementById('rolesFormContainer');
    if (!listEl || !formEl || !container) return;
    titleEl.textContent = '新建角色';
    container.innerHTML = `
        <form id="createRoleFormInPage">
            <div class="form-group">
                <label>角色名称</label>
                <input type="text" name="name" required>
            </div>
            <div class="form-group">
                <label>描述</label>
                <textarea name="description"></textarea>
            </div>
            <div class="form-actions">
                <button type="submit" class="btn btn-primary">创建</button>
                <button type="button" class="btn btn-secondary" onclick="hideRoleFormPanel()">取消</button>
            </div>
        </form>
    `;
    listEl.style.display = 'none';
    formEl.style.display = 'block';
    container.querySelector('#createRoleFormInPage').addEventListener('submit', async function(e) {
        e.preventDefault();
        var form = e.target;
        var formData = new FormData(form);
        try {
            await API.post('/rbac/roles', { name: formData.get('name'), description: formData.get('description') });
            hideRoleFormPanel();
        loadRoles();
        showMessage('角色创建成功', 'success');
        } catch (err) {
            showMessage('创建失败: ' + (err.message || ''), 'error');
        }
    });
}

function hideRoleFormPanel() {
    var listEl = document.getElementById('rolesListSection');
    var formEl = document.getElementById('rolesFormSection');
    if (listEl) listEl.style.display = '';
    if (formEl) formEl.style.display = 'none';
}

function showEditRolePanel(roleId) {
    var listEl = document.getElementById('rolesListSection');
    var formEl = document.getElementById('rolesFormSection');
    var titleEl = document.getElementById('rolesFormTitle');
    var container = document.getElementById('rolesFormContainer');
    if (!listEl || !formEl || !container) return;
    titleEl.textContent = '编辑角色';
    container.innerHTML = '<p class="workbench-loading">加载中...</p>';
    listEl.style.display = 'none';
    formEl.style.display = 'block';
    API.get('/rbac/roles/' + roleId).then(function(role) {
        container.innerHTML = `
            <form id="editRoleFormInPage">
                <div class="form-group">
                    <label>角色名称</label>
                    <input type="text" name="name" value="${(role.name || '').replace(/"/g, '&quot;')}" required>
                </div>
                <div class="form-group">
                    <label>描述</label>
                    <textarea name="description">${(role.description || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">保存</button>
                    <button type="button" class="btn btn-secondary" onclick="hideRoleFormPanel()">取消</button>
                </div>
            </form>
        `;
        container.querySelector('#editRoleFormInPage').addEventListener('submit', async function(e) {
            e.preventDefault();
            var form = e.target;
            var formData = new FormData(form);
            try {
                await API.put('/rbac/roles/' + roleId, { name: formData.get('name'), description: formData.get('description') });
                hideRoleFormPanel();
            loadRoles();
            showMessage('角色编辑成功', 'success');
            } catch (err) {
                showMessage('保存失败: ' + (err.message || ''), 'error');
            }
        });
    }).catch(function() {
        showMessage('加载角色信息失败', 'error');
        hideRoleFormPanel();
    });
}

function showAssignPermissionsPanel(roleId) {
    var listEl = document.getElementById('rolesListSection');
    var formEl = document.getElementById('rolesFormSection');
    var titleEl = document.getElementById('rolesFormTitle');
    var container = document.getElementById('rolesFormContainer');
    if (!listEl || !formEl || !container) return;
    container.innerHTML = '<p class="workbench-loading">加载中...</p>';
    listEl.style.display = 'none';
    formEl.style.display = 'block';
    Promise.all([
        API.get('/rbac/roles/' + roleId),
        API.get('/rbac/permissions'),
        API.get('/rbac/roles/' + roleId + '/permissions')
    ]).then(function(results) {
        var role = results[0];
        var allPerms = results[1];
        var rolePermsRes = results[2];
        var rolePermIds = (rolePermsRes && rolePermsRes.permission_ids) ? rolePermsRes.permission_ids : [];
        titleEl.textContent = '为角色「' + (role.name || '') + '」分配权限';
        var checkboxesHtml = (allPerms.length === 0)
            ? '<p class="workbench-loading">暂无权限，请先在权限管理中创建权限。</p>'
            : allPerms.map(function(p) {
                var checked = rolePermIds.indexOf(p.id) >= 0 ? ' checked' : '';
                return '<label class="assign-perm-item"><input type="checkbox" name="perm" value="' + p.id + '"' + checked + '><span class="assign-perm-label">' + (p.name || p.code) + '</span></label>';
            }).join('');
        container.innerHTML = `
            <form id="assignPermissionsFormInPage">
                <div class="form-group">
                    <p>勾选该角色拥有的权限：</p>
                    <div class="assign-perm-toolbar">
                        <label><input type="checkbox" id="assignPermSelectAllInPage" onchange="toggleAssignPermSelectAllInPage(this)"> 全选</label>
                            </div>
                    <div class="assign-permissions-list">${checkboxesHtml}</div>
                    </div>
                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">保存</button>
                    <button type="button" class="btn btn-secondary" onclick="hideRoleFormPanel()">取消</button>
                </div>
            </form>
        `;
        container.querySelector('#assignPermissionsFormInPage').addEventListener('submit', async function(e) {
            e.preventDefault();
            var form = e.target;
            var permIds = Array.from(form.querySelectorAll('input[name="perm"]:checked')).map(function(cb) { return parseInt(cb.value, 10); });
            try {
                await API.post('/rbac/roles/' + roleId + '/permissions', { permission_ids: permIds });
                hideRoleFormPanel();
                loadRoles();
                loadPermissions();
                showMessage('权限分配已保存', 'success');
            } catch (err) {
                showMessage('保存失败: ' + (err.message || ''), 'error');
            }
        });
    }).catch(function(err) {
        showMessage('加载失败: ' + (err.message || ''), 'error');
        hideRoleFormPanel();
    });
}

function toggleAssignPermSelectAllInPage(checkbox) {
    var form = document.getElementById('assignPermissionsFormInPage');
    if (form) form.querySelectorAll('input[name="perm"]').forEach(function(cb) { cb.checked = checkbox.checked; });
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

function editRole(roleId) { showEditRolePanel(roleId); }
function assignPermissions(roleId) { showAssignPermissionsPanel(roleId); }
function toggleAssignPermSelectAll(checkbox) {
    var form = document.getElementById('assignPermissionsForm');
    if (form) form.querySelectorAll('input[name="perm"]').forEach(function(cb) { cb.checked = checkbox.checked; });
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
                    <button class="btn btn-sm btn-primary" onclick="showEditPermissionPanel(${p.id})">编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="deletePermission(${p.id})">删除</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('加载权限列表失败:', error);
    }
}

function showCreatePermissionPanel() {
    var listEl = document.getElementById('permissionsListSection');
    var formEl = document.getElementById('permissionsFormSection');
    var titleEl = document.getElementById('permissionsFormTitle');
    var container = document.getElementById('permissionsFormContainer');
    if (!listEl || !formEl || !container) return;
    titleEl.textContent = '新建权限';
    container.innerHTML = `
        <form id="createPermissionFormInPage">
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
            <div class="form-actions">
                <button type="submit" class="btn btn-primary">创建</button>
                <button type="button" class="btn btn-secondary" onclick="hidePermissionFormPanel()">取消</button>
            </div>
        </form>
    `;
    listEl.style.display = 'none';
    formEl.style.display = 'block';
    container.querySelector('#createPermissionFormInPage').addEventListener('submit', async function(e) {
        e.preventDefault();
        var form = e.target;
        var formData = new FormData(form);
        try {
        await API.post('/rbac/permissions', {
            code: formData.get('code'),
            name: formData.get('name'),
                resource_id: parseInt(formData.get('resource_id'), 10),
            description: formData.get('description')
        });
            hidePermissionFormPanel();
        loadPermissions();
        showMessage('权限创建成功', 'success');
        } catch (err) {
            showMessage('创建失败: ' + (err.message || ''), 'error');
        }
    });
}

function hidePermissionFormPanel() {
    var listEl = document.getElementById('permissionsListSection');
    var formEl = document.getElementById('permissionsFormSection');
    if (listEl) listEl.style.display = '';
    if (formEl) formEl.style.display = 'none';
}

function showEditPermissionPanel(permissionId) {
    var listEl = document.getElementById('permissionsListSection');
    var formEl = document.getElementById('permissionsFormSection');
    var titleEl = document.getElementById('permissionsFormTitle');
    var container = document.getElementById('permissionsFormContainer');
    if (!listEl || !formEl || !container) return;
    titleEl.textContent = '编辑权限';
    container.innerHTML = '<p class="workbench-loading">加载中...</p>';
    listEl.style.display = 'none';
    formEl.style.display = 'block';
    API.get('/rbac/permissions/' + permissionId).then(function(permission) {
        var code = (permission.code || '').replace(/"/g, '&quot;');
        var name = (permission.name || '').replace(/"/g, '&quot;');
        var desc = (permission.description || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        container.innerHTML = `
            <form id="editPermissionFormInPage">
                <div class="form-group">
                    <label>权限代码</label>
                    <input type="text" name="code" value="${code}" required>
                </div>
                <div class="form-group">
                    <label>权限名称</label>
                    <input type="text" name="name" value="${name}" required>
                </div>
                <div class="form-group">
                    <label>资源ID</label>
                    <input type="number" name="resource_id" value="${permission.resource_id}" required>
                </div>
                <div class="form-group">
                    <label>描述</label>
                    <textarea name="description">${desc}</textarea>
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">保存</button>
                    <button type="button" class="btn btn-secondary" onclick="hidePermissionFormPanel()">取消</button>
                </div>
            </form>
        `;
        container.querySelector('#editPermissionFormInPage').addEventListener('submit', async function(e) {
            e.preventDefault();
            var form = e.target;
            var formData = new FormData(form);
            try {
                await API.put('/rbac/permissions/' + permissionId, {
                code: formData.get('code'),
                name: formData.get('name'),
                    resource_id: parseInt(formData.get('resource_id'), 10),
                description: formData.get('description')
                });
                hidePermissionFormPanel();
            loadPermissions();
            showMessage('权限编辑成功', 'success');
            } catch (err) {
                showMessage('保存失败: ' + (err.message || ''), 'error');
            }
        });
    }).catch(function() {
        showMessage('加载权限信息失败', 'error');
        hidePermissionFormPanel();
    });
}

function editPermission(permissionId) { showEditPermissionPanel(permissionId); }

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
                    <button class="btn btn-sm btn-primary" onclick="showEditResourcePanel(${res.id})">编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteResource(${res.id})">删除</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('加载资源列表失败:', error);
    }
}

function showCreateResourcePanel() {
    var listEl = document.getElementById('resourcesListSection');
    var formEl = document.getElementById('resourcesFormSection');
    var titleEl = document.getElementById('resourcesFormTitle');
    var container = document.getElementById('resourcesFormContainer');
    if (!listEl || !formEl || !container) return;
    titleEl.textContent = '新建资源';
    container.innerHTML = `
        <form id="createResourceFormInPage">
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
            <div class="form-actions">
                <button type="submit" class="btn btn-primary">创建</button>
                <button type="button" class="btn btn-secondary" onclick="hideResourceFormPanel()">取消</button>
            </div>
        </form>
    `;
    listEl.style.display = 'none';
    formEl.style.display = 'block';
    container.querySelector('#createResourceFormInPage').addEventListener('submit', async function(e) {
        e.preventDefault();
        var form = e.target;
        var formData = new FormData(form);
        try {
        await API.post('/rbac/resources', {
                app_id: parseInt(formData.get('app_id'), 10),
            name: formData.get('name'),
            resource_type: formData.get('resource_type'),
            path: formData.get('path'),
                method: formData.get('method') || null
        });
            hideResourceFormPanel();
        loadResources();
        showMessage('资源创建成功', 'success');
        } catch (err) {
            showMessage('创建失败: ' + (err.message || ''), 'error');
        }
    });
}

function hideResourceFormPanel() {
    var listEl = document.getElementById('resourcesListSection');
    var formEl = document.getElementById('resourcesFormSection');
    if (listEl) listEl.style.display = '';
    if (formEl) formEl.style.display = 'none';
}

function showEditResourcePanel(resourceId) {
    var listEl = document.getElementById('resourcesListSection');
    var formEl = document.getElementById('resourcesFormSection');
    var titleEl = document.getElementById('resourcesFormTitle');
    var container = document.getElementById('resourcesFormContainer');
    if (!listEl || !formEl || !container) return;
    titleEl.textContent = '编辑资源';
    container.innerHTML = '<p class="workbench-loading">加载中...</p>';
    listEl.style.display = 'none';
    formEl.style.display = 'block';
    API.get('/rbac/resources/' + resourceId).then(function(resource) {
        var rt = resource.resource_type || 'api';
        var apiSel = rt === 'api' ? ' selected' : '';
        var uiSel = rt === 'ui' ? ' selected' : '';
        var otherSel = rt === 'other' ? ' selected' : '';
        var m = resource.method || '';
        var mEmpty = !m ? ' selected' : '';
        var mGet = m === 'GET' ? ' selected' : '';
        var mPost = m === 'POST' ? ' selected' : '';
        var mPut = m === 'PUT' ? ' selected' : '';
        var mDel = m === 'DELETE' ? ' selected' : '';
        var nameVal = (resource.name || '').replace(/"/g, '&quot;');
        var pathVal = (resource.path || '').replace(/"/g, '&quot;');
        container.innerHTML = `
            <form id="editResourceFormInPage">
                <div class="form-group">
                    <label>应用ID</label>
                    <input type="number" name="app_id" value="${resource.app_id}" required>
                </div>
                <div class="form-group">
                    <label>资源名称</label>
                    <input type="text" name="name" value="${nameVal}" required>
                </div>
                <div class="form-group">
                    <label>资源类型</label>
                    <select name="resource_type" required>
                        <option value="api"${apiSel}>API</option>
                        <option value="ui"${uiSel}>UI</option>
                        <option value="other"${otherSel}>其他</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>路径</label>
                    <input type="text" name="path" value="${pathVal}" required>
                </div>
                <div class="form-group">
                    <label>方法</label>
                    <select name="method">
                        <option value=""${mEmpty}>无</option>
                        <option value="GET"${mGet}>GET</option>
                        <option value="POST"${mPost}>POST</option>
                        <option value="PUT"${mPut}>PUT</option>
                        <option value="DELETE"${mDel}>DELETE</option>
                    </select>
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">保存</button>
                    <button type="button" class="btn btn-secondary" onclick="hideResourceFormPanel()">取消</button>
                </div>
            </form>
        `;
        container.querySelector('#editResourceFormInPage').addEventListener('submit', async function(e) {
            e.preventDefault();
            var form = e.target;
            var formData = new FormData(form);
            try {
                await API.put('/rbac/resources/' + resourceId, {
                    app_id: parseInt(formData.get('app_id'), 10),
                    name: formData.get('name'),
                    resource_type: formData.get('resource_type'),
                    path: formData.get('path'),
                    method: formData.get('method') || null
                });
                hideResourceFormPanel();
                loadResources();
                showMessage('资源编辑成功', 'success');
            } catch (err) {
                showMessage('保存失败: ' + (err.message || ''), 'error');
            }
        });
    }).catch(function() {
        showMessage('加载资源信息失败', 'error');
        hideResourceFormPanel();
    });
}

function editResource(resourceId) { showEditResourcePanel(resourceId); }

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
