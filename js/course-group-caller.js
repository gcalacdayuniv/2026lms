// js/course-group-caller.js
// Group Caller: draws one group at random from a group set the lecturer chooses (Reporting or any set made in Groups),
// without repeats until reset, then opens the practical grading screen (timer, grade, notes) for that group.
// Opened from the Student Caller ("By group"). Called groups are kept per class, set and day on this device.
import { apiFetch } from './globals.js';
import { UI } from './ui-feedback.js';
import { escapeHtml } from './html-utils.js';
import { getLocalDateString } from './date-utils.js';
import { PracticalGrade } from './course-practical.js';

const $ = (id) => document.getElementById(id);
const FIELD = 'w-full border border-gray-300 rounded-md px-3 py-2 text-base focus:ring-2 focus:ring-purple-500 outline-none bg-white';
const calledKey = (courseId, setId) => `group_caller_${courseId}_${setId}_${getLocalDateString()}`;
const readCalled = (k) => { try { const v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
const writeCalled = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
const pick = (n) => { const a = new Uint32Array(1); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : (a[0] = Math.floor(Math.random() * 4294967295)); return a[0] % n; };
const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Members shown as Absent / Excused (or UD / Dropped) in the class list on screen are not graded with the group.
const isOut = (userId) => {
    const safe = window.CSS && CSS.escape ? CSS.escape(userId) : String(userId).replace(/"/g, '\\"');
    const row = document.querySelector(`.student-row[data-student-id="${safe}"]`);
    if (!row) return false;
    if (row.hasAttribute('data-auto-absent')) return true;
    const st = row.querySelector('.attendance-btn[data-selected="true"]')?.dataset.status;
    return st === 'Absent' || st === 'Excused';
};

export const GroupCaller = {
    s: null,   // { courseId, sets, setId, groups, current, busy }

    open: async (courseId) => {
        if (!courseId) return;
        UI.overlay({
            id: 'groupCallerModal', label: 'Group caller', z: 190, padClass: 'p-0',
            panelClass: 'sheet-panel page-full bg-white h-full overflow-y-auto p-4 sm:rounded-none',
            onClose: () => { GroupCaller.s = null; },
            html: `
            <div class="max-w-3xl mx-auto">
                <div class="flex items-center justify-between gap-3 mb-3">
                    <h3 class="text-lg font-black text-gray-900"><i class="fa-solid fa-people-group text-purple-600 mr-2" aria-hidden="true"></i>Group caller</h3>
                    <button type="button" data-overlay-close aria-label="Close" class="min-w-[44px] min-h-[44px] rounded-full text-gray-500 hover:bg-gray-100 text-xl"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                </div>
                <label for="gcSet" class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Group set</label>
                <select id="gcSet" class="${FIELD} mb-1"><option>Loading...</option></select>
                <p id="gcStatus" class="text-xs font-bold text-gray-500 mb-3 min-h-[16px]"></p>
                <div id="gcError" role="alert" class="hidden bg-red-100 text-red-700 p-2 rounded text-sm font-medium mb-3"></div>

                <div id="gcStage" class="rounded-xl border-2 border-purple-200 bg-purple-50 p-4 text-center min-h-[200px] flex flex-col items-center justify-center" aria-live="polite">
                    <p class="text-sm text-purple-700 font-bold">Tap <span class="whitespace-nowrap">Call a group</span></p>
                </div>

                <div class="flex flex-wrap gap-2 mt-3">
                    <button type="button" id="gcCall" class="flex-1 min-w-[10rem] min-h-[52px] rounded-lg bg-purple-600 text-white font-black text-lg hover:bg-purple-700 disabled:opacity-50"><i class="fa-solid fa-shuffle mr-2" aria-hidden="true"></i>Call a group</button>
                    <button type="button" id="gcGrade" disabled class="flex-1 min-w-[10rem] min-h-[52px] rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-40"><i class="fa-solid fa-clipboard-check mr-2" aria-hidden="true"></i>Grade with timer</button>
                </div>

                <div class="flex items-center justify-between mt-5 mb-1">
                    <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wider">Called today</h4>
                    <button type="button" id="gcReset" class="min-h-[44px] px-2 text-sm font-bold text-purple-700 hover:underline">Reset called</button>
                </div>
                <div id="gcCalled" class="flex flex-wrap gap-2 text-sm"></div>
            </div>`
        });
        GroupCaller.s = { courseId, sets: [], setId: 'reporting', groups: [], current: null, busy: false };
        try {
            const r = await apiFetch(`/api/group-sets?courseId=${encodeURIComponent(courseId)}`);
            GroupCaller.s.sets = r.sets || [];
            let last = 'reporting'; try { last = localStorage.getItem(`group_caller_set_${courseId}`) || 'reporting'; } catch (e) { /* no storage */ }
            GroupCaller.s.setId = GroupCaller.s.sets.some(x => x.Set_ID === last) ? last : 'reporting';
            $('gcSet').innerHTML = GroupCaller.s.sets.map(x => `<option value="${escapeHtml(x.Set_ID)}">${escapeHtml(x.Name)}</option>`).join('');
            $('gcSet').value = GroupCaller.s.setId;
            await GroupCaller.loadSet();
        } catch (e) { GroupCaller.fail((e && e.message) || 'Could not load the group sets.'); }
    },

    fail: (m) => { const el = $('gcError'); if (el) { el.textContent = m; el.classList.remove('hidden'); } },

    loadSet: async () => {
        const s = GroupCaller.s; if (!s) return;
        $('gcError')?.classList.add('hidden');
        s.current = null; GroupCaller.paintStage(null);
        try {
            const r = await apiFetch(`/api/group-set?courseId=${encodeURIComponent(s.courseId)}&setId=${encodeURIComponent(s.setId)}`);
            if (GroupCaller.s !== s) return;
            s.groups = r.groups || [];
        } catch (e) { s.groups = []; GroupCaller.fail((e && e.message) || 'Could not load the groups.'); }
        GroupCaller.paintList();
    },

    called: () => readCalled(calledKey(GroupCaller.s.courseId, GroupCaller.s.setId)),
    left: () => { const c = GroupCaller.called(); return GroupCaller.s.groups.filter(g => !c.includes(g.name)); },

    paintList: () => {
        const s = GroupCaller.s; if (!s) return;
        const called = GroupCaller.called(), left = GroupCaller.left().length;
        $('gcStatus').textContent = s.groups.length ? `${left} of ${s.groups.length} group${s.groups.length === 1 ? '' : 's'} not called yet` : 'This set has no groups yet. Make groups in the Groups screen.';
        $('gcCall').disabled = !left;
        $('gcCalled').innerHTML = called.length ? called.map((n, i) => `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 text-gray-700 font-bold"><span class="text-gray-400">${i + 1}</span>${escapeHtml(n)}</span>`).join('') : '<span class="text-gray-400">No group called yet.</span>';
    },

    paintStage: (g, spinning) => {
        const stage = $('gcStage'); if (!stage) return;
        $('gcGrade').disabled = !g || spinning;
        if (!g) { stage.innerHTML = '<p class="text-sm text-purple-700 font-bold">Tap <span class="whitespace-nowrap">Call a group</span></p>'; return; }
        if (spinning) { stage.innerHTML = `<p class="text-4xl sm:text-5xl font-black text-purple-800 break-words">${escapeHtml(g.name)}</p>`; return; }
        const members = g.members.map(m => `<li class="flex items-center justify-between gap-2 py-1.5 border-b border-purple-100 last:border-0"><span class="font-bold text-gray-800 text-left">${escapeHtml(m.Name)}</span>${isOut(m.User_ID) ? '<span class="text-[11px] font-bold text-red-700 bg-red-50 border border-red-200 rounded px-1.5">Absent today</span>' : `<span class="text-xs text-gray-500">${m.Seat_Number ? 'Seat ' + escapeHtml(String(m.Seat_Number)) : ''}</span>`}</li>`).join('');
        stage.innerHTML = `<p class="text-4xl sm:text-5xl font-black text-purple-800 break-words">${escapeHtml(g.name)}</p>
            ${g.topic ? `<p class="mt-1 text-sm font-bold text-purple-700">Topic: ${escapeHtml(g.topic)}</p>` : ''}
            <ul class="w-full max-w-md mt-3 text-sm">${members}</ul>`;
    },

    call: async () => {
        const s = GroupCaller.s; if (!s || s.busy) return;
        const left = GroupCaller.left(); if (!left.length) return;
        s.busy = true; $('gcCall').disabled = true;
        const winner = left[pick(left.length)];
        // A quick shuffle through the names that slows down and lands on the winner.
        if (!reduced() && left.length > 1) {
            const steps = 14;
            for (let i = 0; i < steps && GroupCaller.s === s; i++) {
                GroupCaller.paintStage(i === steps - 1 ? winner : left[pick(left.length)], true);
                await new Promise(r => setTimeout(r, 70 + i * i * 2.2));
            }
        }
        if (GroupCaller.s !== s) return;
        s.busy = false; s.current = winner;
        writeCalled(calledKey(s.courseId, s.setId), [...GroupCaller.called(), winner.name]);
        try { navigator.vibrate && navigator.vibrate(20); } catch (e) { /* no vibration */ }
        GroupCaller.paintStage(winner); GroupCaller.paintList();
    },

    grade: () => {
        const s = GroupCaller.s; if (!s || !s.current) return;
        const targets = s.current.members.filter(m => !isOut(m.User_ID)).map(m => ({ User_ID: m.User_ID, Name: m.Name }));
        if (!targets.length) { GroupCaller.fail('Everyone in this group is marked absent today.'); return; }
        PracticalGrade.open({ courseId: s.courseId, targets, groupName: s.current.name, setId: s.setId });
    },

    init: () => {
        document.addEventListener('click', (e) => {
            const t = e.target;
            if (t.closest('#openGroupCallerBtn')) { GroupCaller.open(window.location.hash.replace('#class-', '')); return; }
            const m = $('groupCallerModal'); if (!m || !m.contains(t)) return;
            if (t.closest('#gcCall')) GroupCaller.call();
            else if (t.closest('#gcGrade')) GroupCaller.grade();
            else if (t.closest('#gcReset')) {
                const s = GroupCaller.s; if (!s) return;
                writeCalled(calledKey(s.courseId, s.setId), []); s.current = null; GroupCaller.paintStage(null); GroupCaller.paintList();
            }
        });
        document.addEventListener('change', (e) => {
            if (e.target.id !== 'gcSet' || !GroupCaller.s) return;
            GroupCaller.s.setId = e.target.value;
            try { localStorage.setItem(`group_caller_set_${GroupCaller.s.courseId}`, e.target.value); } catch (err) { /* no storage */ }
            GroupCaller.loadSet();
        });
    }
};
