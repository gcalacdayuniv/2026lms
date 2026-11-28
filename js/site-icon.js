// js/site-icon.js
// The site icon (favicon). Everyone gets the one the Admin chose (GET /api/site-icon, public), kept on the device so the tab
// shows it at once; the Admin changes it in Admin tools > Site icon (a picture is cut to a 512 x 512 PNG here, then saved).
import { apiFetch, AppState, apiPost } from './globals.js';
import { UI } from './ui-feedback.js';
import { PWA, SITE_ICON_KEY } from './pwa.js';

const KEY = SITE_ICON_KEY;
const SIZE = 512;   // Android needs a 512 icon to install; the same picture serves every smaller size
const MAX_CHARS = 440000;
const $ = (id) => document.getElementById(id);
const defaults = {};

const setLinks = (src) => {
    for (const id of ['siteIcon', 'appleIcon']) {
        const el = $(id);
        if (!el) continue;
        if (!(id in defaults)) defaults[id] = el.getAttribute('href');
        if (src) { el.setAttribute('href', src); el.setAttribute('type', 'image/png'); }
        else { el.setAttribute('href', defaults[id]); el.removeAttribute('type'); }
    }
};

const cut = (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        let out = '';
        for (const size of [SIZE, 384, 256]) {   // a very detailed picture gets a smaller square so it stays small enough to save
            const c = document.createElement('canvas');
            c.width = c.height = size;
            c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
            out = c.toDataURL('image/png');
            if (out.length <= MAX_CHARS) break;
        }
        URL.revokeObjectURL(url);
        resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture.')); };
    img.src = url;
});

export const SiteIcon = {
    pending: null,

    init: async () => {
        try { const saved = localStorage.getItem(KEY); if (saved) setLinks(saved); } catch (e) { /* storage blocked */ }
        document.addEventListener('click', SiteIcon.onClick);
        document.addEventListener('change', SiteIcon.onChange);
        try {
            const res = await apiFetch('/api/site-icon');
            setLinks(res.icon || null);
            PWA.useSiteIcon(res.icon || null);
            try { if (res.icon) localStorage.setItem(KEY, res.icon); else localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ }
        } catch (e) { /* offline: keep what is shown */ }
    },

    open: () => {
        $('siteIconDlg')?.remove();
        SiteIcon.pending = null;
        const current = (() => { try { return localStorage.getItem(KEY); } catch (e) { return null; } })() || (document.getElementById('siteIcon') || {}).href || '';
        UI.overlay({ id: 'siteIconDlg', label: 'Site icon', z: 120, panelClass: 'bg-white rounded-xl shadow-xl max-w-sm p-5', html: `<div class="flex items-center gap-3 mb-3 border-b pb-3">
                    <h3 id="siteIconTitle" class="flex-1 text-lg font-bold text-gray-800"><i class="fa-solid fa-image text-rose-600 mr-2" aria-hidden="true"></i>Site icon</h3>
                    <button type="button" data-overlay-close class="p-2 text-gray-500 hover:text-gray-800" aria-label="Close"><i class="fa-solid fa-xmark text-xl" aria-hidden="true"></i></button>
                </div>
                <p class="text-sm text-gray-600 mb-3">The icon in the browser tab and on a phone's home screen. Choose a square picture; it is cut to the centre.</p>
                <div class="flex items-center justify-center gap-4 mb-4">
                    <img id="siSample" src="${current}" alt="Current icon" class="w-24 h-24 rounded-xl border border-gray-200 object-cover bg-gray-50">
                    <img id="siSmall" src="${current}" alt="" class="w-8 h-8 rounded border border-gray-200 object-cover bg-gray-50">
                </div>
                <label class="block w-full min-h-[44px] py-2.5 text-center border border-gray-300 rounded-md text-sm font-bold text-gray-700 hover:bg-gray-50 cursor-pointer">
                    <i class="fa-solid fa-upload mr-1.5" aria-hidden="true"></i>Choose a picture
                    <input type="file" id="siFile" accept="image/*" class="sr-only">
                </label>
                <p id="siErr" class="hidden mt-2 text-sm font-bold text-red-700" role="alert"></p>
                <div class="grid grid-cols-2 gap-2 mt-3">
                    <button type="button" id="siSave" disabled class="min-h-[44px] rounded-md bg-blue-600 text-white text-sm font-bold disabled:opacity-40">Save</button>
                    <button type="button" id="siReset" class="min-h-[44px] rounded-md border border-gray-300 text-sm font-bold text-gray-700 hover:bg-gray-50">Use default</button>
                </div> `});
    },

    showErr: (t) => { const e = $('siErr'); if (e) { e.textContent = t || ''; e.classList.toggle('hidden', !t); } },

    onChange: async (e) => {
        if (e.target.id !== 'siFile' || !e.target.files || !e.target.files[0]) return;
        SiteIcon.showErr('');
        try {
            const png = await cut(e.target.files[0]);
            SiteIcon.pending = png;
            $('siSample').src = png; $('siSmall').src = png;
            $('siSave').disabled = false;
        } catch (err) { SiteIcon.showErr(err.message); }
    },

    save: async (icon) => {
        try {
            await apiPost('/api/site-icon', { icon });
            setLinks(icon);
            PWA.useSiteIcon(icon);
            try { if (icon) localStorage.setItem(KEY, icon); else localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ }
            UI.closeOverlay('siteIconDlg');
            UI.success(icon ? 'Site icon saved. Other devices pick it up the next time they open the app.' : 'Back to the default site icon.');
        } catch (err) { SiteIcon.showErr(err.message || 'Could not save the icon.'); }
    },

    onClick: (e) => {
        if (e.target.closest('#openSiteIconBtn')) { if (AppState.user && AppState.user.isAdmin) SiteIcon.open(); return; }
        if (e.target.closest('#siSave') && SiteIcon.pending) SiteIcon.save(SiteIcon.pending);
        else if (e.target.closest('#siReset')) SiteIcon.save(null);
    }
};
