// js/my-groups.js
// Student screen: every group the student is in for this class (Reporting and the other sets), with topic and teammates.
import { apiFetch, AppState } from './globals.js';
import { escapeHtml as esc } from './html-utils.js';

const byId = (id) => document.getElementById(id);

export const MyGroups = {
    init: () => document.addEventListener('click', MyGroups.handleClicks),

    handleClicks: async (e) => {
        const open = e.target.closest('#openMyGroupsBtn');
        if (open) {
            const modal = byId('myGroupsModal');
            if (!modal) return;
            modal.classList.remove('hidden');
            const list = byId('myGroupsList');
            list.innerHTML = '<div class="text-center text-sm text-gray-500 py-6"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading...</div>';
            // the student summary stores the class id on its buttons (the hash is not always #class-<id> on this screen)
            const courseId = byId('openMyGroupsBtn').dataset.courseId || byId('openSubmitDocModalBtn')?.dataset.courseId || window.location.hash.replace('#class-', '');
            try {
                const r = await apiFetch(`/api/student-groups?courseId=${courseId}&studentId=${AppState.user.User_ID}&_t=${Date.now()}`);
                const groups = r.groups || [];
                list.innerHTML = groups.length ? groups.map(g => `
                    <div class="p-3 bg-white border border-gray-200 rounded-lg shadow-sm">
                        <div class="text-[10px] font-black uppercase tracking-wider text-violet-700">${esc(g.setName)}</div>
                        <div class="text-base font-bold text-gray-800">${esc(g.groupName)}</div>
                        ${g.topic ? `<div class="text-xs text-gray-600 mt-0.5"><i class="fa-solid fa-lightbulb text-amber-500 mr-1" aria-hidden="true"></i>${esc(g.topic)}</div>` : ''}
                        <div class="mt-2 text-xs text-gray-700">${g.mates.length
                            ? '<span class="font-bold text-gray-500 uppercase text-[10px] tracking-wider">With</span> ' + g.mates.map(esc).join('; ')
                            : '<span class="italic text-gray-500">No other members yet.</span>'}</div>
                    </div>`).join('')
                    : '<div class="text-xs text-gray-500 italic text-center py-6 bg-white rounded border border-gray-200">You are not in a group yet.</div>';
            } catch (err) {
                list.innerHTML = `<div class="text-xs text-red-600 text-center py-6">${esc(err.message || 'Could not load your groups.')}</div>`;
            }
            return;
        }
        if (e.target.closest('#closeMyGroupsBtn') || e.target.id === 'closeMyGroupsBg') byId('myGroupsModal')?.classList.add('hidden');
    }
};
