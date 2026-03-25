/**
 * 壳层：用户信息、侧栏、多标签、工作台
 */
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
        var profileBtn = document.getElementById('profileTopbarBtn');
        if (profileBtn && !profileBtn._bound) {
            profileBtn._bound = true;
            profileBtn.addEventListener('click', function() { openOrActivateTab('profile'); });
        }

        await refreshPermissions();
    } catch (error) {
        console.error('加载用户信息失败:', error);
        if (error && error.status === 401) {
            localStorage.removeItem('access_token');
            window.location.href = '/login';
        }
    }
}

function handle403(err) {
    if (err && err.status === 403) {
        refreshPermissions();
        showMessage('权限已变更，请重试或刷新页面', 'error');
    }
}

/** 检查用户是否拥有某页面所需权限 */
function hasPagePermission(pageName) {
    var need = PAGE_PERMISSIONS[pageName];
    if (need == null) return true;
    if (Array.isArray(need)) return need.some(function(c) { return myPermissionCodes && myPermissionCodes.indexOf(c) !== -1; });
    return myPermissionCodes && myPermissionCodes.indexOf(need) !== -1;
}

/** 刷新权限并更新侧栏与标签（权限变更后调用） */
async function refreshPermissions() {
    try {
        var res = await API.get('/rbac/me/permissions');
        myPermissionCodes = Array.isArray(res.permission_codes) ? res.permission_codes : [];
    } catch (e) {
        myPermissionCodes = [];
    }
    applyNavVisibility();
    var toClose = [];
    openTabs.forEach(function(t) {
        if (!hasPagePermission(t.pageName)) toClose.push(t.id);
    });
    toClose.forEach(function(id) { closeTab(id); });
    if (toClose.length > 0) renderTabs();
}

function applyNavVisibility() {
    var map = {
        usersList: 'users:manage',
        approval: 'users:manage',
        rolesList: 'rbac:manage',
        permissions: 'rbac:manage',
        resources: 'rbac:manage',
        apps: 'apps:manage',
        logs: 'logs:view',
        system: ['users:manage', 'system:manage']
    };
    var anySystemVisible = false;
    Object.keys(map).forEach(function(page) {
        var items = document.querySelectorAll('.nav-item[data-page="' + page + '"]');
        var needCode = map[page];
        var visible = false;
        if (myPermissionCodes) {
            if (Array.isArray(needCode)) visible = needCode.some(function(c) { return myPermissionCodes.indexOf(c) !== -1; });
            else visible = myPermissionCodes.indexOf(needCode) !== -1;
        }
        if (visible) anySystemVisible = true;
        items.forEach(function(el) {
            el.style.display = visible ? '' : 'none';
        });
    });
    var group = document.querySelector('.nav-group[data-group="system"]');
    if (group) group.style.display = anySystemVisible ? '' : 'none';
    var usersGroup = document.querySelector('.nav-group[data-group="users"]');
    if (usersGroup) usersGroup.style.display = (map.usersList && myPermissionCodes && myPermissionCodes.indexOf('users:manage') !== -1) ? '' : 'none';
    var rolesGroup = document.querySelector('.nav-group[data-group="roles"]');
    if (rolesGroup) rolesGroup.style.display = (map.rolesList && myPermissionCodes && myPermissionCodes.indexOf('rbac:manage') !== -1) ? '' : 'none';
}

function initNavigation() {
    document.querySelectorAll('.nav-group-toggle').forEach(function(toggle) {
        toggle.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var group = toggle.closest('.nav-group');
            if (group) group.classList.toggle('expanded');
        });
    });
    document.querySelectorAll('.nav-item').forEach(function(item) {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            var page = this.getAttribute('data-page');
            if (page) openOrActivateTab(page);
        });
    });
    var systemGroup = document.querySelector('.nav-group[data-group="system"]');
    if (systemGroup) systemGroup.classList.add('expanded');
    document.querySelectorAll('.nav-group[data-group="users"], .nav-group[data-group="roles"]').forEach(function(g) {
        g.classList.add('expanded');
    });
}

/** 打开或切换到指定页面对应的标签 */
function openOrActivateTab(pageName) {
    var existing = openTabs.find(function(t) { return t.pageName === pageName; });
    if (existing) {
        setActiveTab(existing.id);
        return;
    }
    tabIdCounter++;
    var tab = { id: tabIdCounter, pageName: pageName, title: PAGE_TITLES[pageName] || pageName };
    openTabs.push(tab);
    renderTabs();
    setActiveTab(tab.id);
    loadPageData(pageName);
}

/** 切换到指定标签并显示对应内容 */
function setActiveTab(tabId) {
    activeTabId = tabId;
    var tab = openTabs.find(function(t) { return t.id === tabId; });
    if (!tab) return;

    var mainPageName = SUB_PAGE_MAIN[tab.pageName] || tab.pageName;
    var pageEl = document.getElementById(mainPageName + 'Page');
    document.querySelectorAll('.page-content').forEach(function(p) { p.classList.remove('active'); });
    if (pageEl) pageEl.classList.add('active');

    if (tab.pageName === 'usersList' || tab.pageName === 'approval') {
        switchUsersTab(tab.pageName);
    } else if (tab.pageName === 'rolesList' || tab.pageName === 'permissions' || tab.pageName === 'resources') {
        switchTab(tab.pageName === 'rolesList' ? 'roles' : tab.pageName);
    }

    document.querySelectorAll('.main-tab').forEach(function(t) { t.classList.remove('active'); });
    var tabEl = document.querySelector('.main-tab[data-tab-id="' + tabId + '"]');
    if (tabEl) tabEl.classList.add('active');

    var titleEl = document.getElementById('pageTitle');
    if (titleEl) titleEl.textContent = tab.title;

    document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
    var nav = document.querySelector('.nav-item[data-page="' + tab.pageName + '"]');
    if (nav) nav.classList.add('active');
}

/** 加载指定页面的数据（仅在新开标签时调用） */
function loadPageData(pageName) {
    switch (pageName) {
        case 'workbench':
            loadWorkbench();
            break;
        case 'overview':
            loadOverview();
            break;
        case 'usersList':
            loadUserRoleFilterOptions();
            loadUsers();
            break;
        case 'approval':
            loadPendingUsers();
            break;
        case 'rolesList':
            loadRoles();
            break;
        case 'permissions':
            loadPermissions();
            break;
        case 'resources':
            loadResources();
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
        case 'profile':
            loadProfilePageData();
            break;
        default:
            break;
    }
}

function getActivePageName() {
    var tab = openTabs.find(function(t) { return t.id === activeTabId; });
    return tab ? tab.pageName : null;
}

/** 刷新当前激活页面（不影响其它标签） */
function refreshActivePage() {
    var pageName = getActivePageName();
    if (!pageName) return;
    loadPageData(pageName);
    showMessage('已刷新当前页面', 'success');
}

/** 渲染标签栏（支持拖拽排序） */
function renderTabs() {
    var list = document.getElementById('mainTabsList');
    if (!list) return;
    list.innerHTML = openTabs.map(function(t) {
        var isActive = t.id === activeTabId;
        return '<div class="main-tab' + (isActive ? ' active' : '') + '" data-tab-id="' + t.id + '" data-page="' + t.pageName + '" draggable="true">' +
            '<span class="main-tab-title">' + escapeHtml(t.title) + '</span>' +
            '<button type="button" class="main-tab-close" aria-label="关闭">×</button></div>';
    }).join('');

    list.querySelectorAll('.main-tab').forEach(function(el) {
        var id = parseInt(el.getAttribute('data-tab-id'), 10);
        el.addEventListener('click', function(e) {
            if (!e.target.classList.contains('main-tab-close')) setActiveTab(id);
        });
        var closeBtn = el.querySelector('.main-tab-close');
        if (closeBtn) closeBtn.addEventListener('click', function(e) { e.stopPropagation(); closeTab(id); });
        el.addEventListener('dragstart', function(e) {
            e.dataTransfer.setData('text/plain', id);
            e.dataTransfer.effectAllowed = 'move';
            el.classList.add('tab-dragging');
        });
        el.addEventListener('dragend', function() { el.classList.remove('tab-dragging'); });
        el.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            var targetId = parseInt(el.getAttribute('data-tab-id'), 10);
            if (targetId !== id) el.classList.add('tab-drag-over');
        });
        el.addEventListener('dragleave', function() { el.classList.remove('tab-drag-over'); });
        el.addEventListener('drop', function(e) {
            e.preventDefault();
            el.classList.remove('tab-drag-over');
            var fromId = parseInt(e.dataTransfer.getData('text/plain'), 10);
            if (fromId === id) return;
            var fromIdx = openTabs.findIndex(function(t) { return t.id === fromId; });
            var toIdx = openTabs.findIndex(function(t) { return t.id === id; });
            if (fromIdx === -1 || toIdx === -1) return;
            var tab = openTabs.splice(fromIdx, 1)[0];
            openTabs.splice(toIdx, 0, tab);
            renderTabs();
        });
    });
}

/** 关闭标签 */
function closeTab(tabId) {
    var idx = openTabs.findIndex(function(t) { return t.id === tabId; });
    if (idx === -1) return;
    var wasActive = activeTabId === tabId;
    openTabs.splice(idx, 1);
    if (openTabs.length === 0) {
        openOrActivateTab('overview');
        return;
    }
    if (wasActive) {
        var nextIdx = Math.min(idx, openTabs.length - 1);
        if (nextIdx < 0) nextIdx = 0;
        setActiveTab(openTabs[nextIdx].id);
    }
    renderTabs();
}

/** 关闭当前标签 */
function closeCurrentTab() {
    if (activeTabId == null) return;
    closeTab(activeTabId);
    closeTabsDropdown();
}

/** 关闭其他标签（保留当前） */
function closeOtherTabs() {
    var current = openTabs.find(function(t) { return t.id === activeTabId; });
    if (!current) return;
    openTabs.length = 0;
    openTabs.push(current);
    renderTabs();
    closeTabsDropdown();
}

/** 关闭全部标签（回到概览） */
function closeAllTabs() {
    openTabs.length = 0;
    openOrActivateTab('overview');
    renderTabs();
    closeTabsDropdown();
}

function closeTabsDropdown() {
    var dd = document.getElementById('tabsDropdown');
    var btn = document.getElementById('tabsDropdownBtn');
    if (dd) { dd.classList.remove('open'); dd.setAttribute('aria-hidden', 'true'); }
    if (btn) btn.setAttribute('aria-expanded', 'false');
}

function initTabsDropdown() {
    var btn = document.getElementById('tabsDropdownBtn');
    var dd = document.getElementById('tabsDropdown');
    if (!btn || !dd) return;
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var isOpen = dd.classList.toggle('open');
        btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        dd.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    });
    dd.querySelectorAll('[data-action]').forEach(function(item) {
        item.addEventListener('click', function() {
            var action = item.getAttribute('data-action');
            if (action === 'closeCurrent') closeCurrentTab();
            else if (action === 'closeOthers') closeOtherTabs();
            else if (action === 'closeAll') closeAllTabs();
        });
    });
    document.addEventListener('click', function(e) {
        if (dd.contains(e.target) || btn.contains(e.target)) return;
        closeTabsDropdown();
    });
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
        handle403(e);
    }
}
