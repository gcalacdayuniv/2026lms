// js/pwa.js
// Makes the portal installable as a phone app: the manifest is the static manifest.webmanifest (+ icons/*.png) so Android can
// install a real app (WebAPK); the iPhone icon and launch image are made here from the Admin's site icon. The service worker (sw.js) keeps the last copy for a weak or missing connection,
// and a small banner offers "Install" once the lecturer is logged in.
import { AppState } from './globals.js';
import { UI } from './ui-feedback.js';
import { Theme } from './theme.js';

export const SITE_ICON_KEY = 'site_icon_v1';   // the Admin's site icon (js/site-icon.js), shared so the installed app uses it too
const THEME = '#2563eb';
const DISMISS_KEY = 'pwa_install_dismissed';

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const store = {
    get: () => { try { return localStorage.getItem(DISMISS_KEY); } catch (e) { return null; } },
    set: () => { try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) { /* private mode */ } }
};

// Icon: blue rounded square with a white answer sheet and a check mark.
export const drawIcon = (size, maskable) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    const u = size / 100;
    const bg = x.createLinearGradient(0, 0, size, size);
    bg.addColorStop(0, '#3b82f6');
    bg.addColorStop(1, '#1d4ed8');
    x.fillStyle = bg;
    if (maskable) x.fillRect(0, 0, size, size);
    else { x.beginPath(); x.roundRect(0, 0, size, size, 22 * u); x.fill(); }
    const s = maskable ? 0.8 : 1;   // maskable icons keep the picture inside the safe zone
    x.save();
    x.translate(50 * u, 50 * u);
    x.scale(s, s);
    x.translate(-50 * u, -50 * u);
    x.fillStyle = '#ffffff';
    x.beginPath(); x.roundRect(27 * u, 18 * u, 46 * u, 64 * u, 6 * u); x.fill();
    x.fillStyle = '#bfdbfe';
    [34, 46].forEach(y => { x.beginPath(); x.roundRect(34 * u, y * u, 32 * u, 4 * u, 2 * u); x.fill(); });
    x.strokeStyle = '#16a34a'; x.lineWidth = 6 * u; x.lineCap = 'round'; x.lineJoin = 'round';
    x.beginPath(); x.moveTo(37 * u, 66 * u); x.lineTo(46 * u, 74 * u); x.lineTo(63 * u, 58 * u); x.stroke();
    x.restore();
    return c.toDataURL('image/png');
};

// The Admin's picture as an app icon: the whole square for a normal icon, on white with a safe margin for a maskable one.
const pictureIcon = (src, size, maskable) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const x = c.getContext('2d');
        x.imageSmoothingQuality = 'high';
        if (maskable) {
            x.fillStyle = '#ffffff'; x.fillRect(0, 0, size, size);
            const s = size * 0.8; x.drawImage(img, (size - s) / 2, (size - s) / 2, s, s);
        } else x.drawImage(img, 0, 0, size, size);
        resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = src;
});

// The launch background is the colour of the icon's edge (the navy of the logo), so the splash looks like one piece with the logo.
// Samples the middle of each side (the corners of a rounded icon are transparent); falls back to the old white/dark.
const edgeColor = (src) => new Promise((resolve) => {
    const fallback = Theme.isDark() ? '#0b1220' : '#ffffff';
    const img = new Image();
    img.onload = () => {
        try {
            const c = document.createElement('canvas');
            c.width = c.height = 16;
            const x = c.getContext('2d', { willReadFrequently: true });
            x.drawImage(img, 0, 0, 16, 16);
            let r = 0, g = 0, b = 0, n = 0;
            [[1, 8], [14, 8], [8, 1], [8, 14], [2, 4], [13, 4], [2, 11], [13, 11]].forEach(([px, py]) => {
                const d = x.getImageData(px, py, 1, 1).data;
                if (d[3] > 200) { r += d[0]; g += d[1]; b += d[2]; n++; }
            });
            if (!n) { resolve(fallback); return; }
            const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
            resolve(`#${hex(r)}${hex(g)}${hex(b)}`);
        } catch (err) { resolve(fallback); }
    };
    img.onerror = () => resolve(fallback);
    img.src = src;
});

// iPhone launch image: Safari matches it by exact screen size, so it is made for this device only
// (it takes effect the next time the app is added to the Home Screen).
const addSplash = (icon, bg) => {
    if (!isIos()) return;
    const w = window.screen.width, h = window.screen.height, r = window.devicePixelRatio || 1;
    const c = document.createElement('canvas');
    c.width = Math.round(w * r); c.height = Math.round(h * r);
    const x = c.getContext('2d');
    x.fillStyle = bg;
    x.fillRect(0, 0, c.width, c.height);
    const img = new Image();
    img.onload = () => {
        const size = Math.round(Math.min(c.width, c.height) * 0.28);
        x.drawImage(img, (c.width - size) / 2, (c.height - size) / 2 - size * 0.1, size, size);
        document.getElementById('pwaSplash')?.remove();
        addHead('link', {
            id: 'pwaSplash',
            rel: 'apple-touch-startup-image',
            href: c.toDataURL('image/png'),
            media: `(device-width: ${Math.min(w, h)}px) and (device-height: ${Math.max(w, h)}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`
        });
    };
    img.src = icon;
};

const addHead = (tag, attrs) => {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    document.head.appendChild(el);
    return el;
};

export const PWA = {
    deferred: null,

    // (Re)writes the iPhone Home Screen icon and launch image. The manifest is static (manifest.webmanifest): Android needs a real
    // file to install the app, so Android keeps the icons in icons/ (replace those PNGs to change the Android icon).
    applyIcons: async (icon192, icon512) => {
        const bg = await edgeColor(icon512);
        let apple = document.getElementById('appleIcon');
        if (apple) apple.setAttribute('href', icon192);
        else addHead('link', { id: 'appleIcon', rel: 'apple-touch-icon', href: icon192 });
        addSplash(icon512, bg);
    },

    // The installed app uses the Admin's site icon (a null src goes back to the built-in icon).
    useSiteIcon: async (src) => {
        try {
            if (!src) { PWA.applyIcons(drawIcon(192, false), drawIcon(512, false)); return; }
            const [i192, i512] = await Promise.all([pictureIcon(src, 192, false), pictureIcon(src, 512, false)]);
            if (i192 && i512) PWA.applyIcons(i192, i512);
        } catch (err) { console.warn('Site icon not applied to the app icon:', err); }
    },

    init: () => {
        try {
            PWA.applyIcons(drawIcon(192, false), drawIcon(512, false));
            addHead('meta', { name: 'theme-color', content: THEME });
            addHead('meta', { name: 'mobile-web-app-capable', content: 'yes' });
            addHead('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
            addHead('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'default' });
            addHead('meta', { name: 'apple-mobile-web-app-title', content: 'Portal' });
            let saved = null;
            try { saved = localStorage.getItem(SITE_ICON_KEY); } catch (e) { /* storage blocked */ }
            if (saved) PWA.useSiteIcon(saved);
        } catch (err) {
            console.warn('App icons could not be prepared:', err);
        }

        if ('serviceWorker' in navigator && (window.isSecureContext || location.hostname === 'localhost')) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker not registered:', err));
            });
        }

        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            PWA.deferred = e;
            PWA.maybeShow();
        });
        window.addEventListener('appinstalled', () => {
            PWA.deferred = null;
            PWA.hide();
        });
        window.addEventListener('hashchange', () => setTimeout(PWA.maybeShow, 800));

        // "Install app" in the profile panel stays available after the banner was dismissed.
        document.addEventListener('click', async (e) => {
            if (!e.target.closest || !e.target.closest('#installAppBtn')) return;
            if (PWA.deferred) {
                const prompt = PWA.deferred;
                PWA.hide();
                prompt.prompt();
                await prompt.userChoice.catch(() => {});
                PWA.deferred = null;
            } else if (isIos()) {
                UI.info('Tap the Share button, then Add to Home Screen.');
            } else {
                UI.info('Open your browser menu and choose Install app or Add to Home screen.');
            }
        });
        setTimeout(PWA.maybeShow, 3000);
    },

    maybeShow: () => {
        if (isStandalone() || store.get() || document.getElementById('installBanner')) return;
        if (!AppState.user || window.location.hash === '#login' || window.location.hash === '#register') return;
        if (window.innerWidth >= 1024) return;
        if (!PWA.deferred && !isIos()) return;

        const bar = document.createElement('div');
        bar.id = 'installBanner';
        bar.setAttribute('role', 'region');
        bar.setAttribute('aria-label', 'Install the app');
        bar.className = 'fixed left-3 right-3 bg-gray-900 text-white rounded-xl shadow-2xl p-3 flex items-center gap-3 fade-in';
        bar.style.bottom = 'calc(0.75rem + env(safe-area-inset-bottom, 0px))';
        // Below the pages (z 50+) and the tab bar (z 45) so it can never cover them; on phones styles.css lifts it above the bar.
        bar.style.zIndex = '44';
        const text = PWA.deferred
            ? 'Install this app on your phone for quick access.'
            : 'To install: tap Share, then Add to Home Screen.';
        bar.innerHTML = `
            <i class="fa-solid fa-mobile-screen-button text-xl text-blue-300" aria-hidden="true"></i>
            <div class="flex-1 text-xs font-bold">${text}</div>
            ${PWA.deferred ? '<button type="button" id="installBannerBtn" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-xs font-bold">Install</button>' : ''}
            <button type="button" id="installBannerClose" class="px-2 py-1.5 text-xs font-bold text-gray-300 hover:text-white" aria-label="Not now">Not now</button>`;
        document.body.appendChild(bar);

        bar.querySelector('#installBannerClose').addEventListener('click', () => { store.set(); PWA.hide(); });
        bar.querySelector('#installBannerBtn')?.addEventListener('click', async () => {
            const prompt = PWA.deferred;
            PWA.hide();
            if (!prompt) return;
            prompt.prompt();
            await prompt.userChoice.catch(() => {});
            PWA.deferred = null;
            store.set();
        });
    },

    hide: () => document.getElementById('installBanner')?.remove()
};
