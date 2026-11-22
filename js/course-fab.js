// js/course-fab.js
// Speed-dial floating action button and bottom tab bar (phones) on the class page (markup: components-class.js).
// The floating button is Student Caller only (#openRecitationBtn, handled in course.js). Scan, Scores and Enroll
// Student are in the bottom tab bar and the More menu. The speed-dial code below stays for a menu that may return;
// it does nothing while #fabMenu is absent.
const $ = (id) => document.getElementById(id);

// Full-screen pages that the bottom tabs switch between: tab target -> page, and how each page closes.
const TAB_PAGES = {
    openScoresModalBtn: { page: 'scoresModal', close: 'closeScoresModalBtn' },
    openScannerBtn: { page: 'scannerModal', close: 'closeScannerBtn' },
    openExamManagerBtn: { page: 'examManagerModal', close: 'closeExamManagerBtn' },
    openCourseMenuBtn: { page: 'courseMenuModal', close: 'closeCourseMenuBtn' }
};

// Pages opened from the More menu: they count as More, and a tab closes them like any other page.
const SUB_PAGES = [
    { page: 'attendanceDatesModal', close: 'closeAttendanceDatesBtn', tab: 'openCourseMenuBtn' },
    { page: 'noClassModal', close: 'closeNoClassModalBtn', tab: 'openCourseMenuBtn' },
    { page: 'classSummaryModal', close: 'closeClassSummaryBtn', tab: 'openCourseMenuBtn' }
];

const openPage = () => [...Object.values(TAB_PAGES), ...SUB_PAGES].find(p => {
    const el = $(p.page);
    return el && !el.classList.contains('hidden');
});

export const CourseFab = {
    // Tapping a tab shows that page in place of the one that is open (Roster closes the open page).
    openTab: (target) => {
        const current = openPage();
        const next = TAB_PAGES[target];
        if (current && next && current.page === next.page) return;
        // More while one of its pages is open goes back to the menu itself.
        if (current) $(current.close)?.click();
        if (target === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
        else document.getElementById(target)?.click();
        CourseFab.syncTabs();
    },

    // Highlights the tab of the page that is showing (Roster when none).
    syncTabs: () => {
        const bar = $('classTabBar');
        if (!bar) return;
        const current = openPage();
        const activeTarget = !current ? 'top' : (current.tab || Object.keys(TAB_PAGES).find(k => TAB_PAGES[k].page === current.page));
        bar.querySelectorAll('.class-tab').forEach(tab => {
            const on = tab.dataset.tabTarget === activeTarget;
            tab.classList.toggle('is-active', on);
            if (on) tab.setAttribute('aria-current', 'page');
            else tab.removeAttribute('aria-current');
        });
    },

    // Dashboard card shortcuts (data-intent) open the class and then one of its pages. The class screen is
    // drawn a moment after the hash changes, so wait for its tab bar, for up to 8 seconds.
    goWith: (target) => {
        if (!target || target === 'top') return;
        const until = Date.now() + 8000;
        // The class opens only to run this action: its roster stays hidden, and closing the action goes back to the dashboard.
        document.body.classList.add('intent-mode');
        const exempt = new Set(['toastHost', 'fabBackdrop', 'profilePanelOverlay', 'classTabBar']);
        const overlayOpen = () => [...document.querySelectorAll('.fixed.inset-0[id]:not(.hidden)')].some(el => !exempt.has(el.id));
        const finish = () => {
            document.body.classList.remove('intent-mode');
            if (window.location.hash.startsWith('#class-')) window.location.hash = 'dashboard';
        };
        const watch = () => {
            const t0 = Date.now();
            let seen = false;
            const poll = setInterval(() => {
                if (!window.location.hash.startsWith('#class-')) { clearInterval(poll); document.body.classList.remove('intent-mode'); return; }
                if (overlayOpen()) { seen = true; return; }
                if (seen || Date.now() - t0 > 2500) { clearInterval(poll); finish(); }
            }, 300);
        };
        const tick = () => {
            if (Date.now() > until) { document.body.classList.remove('intent-mode'); return; }
            const bar = $('classTabBar');
            if (bar && $(target)) { setTimeout(() => { CourseFab.openTab(target); watch(); }, 120); return; }
            setTimeout(tick, 100);
        };
        setTimeout(tick, 150);
    },

    isOpen: () => $('fabMenu') && !$('fabMenu').classList.contains('hidden'),

    set: (open, focusMain = false) => {
        const menu = $('fabMenu');
        const main = $('fabMainBtn');
        if (!menu || !main) return;
        menu.classList.toggle('hidden', !open);
        menu.classList.toggle('flex', open);
        $('fabBackdrop')?.classList.toggle('hidden', !open);
        main.setAttribute('aria-expanded', String(open));
        $('fabMainIcon')?.classList.toggle('rotate-45', open);
        menu.querySelectorAll('.fab-item').forEach(el => { el.tabIndex = open ? 0 : -1; });
        if (open) menu.querySelector('.fab-item')?.focus();
        else if (focusMain) main.focus();
    },

    init: () => {
        // Pages open and close from many places (back arrow, edge swipe, menu tiles): keep the tabs in step.
        let queued = false;
        new MutationObserver(() => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => { queued = false; CourseFab.syncTabs(); });
        }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });

        document.addEventListener('click', (e) => {
            const t = e.target;
            if (!t.closest) return;
            if (t.closest('#fabMainBtn')) {
                CourseFab.set(!CourseFab.isOpen());
                return;
            }
            const tab = t.closest('.class-tab[data-tab-target]');
            if (tab) {
                if (CourseFab.isOpen()) CourseFab.set(false);
                if (navigator.vibrate) navigator.vibrate(8);
                CourseFab.openTab(tab.dataset.tabTarget);
                return;
            }
            const item = t.closest('.fab-item');
            if (item) {
                CourseFab.set(false);
                const target = item.dataset.fabTarget;
                if (target) document.getElementById(target)?.click();
                return;
            }
            // Tapping anywhere else (including the dim backdrop) closes the menu.
            if (CourseFab.isOpen()) CourseFab.set(false);
        });

        document.addEventListener('keydown', (e) => {
            if (!CourseFab.isOpen()) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                CourseFab.set(false, true);
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                const items = [...document.querySelectorAll('#fabMenu .fab-item')];
                const i = items.indexOf(document.activeElement);
                e.preventDefault();
                const next = e.key === 'ArrowUp' ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length;
                items[next]?.focus();
            }
        });
    }
};
