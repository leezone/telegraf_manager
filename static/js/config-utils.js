/**
 * 配置文件管理 - 通用工具函数
 * 包含：提示消息、字符串转义、模态框管理等通用功能
 */

// 辅助函数：转义 HTML 特殊字符
function escapeHtml(unsafe) {
    if (unsafe === null || typeof unsafe === 'undefined') {
        return '';
    }
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// 辅助函数：转义 JavaScript 字符串字面量中的特殊字符
function escapeJsStringLiteral(str) {
    return str
        .replace(/\\/g, '\\') // Escape backslashes first
        .replace(/'/g, "'")     // Escape single quotes
        .replace(/\n/g, '\n')    // Escape newlines
        .replace(/\r/g, '\r');   // Escape carriage returns
}

// 显示提示消息
function showAlert(message, type = 'info', containerId = 'alertPlaceholder') {
    const alertPlaceholder = document.getElementById(containerId);
    if (!alertPlaceholder) {
        console.error(`Alert placeholder with id '${containerId}' not found.`);
        return;
    }
    const wrapper = document.createElement('div');
    wrapper.innerHTML = [
        `<div class=\"alert alert-${type} alert-dismissible fade show\" role=\"alert\">`,
        `   <div>${escapeHtml(message)}</div>`,
        '   <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>',
        '</div>'
    ].join('');
    alertPlaceholder.innerHTML = ''; // Clear previous alerts
    alertPlaceholder.append(wrapper);

    // 5秒后自动移除提示
    setTimeout(() => {
        const alertEl = wrapper.querySelector('.alert');
        if (alertEl) {
            const bsAlert = bootstrap.Alert.getOrCreateInstance(alertEl);
            if (bsAlert) {
                bsAlert.close();
            }
        }
    }, 5000);
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 格式化日期时间
function formatDateTime(dateString) {
    if (!dateString) return '-';
    try {
        const date = new Date(dateString);
        return date.toLocaleString('zh-CN');
    } catch (e) {
        return dateString;
    }
}

// 确认对话框
function confirmAction(message, callback) {
    if (confirm(message)) {
        callback();
    }
}

// 防抖函数
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// API 请求封装
class ApiClient {
    static async request(url, options = {}) {
        try {
            const response = await fetch(url, {
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                ...options
            });

            const contentType = response.headers.get('content-type');
            let data;

            if (contentType && contentType.includes('application/json')) {
                data = await response.json();
            } else {
                data = await response.text();
            }

            if (!response.ok) {
                let error;
                if (typeof data === 'object' && data !== null && data.error) {
                    // 创建一个包含更丰富信息的错误对象
                    error = new Error(data.error);
                    error.details = data.details; // 附加 details 对象
                } else {
                    error = new Error(data || `HTTP ${response.status}: ${response.statusText}`);
                }
                throw error;
            }

            return data;
        } catch (error) {
            console.error(`API请求失败 [${url}]:`, error);
            throw error;
        }
    }


    static async get(url) {
        return this.request(url, { method: 'GET' });
    }

    static async post(url, data) {
        return this.request(url, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    static async put(url, data) {
        return this.request(url, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    static async delete(url) {
        return this.request(url, { method: 'DELETE' });
    }
}

// 模态框管理器
class ModalManager {
    static instances = new Map();

    static getModal(modalId) {
        if (!this.instances.has(modalId)) {
            const modalElement = document.getElementById(modalId);
            if (modalElement) {
                this.instances.set(modalId, new bootstrap.Modal(modalElement));
            }
        }
        return this.instances.get(modalId);
    }

    static showModal(modalId) {
        const modal = this.getModal(modalId);
        if (modal) {
            modal.show();
        } else {
            console.error(`模态框不存在: ${modalId}`);
        }
    }

    static hideModal(modalId) {
        const modal = this.getModal(modalId);
        if (modal) {
            modal.hide();
        }
    }
}

// 表单验证工具
class FormValidator {
    static validateRequired(value, fieldName) {
        if (!value || value.trim() === '') {
            throw new Error(`${fieldName}不能为空`);
        }
        return value.trim();
    }

    static validateConfigName(name, existingNames = [], currentName = null) {
        const trimmedName = this.validateRequired(name, '配置文件名称');
        
        if (existingNames.includes(trimmedName) && trimmedName !== currentName) {
            throw new Error('配置名称已存在，请使用其他名称');
        }
        
        return trimmedName;
    }

    static validateConfigContent(content) {
        return this.validateRequired(content, '配置文件内容');
    }
}

// 下载文件工具
function downloadFile(content, filename, contentType = 'text/plain') {
    const blob = new Blob([content], { type: contentType });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
}

// 动态加载脚本
function loadScript(src, callback) {
    const script = document.createElement('script');
    script.src = src;
    script.onload = callback;
    script.onerror = () => console.error(`加载脚本失败: ${src}`);
    document.head.appendChild(script);
}

// 动态加载CSS
function loadCss(href) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
}