// js/practical-review.js
// Saved practical / major-term activity grades: pick an activity and see each group (or student) with the total,
// every criterion and its points, time used and notes. Lecturer-only (GET /api/practical-grades).
import { apiFetch } from './globals.js';
import { UI } from './ui-feedback.js';
import { escapeHtml } from './html-utils.js';
import { fmt } from './course-practical.js';

const $ = (id) => document.getElementById(id);
const num = (n) => String(Math.round(Number(n) * 100) / 100);
const when = (s) => { const d = new Date(String(s || '').replace(' ', 'T') + 'Z'); return isNaN(d) ? '' : d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }); };

export const PracticalReview = {
    s: null,

    open: async (courseId) => {
        if (!courseId) return;
        UI.overlay({
            id: 'practicalReviewModal', label: 'Saved practical grades', z: 195, padClass: 'p-0',
            panelClass: 'sheet-panel page-full bg-white h-full overflow-y-auto p-4 sm:rounded-none',
            onClose: () => { PracticalReview.s = null; },
            html: `
            <div class="max-w-3xl mx-auto">
                <div class="flex items-center justify-between gap-3 mb-3">
                    <h3 class="text-lg font-black text-gray-900"><i class="fa-solid fa-list-check text-emerald-600 mr-2" aria-hidden="true"></i>Saved practical grades</h3>
                    <button type="button" data-overlay-close aria-label="Close" class="min-w-[44px] min-h-[44px] rounded-full text-gray-500 hover:bg-gray-100 text-xl"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                </div>
                <label for="prvActivity" class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Activity</label>
                <select id="prvActivity" class="w-full border border-gray-300 rounded-md px-3 py-2 text-base bg-white mb-3"><option>Loading...</option></select>
                <div id="prvError" role="alert" class="hidden bg-red-100 text-red-700 p-2 rounded text-sm font-medium mb-3"></div>
                <div id="prvList"></div>
            </div>`
        });
        PracticalReview.s = { courseId, grades: [] };
        PracticalReview.load();
    },

    load: async () => {
        const s = PracticalReview.s; if (!s) return;
        try {
            const r = await apiFetch(`/api/practical-grades?courseId=${encodeURIComponent(s.courseId)}`);
            if (PracticalReview.s !== s) return;
            s.grades = r.grades || [];
            const acts = [...new Set(s.grades.map(g => g.Activity))];   // newest first (the API sorts by update time)
            $('prvActivity').innerHTML = acts.length ? acts.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('') : '<option value="">No saved grades yet</option>';
            PracticalReview.paint();
        } catch (e) { const el = $('prvError'); if (el) { el.textContent = (e && e.message) || 'Could not load the grades.'; el.classList.remove('hidden'); } }
    },

    // Members of one group saved together share a card when their grade and criteria are identical.
    cards: (grades) => {
        const map = new Map();
        grades.forEach(g => {
            const k = g.Group_Name ? [g.Group_Name, g.Score, JSON.stringify(g.Criteria), g.Notes || ''].join('|') : 'solo|' + g.Student_ID;
            if (!map.has(k)) map.set(k, { title: g.Group_Name || '', rows: [] });
            map.get(k).rows.push(g);
        });
        return [...map.values()];
    },

    paint: () => {
        const s = PracticalReview.s, box = $('prvList'); if (!s || !box) return;
        const act = $('prvActivity').value, list = s.grades.filter(g => g.Activity === act);
        if (!list.length) { box.innerHTML = '<p class="text-sm text-gray-500">Nothing saved yet. Use Grade with timer in the Student Caller.</p>'; return; }
        const cards = PracticalReview.cards(list).sort((a, b) => (a.title || a.rows[0].Name || '').localeCompare(b.title || b.rows[0].Name || ''));
        const scored = list.filter(g => g.Score != null);
        const avg = scored.length ? num(scored.reduce((a, g) => a + Number(g.Score), 0) / scored.length) : '';
        const max = list[0].Max_Score;
        box.innerHTML = `<p class="text-sm text-gray-600 mb-3">${cards.length} card${cards.length === 1 ? '' : 's'}, ${list.length} student${list.length === 1 ? '' : 's'}${avg !== '' ? ` · average ${avg}${max ? ' / ' + num(max) : ''}` : ''}</p>` +
            cards.map(c => {
                const g = c.rows[0], parts = g.Criteria || [];
                const names = c.rows.map(r => escapeHtml(r.Name || r.Student_ID)).join(', ');
                const mx = g.Max_Score != null ? g.Max_Score : parts.reduce((a, p) => a + Number(p.max), 0);
                return `<article class="rounded-xl border border-gray-200 p-3 mb-3">
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0"><p class="font-black text-gray-900 break-words">${escapeHtml(c.title || g.Name || g.Student_ID)}</p>
                            ${c.title ? `<p class="text-sm text-gray-600 break-words">${names}</p>` : ''}</div>
                        <p class="shrink-0 text-right"><span class="text-2xl font-black text-emerald-600 tabular-nums">${g.Score == null ? '-' : num(g.Score)}</span>${mx ? `<span class="text-sm font-bold text-gray-500"> / ${num(mx)}</span>` : ''}</p>
                    </div>
                    ${parts.length ? `<ul class="mt-2 space-y-1.5">${parts.map(p => `<li><div class="flex justify-between text-sm"><span class="font-medium text-gray-700">${escapeHtml(p.name)}</span><span class="font-bold tabular-nums">${num(p.score)} / ${num(p.max)}</span></div>
                        <div class="h-1.5 rounded bg-gray-100 overflow-hidden"><div class="h-full bg-emerald-500" style="width:${Math.max(0, Math.min(100, Number(p.max) ? p.score / p.max * 100 : 0))}%"></div></div></li>`).join('')}</ul>` : ''}
                    ${g.Notes && !parts.length ? `<p class="mt-2 text-sm text-gray-700 whitespace-pre-wrap">${escapeHtml(g.Notes)}</p>` : (g.Notes && g.Notes.split('\n').slice(1).join('\n') ? `<p class="mt-2 text-sm text-gray-700 whitespace-pre-wrap">${escapeHtml(g.Notes.split('\n').slice(1).join('\n'))}</p>` : '')}
                    <p class="mt-2 text-xs text-gray-500">${escapeHtml(when(g.Updated_At))}${g.Timer_Seconds ? ` · time used ${fmt(g.Elapsed_Seconds || 0)} of ${fmt(g.Timer_Seconds)}` : ''}${g.Assessment_ID ? ' · copied to Record Scores' : ''}</p>
                </article>`;
            }).join('');
    },

    init: () => {
        document.addEventListener('click', (e) => {
            if (e.target.closest('#openPracticalReviewBtn, #gcReview')) PracticalReview.open(window.location.hash.replace('#class-', ''));
        });
        document.addEventListener('change', (e) => { if (e.target.id === 'prvActivity') PracticalReview.paint(); });
        // A grade was just saved: refresh the review if it is open.
        document.addEventListener('practical-saved', () => { if ($('practicalReviewModal')) PracticalReview.load(); });
    }
};
