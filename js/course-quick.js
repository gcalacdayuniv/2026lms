// js/course-quick.js
// Phones: press and hold a student row (about half a second) to open a quick sheet: Present, Late, Excused, Absent or Manage.
// Moving the finger (a scroll or a swipe) cancels the hold, so it does not clash with swipe-to-mark.
import { CourseSwipe } from './course-swipe.js';
import { escapeHtml } from './html-utils.js';
import { UI } from './ui-feedback.js';

const HOLD_MS = 500;
const MOVE_PX = 10;
const IGNORE = 'input, select, textarea, button, a, .row-points-area, label';
const STATUSES = [
    ['Present', 'fa-check', 'bg-green-100 text-green-800 border-green-300'],
    ['Late', 'fa-clock', 'bg-yellow-100 text-yellow-800 border-yellow-300'],
    ['Excused', 'fa-file-circle-check', 'bg-blue-100 text-blue-800 border-blue-300'],
    ['Absent', 'fa-xmark', 'bg-red-100 text-red-800 border-red-300']
];

let hold = null;

const phone = () => window.innerWidth < 1024;
const cancel = () => { if (hold) clearTimeout(hold.timer); hold = null; };

const closeSheet = () => UI.closeOverlay('quickSheet');

const openSheet = (row) => {
    closeSheet();
    const name = row.querySelector('.manage-student-btn')?.dataset.name || 'Student';
    const manage = row.querySelector('.manage-student-btn');
    const dlg = UI.overlay({ id: 'quickSheet', label: `Quick actions for ${name}`, z: 250, padClass: 'p-0', alignClass: 'items-end', backdropClass: 'bg-gray-900 bg-opacity-50', panelClass: 'max-w-md bg-white rounded-t-2xl p-4 sheet-panel', html: `<div class="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300"></div>
            <div class="flex items-center justify-between mb-3">
                <p class="font-black text-gray-900 truncate pr-2">${escapeHtml(name)}</p>
                <button type="button" aria-label="Close" data-overlay-close class="w-9 h-9 rounded-full text-gray-500 hover:bg-gray-100"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
            </div>
            <div class="grid grid-cols-2 gap-2">
                ${STATUSES.map(([s, icon, cls]) => `<button type="button" data-quick-status="${s}" class="min-h-[48px] rounded-xl border font-bold text-sm flex items-center justify-center gap-2 ${cls}"><i class="fa-solid ${icon}" aria-hidden="true"></i>${s}</button>`).join('')}
            </div>
            ${manage ? `<button type="button" data-quick-manage class="mt-2 w-full min-h-[48px] rounded-xl border border-gray-300 bg-gray-50 font-bold text-sm text-gray-800"><i class="fa-solid fa-gear mr-2" aria-hidden="true"></i>Manage student</button>` : ''}` });
    dlg.panel.style.paddingBottom = 'max(1rem, env(safe-area-inset-bottom))';
    dlg.el.addEventListener('click', (e) => {
        const st = e.target.closest('[data-quick-status]');
        if (st) { CourseSwipe.apply(row, st.dataset.quickStatus); closeSheet(); return; }
        if (e.target.closest('[data-quick-manage]')) { closeSheet(); manage.click(); return; }
    });
};

export const CourseQuick = {
    init: () => {
        document.addEventListener('touchstart', (e) => {
            cancel();
            if (!phone() || e.touches.length !== 1) return;
            const t = e.target;
            if (!t.closest || t.closest(IGNORE)) return;
            const row = t.closest('.student-row');
            if (!row || !row.querySelector('.attendance-btn')) return;
            const x = e.touches[0].clientX, y = e.touches[0].clientY;
            hold = {
                x, y,
                timer: setTimeout(() => {
                    hold = null;
                    if (navigator.vibrate) navigator.vibrate(15);
                    openSheet(row);
                }, HOLD_MS)
            };
        }, { passive: true });
        document.addEventListener('touchmove', (e) => {
            if (!hold) return;
            const t = e.touches[0];
            if (Math.abs(t.clientX - hold.x) > MOVE_PX || Math.abs(t.clientY - hold.y) > MOVE_PX) cancel();
        }, { passive: true });
        document.addEventListener('touchend', cancel);
        document.addEventListener('touchcancel', cancel);
        // A long press must not also pop the phone's own "copy / select" menu on the row.
        document.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('.student-row') && phone()) e.preventDefault(); });
    }
};
