// js/app-feel.js
// Small touches that make the web app feel native on phones: a light tap vibration on primary controls,
// and form fields scrolled into view when the on-screen keyboard opens.
const HAPTIC_SELECTOR = '.form-save, .auth-screen button[type="submit"], [data-dash-tab], .menu-tile, .day-chip, .card-action, .overview-tile';
const FIELD_SELECTOR = 'input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"]), select, textarea';
const FIELD_HOSTS = '.app-page, .sheet-panel, .auth-screen';

const isPhone = () => window.matchMedia('(max-width: 639px)').matches;
let inited = false;
let bannerTimer = 0;

// Slim status pill at the top: shown while offline, and briefly when the connection returns.
const showBanner = (online) => {
    let el = document.getElementById('offlineBanner');
    if (!el) {
        el = document.createElement('div');
        el.id = 'offlineBanner';
        el.className = 'offline-banner';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.style.zIndex = '450';   // inline: see UI.confirm for why
        document.body.appendChild(el);
    }
    clearTimeout(bannerTimer);
    el.classList.toggle('is-online', online);
    el.innerHTML = online
        ? '<i class="fa-solid fa-wifi" aria-hidden="true"></i> Back online'
        : '<i class="fa-solid fa-cloud-arrow-down" aria-hidden="true"></i> You are offline. Showing saved data.';
    requestAnimationFrame(() => el.classList.add('is-shown'));
    if (online) bannerTimer = setTimeout(() => el.classList.remove('is-shown'), 2200);
};

let timer = 0;

const reveal = () => {
    const el = document.activeElement;
    if (!el || !el.matches || !el.matches(FIELD_SELECTOR) || !el.closest(FIELD_HOSTS)) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
};

export const AppFeel = {
    init: () => {
        if (inited) return;
        inited = true;

        window.addEventListener('offline', () => showBanner(false));
        window.addEventListener('online', () => showBanner(true));
        if (navigator.onLine === false) showBanner(false);

        // Touch only, so a mouse click on a laptop never buzzes (and navigator.vibrate is absent on iOS anyway).
        document.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'touch' || !navigator.vibrate) return;
            if (e.target.closest && e.target.closest(HAPTIC_SELECTOR)) navigator.vibrate(6);
        }, { passive: true });

        // The keyboard needs a moment to open; scroll again when the visible area changes.
        document.addEventListener('focusin', () => {
            if (!isPhone()) return;
            clearTimeout(timer);
            timer = setTimeout(reveal, 320);
        });
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', () => {
                if (!isPhone()) return;
                clearTimeout(timer);
                timer = setTimeout(reveal, 120);
            });
        }
    }
};
