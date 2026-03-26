/**
 * Fetch 请求封装
 * Access 过期时若存在 refresh_token，会尝试 POST /auth/refresh 并重试一次（产生 refresh 审计日志）。
 */
const API_BASE_URL = '/api/v1';

class API {
    /** 并发刷新合并为同一 Promise */
    static _refreshPromise = null;

    static _shouldAttemptRefresh(endpoint) {
        if (endpoint.startsWith('/auth/refresh') || endpoint.startsWith('/auth/login')) return false;
        return !!localStorage.getItem('refresh_token');
    }

    static async _tryRefreshAccessToken() {
        if (API._refreshPromise) return API._refreshPromise;
        const rt = localStorage.getItem('refresh_token');
        if (!rt) return false;
        API._refreshPromise = (async () => {
            try {
                const body = new URLSearchParams();
                body.append('refresh_token', rt);
                const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: body.toString(),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    localStorage.removeItem('access_token');
                    localStorage.removeItem('refresh_token');
                    return false;
                }
                if (data.access_token) localStorage.setItem('access_token', data.access_token);
                if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token);
                return true;
            } catch (e) {
                return false;
            } finally {
                API._refreshPromise = null;
            }
        })();
        return API._refreshPromise;
    }

    static async request(endpoint, options = {}) {
        const url = `${API_BASE_URL}${endpoint}`;
        const token = localStorage.getItem('access_token');

        const defaultHeaders = {
            'Content-Type': 'application/json',
        };

        if (token) {
            defaultHeaders['Authorization'] = `Bearer ${token}`;
        }

        const config = {
            ...options,
            headers: {
                ...defaultHeaders,
                ...options.headers,
            },
        };
        delete config._authRetry;

        try {
            const response = await fetch(url, config);

            if (response.status === 401 && !options._authRetry && API._shouldAttemptRefresh(endpoint)) {
                const refreshed = await API._tryRefreshAccessToken();
                if (refreshed) {
                    return this.request(endpoint, { ...options, _authRetry: true });
                }
            }

            // 204 No Content 无响应体，不能调用 response.json()
            if (response.status === 204) {
                if (!response.ok) throw new Error('请求失败');
                return undefined;
            }
            const data = await response.json();

            if (!response.ok) {
                let msg = '请求失败';
                if (data.detail != null) {
                    msg = Array.isArray(data.detail) ? data.detail.map(d => d.msg || JSON.stringify(d)).join('；') : String(data.detail);
                }
                const err = new Error(msg || '请求失败');
                err.status = response.status;
                if (response.status === 401) err.status = 401;
                if (response.status === 403) err.status = 403;
                throw err;
            }

            return data;
        } catch (error) {
            console.error('API请求错误:', error);
            throw error;
        }
    }

    static async get(endpoint) {
        return this.request(endpoint, { method: 'GET' });
    }

    static async post(endpoint, data) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    static async postForm(endpoint, formData) {
        const token = localStorage.getItem('access_token');
        const headers = {};

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: headers,
            body: formData,
        });

        const data = await response.json();

        if (!response.ok) {
            let msg = '请求失败';
            let captcha_required = false;
            if (data.detail != null) {
                if (typeof data.detail === 'object' && !Array.isArray(data.detail) && data.detail.message != null) {
                    msg = String(data.detail.message);
                    captcha_required = !!data.detail.captcha_required;
                } else if (Array.isArray(data.detail)) {
                    msg = data.detail.map(d => d.msg || JSON.stringify(d)).join('；');
                } else {
                    msg = String(data.detail);
                }
            }
            if (response.status === 401) {
                const err = new Error(msg || '未授权');
                err.status = 401;
                err.captcha_required = captcha_required;
                throw err;
            }
            const err = new Error(msg);
            err.captcha_required = captcha_required;
            err.status = response.status;
            throw err;
        }
        return data;
    }

    static async put(endpoint, data) {
        return this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    static async delete(endpoint) {
        return this.request(endpoint, { method: 'DELETE' });
    }
}
