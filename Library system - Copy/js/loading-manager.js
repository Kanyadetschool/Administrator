/**
 * Loading States & User Feedback Utilities
 * Enhanced user experience with better feedback
 */

class LoadingManager {
    constructor() {
        this.activeLoaders = new Set();
    }

    /**
     * Show loading overlay with message
     */
    show(message = 'Loading...', allowOutside = false) {
        return Swal.fire({
            title: message,
            allowOutsideClick: allowOutside,
            allowEscapeKey: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });
    }

    /**
     * Show progress indicator
     */
    progress(title = 'Processing...', currentStep = 0, totalSteps = 100) {
        const percentage = Math.round((currentStep / totalSteps) * 100);
        Swal.fire({
            title: title,
            html: `
                <div style="width: 100%; height: 20px; background: #e9ecef; border-radius: 10px; overflow: hidden;">
                    <div style="width: ${percentage}%; height: 100%; background: #0d6efd; transition: width 0.3s;" ></div>
                </div>
                <p style="margin-top: 10px; color: #666;">${currentStep}/${totalSteps}</p>
            `,
            allowOutsideClick: false,
            showConfirmButton: false
        });
    }

    /**
     * Hide loading
     */
    hide() {
        return Swal.close();
    }

    /**
     * Show success message
     */
    async success(title = 'Success!', message = '', duration = 2000) {
        return Swal.fire({
            icon: 'success',
            title: title,
            text: message,
            timer: duration,
            timerProgressBar: true,
            showConfirmButton: false
        });
    }

    /**
     * Show error message
     */
    async error(title = 'Error!', message = '', duration = 0) {
        return Swal.fire({
            icon: 'error',
            title: title,
            text: message,
            timer: duration,
            timerProgressBar: true,
            showConfirmButton: duration === 0
        });
    }

    /**
     * Show warning
     */
    async warning(title = 'Warning!', message = '') {
        return Swal.fire({
            icon: 'warning',
            title: title,
            text: message,
            showConfirmButton: true
        });
    }

    /**
     * Show info
     */
    async info(title = 'Info', message = '') {
        return Swal.fire({
            icon: 'info',
            title: title,
            text: message
        });
    }

    /**
     * Show confirmation dialog
     */
    async confirm(title = 'Are you sure?', message = '', confirmText = 'Yes', cancelText = 'No') {
        return Swal.fire({
            icon: 'question',
            title: title,
            text: message,
            showCancelButton: true,
            confirmButtonText: confirmText,
            cancelButtonText: cancelText,
            confirmButtonColor: '#dc3545',
            cancelButtonColor: '#6c757d'
        });
    }

    /**
     * Show custom HTML content
     */
    async custom(config) {
        return Swal.fire({
            showConfirmButton: true,
            ...config
        });
    }

    /**
     * Add spinner to button during operation
     */
    addSpinnerToButton(buttonId) {
        const button = document.getElementById(buttonId);
        if (!button) return;

        button.disabled = true;
        button.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span> Loading...`;
    }

    /**
     * Remove spinner from button
     */
    removeSpinnerFromButton(buttonId, originalText) {
        const button = document.getElementById(buttonId);
        if (!button) return;

        button.disabled = false;
        button.innerHTML = originalText;
    }

    /**
     * Create a small loading skeleton
     */
    createSkeletonLoader(count = 3) {
        let html = '';
        for (let i = 0; i < count; i++) {
            html += `
                <div class="skeleton-item mb-3">
                    <div class="skeleton-line" style="height: 20px; margin-bottom: 8px;"></div>
                    <div class="skeleton-line" style="height: 15px; width: 80%; margin-bottom: 8px;"></div>
                    <div class="skeleton-line" style="height: 15px; width: 60%;"></div>
                </div>
            `;
        }
        return html;
    }
}

/**
 * Toast Notifications
 */
class Toast {
    constructor() {
        this.createContainer();
    }

    createContainer() {
        if (!document.getElementById('toast-container')) {
            const container = document.createElement('div');
            container.id = 'toast-container';
            container.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 9999;
                display: flex;
                flex-direction: column;
                gap: 10px;
                max-width: 400px;
            `;
            document.body.appendChild(container);
        }
    }

    show(message, type = 'info', duration = 4000) {
        const container = document.getElementById('toast-container');
        const id = Date.now();

        const colorMap = {
            'success': '#198754',
            'error': '#dc3545',
            'warning': '#ffc107',
            'info': '#0dcaf0'
        };

        const toast = document.createElement('div');
        toast.id = `toast-${id}`;
        toast.style.cssText = `
            background: white;
            border-left: 4px solid ${colorMap[type]};
            padding: 15px 20px;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            animation: slideIn 0.3s ease-out;
            font-size: 14px;
            color: #333;
        `;

        toast.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <span>${message}</span>
                <button onclick="document.getElementById('toast-${id}').remove()" style="border: none; background: none; cursor: pointer; font-size: 18px; color: #999;">×</button>
            </div>
        `;

        container.appendChild(toast);

        if (duration > 0) {
            setTimeout(() => {
                const elem = document.getElementById(`toast-${id}`);
                if (elem) elem.remove();
            }, duration);
        }

        return `toast-${id}`;
    }

    success(message, duration = 4000) {
        return this.show(message, 'success', duration);
    }

    error(message, duration = 5000) {
        return this.show(message, 'error', duration);
    }

    warning(message, duration = 4000) {
        return this.show(message, 'warning', duration);
    }

    info(message, duration = 3000) {
        return this.show(message, 'info', duration);
    }
}

/**
 * Add styles for skeleton loader and animations
 */
const addLoadingStyles = () => {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from {
                transform: translateX(400px);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        .skeleton-item {
            padding: 10px;
            background: white;
        }

        .skeleton-line {
            background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
            background-size: 200% 100%;
            animation: pulse 1.5s infinite;
            border-radius: 4px;
        }

        .loading-spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid #f3f3f3;
            border-top: 3px solid #0d6efd;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .badge-loading {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 4px 8px;
            background: #e9ecef;
            border-radius: 4px;
            font-size: 12px;
            color: #666;
        }
    `;
    document.head.appendChild(style);
};

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addLoadingStyles);
} else {
    addLoadingStyles();
}

// Create global instances
const loadingManager = new LoadingManager();
const toast = new Toast();

// Make global
window.loadingManager = loadingManager;
window.toast = toast;
