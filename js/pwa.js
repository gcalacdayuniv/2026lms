// js/pwa.js
// Makes the portal installable as a phone app: manifest and icons are made here (the site only serves
// .html/.css/.js files), the service worker (sw.js) keeps the last copy for a weak or missing connection,
// and a small banner offers "Install" once the lecturer is logged in.
import { AppState } from './globals.js';
import { UI } from './ui-feedback.js';
import { Theme } from './theme.js';

const THEME = '#2563eb';
const DISMISS_KEY = 'pwa_install_dismissed';

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const store = {
    get: () => { try { return localStorage.getItem(DISMISS_KEY); } catch (e) { return null; } },
    set: () => { try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) { /* private mode */ } }
};

// Icon: blue rounded square with a white answer sheet and a check mark.
const drawIcon = (size, maskable) => {
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

// iPhone launch image: Safari matches it by exact screen size, so it is made for this device only
// (it takes effect the next time the app is added to the Home Screen).
const addSplash = (icon) => {
    if (!isIos()) return;
    const w = window.screen.width, h = window.screen.height, r = window.devicePixelRatio || 1;
    const c = document.createElement('canvas');
    c.width = Math.round(w * r); c.height = Math.round(h * r);
    const x = c.getContext('2d');
    x.fillStyle = Theme.isDark() ? '#0b1220' : '#ffffff';
    x.fillRect(0, 0, c.width, c.height);
    const img = new Image();
    img.onload = () => {
        const size = Math.round(Math.min(c.width, c.height) * 0.28);
        x.drawImage(img, (c.width - size) / 2, (c.height - size) / 2 - size * 0.1, size, size);
        addHead('link', {
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

    init: () => {
        try {
            const icon192 = drawIcon(192, false);
            const icon512 = drawIcon(512, false);
            const maskable = drawIcon(512, true);
            const base = new URL('./', window.location.href).href;
            const manifest = {
                name: document.title || 'Online Portal',
                short_name: 'Portal',
                start_url: base,
                scope: base,
                display: 'standalone',
                orientation: 'portrait',
                background_color: Theme.isDark() ? '#0b1220' : '#ffffff',
                theme_color: THEME,
                icons: [
                    { src: icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
                    { src: icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
                    { src: maskable, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
                ]
            };
            const url = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }));
            addHead('link', { rel: 'manifest', href: url });
            addHead('link', { rel: 'apple-touch-icon', href: icon192 });
            addSplash(icon512);
            addHead('meta', { name: 'theme-color', content: THEME });
            addHead('meta', { name: 'mobile-web-app-capable', content: 'yes' });
            addHead('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
            addHead('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'default' });
            addHead('meta', { name: 'apple-mobile-web-app-title', content: 'Portal' });
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
        bar.className = 'fixed left-3 right-3 z-[60] bg-gray-900 text-white rounded-xl shadow-2xl p-3 flex items-center gap-3 fade-in';
        bar.style.bottom = 'calc(0.75rem + env(safe-area-inset-bottom, 0px))';
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
