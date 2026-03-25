/**
 * 概览页：统计卡片、图表、安全概览
 */
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
