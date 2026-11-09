// js/student-summary-ui.js
// App-style behaviour for the student's "My Course Summary" page: Mid/Final term switch (swipe too),
// attendance bars and pills, and the bottom action bar. It only reads the numbers the existing code already
// writes into the page, so the data flow in course.js / course-attendance.js is untouched.
const $ = (id) => document.getElementById(id);
const TERMS = ['midterm', 'finalterm'];
const num = (id) => parseFloat(($(id)?.textContent || '').replace('%', '')) || 0;

export const StudentSummaryUI = {
    term: 'midterm',

    show: (term) => {
        if (!TERMS.includes(term)) return;
        StudentSummaryUI.term = term;
        document.querySelectorAll('#studentSummaryModal [data-term-block]').forEach(el => {
            el.classList.toggle('hidden', el.dataset.termBlock !== term);
        });
        document.querySelectorAll('#ssTermTabs .ss-term-tab').forEach(btn => {
            const on = btn.dataset.term === term;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
        });
    },

    // Fills bars and pills, picks the term that has class days (Final first), shows the action bar.
    sync: () => {
        TERMS.forEach(term => {
            const pct = Math.max(0, Math.min(100, num(`${term}AttendancePct`)));
            const days = num(`${term}TotalDays`);
            const fill = $(`${term}BarFill`);
            if (fill) {
                fill.style.width = `${days ? pct : 0}%`;
                fill.className = pct >= 85 ? 'is-good' : pct >= 70 ? 'is-warn' : 'is-low';
            }
            const pill = $(`${term}Pill`);
            if (pill) pill.textContent = days ? `${Math.round(pct)}% attendance` : 'No classes yet';
        });
        StudentSummaryUI.show(num('finalterm' + 'TotalDays') > 0 ? 'finalterm' : 'midterm');
        $('ssActionBar')?.classList.remove('hidden');
        const body = document.querySelector('#studentSummaryModal .ss-body');
        if (body) body.style.paddingBottom = 'calc(5.5rem + env(safe-area-inset-bottom))';
    },

    init: () => {
        const modal = $('studentSummaryModal');
        if (!modal || modal.dataset.ssInit) return;
        modal.dataset.ssInit = '1';
        const content = $('summaryContent');
        if (content) {
            new MutationObserver(() => {
                if (!content.classList.contains('hidden')) StudentSummaryUI.sync();
                else $('ssActionBar')?.classList.add('hidden');
            }).observe(content, { attributes: true, attributeFilter: ['class'] });
        }
        // Closing the page hides the action bar too.
        new MutationObserver(() => { if (modal.classList.contains('hidden')) $('ssActionBar')?.classList.add('hidden'); })
            .observe(modal, { attributes: true, attributeFilter: ['class'] });

        $('ssTermTabs')?.addEventListener('click', (e) => {
            const btn = e.target.closest && e.target.closest('.ss-term-tab');
            if (btn) { StudentSummaryUI.show(btn.dataset.term); modal.scrollTo?.({ top: 0 }); }
        });

        // Swipe left/right on the content switches the term.
        let sx = 0, sy = 0, tracking = false;
        const body = modal.querySelector('.ss-body');
        body?.addEventListener('touchstart', (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; tracking = e.touches.length === 1; }, { passive: true });
        body?.addEventListener('touchend', (e) => {
            if (!tracking) return;
            tracking = false;
            const t = e.changedTouches[0];
            const dx = t.clientX - sx, dy = t.clientY - sy;
            if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
            StudentSummaryUI.show(dx < 0 ? 'finalterm' : 'midterm');
        }, { passive: true });
    }
};
