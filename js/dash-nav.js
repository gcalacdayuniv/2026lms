// js/dash-nav.js
// Dashboard navigation (markup: components-dashboard.js, cards: course-dashboard.js).
// Phones: bottom tabs (Courses / New / Admin / Profile). All sizes: Admin Tools page, course search and day chips.
const $ = (id) => document.getElementById(id);
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const profileOpen = () => !!$('profilePanel') && $('profilePanel').classList.contains('translate-x-0');
const adminOpen = () => !!$('adminPage') && !$('adminPage').classList.contains('hidden');

const closeAdmin = () => { if (adminOpen()) $('closeAdminPageBtn')?.click(); };
const closeProfile = () => { if (profileOpen()) $('closeProfilePanel')?.click(); };

const syncTabs = () => {
    const bar = $('dashTabBar');
    if (!bar) return;
    const active = profileOpen() ? 'profile' : adminOpen() ? 'admin' : 'courses';
    bar.querySelectorAll('.class-tab').forEach(tab => {
        const on = tab.dataset.dashTab === active;
        tab.classList.toggle('is-active', on);
        if (on) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
    });
};

const openTab = (tab) => {
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
        document.addEventListener('input', (e) => { if (e.target && e.target.id === 'courseSearch') applyFilter(); });

        // Keep the highlighted tab right when the profile drawer or Admin page opens or closes by other means.
        observer = new MutationObserver(syncTabs);
        observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }
};
