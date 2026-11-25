// js/course-seats.js
// Lecturer tool: Seat Plan. One seat per student (the server refuses duplicates), a lock per seat, and auto-assignment by
// eye-condition group (Legally Blind, Near Sighted, none, Far Sighted) then last name. Saved with /api/set-seat and /api/auto-seat.
import { apiFetch } from './globals.js';
import { UI } from './ui-feedback.js';
import { escapeHtml as esc } from './html-utils.js';
import { CourseClass } from './course-class.js';

const getCourseId = () => window.location.hash.replace('#class-', '');
const byId = (id) => document.getElementById(id);
const post = (path, body) => apiFetch(path, { method: 'POST', body: JSON.stringify(body) });

const eyeRank = (eye) => {
    const e = String(eye || '').toLowerCase();
    return /blind/.test(e) ? 0 : /near/.test(e) ? 1 : /far/.test(e) ? 3 : 2;
};
const seatNum = (s) => { const n = parseFloat(s.Seat_Number); return Number.isNaN(n) ? Infinity : n; };
const byName = (a, b) => String(a.Name || '').localeCompare(String(b.Name || ''), undefined, { sensitivity: 'base' });

export const CourseSeats = {
    changed: false,

    init: () => {
        document.addEventListener('click', CourseSeats.handleClicks);
        document.addEventListener('change', CourseSeats.handleChanges);
    },

    flash: (message, ok = true) => {
        const box = byId('csAlert');
        if (!box) return;
        box.textContent = message;
        box.className = `mb-3 p-2 rounded text-xs font-bold ${ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}${message ? '' : ' hidden'}`;
    },

    render: () => {
        const list = byId('csList');
        if (!list) return;
        const students = (CourseClass.currentStudents || []).slice().sort((a, b) =>
            (seatNum(a) - seatNum(b)) || (eyeRank(a.eye_condition) - eyeRank(b.eye_condition)) || byName(a, b));
        if (!students.length) { list.innerHTML = '<p class="p-6 text-center text-sm text-gray-500">No students enrolled yet.</p>'; return; }
        list.innerHTML = students.map(s => {
            const locked = Number(s.Seat_Locked) === 1 && !!String(s.Seat_Number || '').trim();
            const eye = s.eye_condition && s.eye_condition !== 'No Eye Condition'
                ? `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-800 border border-purple-200">${esc(s.eye_condition)}</span>` : '';
            const off = String(s.account_status || 'Active') === 'Inactive' ? '<span class="text-[10px] font-bold text-gray-400 uppercase">Inactive</span>' : '';
            return `<div class="flex items-center gap-2 p-2 ${off ? 'opacity-60' : ''}">
                <div class="flex-1 min-w-0">
                    <div class="text-sm font-bold text-gray-800 truncate">${esc(s.Name)}</div>
                    <div class="flex flex-wrap items-center gap-1">${eye}${off}</div>
                </div>
                <label class="sr-only" for="seat-${esc(s.User_ID)}">Seat for ${esc(s.Name)}</label>
                <input type="text" id="seat-${esc(s.User_ID)}" class="cs-seat w-16 min-h-[44px] px-2 text-center text-base font-bold border border-gray-300 rounded-md bg-gray-50 focus:bg-white" maxlength="12" inputmode="numeric" placeholder="-" value="${esc(s.Seat_Number || '')}" data-student-id="${esc(s.User_ID)}">
                <button type="button" class="cs-lock min-w-[44px] min-h-[44px] rounded-md border ${locked ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-gray-400 border-gray-300'}" data-student-id="${esc(s.User_ID)}" aria-pressed="${locked}" aria-label="${locked ? 'Unlock' : 'Lock'} seat of ${esc(s.Name)}">
                    <i class="fa-solid ${locked ? 'fa-lock' : 'fa-lock-open'}" aria-hidden="true"></i>
                </button>
            </div>`;
        }).join('');
    },

    // Copies the server's answer (seat + lock for every student) into the roster the page already holds.
    apply: (seats) => {
        const by = new Map((seats || []).map(x => [x.studentId, x]));
        (CourseClass.currentStudents || []).forEach(s => {
            const x = by.get(s.User_ID);
            if (x) { s.Seat_Number = x.seat; s.Seat_Locked = x.locked ? 1 : 0; }
        });
        CourseSeats.changed = true;
        CourseSeats.render();
    },

    close: () => {
        byId('seatPlanModal')?.classList.add('hidden');
        // The class page behind is redrawn once, so its roster shows the new seats.
        if (CourseSeats.changed) { CourseSeats.changed = false; CourseClass.loadClassScreen(getCourseId(), true); }
    },

    handleClicks: async (e) => {
        if (e.target.closest('#openSeatPlanBtn')) {
            byId('courseMenuModal')?.classList.add('hidden');
            byId('seatPlanModal')?.classList.remove('hidden');
            CourseSeats.flash('');
            CourseSeats.render();
            return;
        }
        if (e.target.closest('#closeSeatPlanBtn') || e.target.id === 'closeSeatPlanBg') { CourseSeats.close(); return; }
        const modal = byId('seatPlanModal');
        if (!modal || modal.classList.contains('hidden')) return;
        const courseId = getCourseId();

        const lock = e.target.closest('.cs-lock');
        if (lock) {
            const s = CourseClass.currentStudents.find(x => x.User_ID === lock.dataset.studentId);
            if (!s) return;
            const seat = String(s.Seat_Number || '').trim();
            if (!seat) { CourseSeats.flash('Give the student a seat before locking it.', false); return; }
            try {
                const r = await post('/api/set-seat', { courseId, studentId: s.User_ID, seat, locked: Number(s.Seat_Locked) !== 1 });
                CourseSeats.apply(r.seats); CourseSeats.flash('');
            } catch (err) { CourseSeats.flash(err.message, false); }
            return;
        }

        const all = e.target.closest('#csAutoAllBtn');
        const fresh = e.target.closest('#csAutoNewBtn');
        if (!all && !fresh) return;
        if (all) {
            const ok = await UI.confirm({ title: 'Auto-assign all seats?', message: 'Every active student without a locked seat is seated again by eye condition, then last name. Locked seats stay.', confirmText: 'Auto-assign' });
            if (!ok) return;
        }
        try {
            const r = await post('/api/auto-seat', { courseId, mode: all ? 'all' : 'unseated' });
            CourseSeats.apply(r.seats);
            CourseSeats.flash(r.assigned ? `${r.assigned} student${r.assigned === 1 ? '' : 's'} seated.` : 'Nobody needed a seat.');
        } catch (err) { CourseSeats.flash(err.message, false); }
    },

    handleChanges: async (e) => {
        const input = e.target.closest ? e.target.closest('.cs-seat') : null;
        if (!input) return;
        const s = CourseClass.currentStudents.find(x => x.User_ID === input.dataset.studentId);
        if (!s) return;
        const seat = input.value.trim();
        try {
            const r = await post('/api/set-seat', { courseId: getCourseId(), studentId: s.User_ID, seat, locked: Number(s.Seat_Locked) === 1 });
            CourseSeats.apply(r.seats); CourseSeats.flash('');
        } catch (err) {
            input.value = s.Seat_Number || '';
            CourseSeats.flash(err.message, false);
        }
    }
};
