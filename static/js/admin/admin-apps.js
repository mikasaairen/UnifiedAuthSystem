/**
 * 应用接入管理
 */
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
        handle403(error);
    }
}

function showBatchRegisterModal() {
    const html = `
        <p class="form-hint">每行一个应用，填写应用名称、描述（可选）、回调地址（可选）。</p>
        <div id="batchRegisterRows">
            <div class="batch-app-row form-row" style="display:flex;gap:12px;margin-bottom:12px;align-items:flex-end;flex-wrap:wrap;">
                <div class="form-group" style="flex:1;min-width:160px;margin-bottom:0;">
                    <label>应用名称</label>
                    <input type="text" name="app_name" required placeholder="必填">
                </div>
                <div class="form-group" style="flex:1;min-width:160px;margin-bottom:0;">
                    <label>描述</label>
                    <input type="text" name="description" placeholder="可选">
                </div>
                <div class="form-group" style="flex:1;min-width:160px;margin-bottom:0;">
                    <label>回调地址</label>
                    <input type="url" name="callback_url" placeholder="可选">
                </div>
                <button type="button" class="btn btn-sm btn-danger" style="flex-shrink:0;margin-bottom:2px;" onclick="removeBatchRow(this)">删除</button>
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

function showCreateAppPanel() {
    var listEl = document.getElementById('appsListSection');
    var formEl = document.getElementById('appsFormSection');
    var titleEl = document.getElementById('appsFormTitle');
    var container = document.getElementById('appsFormContainer');
    if (!listEl || !formEl || !container) return;
    titleEl.textContent = '注册应用';
    container.innerHTML = `
        <form id="createAppFormInPage">
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
            <div class="form-actions">
                <button type="submit" class="btn btn-primary">注册</button>
                <button type="button" class="btn btn-secondary" onclick="hideAppFormPanel()">取消</button>
                </div>
            </form>
    `;
    listEl.style.display = 'none';
    formEl.style.display = 'block';
    container.querySelector('#createAppFormInPage').addEventListener('submit', async function(e) {
        e.preventDefault();
        var form = e.target;
        var formData = new FormData(form);
        try {
            var res = await API.post('/apps/register', {
                app_name: formData.get('app_name'),
                description: formData.get('description'),
                callback_url: formData.get('callback_url') || null
            });
            hideAppFormPanel();
            loadApps();
            var text = 'app_id: ' + (res.app_id || '') + '\napp_secret: ' + (res.app_secret || '') + '\napp_name: ' + (res.app_name || '') + '\nstatus: ' + (res.status || '') + '\n\n请妥善保存 app_secret，关闭后将无法再次查看。';
            var json = JSON.stringify({ app_id: res.app_id, app_secret: res.app_secret, app_name: res.app_name, status: res.status }, null, 2);
            showModal('应用注册成功（请保存密钥）', '<pre style="max-height:280px;overflow:auto;font-size:12px;white-space:pre-wrap;">' + text.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre><div class="modal-actions"><a href="data:application/json;charset=utf-8,' + encodeURIComponent(json) + '" download="app_credentials.json" class="btn btn-primary">下载密钥 JSON</a><button type="button" class="btn btn-secondary" onclick="closeModal()">关闭</button></div>', null);
            showMessage('应用注册成功，请保存上方密钥', 'success');
        } catch (err) {
            showMessage('注册失败: ' + (err.message || ''), 'error');
        }
    });
}

function hideAppFormPanel() {
    var listEl = document.getElementById('appsListSection');
    var formEl = document.getElementById('appsFormSection');
    if (listEl) listEl.style.display = '';
    if (formEl) formEl.style.display = 'none';
}

function showEditAppPanel(appId) {
    var listEl = document.getElementById('appsListSection');
    var formEl = document.getElementById('appsFormSection');
    var titleEl = document.getElementById('appsFormTitle');
    var container = document.getElementById('appsFormContainer');
    if (!listEl || !formEl || !container) return;
    titleEl.textContent = '编辑应用';
    container.innerHTML = '<p class="workbench-loading">加载中...</p>';
    listEl.style.display = 'none';
    formEl.style.display = 'block';
    API.get('/apps/' + appId).then(function(app) {
        var name = (app.app_name || '').replace(/"/g, '&quot;');
        var desc = (app.description || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        var url = (app.callback_url || '').replace(/"/g, '&quot;');
        container.innerHTML = `
            <form id="editAppFormInPage">
                <div class="form-group">
                    <label>应用名称</label>
                    <input type="text" name="app_name" value="${name}" required>
                </div>
                <div class="form-group">
                    <label>描述</label>
                    <textarea name="description">${desc}</textarea>
                </div>
                <div class="form-group">
                    <label>回调地址</label>
                    <input type="url" name="callback_url" value="${url}">
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn btn-primary">保存</button>
                    <button type="button" class="btn btn-secondary" onclick="hideAppFormPanel()">取消</button>
                </div>
            </form>
        `;
        container.querySelector('#editAppFormInPage').addEventListener('submit', async function(e) {
            e.preventDefault();
            var form = e.target;
            var formData = new FormData(form);
            try {
                await API.put('/apps/' + appId, {
                    app_name: formData.get('app_name'),
                    description: formData.get('description'),
                    callback_url: formData.get('callback_url') || ''
                });
                hideAppFormPanel();
                loadApps();
                showMessage('应用编辑成功', 'success');
            } catch (err) {
                showMessage('保存失败: ' + (err.message || ''), 'error');
            }
        });
    }).catch(function() {
        showMessage('加载应用信息失败', 'error');
        hideAppFormPanel();
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

function editApp(appId) { showEditAppPanel(appId); }
