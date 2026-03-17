/**
 * Fetch 请求封装
 */
const API_BASE_URL = '/api/v1';

class API {
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

        try {
            const response = await fetch(url, config);
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
            if (data.detail != null) {
                msg = Array.isArray(data.detail) ? data.detail.map(d => d.msg || JSON.stringify(d)).join('；') : String(data.detail);
            }
            if (response.status === 401) {
                const err = new Error(msg || '未授权');
                err.status = 401;
                throw err;
            }
            throw new Error(msg);
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
