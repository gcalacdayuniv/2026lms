// js/theme.js
// Appearance: Auto (follows the phone), Light or Dark. The choice is kept in localStorage ('theme').
// index.html sets data-theme before the first paint so there is no white flash; this module keeps it in sync.
const KEY = 'theme';
const THEME_COLORS = { light: '#2563eb', dark: '#0b1220' };

const read = () => { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch (e) { return 'auto'; } };
const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
const isDark = (choice) => choice === 'dark' || (choice === 'auto' && systemDark());

const apply = () => {
    const choice = read();
    const dark = isDark(choice);
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? THEME_COLORS.dark : THEME_COLORS.light);
    document.querySelectorAll('.theme-choice').forEach(btn => {
        const on = btn.dataset.themeChoice === choice;
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-pressed', String(on));
    });
};

export const Theme = {
    isDark: () => isDark(read()),
    apply,

    init: () => {
        apply();
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (read() === 'auto') apply(); });
        document.addEventListener('click', (e) => {
            const btn = e.target.closest && e.target.closest('.theme-choice');
            if (!btn) return;
            try { localStorage.setItem(KEY, btn.dataset.themeChoice); } catch (err) { /* private mode: applies for this visit only */ }
            apply();
        });
        // The profile panel is drawn after init, so highlight its buttons again when the DOM changes.
        new MutationObserver(() => { if (document.querySelector('.theme-choice:not([data-themed])')) { document.querySelectorAll('.theme-choice').forEach(b => b.setAttribute('data-themed', '1')); apply(); } })
            .observe(document.body, { childList: true, subtree: true });
    }
};
