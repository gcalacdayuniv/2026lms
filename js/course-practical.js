// js/course-practical.js
// Practical / major-term activity grading screen, opened from the Student Caller ("Grade") for a student or a whole group.
// A countdown timer set by the lecturer, grading criteria the lecturer can add to (each scored separately, total = the grade), and optionally a copy of the grade into an assessment (Record Scores).
// Saved through /api/practical-grade-save (worker/practicals.js). Lecturer-only; the criteria breakdown is saved in the notes and never shown to students.
import { apiFetch } from './globals.js';
import { UI } from './ui-feedback.js';
import { escapeHtml } from './html-utils.js';

const PRESETS = [5, 10, 15, 20, 30];
const FIELD = 'w-full border border-gray-300 rounded-md px-3 py-2 text-base focus:ring-2 focus:ring-blue-500 outline-none bg-white';
const LABEL = 'block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1';
let uid = 0;
const newId = () => `c${Date.now().toString(36)}${uid++}`;
const $ = (id) => document.getElementById(id);
const key = (courseId, k) => `practical_${k}_${courseId}`;
const DEFAULT_CRITERIA = [{ name: 'Content', max: 10 }, { name: 'Delivery', max: 10 }];
const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
};
export const fmt = (s) => { const a = Math.abs(Math.round(s)); return `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`; };

// A short beep (Web Audio) and a buzz when time is up. Browsers only allow sound after a tap, and Start is a tap.
const alarm = (long) => {
    try { navigator.vibrate && navigator.vibrate(long ? [300, 120, 300, 120, 500] : [120]); } catch (e) { /* no vibration */ }
    try {
        const ctx = PracticalGrade.audio || (PracticalGrade.audio = new (window.AudioContext || window.webkitAudioContext)());
        const beeps = long ? 3 : 1;
        for (let i = 0; i < beeps; i++) {
            const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * 0.35;
            o.frequency.value = long ? 880 : 660; o.connect(g); g.connect(ctx.destination);
            g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
            o.start(t); o.stop(t + 0.3);
        }
    } catch (e) { /* no sound */ }
};

export const PracticalGrade = {
    audio: null,
    s: null,   // state of the open screen

    // targets: [{ User_ID, Name }]; groupName/setId when a group was called.
    open: async ({ courseId, targets, groupName = '', setId = '' }) => {
        if (!courseId || !targets || !targets.length) return;
        PracticalGrade.close(true);
        const minutes = Number(store.get(key(courseId, 'minutes'))) || 10;
        PracticalGrade.s = {
            courseId, targets, groupName, setId, mode: targets.length > 1 ? 'group' : 'one',
            total: minutes * 60, startedAt: 0, pausedLeft: minutes * 60, running: false, fired: false, warned: false, tick: null, wake: null,
            assessments: [], criteria: PracticalGrade.loadCriteria(courseId)
        };
        const many = targets.length > 1;
        const who = many ? `${groupName ? escapeHtml(groupName) + ' · ' : ''}${targets.length} students` : escapeHtml(targets[0].Name);
        UI.overlay({
            id: 'practicalModal', label: 'Practical grading', z: 200, padClass: 'p-0',
            panelClass: 'sheet-panel page-full bg-white h-full overflow-y-auto p-4 sm:rounded-none',
            onClose: () => PracticalGrade.stop(),
            html: `
            <div class="max-w-3xl mx-auto">
                <div class="flex items-center justify-between gap-3 mb-3">
                    <div class="min-w-0">
                        <h3 class="text-lg font-black text-gray-900 truncate"><i class="fa-solid fa-clipboard-check text-emerald-600 mr-2" aria-hidden="true"></i>Practical grading</h3>
                        <p class="text-sm text-gray-600 truncate">${who}</p>
                    </div>
                    <button type="button" data-overlay-close aria-label="Close" class="min-w-[44px] min-h-[44px] rounded-full text-gray-500 hover:bg-gray-100 text-xl"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                </div>

                <section class="rounded-xl border border-gray-200 bg-gray-50 p-4 mb-4" aria-label="Timer">
                    <div id="pgClock" role="timer" aria-live="off" class="text-center font-black tabular-nums text-6xl sm:text-7xl text-emerald-600 leading-none py-2">${fmt(minutes * 60)}</div>
                    <p id="pgClockNote" class="text-center text-xs font-bold text-gray-500 min-h-[16px]"></p>
                    <div class="flex flex-wrap justify-center gap-2 mt-3" id="pgPresets">
                        ${PRESETS.map(m => `<button type="button" data-pg-min="${m}" class="min-h-[44px] min-w-[56px] px-3 rounded-md border text-sm font-bold ${m === minutes ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-700 border-gray-300'}">${m} min</button>`).join('')}
                        <label class="flex items-center gap-1 text-sm text-gray-600"><span class="sr-only">Custom minutes</span>
                            <input id="pgCustom" type="number" min="1" max="240" inputmode="numeric" placeholder="min" class="w-20 min-h-[44px] border border-gray-300 rounded-md px-2 text-base"></label>
                    </div>
                    <div class="flex justify-center gap-2 mt-3">
                        <button type="button" id="pgStart" class="min-h-[48px] px-6 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700"><i class="fa-solid fa-play mr-1" aria-hidden="true"></i>Start</button>
                        <button type="button" id="pgReset" class="min-h-[48px] px-4 rounded-lg bg-white border border-gray-300 text-gray-700 font-bold hover:bg-gray-100"><i class="fa-solid fa-rotate-left mr-1" aria-hidden="true"></i>Reset</button>
                    </div>
                </section>

                <div id="pgError" role="alert" class="hidden bg-red-100 text-red-700 p-2 rounded text-sm font-medium mb-3"></div>

                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                    <div class="sm:col-span-2"><label for="pgActivity" class="${LABEL}">Activity</label>
                        <input id="pgActivity" type="text" maxlength="80" placeholder="e.g. Practical 1" value="${escapeHtml(store.get(key(courseId, 'activity')) || '')}" class="${FIELD}"></div>
                    <div><label for="pgMax" class="${LABEL}">Highest score (total of criteria)</label>
                        <input id="pgMax" type="number" readonly class="${FIELD} bg-gray-100 font-black"></div>
                    <div class="sm:col-span-3"><label for="pgAssessment" class="${LABEL}">Also save the grade as a score in</label>
                        <select id="pgAssessment" class="${FIELD}"><option value="">Do not copy to Record Scores</option></select></div>
                </div>

                <section class="rounded-xl border border-gray-200 p-3 mb-4" aria-label="Grading criteria">
                    <div class="flex items-center justify-between mb-2"><h4 class="${LABEL} mb-0">Criteria</h4>
                        <button type="button" id="pgAddCrit" class="min-h-[44px] px-3 rounded-md bg-blue-50 text-blue-700 border border-blue-200 text-sm font-bold"><i class="fa-solid fa-plus mr-1" aria-hidden="true"></i>Add criterion</button></div>
                    <div id="pgCriteria"></div>
                </section>

                ${many ? `<div class="flex gap-2 mb-3" role="group" aria-label="How to grade">
                    <button type="button" data-pg-mode="group" class="pg-mode flex-1 min-h-[44px] rounded-md border text-sm font-bold">Grade as a group</button>
                    <button type="button" data-pg-mode="each" class="pg-mode flex-1 min-h-[44px] rounded-md border text-sm font-bold">Grade each member</button></div>` : ''}
                <div id="pgGrades"></div>

                <div class="sticky bottom-0 bg-white pt-3 pb-2 mt-4 border-t border-gray-200 flex gap-2">
                    <button type="button" data-overlay-close class="min-h-[48px] px-4 rounded-lg bg-gray-100 text-gray-700 font-bold hover:bg-gray-200">Close</button>
                    <button type="button" id="pgSave" class="flex-1 min-h-[48px] rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700"><i class="fa-solid fa-floppy-disk mr-1" aria-hidden="true"></i>Save grade</button>
                </div>
            </div>`
        });
        PracticalGrade.paintCriteria();
        PracticalGrade.paintMode();
        PracticalGrade.paintClock();
        PracticalGrade.loadAssessments();
    },

    close: (silent) => { const el = $('practicalModal'); if (el) UI.closeOverlay('practicalModal'); if (!silent) PracticalGrade.stop(); },
    stop: () => {
        const s = PracticalGrade.s; if (!s) return;
        clearInterval(s.tick); s.tick = null; s.running = false;
        try { s.wake && s.wake.release(); } catch (e) { /* not held */ }
        PracticalGrade.s = null;
    },

    loadAssessments: async () => {
        const s = PracticalGrade.s; if (!s) return;
        try {
            const r = await apiFetch(`/api/assessments?courseId=${encodeURIComponent(s.courseId)}`);
            s.assessments = r.assessments || [];
            const sel = $('pgAssessment'); if (!sel || PracticalGrade.s !== s) return;
            const last = store.get(key(s.courseId, 'assessment')) || '';
            sel.innerHTML = '<option value="">Do not copy to Record Scores</option>' + s.assessments.map(a =>
                `<option value="${escapeHtml(a.Assessment_ID)}" ${a.Assessment_ID === last ? 'selected' : ''}>${escapeHtml(a.Title || 'Untitled')} (${escapeHtml(String(a.Term || ''))}, ${a.Max_Score} pts)</option>`).join('');
        } catch (err) { /* the grade can still be saved without copying it */ }
    },

    // ---- timer: based on clock times, so a phone that sleeps for a moment does not lose time
    left: () => { const s = PracticalGrade.s; return s.running ? s.pausedLeft - (Date.now() - s.startedAt) / 1000 : s.pausedLeft; },
    elapsed: () => { const s = PracticalGrade.s; return Math.max(0, Math.round(s.total - PracticalGrade.left())); },
    paintClock: () => {
        const s = PracticalGrade.s, el = $('pgClock'); if (!s || !el) return;
        const left = PracticalGrade.left(), over = left < 0;
        el.textContent = (over ? '+' : '') + fmt(left);
        const warn = !over && (left <= 60 || left <= s.total * 0.2) && s.running;
        el.className = `text-center font-black tabular-nums text-6xl sm:text-7xl leading-none py-2 ${over ? 'text-red-600' : warn ? 'text-amber-500' : 'text-emerald-600'}`;
        const note = $('pgClockNote');
        if (note) note.textContent = over ? 'Time is up. Overtime is counted.' : s.running ? (warn ? 'Almost time' : 'Running') : (s.pausedLeft < s.total ? 'Paused' : '');
        const start = $('pgStart');
        if (start) start.innerHTML = s.running ? '<i class="fa-solid fa-pause mr-1" aria-hidden="true"></i>Pause' : `<i class="fa-solid fa-play mr-1" aria-hidden="true"></i>${s.pausedLeft < s.total ? 'Resume' : 'Start'}`;
        if (s.running) {
            if (!s.warned && left <= 60 && s.total > 120 && !over) { s.warned = true; alarm(false); }
            if (!s.fired && left <= 0) { s.fired = true; alarm(true); }
        }
    },
    toggle: async () => {
        const s = PracticalGrade.s; if (!s) return;
        if (s.running) { s.pausedLeft = PracticalGrade.left(); s.running = false; clearInterval(s.tick); s.tick = null; try { s.wake && s.wake.release(); } catch (e) { /* not held */ } }
        else {
            s.startedAt = Date.now(); s.running = true;
            s.tick = setInterval(PracticalGrade.paintClock, 250);
            try { if (navigator.wakeLock) s.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* the screen may sleep */ }
            if (PracticalGrade.audio && PracticalGrade.audio.state === 'suspended') PracticalGrade.audio.resume();
            else alarm(false);   // unlocks sound on iPhone (a tap is needed once)
        }
        PracticalGrade.paintClock();
    },
    setMinutes: (m) => {
        const s = PracticalGrade.s; if (!s || !(m > 0)) return;
        s.total = m * 60; s.pausedLeft = s.total; s.running = false; s.fired = false; s.warned = false; clearInterval(s.tick); s.tick = null;
        store.set(key(s.courseId, 'minutes'), String(m));
        document.querySelectorAll('#pgPresets [data-pg-min]').forEach(b => {
            const on = Number(b.dataset.pgMin) === m;
            b.classList.toggle('bg-emerald-600', on); b.classList.toggle('text-white', on); b.classList.toggle('border-emerald-600', on);
            b.classList.toggle('bg-white', !on); b.classList.toggle('text-gray-700', !on); b.classList.toggle('border-gray-300', !on);
        });
        PracticalGrade.paintClock();
    },
    reset: () => { const s = PracticalGrade.s; if (s) PracticalGrade.setMinutes(s.total / 60); },

    // ---- criteria (kept per class on this device; the lecturer can add, rename, change points or remove)
    loadCriteria: (courseId) => {
        try { const v = JSON.parse(store.get(key(courseId, 'criteria'))); if (Array.isArray(v) && v.length) return v.slice(0, 20).map(c => ({ id: newId(), name: String(c.name || '').slice(0, 60), max: Number(c.max) > 0 ? Number(c.max) : 10 })); } catch (e) { /* use the default */ }
        return DEFAULT_CRITERIA.map(c => ({ id: newId(), ...c }));
    },
    saveCriteria: () => { const s = PracticalGrade.s; if (s) store.set(key(s.courseId, 'criteria'), JSON.stringify(s.criteria.map(c => ({ name: c.name, max: c.max })))); },
    total: () => { const s = PracticalGrade.s; return s.criteria.reduce((a, c) => a + (Number(c.max) || 0), 0); },
    paintCriteria: () => {
        const s = PracticalGrade.s, box = $('pgCriteria'); if (!s || !box) return;
        box.innerHTML = s.criteria.map((c, i) => `
            <div class="flex items-end gap-2 mb-2">
                <div class="flex-1 min-w-0"><label class="sr-only" for="pgCn-${c.id}">Criterion ${i + 1} name</label>
                    <input id="pgCn-${c.id}" data-pg-cname="${c.id}" type="text" maxlength="60" placeholder="Criterion name" value="${escapeHtml(c.name)}" class="${FIELD}"></div>
                <div class="w-24"><label class="sr-only" for="pgCm-${c.id}">Points</label>
                    <input id="pgCm-${c.id}" data-pg-cmax="${c.id}" type="number" min="1" step="any" inputmode="decimal" value="${escapeHtml(String(c.max))}" class="${FIELD} text-center" aria-label="Points for ${escapeHtml(c.name || 'criterion')}"></div>
                <button type="button" data-pg-cdel="${c.id}" aria-label="Remove criterion ${escapeHtml(c.name || String(i + 1))}" class="min-w-[44px] min-h-[44px] rounded-md text-red-600 hover:bg-red-50"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
            </div>`).join('') || '<p class="text-sm text-gray-500">No criteria. Add one, or grade with a single total below.</p>';
        const max = $('pgMax'); if (max) max.value = s.criteria.length ? String(PracticalGrade.total()) : (store.get(key(s.courseId, 'max')) || '');
        if (max) max.readOnly = s.criteria.length > 0, max.classList.toggle('bg-gray-100', s.criteria.length > 0);
    },

    // ---- grades
    paintMode: () => {
        const s = PracticalGrade.s, box = $('pgGrades'); if (!s || !box) return;
        document.querySelectorAll('.pg-mode').forEach(b => {
            const on = b.dataset.pgMode === s.mode;
            b.classList.toggle('bg-blue-600', on); b.classList.toggle('text-white', on); b.classList.toggle('border-blue-600', on);
            b.classList.toggle('bg-white', !on); b.classList.toggle('text-gray-700', !on); b.classList.toggle('border-gray-300', !on);
            b.setAttribute('aria-pressed', String(on));
        });
        const keep = {};   // what was typed stays when switching or when a criterion is added
        box.querySelectorAll('[data-pg-score]').forEach(i => { keep[`s${i.dataset.pgScore}`] = i.value; });
        box.querySelectorAll('[data-pg-crit]').forEach(i => { keep[`c${i.dataset.pgCrit}`] = i.value; });
        box.querySelectorAll('[data-pg-note]').forEach(i => { keep[`n${i.dataset.pgNote}`] = i.value; });
        const useCrit = s.criteria.length > 0, showNotes = !s.groupName;   // no free notes in a group call: the criteria carry the feedback
        const one = (id, name) => `
            <div class="rounded-lg border border-gray-200 p-3 mb-3" data-pg-card="${escapeHtml(id)}">
                ${name ? `<p class="font-bold text-gray-800 mb-2">${escapeHtml(name)}</p>` : ''}
                ${useCrit ? `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">${s.criteria.map(c => `
                    <div><label class="${LABEL}" for="pgC-${escapeHtml(id)}-${c.id}">${escapeHtml(c.name || 'Criterion')} <span class="normal-case text-gray-400">/ ${escapeHtml(String(c.max))}</span></label>
                        <input id="pgC-${escapeHtml(id)}-${c.id}" data-pg-crit="${escapeHtml(id)}|${c.id}" type="number" min="0" max="${escapeHtml(String(c.max))}" step="any" inputmode="decimal" value="${escapeHtml(keep[`c${id}|${c.id}`] || '')}" class="${FIELD} text-xl font-black text-center"></div>`).join('')}</div>
                    <p class="mt-3 text-right text-sm font-bold text-gray-600">Total <span id="pgT-${escapeHtml(id)}" class="text-2xl font-black text-emerald-600 tabular-nums">0</span> / ${PracticalGrade.total()}</p>`
                : `<div><label class="${LABEL}" for="pgS-${escapeHtml(id)}">Grade</label>
                    <input id="pgS-${escapeHtml(id)}" data-pg-score="${escapeHtml(id)}" type="number" min="0" step="any" inputmode="decimal" value="${escapeHtml(keep[`s${id}`] || '')}" class="${FIELD} text-2xl font-black text-center"></div>`}
                ${showNotes ? `<div class="mt-3"><label class="${LABEL}" for="pgN-${escapeHtml(id)}">Notes</label>
                    <textarea id="pgN-${escapeHtml(id)}" data-pg-note="${escapeHtml(id)}" rows="2" maxlength="1500" placeholder="What went well, what to improve..." class="${FIELD}">${escapeHtml(keep[`n${id}`] || '')}</textarea></div>` : ''}
            </div>`;
        box.innerHTML = s.mode === 'each'
            ? s.targets.map(t => one(t.User_ID, t.Name)).join('')
            : one('*', s.mode === 'group' ? `${s.groupName || 'Group'} (all ${s.targets.length} members get this grade)` : '');
        s.targets.concat([{ User_ID: '*' }]).forEach(t => PracticalGrade.paintTotal(t.User_ID));
    },
    // Scores typed for one card: [{c, v}] for the criteria that have a number.
    cardScores: (id) => PracticalGrade.s.criteria.map(c => ({ c, v: (($(`pgC-${id}-${c.id}`) || {}).value) })),
    paintTotal: (id) => {
        const el = $(`pgT-${id}`); if (!el || !PracticalGrade.s) return;
        el.textContent = String(Math.round(PracticalGrade.cardScores(id).reduce((a, x) => a + (Number(x.v) || 0), 0) * 100) / 100);
    },

    save: async () => {
        const s = PracticalGrade.s; if (!s) return;
        const err = $('pgError'); err.classList.add('hidden');
        const fail = (m) => { err.textContent = m; err.classList.remove('hidden'); err.scrollIntoView({ block: 'nearest' }); };
        const activity = $('pgActivity').value.trim();
        if (!activity) { fail('Give the activity a name first (for example Practical 1).'); $('pgActivity').focus(); return; }
        if (s.criteria.some(c => !c.name.trim())) { fail('Give every criterion a name, or remove it.'); return; }
        const note = (id) => (($(`pgN-${id}`) || {}).value || '').trim();
        // One card gives { score, notes }; with criteria the score is the sum and the notes list each criterion.
        const grade = (id) => {
            if (!s.criteria.length) return { score: (($(`pgS-${id}`) || {}).value), notes: note(id) };
            const parts = PracticalGrade.cardScores(id);
            if (parts.every(x => x.v === '' || x.v == null)) return { score: '', notes: '' };
            const bad = parts.find(x => Number(x.v) < 0 || Number(x.v) > Number(x.c.max));
            if (bad) return { error: `${bad.c.name}: enter 0 to ${bad.c.max}.` };
            const total = Math.round(parts.reduce((a, x) => a + (Number(x.v) || 0), 0) * 100) / 100;
            const line = parts.map(x => `${x.c.name} ${Number(x.v) || 0}/${x.c.max}`).join('; ');
            return { score: total, notes: [line, note(id)].filter(Boolean).join('\n'), parts: parts.map(x => ({ name: x.c.name.trim(), max: Number(x.c.max), score: Number(x.v) || 0 })) };
        };
        const g = s.mode === 'each' ? null : grade('*');
        const per = s.mode === 'each' ? s.targets.map(t => grade(t.User_ID)) : null;
        const bad = (g && g.error) || (per && (per.find(x => x.error) || {}).error);
        if (bad) { fail(bad); return; }
        const entries = s.mode === 'each'
            ? s.targets.map((t, i) => ({ studentId: t.User_ID, score: per[i].score, notes: per[i].notes, parts: per[i].parts }))
            : s.targets.map(t => ({ studentId: t.User_ID, score: g.score, notes: g.notes, parts: g.parts }));
        if (!entries.some(e => e.score !== '' && e.score != null)) { fail('Enter a grade first.'); return; }
        const max = $('pgMax').value, assessmentId = $('pgAssessment').value;
        const btn = $('pgSave'); btn.disabled = true;
        try {
            const r = await apiFetch('/api/practical-grade-save', {
                method: 'POST',
                body: JSON.stringify({ courseId: s.courseId, activity, maxScore: max, timerSeconds: s.total, elapsedSeconds: PracticalGrade.elapsed(), setId: s.setId, groupName: s.groupName, assessmentId, entries })
            });
            store.set(key(s.courseId, 'activity'), activity); store.set(key(s.courseId, 'max'), max); store.set(key(s.courseId, 'assessment'), assessmentId);
            PracticalGrade.saveCriteria();
            UI.success(`Saved ${r.saved} grade${r.saved === 1 ? '' : 's'}${r.copied ? ` and copied ${r.copied} to Record Scores` : ''}.`);
            document.dispatchEvent(new CustomEvent('practical-saved', { detail: { courseId: s.courseId, copied: r.copied } }));
            PracticalGrade.close();
        } catch (e) { fail((e && e.message) || 'Could not save the grade.'); btn.disabled = false; }
    },

    init: () => {
        document.addEventListener('click', (e) => {
            const t = e.target;
            if (t.closest('#recitationGradeBtn')) { PracticalGrade.fromCaller(); return; }
            if (!$('practicalModal') || !$('practicalModal').contains(t)) return;
            const pre = t.closest('[data-pg-min]'); if (pre) { PracticalGrade.setMinutes(Number(pre.dataset.pgMin)); return; }
            if (t.closest('#pgStart')) { PracticalGrade.toggle(); return; }
            if (t.closest('#pgReset')) { PracticalGrade.reset(); return; }
            const m = t.closest('[data-pg-mode]'); if (m && PracticalGrade.s) { PracticalGrade.s.mode = m.dataset.pgMode; PracticalGrade.paintMode(); return; }
            const st = PracticalGrade.s;
            if (t.closest('#pgAddCrit') && st) {
                if (st.criteria.length >= 20) { UI.error('Up to 20 criteria.'); return; }
                st.criteria.push({ id: newId(), name: '', max: 10 }); PracticalGrade.paintCriteria(); PracticalGrade.paintMode();
                const last = st.criteria[st.criteria.length - 1]; const f = $(`pgCn-${last.id}`); if (f) f.focus(); return;
            }
            const del = t.closest('[data-pg-cdel]');
            if (del && st) { st.criteria = st.criteria.filter(c => c.id !== del.dataset.pgCdel); PracticalGrade.saveCriteria(); PracticalGrade.paintCriteria(); PracticalGrade.paintMode(); return; }
            if (t.closest('#pgSave')) PracticalGrade.save();
        });
        document.addEventListener('input', (e) => {
            const st = PracticalGrade.s; if (!st || !$('practicalModal') || !$('practicalModal').contains(e.target)) return;
            const d = e.target.dataset;
            if (d.pgCname) { const c = st.criteria.find(x => x.id === d.pgCname); if (c) c.name = e.target.value; }
            else if (d.pgCmax) { const c = st.criteria.find(x => x.id === d.pgCmax); if (c && Number(e.target.value) > 0) { c.max = Number(e.target.value); const m = $('pgMax'); if (m) m.value = String(PracticalGrade.total()); } }
            else if (d.pgCrit) PracticalGrade.paintTotal(d.pgCrit.split('|')[0]);
        });
        // Names/points changed: refresh the score boxes (labels and limits) once the field is left.
        document.addEventListener('change', (e) => {
            const st = PracticalGrade.s, d = e.target.dataset; if (!st) return;
            const id = d.pgCname || d.pgCmax; if (!id) return;
            const c = st.criteria.find(x => x.id === id); if (!c) return;
            PracticalGrade.saveCriteria();
            // Update the score boxes in place so a tap on one of them is not lost to a redraw.
            document.querySelectorAll(`[data-pg-crit$="|${id}"]`).forEach(inp => {
                inp.max = String(c.max);
                const lab = inp.previousElementSibling; if (lab) lab.innerHTML = `${escapeHtml(c.name || 'Criterion')} <span class="normal-case text-gray-400">/ ${escapeHtml(String(c.max))}</span>`;
            });
            document.querySelectorAll('[data-pg-card]').forEach(card => { const t = card.querySelector('p span[id^="pgT-"]'); if (t && t.parentElement) t.parentElement.lastChild.textContent = ` / ${PracticalGrade.total()}`; });
        });
        document.addEventListener('change', (e) => {
            if (e.target.id === 'pgCustom') { const v = Number(e.target.value); if (v >= 1 && v <= 240) PracticalGrade.setMinutes(v); }
            if (e.target.id === 'pgAssessment' && PracticalGrade.s) {
                const a = PracticalGrade.s.assessments.find(x => x.Assessment_ID === e.target.value);
                if (a && !$('pgMax').value) $('pgMax').value = a.Max_Score;
                if (a && !$('pgActivity').value.trim()) $('pgActivity').value = a.Title || '';
            }
        });
        // Coming back to the app: show the true time at once.
        document.addEventListener('visibilitychange', () => { if (PracticalGrade.s && document.visibilityState === 'visible') PracticalGrade.paintClock(); });
    },

    // The student the caller just called (the group caller sets its own targets).
    fromCaller: async () => {
        const { CourseRecitation } = await import('./course-recitation.js');
        const courseId = window.location.hash.replace('#class-', '');
        if (CourseRecitation.calledGroup) { PracticalGrade.open({ courseId, ...CourseRecitation.calledGroup }); return; }
        const st = CourseRecitation.students.find(x => x.User_ID === CourseRecitation.currentSelectedStudentId);
        if (!st) { UI.error('Call a student first.'); return; }
        PracticalGrade.open({ courseId, targets: [{ User_ID: st.User_ID, Name: st.Name }] });
    }
};
