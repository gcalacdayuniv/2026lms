// js/course-pull.js
// Phones/tablets: pull down from the top of the class page or dashboard to reload it, like a phone app.
import { CourseClass } from './course-class.js';
import { CourseDashboard } from './course-dashboard.js';
import { CourseAttendance } from './course-attendance.js';
import { UI } from './ui-feedback.js';

const TRIGGER_PX = 70;
const MAX_PULL = 100;
const IGNORE = 'input, select, textarea, .overflow-x-auto, .overflow-y-auto, .student-row[data-swipe]';

let g = null;
let busy = false;
let bar = null;

const getBar = () => {
    if (bar && document.body.contains(bar)) return bar;
    bar = document.createElement('div');
    bar.id = 'pullIndicator';
    bar.setAttribute('aria-hidden', 'true');
    bar.className = 'fixed left-1/2 z-40 w-10 h-10 rounded-full bg-white shadow-lg border border-gray-200 flex items-center justify-center text-blue-600 pointer-events-none';
    bar.style.cssText = 'top:calc(3.5rem + env(safe-area-inset-top, 0px));opacity:0;transform:translate(-50%,-60px)';
    bar.innerHTML = '<i class="fa-solid fa-arrow-down"></i>';
    document.body.appendChild(bar);
    return bar;
};

const place = (pull, ready) => {
    const b = getBar();
    b.style.transition = 'none';
    b.style.opacity = String(Math.min(1, pull / 40));
    b.style.transform = `translate(-50%, ${pull - 60}px) rotate(${ready ? 180 : Math.min(180, pull * 2)}deg)`;
};

const hide = () => {
    const b = getBar();
    b.style.transition = 'opacity .2s, transform .2s';
    b.style.opacity = '0';
    b.style.transform = 'translate(-50%,-60px)';
    b.innerHTML = '<i class="fa-solid fa-arrow-down"></i>';
};

const dialogOpen = () => Boolean(document.querySelector('.fixed.inset-0:not(.hidden)'));

export const CoursePull = {
    init: () => {
        document.addEventListener('touchstart', CoursePull.start, { passive: true });
        document.addEventListener('touchmove', CoursePull.move, { passive: false });
        document.addEventListener('touchend', CoursePull.end);
        document.addEventListener('touchcancel', () => { g = null; hide(); });
    },

    start: (e) => {
        g = null;
        if (busy || window.innerWidth >= 1024 || e.touches.length !== 1 || window.scrollY > 0) return;
        const hash = window.location.hash;
        if (!hash.startsWith('#class-') && hash !== '#dashboard') return;
        if (e.target.closest && e.target.closest(IGNORE)) return;
        if (dialogOpen()) return;
        g = { x: e.touches[0].clientX, y: e.touches[0].clientY, pull: 0, on: false };
    },

    move: (e) => {
        if (!g) return;
        const dy = e.touches[0].clientY - g.y;
        const dx = e.touches[0].clientX - g.x;
        if (!g.on) {
            if (dy < 0 || Math.abs(dx) > dy) { if (Math.abs(dx) > 12 || dy < -8) g = null; return; }
            if (dy < 10) return;
            g.on = true;
        }
        if (e.cancelable) e.preventDefault();
        g.pull = Math.min(MAX_PULL, dy * 0.5);
        place(g.pull, g.pull >= TRIGGER_PX * 0.5);
    },

    end: async () => {
        if (!g) return;
        const { pull, on } = g;
        g = null;
        if (!on) return;
        if (pull < TRIGGER_PX * 0.5) { hide(); return; }
        await CoursePull.refresh();
    },

    refresh: async () => {
        if (busy) return;
        busy = true;
        const b = getBar();
        b.style.transition = 'transform .15s';
        b.style.transform = 'translate(-50%, 8px)';
        b.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        if (navigator.vibrate) navigator.vibrate(10);
        try {
            const hash = window.location.hash;
            if (hash.startsWith('#class-')) {
                if (CourseAttendance.isDirty && CourseAttendance.baselineReady && CourseAttendance.isDirty()) {
                    UI.warning('Some attendance changes are not saved yet. Wait a moment, then pull again.');
                } else {
                    await CourseClass.loadClassScreen(hash.replace('#class-', ''), true);
                    UI.success('Class updated.', 1800);
                }
            } else if (hash === '#dashboard') {
                await CourseDashboard.loadDashboardData();
                UI.success('Updated.', 1800);
            }
        } catch (err) {
            UI.error(err.message || 'Could not refresh.');
        } finally {
            busy = false;
            hide();
        }
    }
};
