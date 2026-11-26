// js/course-groups.js
// Lecturer tool: several sets of groups per class (Reporting, Lab 1, Quiz teams ...). A student is in one group per set.
// Groups can get a topic, and a set can be filled by a random, balanced split. Saved with /api/group-set-save.
import { apiFetch, apiPost } from './globals.js';
const post = apiPost;
import { UI } from './ui-feedback.js';
import { escapeHtml as esc } from './html-utils.js';

const getCourseId = () => window.location.hash.replace('#class-', '');
const byId = (id) => document.getElementById(id);

export const CourseGroups = {
    courseId: null,
    sets: [],
    setId: 'reporting',
    students: [],          // everyone in the class: { User_ID, Name, Student_Number }
    groups: [],            // [{ gid, name, topic }]
    assign: {},            // User_ID -> gid
    nextGid: 1,

    init: () => {
        document.addEventListener('click', CourseGroups.handleClicks);
        document.addEventListener('change', CourseGroups.handleChanges);
        document.addEventListener('input', CourseGroups.handleInput);
    },

    alert: (message, ok = false) => {
        const box = byId('cgAlert');
        if (!box) return;
        box.textContent = message;
        box.className = `mb-3 p-2 rounded text-xs font-bold ${ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}${message ? '' : ' hidden'}`;
    },

    // Fisher-Yates shuffle then deal round-robin, so group sizes differ by at most one.
    randomSplit: (ids, count, rand = Math.random) => {
        const a = ids.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        const out = Array.from({ length: count }, () => []);
        a.forEach((id, i) => out[i % count].push(id));
        return out;
    },

    handleClicks: async (e) => {
        if (e.target.closest('#openGroupsBtn')) {
            byId('courseMenuModal')?.classList.add('hidden');
            byId('groupsModal')?.classList.remove('hidden');
            CourseGroups.courseId = getCourseId();
            CourseGroups.setId = 'reporting';
            await CourseGroups.loadSets();
            return;
        }
        if (e.target.closest('#closeGroupsBtn') || e.target.id === 'closeGroupsBg') {
            byId('groupsModal')?.classList.add('hidden');
            return;
        }
        if (!byId('groupsModal') || byId('groupsModal').classList.contains('hidden')) return;

        if (e.target.closest('#cgNewSetBtn')) {
            const name = byId('cgSetName').value.trim();
            if (!name) { CourseGroups.alert('Type a name for the new set first.'); return; }
            try {
                const r = await post('/api/group-set-create', { courseId: CourseGroups.courseId, name });
                CourseGroups.setId = r.setId;
                byId('cgSetName').value = '';
                await CourseGroups.loadSets();
            } catch (err) { CourseGroups.alert(err.message || 'Could not create the set.'); }
            return;
        }
        if (e.target.closest('#cgRenameSetBtn')) {
            const name = byId('cgSetName').value.trim();
            if (!name) { CourseGroups.alert('Type the new name first.'); return; }
            try {
                await post('/api/group-set-rename', { courseId: CourseGroups.courseId, setId: CourseGroups.setId, name });
                byId('cgSetName').value = '';
                await CourseGroups.loadSets();
            } catch (err) { CourseGroups.alert(err.message || 'Could not rename the set.'); }
            return;
        }
        if (e.target.closest('#cgDeleteSetBtn')) {
            const ok = await UI.confirm({ title: 'Delete this set?', message: 'All its groups are removed. Scores and uploads are not affected.', confirmText: 'Delete', danger: true });
            if (!ok) return;
            try {
                await post('/api/group-set-delete', { courseId: CourseGroups.courseId, setId: CourseGroups.setId });
                CourseGroups.setId = 'reporting';
                await CourseGroups.loadSets();
            } catch (err) { CourseGroups.alert(err.message || 'Could not delete the set.'); }
            return;
        }
        if (e.target.closest('#cgAddGroupBtn')) {
            CourseGroups.addGroup('');
            CourseGroups.render();
            return;
        }
        const rm = e.target.closest('.cg-remove-group');
        if (rm) {
            const gid = Number(rm.dataset.gid);
            CourseGroups.groups = CourseGroups.groups.filter(g => g.gid !== gid);
            for (const id of Object.keys(CourseGroups.assign)) if (CourseGroups.assign[id] === gid) delete CourseGroups.assign[id];
            CourseGroups.render();
            return;
        }
        if (e.target.closest('#cgSplitBtn')) {
            const n = parseInt(byId('cgSplitCount').value, 10);
            const ids = CourseGroups.students.map(s => s.User_ID);
            if (!(n >= 1) || n > ids.length) { CourseGroups.alert(`Enter a number of groups from 1 to ${ids.length}.`); return; }
            CourseGroups.alert('');
            CourseGroups.groups = [];
            CourseGroups.assign = {};
            CourseGroups.randomSplit(ids, n).forEach((members, i) => {
                const g = CourseGroups.addGroup(`Group ${i + 1}`);
                members.forEach(id => { CourseGroups.assign[id] = g.gid; });
            });
            CourseGroups.render();
            return;
        }
        if (e.target.closest('#cgClearBtn')) {
            CourseGroups.groups = [];
            CourseGroups.assign = {};
            CourseGroups.render();
            return;
        }
        if (e.target.closest('#cgSaveBtn')) await CourseGroups.save();
    },

    handleChanges: async (e) => {
        if (e.target.id === 'cgSort') { CourseGroups.render(); return; }
        if (e.target.id === 'cgSetSelect') {
            CourseGroups.setId = e.target.value;
            await CourseGroups.loadSet();
            return;
        }
        if (e.target.classList && e.target.classList.contains('cg-assign')) {
            const gid = e.target.value;
            if (gid) CourseGroups.assign[e.target.dataset.id] = Number(gid);
            else delete CourseGroups.assign[e.target.dataset.id];
            CourseGroups.renderCounts();
        }
    },

    handleInput: (e) => {
        const t = e.target;
        if (!t.classList) return;
        const g = CourseGroups.groups.find(x => x.gid === Number(t.dataset.gid));
        if (!g) return;
        if (t.classList.contains('cg-name')) g.name = t.value;
        if (t.classList.contains('cg-topic')) g.topic = t.value;
        if (t.classList.contains('cg-name')) CourseGroups.renderAssignOptions();
    },

    // Names are stored "Last, Given", so a plain name sort is a last-name sort.
    sorted: () => {
        const mode = byId('cgSort') ? byId('cgSort').value : 'last';
        const cmp = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
        const given = (s) => (String(s.Name || '').split(',')[1] || '').trim();
        const seat = (s) => { const n = parseFloat(s.Seat_Number); return Number.isNaN(n) ? Infinity : n; };
        const groupName = (s) => { const g = CourseGroups.groups.find(x => x.gid === CourseGroups.assign[s.User_ID]); return g ? g.name : '\uffff'; };
        const by = {
            last: (a, b) => cmp(a.Name, b.Name),
            given: (a, b) => cmp(given(a), given(b)) || cmp(a.Name, b.Name),
            seat: (a, b) => (seat(a) === seat(b) ? 0 : seat(a) < seat(b) ? -1 : 1) || cmp(a.Name, b.Name),
            number: (a, b) => cmp(a.Student_Number, b.Student_Number),
            group: (a, b) => cmp(groupName(a), groupName(b)) || cmp(a.Name, b.Name)
        };
        return [...CourseGroups.students].sort(by[mode] || by.last);
    },

    addGroup: (name, topic = '') => {
        const g = { gid: CourseGroups.nextGid++, name, topic };
        CourseGroups.groups.push(g);
        return g;
    },

    loadSets: async () => {
        CourseGroups.alert('');
        try {
            const r = await apiFetch(`/api/group-sets?courseId=${CourseGroups.courseId}`);
            CourseGroups.sets = r.sets || [];
            if (!CourseGroups.sets.some(s => s.Set_ID === CourseGroups.setId)) CourseGroups.setId = 'reporting';
            byId('cgSetSelect').innerHTML = CourseGroups.sets.map(s => `<option value="${esc(s.Set_ID)}">${esc(s.Name)}</option>`).join('');
            byId('cgSetSelect').value = CourseGroups.setId;
            await CourseGroups.loadSet();
        } catch (err) { CourseGroups.alert(err.message || 'Failed to load.'); }
    },

    loadSet: async () => {
        const isReporting = CourseGroups.setId === 'reporting';
        byId('cgRenameSetBtn').classList.toggle('hidden', isReporting);
        byId('cgDeleteSetBtn').classList.toggle('hidden', isReporting);
        byId('cgSetNote').textContent = isReporting
            ? 'The Reporting set is the group shown on the roster and used for reporting topics.'
            : 'Use this set for a different activity. It does not change the Reporting groups.';
        try {
            const r = await apiFetch(`/api/group-set?courseId=${CourseGroups.courseId}&setId=${encodeURIComponent(CourseGroups.setId)}&_t=${Date.now()}`);
            CourseGroups.students = [...r.groups.flatMap(g => g.members), ...r.unassigned]
                .sort((a, b) => a.Name.localeCompare(b.Name));
            CourseGroups.groups = [];
            CourseGroups.assign = {};
            for (const g of r.groups) {
                const added = CourseGroups.addGroup(g.name, g.topic || '');
                g.members.forEach(m => { CourseGroups.assign[m.User_ID] = added.gid; });
            }
            CourseGroups.render();
        } catch (err) { CourseGroups.alert(err.message || 'Failed to load.'); }
    },

    render: () => {
        byId('cgGroups').innerHTML = CourseGroups.groups.length ? CourseGroups.groups.map(g => `
            <div class="flex flex-wrap items-center gap-2 mb-2">
                <input type="text" class="cg-name w-32 px-2 py-1.5 border border-gray-300 rounded text-sm bg-gray-50" data-gid="${g.gid}" value="${esc(g.name)}" placeholder="Group name" aria-label="Group name">
                <input type="text" class="cg-topic flex-1 min-w-[8rem] px-2 py-1.5 border border-gray-300 rounded text-sm bg-gray-50" data-gid="${g.gid}" value="${esc(g.topic)}" placeholder="Topic (optional)" aria-label="Topic">
                <span class="cg-count text-[10px] font-bold text-gray-500 w-14 text-right" data-gid="${g.gid}"></span>
                <button type="button" class="cg-remove-group text-red-500 hover:text-red-700 px-1" data-gid="${g.gid}" aria-label="Remove group"><i class="fa-solid fa-trash"></i></button>
            </div>`).join('') : '<p class="text-xs text-gray-500 italic">No groups yet. Add one, or split the class randomly.</p>';

        byId('cgStudents').innerHTML = CourseGroups.sorted().map(s => `
            <tr>
                <td class="px-3 py-2"><div class="font-bold text-gray-800">${esc(s.Name)}</div><div class="text-[10px] text-gray-500">${esc(s.Student_Number || 'N/A')}${s.Seat_Number ? ` &middot; Seat ${esc(s.Seat_Number)}` : ''}</div></td>
                <td class="px-3 py-2"><select class="cg-assign w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-gray-50" data-id="${esc(s.User_ID)}"></select></td>
            </tr>`).join('');
        CourseGroups.renderAssignOptions();
    },

    // Rebuild the group choices in every student's select without losing the current choice.
    renderAssignOptions: () => {
        const opts = '<option value="">— none —</option>' + CourseGroups.groups.map(g => `<option value="${g.gid}">${esc(g.name || '(unnamed)')}</option>`).join('');
        document.querySelectorAll('#cgStudents .cg-assign').forEach(sel => {
            sel.innerHTML = opts;
            sel.value = CourseGroups.assign[sel.dataset.id] ? String(CourseGroups.assign[sel.dataset.id]) : '';
        });
        CourseGroups.renderCounts();
    },

    renderCounts: () => {
        const counts = {};
        Object.values(CourseGroups.assign).forEach(gid => { counts[gid] = (counts[gid] || 0) + 1; });
        document.querySelectorAll('#cgGroups .cg-count').forEach(el => { el.textContent = `${counts[el.dataset.gid] || 0} in`; });
        const placed = Object.keys(CourseGroups.assign).length;
        byId('cgSummary').textContent = `${CourseGroups.students.length} students, ${placed} in a group`;
    },

    save: async () => {
        const groups = CourseGroups.groups.map(g => ({
            name: g.name.trim(),
            topic: g.topic.trim(),
            memberIds: Object.keys(CourseGroups.assign).filter(id => CourseGroups.assign[id] === g.gid)
        }));
        if (groups.some(g => !g.name)) { CourseGroups.alert('Every group needs a name.'); return; }
        const btn = byId('cgSaveBtn');
        btn.disabled = true;
        try {
            await post('/api/group-set-save', { courseId: CourseGroups.courseId, setId: CourseGroups.setId, groups });
            CourseGroups.alert('Groups saved.', true);
            UI.toast('Groups saved.', 'success');
        } catch (err) { CourseGroups.alert(err.message || 'Could not save.'); }
        btn.disabled = false;
    }
};
