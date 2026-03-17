/**
 * 管理控制台功能脚本
 */

let currentUser = null;
let isAdmin = false;
let myPermissionCodes = [];

/** 多标签组状态 */
var openTabs = [];
var activeTabId = null;
var tabIdCounter = 0;
var PAGE_TITLES = {
    workbench: '工作台',
    overview: '概览',
    usersList: '用户列表',
    approval: '注册审核',
    rolesList: '角色管理',
    permissions: '权限管理',
    resources: '资源管理',
    apps: '应用管理',
    logs: '审计日志',
    system: '系统设置',
    profile: '基本资料'
};

/** 子页面对应主页面（用于多标签下展示同一主页面不同 inner tab） */
var SUB_PAGE_MAIN = {
    usersList: 'users',
    approval: 'users',
    rolesList: 'roles',
    permissions: 'roles',
    resources: 'roles'
};

/** 各页面所需权限（用于权限变更后关闭无权限标签），null 表示无限制 */
var PAGE_PERMISSIONS = {
    workbench: null,
    overview: null,
    usersList: 'users:manage',
    approval: 'users:manage',
    rolesList: 'rbac:manage',
    permissions: 'rbac:manage',
    resources: 'rbac:manage',
    apps: 'apps:manage',
    logs: 'logs:view',
    system: ['users:manage', 'system:manage'],
    profile: null
};

/** 概览统计缓存（1 分钟内不重复请求） */
var overviewCache = { users: null, apps: null, roles: null, todayLogs: null, ts: 0 };
var OVERVIEW_CACHE_TTL = 60000;

/** 用户列表分页 */
var usersPageCurrent = 1;
var usersPageSize = 20;
var usersTotal = 0;

/** 日志列表分页 */
var logsPageCurrent = 1;
var logsPageSize = 20;
var logsTotal = 0;

/** 个人资料-会话列表分页 */
var sessionsPageCurrent = 1;
var sessionsPageSize = 10;
var sessionsAll = [];

document.addEventListener('DOMContentLoaded', async function() {
    const token = localStorage.getItem('access_token');
    if (!token) {
        window.location.href = '/login';
        return;
    }

    await loadCurrentUser();

    initNavigation();
    initTabsDropdown();
    initUserSearchDebounce();
    initUserFormInPage();
    // 默认打开概览标签
    openOrActivateTab('overview');
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

function getTodayBeijingDateString() {
    var s = new Date().toLocaleString('en-CA', { timeZone: 'Asia/Shanghai' });
    return s.split(',')[0].trim();
}

function loadChartJs() {
    if (window.Chart) return Promise.resolve();
    return new Promise(function(resolve, reject) {
        var script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
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
    document.querySelectorAll('[data-permission]').forEach(function(el) {
        if (el.closest('#overviewStatsGrid')) return;
        var perm = el.getAttribute('data-permission');
        if (!perm) return;
        var allowed = perm.split(/\s+/).some(function(p) { return codes.indexOf(p.trim()) !== -1; });
        el.style.display = allowed ? '' : 'none';
    });

    var now = Date.now();
    var useCache = (now - overviewCache.ts) < OVERVIEW_CACHE_TTL;

    async function fetchUsers() {
        if (codes.indexOf('users:manage') === -1) return;
        if (useCache && overviewCache.users !== null) {
            var el = document.getElementById('totalUsers');
            if (el) el.textContent = overviewCache.users;
            return;
        }
        var res = await API.get('/users/?limit=1&skip=0&scope=managed');
        var count = (res && typeof res.total === 'number') ? res.total : (res && res.items ? res.items.length : 0);
        overviewCache.users = count;
        overviewCache.ts = now;
        var el = document.getElementById('totalUsers');
        if (el) el.textContent = count;
    }
    async function fetchApps() {
        if (codes.indexOf('apps:manage') === -1) return;
        if (useCache && overviewCache.apps !== null) {
            var el = document.getElementById('totalApps');
            if (el) el.textContent = overviewCache.apps;
            return;
        }
        var apps = await API.get('/apps/');
        var count = Array.isArray(apps) ? apps.length : 0;
        overviewCache.apps = count;
        overviewCache.ts = now;
        var el = document.getElementById('totalApps');
        if (el) el.textContent = count;
    }
    async function fetchRoles() {
        if (codes.indexOf('rbac:manage') === -1) return;
        if (useCache && overviewCache.roles !== null) {
            var el = document.getElementById('totalRoles');
            if (el) el.textContent = overviewCache.roles;
            return;
        }
        var roles = await API.get('/rbac/roles');
        var count = Array.isArray(roles) ? roles.length : 0;
        overviewCache.roles = count;
        overviewCache.ts = now;
        var el = document.getElementById('totalRoles');
        if (el) el.textContent = count;
    }
    async function fetchLogs() {
        if (codes.indexOf('logs:view') === -1) return;
        if (useCache && overviewCache.todayLogs !== null) {
            var el = document.getElementById('todayLogs');
            if (el) el.textContent = overviewCache.todayLogs;
            return;
        }
        var today = getTodayBeijingDateString();
        var stats = await API.get('/logs/stats?start_time=' + encodeURIComponent(today) + '&end_time=' + encodeURIComponent(today));
        var count = (stats && typeof stats.total === 'number') ? stats.total : 0;
        overviewCache.todayLogs = count;
        overviewCache.ts = now;
        var el = document.getElementById('todayLogs');
        if (el) el.textContent = count;
    }

    var promises = [fetchUsers(), fetchApps(), fetchRoles(), fetchLogs()];

    if (codes.indexOf('logs:view') !== -1) {
        var chartsRow = document.getElementById('overviewChartsRow');
        if (chartsRow && chartsRow.style.display !== 'none') {
            promises.push(loadChartJs().then(function() {
                return Promise.all([loadLoginTrendChart(), loadActionPieChart()]);
            }));
        }
    }
    if (codes.indexOf('users:manage') !== -1 || codes.indexOf('system:manage') !== -1) {
        promises.push(loadSecurityOverview());
    }

    try {
        await Promise.allSettled(promises);
    } catch (e) {
        console.error('加载概览数据失败:', e);
        handle403(e);
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
        handle403(error);
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

function renderSessionsPage() {
    var tbody = document.getElementById('sessionsTableBody');
    var paginationEl = document.getElementById('sessionsPagination');
    if (!tbody) return;
    var total = sessionsAll.length;
    var maxPage = Math.max(1, Math.ceil(total / sessionsPageSize));
    var start = (sessionsPageCurrent - 1) * sessionsPageSize;
    var list = sessionsAll.slice(start, start + sessionsPageSize);
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7">暂无会话</td></tr>';
        if (paginationEl) renderPaginationBar(paginationEl, 1, maxPage, sessionsPageGo);
        return;
    }
    tbody.innerHTML = list.map(function(s) {
        var statusBadge = s.active
            ? '<span class="badge badge-success">活跃</span>'
            : (s.revoked ? '<span class="badge badge-danger">已撤销</span>' : '<span class="badge badge-warning">已过期</span>');
        return '<tr>' +
            '<td title="' + escapeHtml(s.jti || '') + '">' + (s.jti ? escapeHtml(s.jti.substring(0, 12)) + '...' : '-') + '</td>' +
            '<td>' + escapeHtml(s.ip || '-') + '</td>' +
            '<td title="' + escapeHtml(s.user_agent || '') + '">' + (s.user_agent ? escapeHtml(s.user_agent.substring(0, 40)) + '...' : '-') + '</td>' +
            '<td>' + formatBeijingTime(s.created_at) + '</td>' +
            '<td>' + formatBeijingTime(s.expires_at) + '</td>' +
            '<td>' + statusBadge + '</td>' +
            '<td>' + (s.active ? '<button type="button" class="btn btn-sm btn-danger" data-jti="' + escapeHtml(s.jti || '') + '" onclick="revokeSession(this.getAttribute(\'data-jti\'))">撤销</button>' : '-') + '</td>' +
            '</tr>';
    }).join('');
    if (paginationEl) renderPaginationBar(paginationEl, sessionsPageCurrent, maxPage, sessionsPageGo);
}

function sessionsPageGo(page) {
    if (page < 1) return;
    sessionsPageCurrent = page;
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
