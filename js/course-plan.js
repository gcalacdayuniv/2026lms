// js/course-plan.js
// Lecturer: the class's syllabus file and course learning plan, and linking plan topics to calendar days.
//  - Course Actions > Course Plan opens a full-screen page: syllabus (attach / view / remove) and the plan topics
//    (time allotment, contents, essential questions, learning outcomes, activities, assessment tasks, references).
//  - On the attendance screen, "Topics for this day" links 0, 1 or several topics to the chosen date; a topic can be taught on several days.
import { apiFetch } from './globals.js';
import { UI } from './ui-feedback.js';
import { escapeHtml as esc } from './html-utils.js';

const $ = (id) => document.getElementById(id);
const post = (path, body) => apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
const courseIdNow = () => window.location.hash.replace('#class-', '');
const first = (text) => String(text || '').split('\n').map(s => s.trim()).find(Boolean) || '';
const niceDate = (d) => { const t = new Date(`${d}T00:00:00`); return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
const FILE_TYPES = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

const toBase64 = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
});

const FIELD_DEFS = [
    ['time', 'Time allotment', 'Week 3 & 4 / 3 hours', 1],
    ['contents', 'Course contents', 'One topic per line', 4],
    ['questions', 'Essential question/s', '', 3],
    ['outcomes', 'Intended learning outcomes (ILOs)', 'One per line', 3],
    ['activities', 'Suggested teaching-learning activities', 'Interactive discussion, brainstorming...', 2],
    ['assessments', 'Suggested assessment tasks', 'Quiz, seatwork...', 2],
    ['refs', 'References / teaching-learning materials', '', 3]
];

export const CoursePlan = {
    courseId: '',
    data: { syllabus: null, topics: [], sameCode: [] },
    day: { date: '', ids: [] },
    token: 0,

    load: async (courseId) => {
        CoursePlan.courseId = courseId;
        const mine = ++CoursePlan.token;
        const r = await apiFetch(`/api/course-plan?courseId=${encodeURIComponent(courseId)}&_t=${Date.now()}`);
        if (mine !== CoursePlan.token) return false;
        CoursePlan.data = { syllabus: r.syllabus || null, topics: r.topics || [], sameCode: r.sameCode || [] };
        return true;
    },

    // ---- the Course Plan page
    ensurePage: () => {
        if ($('coursePlanModal')) return;
        const el = document.createElement('div');
        el.id = 'coursePlanModal';
        el.className = 'hidden fixed inset-0 z-[70] flex items-center justify-center fade-in p-0 sm:p-4';
        el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'coursePlanTitle');
        el.innerHTML = `<div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeCoursePlanBg"></div>
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full sm:max-w-2xl h-full sm:h-auto p-4 sm:p-6 relative z-10 sheet-panel app-page max-h-full sm:max-h-[92vh] flex flex-col">
                <div class="flex items-center gap-3 mb-3 border-b pb-3 app-page-header">
                    <h3 id="coursePlanTitle" class="flex-1 min-w-0 text-lg font-bold text-gray-800"><i class="fa-solid fa-book-open text-emerald-600 mr-2" aria-hidden="true"></i>Course plan</h3>
                    <button id="closeCoursePlanBtn" type="button" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-500 sm:text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden" aria-hidden="true"></i><i class="fa-solid fa-xmark text-xl hidden sm:inline" aria-hidden="true"></i>
                    </button>
                </div>
                <div id="coursePlanBody" class="flex-1 overflow-y-auto min-h-0"></div>
            </div>`;
        document.body.appendChild(el);
    },

    open: async () => {
        CoursePlan.ensurePage();
        $('coursePlanModal').classList.remove('hidden');
        $('coursePlanBody').innerHTML = '<p class="text-sm text-gray-400 italic py-4">Loading...</p>';
        try { await CoursePlan.load(courseIdNow()); CoursePlan.paint(); }
        catch (err) { $('coursePlanBody').innerHTML = `<p class="text-sm text-red-600 font-bold py-4">${esc(err.message || 'Could not load the plan.')}</p>`; }
    },

    close: () => { $('coursePlanModal')?.classList.add('hidden'); CoursePlan.closeForm(); PlanDay.paint(); },

    paint: () => {
        const body = $('coursePlanBody');
        if (!body) return;
        const { syllabus, topics } = CoursePlan.data;
        const btn = 'min-h-[44px] px-3 rounded-md border text-sm font-bold';
        const syl = `<section class="mb-5 p-3 rounded-lg border border-emerald-200 bg-emerald-50">
            <h4 class="text-xs font-bold uppercase tracking-wide text-emerald-800 mb-1"><i class="fa-solid fa-file-lines mr-1" aria-hidden="true"></i>Syllabus</h4>
            ${syllabus ? `<p class="text-sm font-bold text-gray-800 break-words">${esc(syllabus.name)}</p><p class="text-[11px] text-gray-500 mb-2">Attached ${esc(String(syllabus.updatedAt || '').slice(0, 10))}</p>` : '<p class="text-sm text-gray-600 mb-2">No syllabus attached to this class yet (PDF, Word or picture, up to 4 MB).</p>'}
            <div class="flex flex-wrap gap-2">
                <button type="button" id="cpSylAttach" class="${btn} border-emerald-600 bg-emerald-600 text-white"><i class="fa-solid fa-paperclip mr-1" aria-hidden="true"></i>${syllabus ? 'Replace file' : 'Attach syllabus'}</button>
                ${syllabus ? `<button type="button" id="cpSylView" class="${btn} border-emerald-300 bg-white text-emerald-700"><i class="fa-regular fa-eye mr-1" aria-hidden="true"></i>View</button><button type="button" id="cpSylRemove" class="${btn} border-red-300 bg-white text-red-700">Remove</button>` : ''}
                <input type="file" id="cpSylFile" accept=".pdf,.docx,image/png,image/jpeg,application/pdf" class="hidden">
            </div></section>`;
        const mineHas = !!syllabus || topics.length > 0;
        const sameCode = CoursePlan.data.sameCode;
        const share = sameCode.length ? `<section class="mb-5 p-3 rounded-lg border border-indigo-200 bg-indigo-50">
            <h4 class="text-xs font-bold uppercase tracking-wide text-indigo-800 mb-1"><i class="fa-solid fa-copy mr-1" aria-hidden="true"></i>Same course code</h4>
            <p class="text-[11px] text-gray-600 mb-2">Use one syllabus and plan for your other classes of this course. Topics are copied only into a class that has none yet; calendar links are not copied.</p>
            ${sameCode.map(o => `<div class="flex items-center gap-2 py-1 border-t border-indigo-100" data-other="${esc(o.courseId)}">
                <div class="flex-1 min-w-0"><p class="text-sm font-bold text-gray-800 truncate">${esc(o.title || 'Class')}</p><p class="text-[11px] text-gray-500 truncate">${esc([o.day, o.time].filter(Boolean).join(' ') || 'No schedule')} · ${o.hasSyllabus ? 'syllabus' : 'no syllabus'} · ${o.topics} topic${o.topics === 1 ? '' : 's'}</p></div>
                <button type="button" class="cp-get ${btn} border-indigo-300 bg-white text-indigo-700 disabled:opacity-40" ${o.hasSyllabus || o.topics ? '' : 'disabled'}>Use theirs</button>
                <button type="button" class="cp-send ${btn} border-indigo-600 bg-indigo-600 text-white disabled:opacity-40" ${mineHas ? '' : 'disabled'}>Send mine</button></div>`).join('')}</section>` : '';
        const card = (t, i) => `<article class="mb-3 p-3 rounded-lg border border-gray-200 bg-white" data-topic="${esc(t.topicId)}">
            <div class="flex items-start gap-2">
                <div class="flex-1 min-w-0">
                    <p class="text-[11px] font-black uppercase tracking-wide text-emerald-700">${esc(t.time || 'No time allotment')}</p>
                    <p class="text-sm font-bold text-gray-800 whitespace-pre-line break-words">${esc(t.contents || '(no contents)')}</p>
                </div>
                <div class="flex shrink-0">
                    <button type="button" class="cp-move w-11 h-11 text-gray-500 disabled:opacity-30" data-dir="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-up" aria-hidden="true"></i></button>
                    <button type="button" class="cp-move w-11 h-11 text-gray-500 disabled:opacity-30" data-dir="1" aria-label="Move down" ${i === topics.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button>
                </div>
            </div>
            ${t.dates.length ? `<p class="mt-1 text-[11px] text-indigo-700 font-bold"><i class="fa-regular fa-calendar-check mr-1" aria-hidden="true"></i>Taught: ${t.dates.map(d => esc(niceDate(d))).join(', ')}</p>` : '<p class="mt-1 text-[11px] text-gray-400">Not linked to a date yet</p>'}
            ${FIELD_DEFS.slice(2).some(([k]) => t[k]) ? `<details class="mt-1"><summary class="text-xs font-bold text-gray-500 cursor-pointer min-h-[32px] flex items-center">Details</summary>
                ${FIELD_DEFS.slice(2).filter(([k]) => t[k]).map(([k, label]) => `<p class="mt-1 text-[11px] font-bold text-gray-500 uppercase">${esc(label)}</p><p class="text-sm text-gray-700 whitespace-pre-line break-words">${esc(t[k])}</p>`).join('')}</details>` : ''}
            <div class="flex gap-2 mt-2">
                <button type="button" class="cp-edit ${btn} border-gray-300 bg-white text-gray-700"><i class="fa-solid fa-pen mr-1" aria-hidden="true"></i>Edit</button>
                <button type="button" class="cp-del ${btn} border-red-300 bg-white text-red-700"><i class="fa-regular fa-trash-can mr-1" aria-hidden="true"></i>Delete</button>
            </div></article>`;
        body.innerHTML = `${syl}${share}
            <div class="flex items-center gap-2 mb-2">
                <h4 class="flex-1 text-sm font-bold text-gray-800">Course learning plan <span class="text-gray-400 font-medium">(${topics.length})</span></h4>
                <button type="button" id="cpQuick" class="${btn} border-emerald-300 bg-white text-emerald-700">Quick add</button>
                <button type="button" id="cpAdd" class="${btn} border-emerald-600 bg-emerald-600 text-white"><i class="fa-solid fa-plus mr-1" aria-hidden="true"></i>Topic</button>
            </div>
            ${topics.length ? topics.map(card).join('') : '<p class="text-sm text-gray-500 py-6 text-center">No topics yet. Add one at a time, or use Quick add to paste the weeks of your syllabus.</p>'}`;
    },

    // ---- topic form / quick add (own overlay above the page)
    closeForm: () => { $('cpForm')?.remove(); },

    shell: (title, inner) => {
        CoursePlan.closeForm();
        const m = document.createElement('div');
        m.id = 'cpForm';
        m.className = 'fixed inset-0 z-[150] flex items-center justify-center fade-in p-0 sm:p-4';
        m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', title);
        m.innerHTML = `<div class="absolute inset-0 bg-gray-900 bg-opacity-60" id="cpFormBg"></div>
            <div class="relative z-10 bg-white w-full sm:max-w-xl h-full sm:h-auto sm:max-h-[92vh] rounded-none sm:rounded-lg shadow-xl p-4 flex flex-col" style="padding-top:max(1rem, env(safe-area-inset-top))">
                <div class="shrink-0 flex items-center gap-3 mb-3 border-b pb-3"><h3 class="flex-1 text-lg font-bold text-gray-800">${esc(title)}</h3><button type="button" id="cpFormClose" class="p-2 text-gray-500" aria-label="Close"><i class="fa-solid fa-xmark text-xl" aria-hidden="true"></i></button></div>
                <div class="flex-1 overflow-y-auto min-h-0">${inner}</div></div>`;
        document.body.appendChild(m);
        return m;
    },

    topicForm: (topic) => {
        const field = ([key, label, hint, rows]) => `<label class="block mb-3 text-xs font-bold text-gray-600">${esc(label)}
            <textarea data-f="${key}" rows="${rows}" placeholder="${esc(hint)}" style="font-size:16px" class="mt-1 w-full px-3 py-2 text-base font-normal border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-400 focus:outline-none">${esc(topic ? topic[key] : '')}</textarea></label>`;
        const m = CoursePlan.shell(topic ? 'Edit topic' : 'Add topic', `${FIELD_DEFS.map(field).join('')}
            <button type="button" id="cpSave" data-id="${esc(topic ? topic.topicId : '')}" class="w-full min-h-[48px] rounded-md bg-emerald-600 text-white font-bold mb-2">Save topic</button>`);
        m.querySelector('textarea').focus();
    },

    quickForm: () => {
        CoursePlan.shell('Quick add topics', `<p class="text-sm text-gray-600 mb-2">One topic per line. Type the time allotment, then <b>|</b>, then the contents. Example:</p>
            <pre class="text-xs bg-gray-50 border rounded p-2 mb-3 whitespace-pre-wrap">Week 1 | Walk through the syllabus and class policies
Week 2 | Introduction to Capital Markets
Weeks 11-12 | Swaps, Caps and Floors Markets</pre>
            <textarea id="cpQuickText" rows="10" style="font-size:16px" class="w-full px-3 py-2 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-400 focus:outline-none" placeholder="Week 1 | ..."></textarea>
            <button type="button" id="cpQuickSave" class="w-full min-h-[48px] rounded-md bg-emerald-600 text-white font-bold mt-3">Add topics</button>`);
        $('cpQuickText').focus();
    },

    saveTopic: async (id) => {
        const body = { courseId: CoursePlan.courseId, topicId: id || undefined };
        document.querySelectorAll('#cpForm [data-f]').forEach(el => { body[el.dataset.f] = el.value; });
        try { await post('/api/plan-topic', body); CoursePlan.closeForm(); await CoursePlan.load(CoursePlan.courseId); CoursePlan.paint(); UI.success('Topic saved.'); }
        catch (err) { UI.error(err.message || 'Could not save the topic.'); }
    },

    quickSave: async () => {
        const lines = ($('cpQuickText')?.value || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
            const i = l.indexOf('|');
            return i < 0 ? { time: '', contents: l } : { time: l.slice(0, i).trim(), contents: l.slice(i + 1).trim() };
        });
        if (!lines.length) { UI.error('Type at least one line.'); return; }
        try { const r = await post('/api/plan-quick-add', { courseId: CoursePlan.courseId, lines }); CoursePlan.closeForm(); await CoursePlan.load(CoursePlan.courseId); CoursePlan.paint(); UI.success(`${r.added} topics added.`); }
        catch (err) { UI.error(err.message || 'Could not add the topics.'); }
    },

    attach: async (file) => {
        if (!file) return;
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const mimeType = FILE_TYPES[ext];
        if (!mimeType) { UI.error('Attach a PDF, Word (.docx) or picture file.'); return; }
        if (file.size > 4 * 1024 * 1024) { UI.error('The file is larger than 4 MB. Compress it first.'); return; }
        const b = $('cpSylAttach'); if (b) { b.disabled = true; b.textContent = 'Uploading...'; }
        try {
            await post('/api/course-syllabus', { courseId: CoursePlan.courseId, base64: await toBase64(file), fileName: file.name, mimeType });
            await CoursePlan.load(CoursePlan.courseId); UI.success('Syllabus attached.');
        } catch (err) { UI.error(err.message || 'Could not attach the file.'); }
        CoursePlan.paint();
    },

    viewSyllabus: async () => {
        try {
            const r = await apiFetch(`/api/course-syllabus?courseId=${encodeURIComponent(CoursePlan.courseId)}&_t=${Date.now()}`);
            const bytes = Uint8Array.from(atob(r.base64), c => c.charCodeAt(0));
            const url = URL.createObjectURL(new Blob([bytes], { type: r.mimeType }));
            if (r.mimeType === 'application/pdf' || r.mimeType.startsWith('image/')) { if (!window.open(url, '_blank')) UI.info('Your browser blocked the new tab. Allow pop-ups and try again.'); }
            else { const a = document.createElement('a'); a.href = url; a.download = r.name || 'syllabus'; document.body.appendChild(a); a.click(); a.remove(); }
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (err) { UI.error(err.message || 'Could not open the syllabus.'); }
    }
};

// ---- Topics for the day selected on the attendance screen
export const PlanDay = {
    date: '',
    ids: [],
    token: 0,

    load: async (courseId, date) => {
        PlanDay.date = date;
        const mine = ++PlanDay.token;
        try { await CoursePlan.load(courseId); } catch (e) { /* the bar still shows */ }
        if (mine !== PlanDay.token) return;
        PlanDay.ids = CoursePlan.data.topics.filter(t => t.dates.includes(date)).map(t => t.topicId);
        PlanDay.paint();
    },

    paint: () => {
        const box = $('planDayBar');
        if (!box) return;
        const topics = CoursePlan.data.topics;
        const chosen = topics.filter(t => t.dates.includes(PlanDay.date));
        box.innerHTML = `<div class="flex flex-wrap items-center gap-2">
            <span class="text-xs font-bold uppercase tracking-wide text-gray-500">Topics today</span>
            ${chosen.length ? chosen.map(t => `<span class="px-2 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold max-w-[16rem] truncate" title="${esc(t.contents)}">${esc(t.time ? t.time + ': ' : '')}${esc(first(t.contents) || 'Topic')}</span>`).join('') : '<span class="text-xs text-gray-400">none (activity, quiz or exam day)</span>'}
            <button type="button" id="pdLink" class="min-h-[44px] px-3 rounded-md border border-emerald-300 bg-white text-emerald-700 text-sm font-bold"><i class="fa-solid fa-link mr-1" aria-hidden="true"></i>${topics.length ? 'Link topics' : 'Set up plan'}</button>
        </div>`;
    },

    picker: () => {
        const topics = CoursePlan.data.topics;
        if (!topics.length) { CoursePlan.open(); return; }
        const sel = new Set(topics.filter(t => t.dates.includes(PlanDay.date)).map(t => t.topicId));
        const row = (t) => {
            const others = t.dates.filter(d => d !== PlanDay.date);
            return `<label class="flex items-start gap-3 p-2 border-b border-gray-100 min-h-[48px]"><input type="checkbox" class="pd-check mt-1 w-5 h-5" value="${esc(t.topicId)}" ${sel.has(t.topicId) ? 'checked' : ''}>
                <span class="min-w-0"><span class="block text-[11px] font-black uppercase text-emerald-700">${esc(t.time || '')}</span><span class="block text-sm font-bold text-gray-800 break-words">${esc(first(t.contents) || '(no contents)')}</span>${others.length ? `<span class="block text-[11px] text-gray-400">Also taught: ${others.map(d => esc(niceDate(d))).join(', ')}</span>` : ''}</span></label>`;
        };
        CoursePlan.shell(`Topics for ${niceDate(PlanDay.date)}`, `<p class="text-xs text-gray-500 mb-2">Tick none for a day with only activities, quizzes or exams. Tick several if the day covers more than one topic.</p>${topics.map(row).join('')}
            <button type="button" id="pdSave" class="w-full min-h-[48px] rounded-md bg-emerald-600 text-white font-bold mt-3">Save</button>`);
    },

    save: async () => {
        const ids = [...document.querySelectorAll('#cpForm .pd-check:checked')].map(c => c.value);
        try {
            await post('/api/plan-day', { courseId: courseIdNow(), date: PlanDay.date, topicIds: ids });
            CoursePlan.closeForm();
            await PlanDay.load(courseIdNow(), PlanDay.date);
            UI.success('Topics saved for this day.');
        } catch (err) { UI.error(err.message || 'Could not save.'); }
    }
};

export const initCoursePlan = () => {
    if (CoursePlan.bound) return;
    CoursePlan.bound = true;
    document.addEventListener('click', async (e) => {
        const t = e.target;
        if (!t.closest) return;
        if (t.closest('#openCoursePlanBtn')) { $('courseMenuModal')?.classList.add('hidden'); CoursePlan.open(); return; }
        if (t.closest('#closeCoursePlanBtn') || t.id === 'closeCoursePlanBg') { CoursePlan.close(); return; }
        if (t.closest('#cpFormClose') || t.id === 'cpFormBg') { CoursePlan.closeForm(); return; }
        if (t.closest('#pdLink')) { PlanDay.picker(); return; }
        if (t.closest('#pdSave')) { await PlanDay.save(); return; }
        if (!$('coursePlanModal') || $('coursePlanModal').classList.contains('hidden')) return;
        if (t.closest('#cpAdd')) { CoursePlan.topicForm(null); return; }
        if (t.closest('#cpQuick')) { CoursePlan.quickForm(); return; }
        if (t.closest('#cpQuickSave')) { await CoursePlan.quickSave(); return; }
        if (t.closest('#cpSave')) { await CoursePlan.saveTopic(t.closest('#cpSave').dataset.id); return; }
        if (t.closest('#cpSylAttach')) { $('cpSylFile')?.click(); return; }
        if (t.closest('#cpSylView')) { await CoursePlan.viewSyllabus(); return; }
        if (t.closest('#cpSylRemove')) {
            if (!(await UI.confirm({ title: 'Remove the syllabus?', message: 'It is unlinked from this class. The topics stay.', confirmText: 'Remove' }))) return;
            try { await post('/api/course-syllabus-delete', { courseId: CoursePlan.courseId }); await CoursePlan.load(CoursePlan.courseId); CoursePlan.paint(); } catch (err) { UI.error(err.message); }
            return;
        }
        const other = t.closest('[data-other]');
        if (other && (t.closest('.cp-get') || t.closest('.cp-send'))) {
            const get = !!t.closest('.cp-get');
            const row = CoursePlan.data.sameCode.find(o => o.courseId === other.dataset.other);
            const name = (row && row.title) || 'that class';
            const msg = get ? `Copy the syllabus${row && row.topics ? ' and plan' : ''} of ${name} into this class? ${CoursePlan.data.topics.length && row && row.topics ? 'This class already has topics, so its plan is kept.' : ''}` : `Copy this class's syllabus${CoursePlan.data.topics.length ? ' and plan' : ''} into ${name}? ${row && row.topics ? 'It already has topics, so its plan is kept.' : ''}`;
            if (!(await UI.confirm({ title: get ? 'Use their syllabus?' : 'Send to that class?', message: msg.trim(), confirmText: 'Copy' }))) return;
            try {
                const r = await post('/api/plan-copy', get ? { courseId: other.dataset.other, toCourseIds: [CoursePlan.courseId] } : { courseId: CoursePlan.courseId, toCourseIds: [other.dataset.other] });
                await CoursePlan.load(CoursePlan.courseId); CoursePlan.paint();
                UI.success(`Copied${r.syllabusCopied ? ' syllabus' : ''}${r.planCopied ? (r.syllabusCopied ? ' and plan' : ' plan') : ''}${r.planSkipped ? ' (plan kept: the class already has topics)' : ''}.`);
            } catch (err) { UI.error(err.message || 'Could not copy.'); }
            return;
        }
        const card = t.closest('article[data-topic]');
        if (!card) return;
        const topic = CoursePlan.data.topics.find(x => x.topicId === card.dataset.topic);
        if (t.closest('.cp-edit')) { CoursePlan.topicForm(topic); return; }
        if (t.closest('.cp-del')) {
            if (!(await UI.confirm({ title: 'Delete this topic?', message: 'Its links to calendar days are removed too.', confirmText: 'Delete' }))) return;
            try { await post('/api/plan-topic-delete', { courseId: CoursePlan.courseId, topicId: card.dataset.topic }); await CoursePlan.load(CoursePlan.courseId); CoursePlan.paint(); } catch (err) { UI.error(err.message); }
            return;
        }
        const mv = t.closest('.cp-move');
        if (mv) {
            try { await post('/api/plan-topic-move', { courseId: CoursePlan.courseId, topicId: card.dataset.topic, dir: Number(mv.dataset.dir) }); await CoursePlan.load(CoursePlan.courseId); CoursePlan.paint(); } catch (err) { UI.error(err.message); }
        }
    });
    document.addEventListener('change', (e) => {
        if (e.target && e.target.id === 'cpSylFile') { const f = e.target.files && e.target.files[0]; e.target.value = ''; CoursePlan.attach(f); }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if ($('cpForm')) CoursePlan.closeForm(); else if ($('coursePlanModal') && !$('coursePlanModal').classList.contains('hidden')) CoursePlan.close();
    });
};
initCoursePlan();
