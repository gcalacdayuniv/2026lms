// js/course-roster-tools.js
// Class roster tools: search, filter, and a Select mode with bulk attendance and bulk exam access.
// Filtering only hides rows, so Save All still saves everyone.
import { apiFetch } from './globals.js';
import { UI } from './ui-feedback.js';
import { CourseAttendance } from './course-attendance.js';

const $ = (id) => document.getElementById(id);
const rows = () => Array.from(document.querySelectorAll('#rosterListContainer .student-row'));
const isShown = (row) => row.style.display !== 'none';
const statusOf = (row) => row.querySelector('.attendance-btn[data-selected="true"]')?.dataset.status || '';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const LONG_PRESS = 280;   // ms a finger holds a row before a drag starts selecting
const INTERACTIVE = 'button, a, input:not(.roster-check), select, textarea, label, .view-summary-trigger, .group-name-trigger, .view-avatar-trigger, .attendance-btn, .pts-step';

export const RosterTools = {
    selecting: false,
    classExams: [],
    paint: null,            // drag-select in progress: { id, mode: 'add' | 'remove', on, ... }
    swallowUntil: 0,        // ignore the click that ends a drag

    init: () => {
        document.addEventListener('input', RosterTools.onInput);
        document.addEventListener('change', RosterTools.onChange);
        document.addEventListener('click', RosterTools.onClick);
        window.addEventListener('resize', () => RosterTools.syncBulkTop());
        document.addEventListener('pointerdown', RosterTools.onDown);
        document.addEventListener('pointermove', RosterTools.onMove);
        document.addEventListener('pointerup', RosterTools.onUp);
        document.addEventListener('pointercancel', RosterTools.onUp);
        document.addEventListener('touchmove', (ev) => { if (RosterTools.paint && RosterTools.paint.on) ev.preventDefault(); }, { passive: false });   // a drag that is selecting must not scroll
        document.addEventListener('click', (ev) => { if (Date.now() < RosterTools.swallowUntil && ev.target.closest('#rosterListContainer')) { ev.preventDefault(); ev.stopPropagation(); } }, true);
    },

    matches: (row, query, filter) => {
        if (query && !(row.dataset.search || '').includes(query)) return false;
        if (filter === 'blind') return row.dataset.eye === 'Legally Blind';
        if (filter === 'notpresent') return ['Late', 'Excused', 'Absent'].includes(statusOf(row));
        if (filter === 'noseat') return !row.dataset.seat;
        if (filter.startsWith('group:')) return row.dataset.group === filter.slice(6);
        return true;
    },

    // Puts the rows in the chosen order ('' = the order they were listed in). Only moves rows; nothing is saved or hidden.
    sortRows: () => {
        const mode = $('rosterSort') ? $('rosterSort').value : '';
        const all = rows();
        if (!all.length) return;
        all.forEach((row, i) => { if (row.dataset.orig === undefined) row.dataset.orig = String(i); });
        const byOrig = (a, b) => Number(a.dataset.orig) - Number(b.dataset.orig);
        const key = mode === 'number' ? (r) => r.dataset.number || '' : (r) => r.dataset.name || '';
        const sorted = all.slice().sort(mode ? (a, b) => {
            const ka = key(a), kb = key(b);
            if (!ka && kb) return 1;           // rows without a value go last
            if (ka && !kb) return -1;
            return collator.compare(ka, kb) || collator.compare(a.dataset.name || '', b.dataset.name || '') || byOrig(a, b);
        } : byOrig);
        if (sorted.every((row, i) => row === all[i])) return;
        const parent = all[0].parentNode;
        sorted.forEach(row => parent.appendChild(row));
    },

    // The selection bar sticks just under the attendance bar, whatever height the bar has (the phone menu makes it taller).
    syncBulkTop: () => {
        const bar = $('attendanceBar'), bulk = $('rosterBulkBar');
        if (bar && bulk) bulk.style.top = `${64 + bar.offsetHeight + 2}px`;
    },

    classId: () => window.location.hash.replace('#class-', ''),

    // The first time a class screen is shown, put back the filter this class was last left on.
    restoreView: () => {
        const tools = $('rosterTools');
        if (!tools || tools.dataset.viewRestored) return;
        tools.dataset.viewRestored = '1';
        try {
            const f = localStorage.getItem(`roster_filter_${RosterTools.classId()}`);
            const sel = $('rosterFilter');
            if (f && sel && [...sel.options].some(o => o.value === f)) sel.value = f;
        } catch (err) { /* storage unavailable */ }
    },

    apply: () => {
        if (!$('rosterTools')) return;
        RosterTools.restoreView();
        RosterTools.syncBulkTop();
        RosterTools.sortRows();
        const query = ($('rosterSearch').value || '').trim().toLowerCase();
        const filter = $('rosterFilter').value || 'all';
        const all = rows();
        let shown = 0;
        all.forEach(row => {
            const ok = RosterTools.matches(row, query, filter);
            row.style.display = ok ? '' : 'none';
            if (ok) shown++;
            else {
                const box = row.querySelector('.roster-check');
                if (box) box.checked = false;
            }
        });
        const filtering = Boolean(query) || filter !== 'all';
        $('rosterCount').textContent = filtering ? `Showing ${shown} of ${all.length}` : '';
        $('rosterNoMatch')?.classList.toggle('hidden', shown > 0);
        const markAll = $('markAllPresent');
        if (markAll) markAll.textContent = filtering ? 'Mark Shown Present' : 'Mark All Present';
        RosterTools.updateSelection();
    },

    selected: () => rows().filter(r => r.querySelector('.roster-check')?.checked && isShown(r)),

    updateSelection: () => {
        const n = RosterTools.selected().length;
        const label = $('rosterSelCount');
        if (label) label.textContent = `${n} selected`;
        document.querySelectorAll('#rosterBulkBar .roster-bulk').forEach(b => { b.disabled = n === 0; b.classList.toggle('opacity-50', n === 0); });
    },

    setSelecting: (on) => {
        RosterTools.selecting = on;
        RosterTools.syncBulkTop();
        rows().forEach(row => {
            const box = row.querySelector('.roster-check');
            if (!box) return;
            box.classList.toggle('hidden', !on);
            if (!on) box.checked = false;
        });
        $('rosterBulkBar')?.classList.toggle('hidden', !on);
        const list = $('rosterListContainer');
        if (list) { list.style.userSelect = on ? 'none' : ''; list.style.webkitUserSelect = on ? 'none' : ''; list.style.webkitTouchCallout = on ? 'none' : ''; }
        const t = $('rosterSelectToggle');
        if (t) {
            t.setAttribute('aria-pressed', String(on));
            t.classList.toggle('bg-blue-600', on);
            t.classList.toggle('text-white', on);
            t.classList.toggle('bg-white', !on);
            t.classList.toggle('text-gray-700', !on);
            t.innerHTML = on ? '<i class="fa-solid fa-xmark mr-1" aria-hidden="true"></i>Done' : '<i class="fa-regular fa-square-check mr-1" aria-hidden="true"></i>Select';
        }
        if (!on) $('rosterExamPanel')?.classList.add('hidden');
        RosterTools.updateSelection();
    },

    // ---- drag to select (Select mode): hold a row ~0.3 s and drag over others; with a mouse just press and drag.
    // Starting on an unticked row ticks everything dragged over; starting on a ticked row unticks. Near the top or bottom edge the page scrolls.
    rowAt: (x, y) => { const el = document.elementFromPoint(x, y); const r = el && el.closest('#rosterListContainer .student-row'); return r && isShown(r) ? r : null; },
    mark: (row) => {
        const P = RosterTools.paint; if (!P || !row || row === P.last) return;
        P.last = row;
        const box = row.querySelector('.roster-check'); if (!box || box.checked === (P.mode === 'add')) return;
        box.checked = P.mode === 'add'; P.dirty = true;
    },
    onDown: (e) => {
        if (!RosterTools.selecting || (e.pointerType === 'mouse' && e.button !== 0)) return;
        const row = e.target.closest('#rosterListContainer .student-row');
        if (!row || !isShown(row) || (e.target.closest(INTERACTIVE))) return;
        const box = row.querySelector('.roster-check');
        const P = RosterTools.paint = { id: e.pointerId, start: row, last: null, on: false, dirty: false, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, mode: box && box.checked ? 'remove' : 'add', touch: e.pointerType !== 'mouse', timer: null };
        P.begin = () => { P.on = true; P.last = null; RosterTools.mark(P.start); RosterTools.updateSelection(); try { navigator.vibrate && navigator.vibrate(12); } catch (err) { /* no vibration */ } RosterTools.edgeScroll(); };
        if (P.touch) P.timer = setTimeout(P.begin, LONG_PRESS);
    },
    onMove: (e) => {
        const P = RosterTools.paint; if (!P || e.pointerId !== P.id) return;
        P.x = e.clientX; P.y = e.clientY;
        if (!P.on) {
            if (P.touch) { if (Math.abs(e.clientX - P.sx) + Math.abs(e.clientY - P.sy) > 14) clearTimeout(P.timer); return; }   // moving before the hold is a scroll
            const over = RosterTools.rowAt(e.clientX, e.clientY);
            if (over && over !== P.start) P.begin(); else return;   // mouse: dragging onto another row starts selecting
        }
        RosterTools.mark(RosterTools.rowAt(e.clientX, e.clientY));
        if (P.dirty) { P.dirty = false; RosterTools.updateSelection(); }
    },
    onUp: () => {
        const P = RosterTools.paint; if (!P) return;
        clearTimeout(P.timer); cancelAnimationFrame(P.raf);
        if (P.on) RosterTools.swallowUntil = Date.now() + 500;   // the release must not also count as a tap
        RosterTools.paint = null;
    },
    edgeScroll: () => {
        const P = RosterTools.paint; if (!P || !P.on) return;
        const bulk = $('rosterBulkBar'), top = (bulk ? bulk.getBoundingClientRect().bottom : 120) + 36, bottom = window.innerHeight - 70;
        const dy = P.y < top ? -12 : P.y > bottom ? 12 : 0;
        if (dy) { window.scrollBy(0, dy); RosterTools.mark(RosterTools.rowAt(P.x, P.y)); if (P.dirty) { P.dirty = false; RosterTools.updateSelection(); } }
        P.raf = requestAnimationFrame(RosterTools.edgeScroll);
    },

    bulkStatus: (status) => {
        const targets = RosterTools.selected();
        if (!targets.length) return;
        targets.forEach(row => row.querySelector(`.attendance-btn[data-status="${status}"]`)?.click());
        // code-made clicks are not auto-saved one by one, so save once, the same way Mark All Present does
        clearTimeout(CourseAttendance.bulkTimer);
        CourseAttendance.bulkTimer = setTimeout(CourseAttendance.autoSaveAll, 0);
        UI.success(`${targets.length} student${targets.length === 1 ? '' : 's'} marked ${status}`);
    },

    openExamPanel: async () => {
        const panel = $('rosterExamPanel');
        const open = panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !open);
        $('rosterExamToggle').setAttribute('aria-expanded', String(open));
        if (!open) return;
        const select = $('rosterExamSelect');
        select.innerHTML = '<option value="">Loading...</option>';
        try {
            const courseId = window.location.hash.replace('#class-', '');
            const res = await apiFetch(`/api/class-exams?courseId=${encodeURIComponent(courseId)}&_t=${Date.now()}`);
            RosterTools.classExams = res.classExams || [];
            select.innerHTML = RosterTools.classExams.length
                ? RosterTools.classExams.map(ce => `<option value="${String(ce.Exam_ID).replace(/"/g, '&quot;')}">${String(ce.ExamTitle || 'Exam').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))}</option>`).join('')
                : '<option value="">No exam is linked to this class yet</option>';
        } catch (err) {
            select.innerHTML = '<option value="">Could not load exams</option>';
            UI.error(err.message || 'Could not load exams');
        }
    },

    bulkExam: async (enable) => {
        const targets = RosterTools.selected();
        const examId = $('rosterExamSelect')?.value;
        const ce = RosterTools.classExams.find(c => c.Exam_ID === examId);
        if (!targets.length || !ce) { UI.error('Select students and an exam first.'); return; }
        const courseId = window.location.hash.replace('#class-', '');
        const ok = await UI.confirm({
            title: enable ? 'Enable exam access' : 'Disable exam access',
            message: `${enable ? 'Enable' : 'Disable'} "${ce.ExamTitle}" for ${targets.length} student${targets.length === 1 ? '' : 's'}?`,
            confirmText: enable ? 'Enable' : 'Disable'
        });
        if (!ok) return;
        try {
            await apiFetch('/api/class-exams', {
                method: 'POST',
                body: JSON.stringify({
                    courseId,
                    examId,
                    term: ce.Term,
                    category: ce.Category,
                    isActive: Boolean(ce.Is_Active),
                    fromDate: ce.From_Date || '',
                    toDate: ce.To_Date || '',
                    assignments: targets.map(r => ({ studentId: r.dataset.studentId, isEnabled: enable }))
                })
            });
            UI.success(`${enable ? 'Enabled' : 'Disabled'} for ${targets.length} student${targets.length === 1 ? '' : 's'}`);
        } catch (err) {
            UI.error(err.message || 'Could not update exam access');
        }
    },

    onInput: (e) => {
        if (e.target.id === 'rosterSearch') RosterTools.apply();
    },

    onChange: (e) => {
        if (e.target.id === 'rosterFilter') {
            try { localStorage.setItem(`roster_filter_${RosterTools.classId()}`, e.target.value); } catch (err) { /* storage unavailable */ }
            RosterTools.apply();
        }
        else if (e.target.id === 'rosterSort') {
            try {
                localStorage.setItem('student_sort', e.target.value);
                localStorage.setItem(`student_sort_${RosterTools.classId()}`, e.target.value);
            } catch (err) { /* storage unavailable */ }
            RosterTools.apply();
        }
        else if (e.target.classList && e.target.classList.contains('roster-check')) RosterTools.updateSelection();
        else if (e.target.id === 'attendanceDate') setTimeout(RosterTools.apply, 900);
    },

    onClick: (e) => {
        const t = e.target;
        if (t.closest('#attendanceMoreBtn')) {
            const open = $('attendanceBarTools').classList.toggle('att-tools-open');
            $('attendanceMoreBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
            RosterTools.syncBulkTop();
            return;
        }
        if (RosterTools.selecting && !t.closest(INTERACTIVE) && !t.classList.contains('roster-check')) {
            const row = t.closest('#rosterListContainer .student-row'), box = row && row.querySelector('.roster-check');
            if (row && box && isShown(row)) { box.checked = !box.checked; RosterTools.updateSelection(); return; }
        }
        if (t.closest('#rosterSelectToggle')) { RosterTools.setSelecting(!RosterTools.selecting); return; }
        if (t.closest('#rosterSelectShown')) {
            rows().filter(isShown).forEach(r => { const b = r.querySelector('.roster-check'); if (b) b.checked = true; });
            RosterTools.updateSelection();
            return;
        }
        if (t.closest('#rosterClearSel')) {
            rows().forEach(r => { const b = r.querySelector('.roster-check'); if (b) b.checked = false; });
            RosterTools.updateSelection();
            return;
        }
        const bulk = t.closest('[data-bulk-status]');
        if (bulk) { RosterTools.bulkStatus(bulk.dataset.bulkStatus); return; }
        if (t.closest('#rosterExamToggle')) { RosterTools.openExamPanel(); return; }
        if (t.closest('#rosterExamEnable')) { RosterTools.bulkExam(true); return; }
        if (t.closest('#rosterExamDisable')) { RosterTools.bulkExam(false); return; }
    }
};
