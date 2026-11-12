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

export const RosterTools = {
    selecting: false,
    classExams: [],

    init: () => {
        document.addEventListener('input', RosterTools.onInput);
        document.addEventListener('change', RosterTools.onChange);
        document.addEventListener('click', RosterTools.onClick);
    },

    matches: (row, query, filter) => {
        if (query && !(row.dataset.search || '').includes(query)) return false;
        if (filter === 'blind') return row.dataset.eye === 'Legally Blind';
        if (filter === 'notpresent') return ['Late', 'Excused', 'Absent'].includes(statusOf(row));
        if (filter === 'noseat') return !row.dataset.seat;
        if (filter.startsWith('group:')) return row.dataset.group === filter.slice(6);
        return true;
    },

    apply: () => {
        if (!$('rosterTools')) return;
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
        rows().forEach(row => {
            const box = row.querySelector('.roster-check');
            if (!box) return;
            box.classList.toggle('hidden', !on);
            if (!on) box.checked = false;
        });
        $('rosterBulkBar')?.classList.toggle('hidden', !on);
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
        if (e.target.id === 'rosterFilter') RosterTools.apply();
        else if (e.target.classList && e.target.classList.contains('roster-check')) RosterTools.updateSelection();
        else if (e.target.id === 'attendanceDate') setTimeout(RosterTools.apply, 900);
    },

    onClick: (e) => {
        const t = e.target;
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
