// js/ui-feedback.js
// Non-blocking toasts and a promise-based confirm modal (replaces alert()/confirm()).

const ICONS = {
    success: 'fa-circle-check',
    error: 'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info'
};

const COLORS = {
    success: 'bg-green-600',
    error: 'bg-red-600',
    warning: 'bg-orange-500',
    info: 'bg-blue-600'
};

const MAX_TOASTS = 4;

export const UI = {
    host: null,

    getHost: () => {
        if (UI.host && document.body.contains(UI.host)) return UI.host;
        const host = document.createElement('div');
        host.id = 'toastHost';
        host.className = 'fixed top-4 right-4 left-4 sm:left-auto sm:w-96 z-[400] flex flex-col gap-2 pointer-events-none';
        host.setAttribute('aria-live', 'polite');
        document.body.appendChild(host);
        UI.host = host;
        return host;
    },

    toast: (message, type = 'info', duration = 3500) => {
        const host = UI.getHost();
        while (host.children.length >= MAX_TOASTS) host.removeChild(host.firstChild);

        const el = document.createElement('div');
        el.className = `pointer-events-auto flex items-start gap-3 text-white px-4 py-3 rounded-lg shadow-lg fade-in cursor-pointer ${COLORS[type] || COLORS.info}`;
        el.setAttribute('role', type === 'error' ? 'alert' : 'status');

        const icon = document.createElement('i');
        icon.className = `fa-solid ${ICONS[type] || ICONS.info} mt-0.5`;
        const text = document.createElement('div');
        text.className = 'text-sm font-bold flex-1 break-words';
        text.textContent = String(message ?? '');

        el.appendChild(icon);
        el.appendChild(text);
        host.appendChild(el);

        let timer = null;
        const dismiss = () => {
            clearTimeout(timer);
            el.style.transition = 'opacity 0.2s';
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 200);
        };
        el.addEventListener('click', dismiss);
        if (duration > 0) timer = setTimeout(dismiss, duration);
        return dismiss;
    },

    success: (message, duration) => UI.toast(message, 'success', duration),
    error: (message, duration = 5000) => UI.toast(message, 'error', duration),
    warning: (message, duration = 4500) => UI.toast(message, 'warning', duration),
    info: (message, duration) => UI.toast(message, 'info', duration),

    confirm: ({
        title = 'Please confirm',
        message = '',
        confirmText = 'Confirm',
        cancelText = 'Cancel',
        danger = false
    } = {}) => new Promise((resolve) => {
        const previousFocus = document.activeElement;

        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[300] flex items-center justify-center p-4 fade-in';
        overlay.setAttribute('role', 'alertdialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'uiConfirmTitle');
        overlay.setAttribute('aria-describedby', 'uiConfirmMessage');

        const backdrop = document.createElement('div');
        backdrop.className = 'absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm';

        const card = document.createElement('div');
        card.className = 'bg-white rounded-lg shadow-xl w-full max-w-sm p-5 relative z-10 scale-up';

        const head = document.createElement('div');
        head.className = 'flex items-start gap-3 mb-4';

        const iconWrap = document.createElement('div');
        iconWrap.className = `flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${danger ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`;
        iconWrap.innerHTML = `<i class="fa-solid ${danger ? 'fa-triangle-exclamation' : 'fa-circle-question'} text-lg"></i>`;

        const textWrap = document.createElement('div');
        const titleEl = document.createElement('h3');
        titleEl.id = 'uiConfirmTitle';
        titleEl.className = 'text-base font-black text-gray-800';
        titleEl.textContent = title;
        const msgEl = document.createElement('p');
        msgEl.id = 'uiConfirmMessage';
        msgEl.className = 'text-sm text-gray-600 mt-1 whitespace-pre-line';
        msgEl.textContent = message;
        textWrap.appendChild(titleEl);
        textWrap.appendChild(msgEl);

        head.appendChild(iconWrap);
        head.appendChild(textWrap);

        const actions = document.createElement('div');
        actions.className = 'flex flex-col-reverse sm:flex-row sm:justify-end gap-2';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'px-4 py-2 rounded-md text-sm font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition';
        cancelBtn.textContent = cancelText;

        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = `px-4 py-2 rounded-md text-sm font-bold text-white focus:outline-none focus:ring-2 focus:ring-offset-1 transition ${danger ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500' : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'}`;
        okBtn.textContent = confirmText;

        actions.appendChild(cancelBtn);
        actions.appendChild(okBtn);
        card.appendChild(head);
        card.appendChild(actions);
        overlay.appendChild(backdrop);
        overlay.appendChild(card);
        document.body.appendChild(overlay);

        const finish = (result) => {
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
            if (previousFocus && typeof previousFocus.focus === 'function' && document.body.contains(previousFocus)) {
                previousFocus.focus();
            }
            resolve(result);
        };

        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                finish(false);
            } else if (e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                const order = [cancelBtn, okBtn];
                const idx = order.indexOf(document.activeElement);
                const next = e.shiftKey ? (idx <= 0 ? order.length - 1 : idx - 1) : (idx + 1) % order.length;
                order[next].focus();
            }
        };

        document.addEventListener('keydown', onKey, true);
        backdrop.addEventListener('click', () => finish(false));
        cancelBtn.addEventListener('click', () => finish(false));
        okBtn.addEventListener('click', () => finish(true));

        // Destructive actions default focus to Cancel; others to Confirm.
        (danger ? cancelBtn : okBtn).focus();
    })
};
