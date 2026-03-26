/**
 * 从 URL 解析 OAuth 参数（client_id, redirect_uri, state）
 */
function getOAuthParams() {
    const params = new URLSearchParams(window.location.search);
    const client_id = params.get('client_id');
    const redirect_uri = params.get('redirect_uri');
    const state = params.get('state') || '';
    return { client_id, redirect_uri, state };
}

async function loadLoginCaptcha() {
    const data = await API.get('/auth/captcha');
    const hidden = document.getElementById('captchaId');
    const img = document.getElementById('captchaImg');
    const codeInput = document.getElementById('captchaCode');
    if (hidden) hidden.value = data.captcha_id;
    if (img) img.src = data.image_base64;
    if (codeInput) codeInput.value = '';
}

async function showCaptchaIfNeeded(username) {
    const row = document.getElementById('captchaRow');
    if (!row || !username || !String(username).trim()) return;
    try {
        const r = await fetch('/api/v1/auth/captcha-required?username=' + encodeURIComponent(String(username).trim()));
        const data = await r.json();
        if (data.captcha_required) {
            row.style.display = 'block';
            await loadLoginCaptcha();
        }
    } catch (e) {
        /* 忽略探测失败 */
    }
}

/**
 * 登录/登出逻辑
 */
document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const oauth = getOAuthParams();

    const usernameInput = document.getElementById('username');
    if (usernameInput) {
        usernameInput.addEventListener('blur', function() {
            showCaptchaIfNeeded(usernameInput.value);
        });
    }
    const captchaImg = document.getElementById('captchaImg');
    const captchaRefresh = document.getElementById('captchaRefresh');
    if (captchaImg) {
        captchaImg.addEventListener('click', function() {
            loadLoginCaptcha().catch(function() {});
        });
    }
    if (captchaRefresh) {
        captchaRefresh.addEventListener('click', function() {
            loadLoginCaptcha().catch(function() {});
        });
    }

    // 登录表单处理
    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const errorDiv = document.getElementById('error');

            errorDiv.textContent = '';

            const formData = new FormData();
            formData.append('username', username);
            formData.append('password', password);
            if (oauth.client_id) formData.append('client_id', oauth.client_id);
            if (oauth.redirect_uri) formData.append('redirect_uri', oauth.redirect_uri);
            if (oauth.state !== undefined) formData.append('state', oauth.state);

            const captchaRow = document.getElementById('captchaRow');
            if (captchaRow && captchaRow.style.display !== 'none') {
                const cid = document.getElementById('captchaId');
                const cc = document.getElementById('captchaCode');
                formData.append('captcha_id', cid ? cid.value : '');
                formData.append('captcha_code', cc ? cc.value : '');
            }

            try {
                const response = await API.postForm('/auth/login', formData);

                if (response.redirect_url) {
                    // 单点登录：同时保存 token，便于之后访问管理端免登
                    if (response.access_token) {
                        localStorage.setItem('access_token', response.access_token);
                        if (response.refresh_token) localStorage.setItem('refresh_token', response.refresh_token);
                    }
                    window.location.href = response.redirect_url;
                    return;
                }
                localStorage.setItem('access_token', response.access_token);
                if (response.refresh_token) localStorage.setItem('refresh_token', response.refresh_token);
                window.location.href = '/dashboard';
            } catch (error) {
                errorDiv.textContent = error.message || '登录失败，请检查用户名和密码';
                if (error.captcha_required) {
                    const row = document.getElementById('captchaRow');
                    if (row) row.style.display = 'block';
                    loadLoginCaptcha().catch(function() {});
                }
            }
        });
    }

    // 注册表单处理
    if (registerForm) {
        registerForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            const username = document.getElementById('reg_username').value;
            const email = document.getElementById('reg_email').value;
            const password = document.getElementById('reg_password').value;
            const fullName = document.getElementById('reg_full_name').value;
            const errorDiv = document.getElementById('reg_error');
            const successDiv = document.getElementById('reg_success');

            errorDiv.textContent = '';
            successDiv.textContent = '';

            try {
                var res = await API.post('/users/register', {
                    username,
                    email,
                    password,
                    full_name: fullName
                });

                var msg = (res && res.message) ? res.message : '注册成功！请登录。';
                successDiv.textContent = msg;
                setTimeout(() => {
                    window.location.href = '/login';
                }, 2500);
            } catch (error) {
                errorDiv.textContent = error.message || '注册失败';
            }
        });
    }

    // 登出处理：先请求服务端清除 SSO Cookie，再清本地 token 并跳转（需等请求完成再跳转，否则 Cookie 可能未清除）
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function() {
            var token = localStorage.getItem('access_token');
            var headers = token ? { 'Authorization': 'Bearer ' + token } : {};
            fetch('/api/v1/auth/logout', { method: 'POST', headers: headers, credentials: 'include' })
                .catch(function() {})
                .finally(function() {
                    localStorage.removeItem('access_token');
                    localStorage.removeItem('refresh_token');
                    window.location.href = '/login';
                });
        });
    }

    // 未登录访问 dashboard/根 时跳转登录
    const token = localStorage.getItem('access_token');
    if (!token && (window.location.pathname.includes('dashboard') || window.location.pathname === '/')) {
        window.location.href = '/login';
        return;
    }
    // 已登录访问登录页且非 OAuth 流程时，直接进仪表盘
    const oauthCheck = getOAuthParams();
    if (token && (window.location.pathname === '/login' || window.location.pathname === '/') && !oauthCheck.client_id) {
        window.location.href = '/dashboard';
    }
});

async function loadUserInfo() {
    try {
        const user = await API.get('/users/me');
        const userInfoDiv = document.getElementById('userInfo');
        if (userInfoDiv) {
            userInfoDiv.innerHTML = `
                <h2>欢迎, ${user.full_name || user.username}!</h2>
                <p><strong>用户名:</strong> ${user.username}</p>
                <p><strong>邮箱:</strong> ${user.email}</p>
                <p><strong>状态:</strong> ${user.is_active ? '已激活' : '未激活'}</p>
                <p><strong>角色:</strong> ${(user.roles && user.roles.length) ? user.roles.map(r => r.name).join('、') : '普通用户'}</p>
            `;
        }
    } catch (error) {
        console.error('加载用户信息失败:', error);
        if (error.status === 401 || error.message.includes('401')) {
            localStorage.removeItem('access_token');
            window.location.href = '/login';
        }
    }
}
