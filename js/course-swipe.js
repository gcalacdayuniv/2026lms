// js/course-swipe.js
// Phones: swipe a student row to the right to mark Present, to the left to mark Absent (the same buttons
// stay on the row, so this is only a shortcut). The status is saved the same way as a tap on the button.
import { CourseAttendance } from './course-attendance.js';

const START_PX = 12;      // movement before the direction is decided
const COMMIT_PX = 90;     // distance that counts as a swipe
const MAX_PULL = 130;
const IGNORE = 'input, select, textarea, button, a, .row-points-area, label';

let g = null;

const phone = () => window.innerWidth < 1024;

const reset = (row, animate = true) => {
    if (!row) return;
    row.style.transition = animate ? 'transform .18s ease-out, background-color .18s ease-out' : '';
    row.style.transform = '';
    row.style.backgroundColor = '';
    row.removeAttribute('data-swipe');
    setTimeout(() => { row.style.transition = ''; }, 220);
};

// Swipe from the left edge to the right goes back (closes the top full-screen page), like a phone app.
const EDGE_PX = 24;
const BACK_PX = 80;
let edge = null;

const topPage = () => {
    const live = document.getElementById('scnLivePanel');
    if (live && !live.classList.contains('hidden')) return null;   // the camera has its own Close button
    const pages = [...document.querySelectorAll('.app-page')].filter(p => p.offsetParent !== null || p.getClientRects().length);
    return pages.length ? pages[pages.length - 1] : null;
};

export const CourseSwipe = {
    init: () => {
        document.addEventListener('touchstart', (e) => {
            edge = null;
            if (e.touches.length !== 1 || e.touches[0].clientX > EDGE_PX) return;
            const page = topPage();
            if (page) edge = { page, x: e.touches[0].clientX, y: e.touches[0].clientY };
        }, { passive: true });
        document.addEventListener('touchend', (e) => {
            if (!edge) return;
            const t = e.changedTouches[0];
            const { page, x, y } = edge;
            edge = null;
            if (t.clientX - x >= BACK_PX && Math.abs(t.clientY - y) < 60) page.querySelector('.app-page-close')?.click();
        });

        document.addEventListener('touchstart', CourseSwipe.start, { passive: true });
        document.addEventListener('touchmove', CourseSwipe.move, { passive: false });
        document.addEventListener('touchend', CourseSwipe.end);
        document.addEventListener('touchcancel', CourseSwipe.cancel);
    },

    start: (e) => {
        g = null;
        if (!phone() || e.touches.length !== 1) return;
        const t = e.target;
        if (!t.closest || t.closest(IGNORE)) return;
        const row = t.closest('.student-row');
        if (!row) return;
        g = { row, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, mode: '' };
    },

    move: (e) => {
        if (!g) return;
        const dx = e.touches[0].clientX - g.x;
        const dy = e.touches[0].clientY - g.y;
        if (!g.mode) {
            if (Math.abs(dy) > START_PX && Math.abs(dy) > Math.abs(dx)) { g = null; return; }   // it is a scroll
            if (Math.abs(dx) < START_PX) return;
            g.mode = Math.abs(dx) > Math.abs(dy) * 1.5 ? 'swipe' : 'scroll';
            if (g.mode === 'scroll') { g = null; return; }
        }
        if (e.cancelable) e.preventDefault();
        g.dx = dx;
        const pull = Math.max(-MAX_PULL, Math.min(MAX_PULL, dx * 0.6));
        const ready = Math.abs(dx) >= COMMIT_PX;
        g.row.style.transition = 'none';
        g.row.style.transform = `translateX(${pull}px)`;
        g.row.style.backgroundColor = dx > 0 ? (ready ? '#bbf7d0' : '#f0fdf4') : (ready ? '#fecaca' : '#fef2f2');
        g.row.setAttribute('data-swipe', dx > 0 ? 'Present' : 'Absent');
        g.row.toggleAttribute('data-swipe-ready', ready);
    },

    end: () => {
        if (!g) return;
        const { row, dx, mode } = g;
        g = null;
        row.removeAttribute('data-swipe-ready');
        reset(row);
        if (mode !== 'swipe' || Math.abs(dx) < COMMIT_PX) return;
        CourseSwipe.apply(row, dx > 0 ? 'Present' : 'Absent');
    },

    cancel: () => {
        if (g) reset(g.row);
        g = null;
    },

    apply: (row, status) => {
        const btn = row.querySelector(`.attendance-btn[data-status="${status}"]`);
        if (!btn || btn.disabled) return;
        if (btn.getAttribute('data-selected') !== 'true') btn.click();   // updates the buttons like a tap
        if (navigator.vibrate) navigator.vibrate(12);
        CourseAttendance.queueAutoSave(row.dataset.studentId, 0);
    }
};
