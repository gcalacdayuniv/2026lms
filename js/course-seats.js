// js/course-seats.js
// Lecturer tool: Seat Plan. One seat per student (the server refuses duplicates). Drag a row (or use the up/down buttons) and the
// seat numbers follow the new order; a "+" seats a student who has none (in their eye-condition group, or after the last seat);
// a padlock keeps a seat out of every automatic change; "Reassign all seats" seats everybody again by eye condition then last name.
// Students who are UD, Dropped or Graduated get no seat. Saved with /api/set-seat, /api/seat-order, /api/seat-insert, /api/auto-seat.
import { apiFetch } from './globals.js';
import { UI } from './ui-feedback.js';
import { escapeHtml as esc } from './html-utils.js';
import { CourseClass } from './course-class.js';
import { SeatMap } from './seat-map.js';

const getCourseId = () => window.location.hash.replace('#class-', '');
const byId = (id) => document.getElementById(id);
const post = (path, body) => apiFetch(path, { method: 'POST', body: JSON.stringify(body) });

const NO_SEAT = ['ud', 'dropped', 'graduated'];
const seatable = (s) => !NO_SEAT.includes(String(s.account_status || 'Active').trim().toLowerCase());
const hasSeat = (s) => String(s.Seat_Number || '').trim() !== '';
const locked = (s) => Number(s.Seat_Locked) === 1 && hasSeat(s);
const eyeRank = (eye) => {
    const e = String(eye || '').toLowerCase();
    return /blind/.test(e) ? 0 : /near/.test(e) ? 1 : /far/.test(e) ? 3 : 2;
};
const seatNum = (s) => { const n = parseFloat(s.Seat_Number); return Number.isNaN(n) ? Infinity : n; };
const byName = (a, b) => String(a.Name || '').localeCompare(String(b.Name || ''), undefined, { sensitivity: 'base' });
const bySeat = (a, b) => (seatNum(a) - seatNum(b)) || (eyeRank(a.eye_condition) - eyeRank(b.eye_condition)) || byName(a, b);

const eyeBadge = (s) => s.eye_condition && s.eye_condition !== 'No Eye Condition'
    ? `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-800 border border-purple-200">${esc(s.eye_condition)}</span>` : '';

export const CourseSeats = {
    changed: false,
    pick: null,      // student whose "+" choice is open
    drag: null,      // { id, targetId, after }

    init: () => {
        document.addEventListener('click', CourseSeats.handleClicks);
        document.addEventListener('change', CourseSeats.handleChanges);
        document.addEventListener('pointerdown', CourseSeats.dragStart);
        document.addEventListener('pointermove', CourseSeats.dragMove);
        document.addEventListener('pointerup', CourseSeats.dragEnd);
        document.addEventListener('pointercancel', CourseSeats.dragCancel);
    },

    flash: (message, ok = true) => {
        const box = byId('csAlert');
        if (!box) return;
        box.textContent = message;
        box.className = `mb-3 p-2 rounded text-xs font-bold ${ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}${message ? '' : ' hidden'}`;
    },

    students: () => CourseClass.currentStudents || [],
    seated: () => CourseSeats.students().filter(s => seatable(s) && hasSeat(s)).sort(bySeat),

    render: () => {
        const list = byId('csList');
        if (!list) return;
        const all = CourseSeats.students();
        if (!all.length) { list.innerHTML = '<p class="p-6 text-center text-sm text-gray-500">No students enrolled yet.</p>'; return; }
        const seated = CourseSeats.seated();
        const unseated = all.filter(s => seatable(s) && !hasSeat(s)).sort((a, b) => (eyeRank(a.eye_condition) - eyeRank(b.eye_condition)) || byName(a, b));
        const none = all.filter(s => !seatable(s)).sort(byName);
        const head = (t, n) => `<div class="px-3 py-1.5 bg-gray-50 text-[10px] font-bold text-gray-500 uppercase tracking-wider sticky top-0 z-10">${t} (${n})</div>`;

        const seatedRow = (s, i) => {
            const lk = locked(s);
            return `<div class="cs-row flex flex-wrap items-center gap-1.5 px-2 py-1.5 bg-white" data-id="${esc(s.User_ID)}">
                <button type="button" class="cs-grip w-8 min-h-[44px] text-gray-400 ${lk ? 'opacity-30' : 'cursor-grab'}" style="touch-action:none" aria-label="Drag ${esc(s.Name)} to a new seat" ${lk ? 'disabled' : ''}><i class="fa-solid fa-grip-vertical" aria-hidden="true"></i></button>
                <label class="sr-only" for="seat-${esc(s.User_ID)}">Seat for ${esc(s.Name)}</label>
                <input type="text" id="seat-${esc(s.User_ID)}" class="cs-seat w-14 min-h-[44px] px-1 text-center text-base font-bold border border-gray-300 rounded-md bg-gray-50 focus:bg-white" maxlength="12" inputmode="numeric" value="${esc(s.Seat_Number || '')}" data-student-id="${esc(s.User_ID)}">
                <div class="flex-1 min-w-[7rem]"><div class="text-sm font-bold text-gray-800 truncate">${esc(s.Name)}</div><div>${eyeBadge(s)}</div></div>
                <div class="flex items-center gap-1 ml-auto">
                    <button type="button" class="cs-up min-w-[44px] min-h-[44px] rounded-md border border-gray-300 text-gray-600 bg-white disabled:opacity-30" data-student-id="${esc(s.User_ID)}" aria-label="Move ${esc(s.Name)} up" ${lk || i === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-up" aria-hidden="true"></i></button>
                    <button type="button" class="cs-down min-w-[44px] min-h-[44px] rounded-md border border-gray-300 text-gray-600 bg-white disabled:opacity-30" data-student-id="${esc(s.User_ID)}" aria-label="Move ${esc(s.Name)} down" ${lk || i === seated.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button>
                    <button type="button" class="cs-lock min-w-[44px] min-h-[44px] rounded-md border ${lk ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-gray-400 border-gray-300'}" data-student-id="${esc(s.User_ID)}" aria-pressed="${lk}" aria-label="${lk ? 'Unlock' : 'Lock'} seat of ${esc(s.Name)}"><i class="fa-solid ${lk ? 'fa-lock' : 'fa-lock-open'}" aria-hidden="true"></i></button>
                </div>
            </div>`;
        };
        const unseatedRow = (s) => `<div class="px-2 py-1.5 bg-white">
                <div class="flex items-center gap-2">
                    <div class="flex-1 min-w-0"><div class="text-sm font-bold text-gray-800 truncate">${esc(s.Name)}</div><div>${eyeBadge(s)}</div></div>
                    <button type="button" class="cs-plus min-w-[44px] min-h-[44px] rounded-md bg-sky-600 text-white font-bold" data-student-id="${esc(s.User_ID)}" aria-label="Give ${esc(s.Name)} a seat" aria-expanded="${CourseSeats.pick === s.User_ID}"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
                </div>
                ${CourseSeats.pick === s.User_ID ? `<div class="grid grid-cols-2 gap-2 mt-2">
                    <button type="button" class="cs-ins min-h-[44px] px-2 rounded-md border border-sky-300 text-sky-700 text-xs font-bold bg-sky-50" data-where="group" data-student-id="${esc(s.User_ID)}">Into their eye group<span class="block font-normal text-[10px] text-sky-600">seats behind move down</span></button>
                    <button type="button" class="cs-ins min-h-[44px] px-2 rounded-md border border-sky-300 text-sky-700 text-xs font-bold bg-sky-50" data-where="end" data-student-id="${esc(s.User_ID)}">After the last seat<span class="block font-normal text-[10px] text-sky-600">nobody else moves</span></button>
                </div>` : ''}
            </div>`;
        const noneRow = (s) => `<div class="px-3 py-2 bg-white opacity-60 flex items-center gap-2"><span class="flex-1 text-sm text-gray-700 truncate">${esc(s.Name)}</span><span class="text-[10px] font-bold text-gray-500 uppercase">${esc(s.account_status)}</span></div>`;

        list.innerHTML =
            (seated.length ? head('Seated', seated.length) + `<div class="divide-y divide-gray-100">${seated.map(seatedRow).join('')}</div>` : '') +
            (unseated.length ? head('Not seated yet', unseated.length) + `<div class="divide-y divide-gray-100">${unseated.map(unseatedRow).join('')}</div>` : '') +
            (none.length ? head('No seat: UD, Dropped, Graduated', none.length) + `<div class="divide-y divide-gray-100">${none.map(noneRow).join('')}</div>` : '');
    },

    // Copies the server's answer (seat + lock for every student) into the roster the page already holds.
    apply: (seats) => {
        const by = new Map((seats || []).map(x => [x.studentId, x]));
        CourseSeats.students().forEach(s => {
            const x = by.get(s.User_ID);
            if (x) { s.Seat_Number = x.seat; s.Seat_Locked = x.locked ? 1 : 0; }
        });
        CourseSeats.changed = true;
        CourseSeats.pick = null;
        CourseSeats.render();
    },

    run: async (path, body, okMessage) => {
        try {
            const r = await post(path, { courseId: getCourseId(), ...body });
            CourseSeats.apply(r.seats);
            CourseSeats.flash(okMessage ? okMessage(r) : '');
        } catch (err) {
            CourseSeats.flash(err.message, false);
            CourseSeats.render();
        }
    },

    close: () => {
        byId('seatPlanModal')?.classList.add('hidden');
        // The class page behind is redrawn once, so its roster shows the new seats.
        if (CourseSeats.changed) { CourseSeats.changed = false; CourseClass.loadClassScreen(getCourseId(), true); }
    },

    // The seated students in their current order, with `id` moved before/after another row.
    moved: (id, targetId, after) => {
        const ids = CourseSeats.seated().map(s => s.User_ID).filter(x => x !== id);
        const at = ids.indexOf(targetId);
        if (at < 0) return null;
        ids.splice(after ? at + 1 : at, 0, id);
        return ids;
    },

    step: (id, dir) => {
        const seated = CourseSeats.seated();
        const i = seated.findIndex(s => s.User_ID === id);
        let j = i + dir;
        while (seated[j] && locked(seated[j])) j += dir;   // a locked seat stays where it is
        if (i < 0 || !seated[j]) return;
        const ids = seated.map(s => s.User_ID);
        ids.splice(i, 1);
        ids.splice(j, 0, id);
        CourseSeats.run('/api/seat-order', { order: ids });
    },

    // Drag with a pointer (mouse, finger or pen) on the grip handle.
    dragStart: (e) => {
        const grip = e.target.closest && e.target.closest('.cs-grip');
        if (!grip || grip.disabled) return;
        const row = grip.closest('.cs-row');
        e.preventDefault();
        CourseSeats.drag = { id: row.dataset.id, targetId: null, after: false, row };
        row.classList.add('opacity-60', 'shadow-lg');
        try { grip.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
    },

    clearMarks: () => {
        document.querySelectorAll('#csList .cs-row').forEach(r => { r.style.boxShadow = ''; });
    },

    dragMove: (e) => {
        const d = CourseSeats.drag;
        if (!d) return;
        const list = byId('csList');
        const box = list.getBoundingClientRect();
        if (e.clientY < box.top + 40) list.scrollTop -= 12;
        else if (e.clientY > box.bottom - 40) list.scrollTop += 12;
        CourseSeats.clearMarks();
        const row = document.elementFromPoint(e.clientX, e.clientY)?.closest('#csList .cs-row');
        if (!row || row.dataset.id === d.id) { d.targetId = null; return; }
        const r = row.getBoundingClientRect();
        d.targetId = row.dataset.id;
        d.after = e.clientY > r.top + r.height / 2;
        row.style.boxShadow = d.after ? 'inset 0 -3px 0 #0284c7' : 'inset 0 3px 0 #0284c7';
    },

    dragEnd: () => {
        const d = CourseSeats.drag;
        if (!d) return;
        CourseSeats.drag = null;
        CourseSeats.clearMarks();
        d.row.classList.remove('opacity-60', 'shadow-lg');
        if (!d.targetId) return;
        const ids = CourseSeats.moved(d.id, d.targetId, d.after);
        if (ids) CourseSeats.run('/api/seat-order', { order: ids });
    },

    dragCancel: () => {
        const d = CourseSeats.drag;
        CourseSeats.drag = null;
        CourseSeats.clearMarks();
        d?.row.classList.remove('opacity-60', 'shadow-lg');
    },

    handleClicks: async (e) => {
        if (e.target.closest('#openSeatPlanBtn')) {
            byId('courseMenuModal')?.classList.add('hidden');
            byId('seatPlanModal')?.classList.remove('hidden');
            CourseSeats.pick = null;
            CourseSeats.flash('');
            CourseSeats.render();
            return;
        }
        if (e.target.closest('#closeSeatPlanBtn') || e.target.id === 'closeSeatPlanBg') { CourseSeats.close(); return; }
        const modal = byId('seatPlanModal');
        if (!modal || modal.classList.contains('hidden')) return;

        if (e.target.closest('#csMapBtn')) { SeatMap.openLecturer(CourseSeats.students()); return; }

        const up = e.target.closest('.cs-up'), down = e.target.closest('.cs-down');
        if (up || down) { CourseSeats.step((up || down).dataset.studentId, up ? -1 : 1); return; }

        const plus = e.target.closest('.cs-plus');
        if (plus) {
            CourseSeats.pick = CourseSeats.pick === plus.dataset.studentId ? null : plus.dataset.studentId;
            CourseSeats.render();
            return;
        }
        const ins = e.target.closest('.cs-ins');
        if (ins) { await CourseSeats.run('/api/seat-insert', { studentId: ins.dataset.studentId, where: ins.dataset.where }); return; }

        const lock = e.target.closest('.cs-lock');
        if (lock) {
            const s = CourseSeats.students().find(x => x.User_ID === lock.dataset.studentId);
            if (!s) return;
            if (!hasSeat(s)) { CourseSeats.flash('Give the student a seat before locking it.', false); return; }
            await CourseSeats.run('/api/set-seat', { studentId: s.User_ID, seat: String(s.Seat_Number).trim(), locked: !locked(s) });
            return;
        }

        if (e.target.closest('#csAutoAllBtn')) {
            const ok = await UI.confirm({ title: 'Reassign all seats?', message: 'Every student without a locked seat is seated again from 1 by eye condition, then last name. Locked seats stay. UD, Dropped and Graduated students get no seat.', confirmText: 'Reassign' });
            if (ok) await CourseSeats.run('/api/auto-seat', { mode: 'all' }, (r) => `${r.assigned} seat${r.assigned === 1 ? '' : 's'} changed.`);
            return;
        }
        if (e.target.closest('#csAutoNewBtn')) {
            await CourseSeats.run('/api/auto-seat', { mode: 'unseated' }, (r) => r.assigned ? `${r.assigned} student${r.assigned === 1 ? '' : 's'} seated.` : 'Nobody needed a seat.');
        }
    },

    handleChanges: async (e) => {
        const input = e.target.closest ? e.target.closest('.cs-seat') : null;
        if (!input) return;
        const s = CourseSeats.students().find(x => x.User_ID === input.dataset.studentId);
        if (!s) return;
        await CourseSeats.run('/api/set-seat', { studentId: s.User_ID, seat: input.value.trim(), locked: locked(s) });
    }
};
