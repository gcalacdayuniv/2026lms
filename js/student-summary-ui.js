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

    // Small pop-up with the complete text of a field that is cut off in its chip.
    callout: (label, text) => {
        $('ssCallout')?.remove();
        const wrap = document.createElement('div');
        wrap.id = 'ssCallout';
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'true');
        wrap.setAttribute('aria-label', label);
        wrap.className = 'fixed inset-0 flex items-end sm:items-center justify-center p-4';
        wrap.style.cssText = 'z-index:340;background:rgba(15,23,42,.55)';
        const card = document.createElement('div');
        card.className = 'bg-white rounded-2xl shadow-xl w-full max-w-sm p-5';
        card.style.paddingBottom = 'calc(1.25rem + env(safe-area-inset-bottom))';
        const h = document.createElement('div');
        h.className = 'text-xs font-bold uppercase tracking-wider text-blue-600 mb-2';
        h.textContent = label;
        const body = document.createElement('div');
        body.className = 'text-gray-800 font-semibold text-base leading-relaxed whitespace-pre-wrap break-words';
        body.style.maxHeight = '50vh'; body.style.overflowY = 'auto';
        body.textContent = text;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mt-4 w-full py-3 rounded-xl bg-blue-600 text-white font-bold';
        btn.textContent = 'Close';
        card.append(h, body, btn);
        wrap.appendChild(card);
        document.body.appendChild(wrap);
        const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); $('ssTopicChip')?.focus(); };
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', onKey);
        btn.onclick = close;
        wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
        btn.focus();
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
        // The score details page stops above the History / Upload bar so the bar stays in reach.
        const details = $('detailsModal');
        const fit = () => {
            const bar = $('ssActionBar');
            const open = details && !details.classList.contains('hidden') && !modal.classList.contains('hidden') && bar && !bar.classList.contains('hidden');
            details.style.bottom = open ? `${Math.ceil(bar.getBoundingClientRect().height)}px` : '';
            // Also stay below the summary header (course, seat/group/topic, term tabs).
            const head = modal.querySelector('.ss-top');
            details.style.top = open && head ? `${Math.ceil(head.getBoundingClientRect().bottom)}px` : '';
        };
        if (details) new MutationObserver(fit).observe(details, { attributes: true, attributeFilter: ['class'] });
        window.addEventListener('resize', fit);
        // Closing the page hides the action bar too.
        new MutationObserver(() => { if (modal.classList.contains('hidden')) $('ssActionBar')?.classList.add('hidden'); })
            .observe(modal, { attributes: true, attributeFilter: ['class'] });

        $('ssTopicChip')?.addEventListener('click', () => StudentSummaryUI.callout('Topic', $('ssTopic')?.textContent || ''));
        $('ssTermTabs')?.addEventListener('click', (e) => {
            const btn = e.target.closest && e.target.closest('.ss-term-tab');
            if (btn) { $('detailsModal')?.classList.add('hidden'); StudentSummaryUI.show(btn.dataset.term); modal.scrollTo?.({ top: 0 }); }
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
