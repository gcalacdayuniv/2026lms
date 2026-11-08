// js/course-fab.js
// Speed-dial floating action button on the class page (markup: components-class.js).
// The main button opens a small menu: Student Caller, Scan Answer Sheets, Record Scores, Enroll Student.
// Items with data-fab-target press the matching button of the Course Actions menu, so each action keeps
// a single implementation. Student Caller keeps its own id and is handled in course.js.
const $ = (id) => document.getElementById(id);

export const CourseFab = {
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
        document.addEventListener('click', (e) => {
            const t = e.target;
            if (!t.closest) return;
            if (t.closest('#fabMainBtn')) {
                CourseFab.set(!CourseFab.isOpen());
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
