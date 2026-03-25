/**
 * 工具函数：时间、HTML 转义、分页条、Chart.js 按需加载
 */
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
