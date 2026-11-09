// js/dash-nav.js
// Dashboard navigation (markup: components-dashboard.js, cards: course-dashboard.js).
// Phones: bottom tabs (Courses / New / Admin / Profile). All sizes: Admin Tools page, course search and day chips.
import { CourseFab } from './course-fab.js';
import { UI } from './ui-feedback.js';
const $ = (id) => document.getElementById(id);
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const profileOpen = () => !!$('profilePanel') && $('profilePanel').classList.contains('translate-x-0');
const adminOpen = () => !!$('adminPage') && !$('adminPage').classList.contains('hidden');

let scrollTab = '';   // 'exams' or 'browse' after a student taps those tabs

const closeAdmin = () => { if (adminOpen()) $('closeAdminPageBtn')?.click(); };
const closeProfile = () => { if (profileOpen()) $('closeProfilePanel')?.click(); };

const syncTabs = () => {
    const bar = $('dashTabBar');
    if (!bar) return;
    const active = profileOpen() ? 'profile' : adminOpen() ? 'admin' : (scrollTab && window.scrollY > 80 ? scrollTab : 'courses');
    bar.querySelectorAll('.class-tab').forEach(tab => {
        const on = tab.dataset.dashTab === active;
        tab.classList.toggle('is-active', on);
        if (on) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
    });
};

const scrollToId = (id) => {
    const el = $(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return !!el;
};

const openTab = (tab) => {
    if (tab === 'exams' || tab === 'browse') {
        closeProfile();
        const found = scrollToId(tab === 'exams' ? 'studentExamsSection' : 'studentAvailableSection');
        if (!found && tab === 'exams') UI.info('No exams assigned to you right now');
        else scrollTab = tab;
        syncTabs();
        return;
    }
    scrollTab = '';
    if (tab === 'courses') {
        closeAdmin(); closeProfile();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (tab === 'new') {
        closeAdmin(); closeProfile();
        $('openCreateCourseModalBtn')?.click();
    } else if (tab === 'admin') {
        if (adminOpen()) return;
        closeProfile();
        $('adminPage')?.classList.remove('hidden');
    } else if (tab === 'profile') {
        if (profileOpen()) return;
        closeAdmin();
        $('profileToggleBtn')?.click();
    }
    syncTabs();
};

// Search text + day chip. Cards carry data-search and data-day.
const applyFilter = () => {
    const box = $('courseSearch');
    if (!box) return;
    const q = box.value.trim().toLowerCase();
    const chip = document.querySelector('.day-chip.is-on');
    let day = chip ? chip.dataset.dayChip : 'All';
    if (day === 'Today') day = DAYS[new Date().getDay()];
    let shown = 0;
    document.querySelectorAll('#courseContainer [data-course-card]').forEach(card => {
        const okText = !q || (card.dataset.search || '').includes(q);
        const okDay = day === 'All' || card.dataset.day === day;
        const show = okText && okDay;
        card.classList.toggle('hidden', !show);
        if (show) shown++;
    });
    $('courseNoMatch')?.classList.toggle('hidden', shown > 0);
};

// Phones: the header slides away while scrolling down and returns on scroll up, giving the list more room.
const initHeader = () => {
    let lastY = window.scrollY;
    let queued = false;
    window.addEventListener('scroll', () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            const header = $('dashHeader');
            if (!header) { lastY = window.scrollY; return; }
            const y = window.scrollY;
            const typing = document.activeElement && document.activeElement.id === 'courseSearch';
            const phone = window.matchMedia('(max-width: 639px)').matches;
            const hide = phone && !typing && y > 80 && y > lastY + 4;
            const show = y < lastY - 4 || y <= 80;
            if (hide) header.classList.add('dash-header-hidden');
            else if (show) header.classList.remove('dash-header-hidden');
            lastY = y;
        });
    }, { passive: true });
};

let observer = null;

export const DashNav = {
    init: () => {
        if (observer) return;
        document.addEventListener('click', (e) => {
            const t = e.target;
            if (!t.closest) return;
            const tab = t.closest('[data-dash-tab]');
            if (tab) { openTab(tab.dataset.dashTab); return; }
            if (t.closest('#openAdminPageBtn')) {
                closeProfile();
                $('adminPage')?.classList.remove('hidden');
                syncTabs();
                return;
            }
            if (t.closest('#closeAdminPageBtn') || t.id === 'closeAdminPageBg') {
                $('adminPage')?.classList.add('hidden');
                syncTabs();
                return;
            }
            const jump = t.closest('[data-scroll-to]');
            if (jump) { scrollToId(jump.dataset.scrollTo); return; }
            const shortcut = t.closest('[data-intent]');
            if (shortcut) { CourseFab.goWith(shortcut.dataset.intent); return; }
            const chip = t.closest('.day-chip');
            if (chip) {
                document.querySelectorAll('.day-chip').forEach(c => {
                    const on = c === chip;
                    c.classList.toggle('is-on', on);
                    c.setAttribute('aria-pressed', String(on));
                });
                applyFilter();
            }
        });
        initHeader();
        window.addEventListener('scroll', () => { if (scrollTab) syncTabs(); }, { passive: true });
        document.addEventListener('input', (e) => { if (e.target && e.target.id === 'courseSearch') applyFilter(); });

        // Keep the highlighted tab right when the profile drawer or Admin page opens or closes by other means.
        observer = new MutationObserver(syncTabs);
        observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }
};
