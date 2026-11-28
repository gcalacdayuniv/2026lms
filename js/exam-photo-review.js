// js/exam-photo-review.js
// Admin: review the photos taken during online exams, by exam (grouped by student) or by student (grouped by exam).
// A lecturer only gets the initial face verification photo (no gallery); the server decides (res.limited).
//  - By exam: Manage Exams > Results > Photos.   By student: Manage Student > Exam photos.   Every class: Admin tools > Exam Photos (admins only).
//  - Pictures are fetched from Drive one at a time (3 at most in parallel) and only for the group that is open.
//  - Tap a picture to enlarge it; Previous / Next (or the arrow keys) move through every photo in the list.
//  - Admin only: Select turns on tick marks (tap pictures, Select all, or a whole student/exam), then Delete removes them from Drive and the list.
import { apiFetch, apiPost, AppState } from './globals.js';
import { UI } from './ui-feedback.js';
import { escapeHtml as esc } from './html-utils.js';

const $ = (id) => document.getElementById(id);
const PARALLEL = 3;
const FIRST_PAGE = 10;   // pictures loaded when the gallery opens
const NEXT_PAGE = 5;     // pictures added by each "Load more"
const LONG_PRESS = 280;  // ms of holding a picture before a finger drag starts selecting
const fmtTime = (iso, withDate) => {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const opt = { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit' };
    if (withDate) Object.assign(opt, { month: 'short', day: 'numeric' });
    return d.toLocaleString('en-PH', opt);
};

const opts_name = (all) => (all[0] && all[0].Name) || '';

export const ExamPhotoReview = {
    cache: new Map(),      // photoId -> data: URL
    photos: [],            // every photo in display order
    index: 0,
    queue: [],
    running: 0,
    mode: 'exam',
    ctx: null,             // { all, byStudent, focusId } of the gallery on screen (Admin gallery only)
    selecting: false,
    selected: new Set(),   // Photo_IDs ticked
    changed: false,        // something was deleted: the Admin lists behind refresh when this closes
    budget: FIRST_PAGE,    // how many more pictures may be fetched now: 10 at first, +5 for each "Load more"
    paint: null,           // drag-select in progress: { mode: 'add' | 'remove', last, timer, pointerId }
    swallowClickUntil: 0,

    // opts: { classExamId, focusStudentId? } for one exam, or { courseId, studentId, name } for one student.
    open: async (opts) => {
        ExamPhotoReview.close();
        ExamPhotoReview.cache.clear();
        ExamPhotoReview.queue = []; ExamPhotoReview.running = 0;
        ExamPhotoReview.budget = FIRST_PAGE; ExamPhotoReview.paint = null;
        ExamPhotoReview.ctx = null; ExamPhotoReview.selecting = false; ExamPhotoReview.selected = new Set(); ExamPhotoReview.changed = false;
        const byStudent = !!opts.studentId && !!opts.courseId;
        ExamPhotoReview.mode = byStudent ? 'student' : 'exam';
        const dlg = document.createElement('div');
        dlg.id = 'examPhotosDlg';
        dlg.className = 'fixed inset-0 z-[120] flex items-start sm:items-center justify-center fade-in';
        dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-label', 'Exam photos');
        dlg.innerHTML = `<div class="absolute inset-0 bg-gray-900 bg-opacity-60" data-ep-close></div>
            <div class="relative z-10 bg-white w-full sm:max-w-2xl h-full sm:h-auto sm:max-h-[90vh] sm:rounded-lg shadow-xl p-4 flex flex-col" style="padding-top:max(1rem, env(safe-area-inset-top))">
                <div class="shrink-0 flex items-center gap-3 mb-3 border-b pb-3">
                    <div class="min-w-0 flex-1"><h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-camera text-blue-600 mr-2" aria-hidden="true"></i>Exam photos</h3>
                        <p id="epSub" class="text-xs text-gray-500 truncate">${byStudent ? esc(opts.name || '') + ' &middot; all exams in this class' : 'By student &middot; taken at the start and every 30 seconds'}</p></div>
                    <button type="button" data-ep-close class="p-2 text-gray-500 hover:text-gray-800" aria-label="Close"><i class="fa-solid fa-xmark text-xl" aria-hidden="true"></i></button>
                </div>
                <div id="epBody" class="flex-1 min-h-0 overflow-y-auto"><p class="text-sm text-gray-500">Loading...</p></div>
                <div id="epSelBar" class="hidden shrink-0 border-t border-gray-200 pt-3 mt-3 flex items-center gap-2" style="padding-bottom:max(0rem, env(safe-area-inset-bottom))">
                    <span id="epSelCount" class="flex-1 text-sm font-bold text-gray-800" role="status">0 selected</span>
                    <button type="button" data-ep-select-all class="min-h-[44px] px-3 rounded-md border border-gray-300 text-sm font-bold text-gray-700">Select shown</button>
                    <button type="button" id="epDeleteBtn" data-ep-delete disabled class="min-h-[44px] px-4 rounded-md bg-red-600 text-white text-sm font-bold disabled:opacity-40"><i class="fa-solid fa-trash mr-1" aria-hidden="true"></i>Delete</button>
                </div>
            </div>`;
        document.body.appendChild(dlg);
        dlg.addEventListener('click', ExamPhotoReview.onClick);
        dlg.addEventListener('pointerdown', ExamPhotoReview.onDown);
        dlg.addEventListener('pointermove', ExamPhotoReview.onMove);
        dlg.addEventListener('pointerup', ExamPhotoReview.onUp);
        dlg.addEventListener('pointercancel', ExamPhotoReview.onUp);
        dlg.addEventListener('touchmove', (ev) => { if (ExamPhotoReview.paint && ExamPhotoReview.paint.on) ev.preventDefault(); }, { passive: false });   // a drag that is selecting must not scroll the page
        const body = dlg.querySelector('#epBody');
        try {
            const q = byStudent ? `courseId=${encodeURIComponent(opts.courseId)}&studentId=${encodeURIComponent(opts.studentId)}` : `classExamId=${encodeURIComponent(opts.classExamId)}`;
            const res = await apiFetch(`/api/exam-photos?${q}`);
            if (!$('examPhotosDlg')) return;
            let all = res.photos || [];
            if (res.limited && opts.focusStudentId) all = all.filter(p => p.Student_ID === opts.focusStudentId);
            if (!all.length) { body.innerHTML = `<p class="text-sm text-gray-500">${byStudent ? 'No exam photos for this student in this class.' : 'No photos were taken for this exam.'}</p>`; return; }
            if (res.limited) { ExamPhotoReview.renderInitial(body, all, byStudent); return; }
            ExamPhotoReview.render(body, all, byStudent, opts.focusStudentId);
        } catch (e) { body.innerHTML = `<p class="text-sm text-red-700">${esc(e.message || 'Could not load photos.')}</p>`; }
    },

    // A lecturer gets the initial face verification photo only: one picture per student (per exam), no gallery.
    renderInitial: (body, all, byStudent) => {
        $('epSub') && ($('epSub').textContent = (byStudent ? `${opts_name(all)} · ` : '') + 'Initial face verification photo');
        body.innerHTML = `<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">${all.map(p => `
            <figure class="m-0"><div class="aspect-[3/4] bg-gray-100 rounded-lg overflow-hidden"><img data-photo-id="${esc(p.Photo_ID)}" alt="Face verification photo of ${esc(p.Name || 'student')}" class="w-full h-full object-cover"></div>
            <figcaption class="mt-1"><span class="block text-xs font-bold text-gray-800 truncate">${esc(byStudent ? (p.Exam_Title || 'Exam') : (p.Name || 'Student'))}</span>
            <span class="block text-[11px] text-gray-500">${esc(fmtTime(p.Taken_At, true))}</span></figcaption></figure>`).join('')}</div>`;
        body.insertAdjacentHTML('beforeend', ExamPhotoReview.moreHtml());
        ExamPhotoReview.fill();
    },

    // Groups: students (by exam) or exams (by student). Each group is a collapsible section; its pictures load when it opens.
    render: (body, all, byStudent, focusId) => {
        ExamPhotoReview.ctx = { all, byStudent, focusId };
        const groups = [];
        const at = new Map();
        for (const p of all) {
            const key = byStudent ? p.Class_Exam_ID : p.Student_ID;
            if (!at.has(key)) { const g = { key, title: byStudent ? (p.Exam_Title || 'Exam') : (p.Name || 'Student'), photos: [] }; at.set(key, g); groups.push(g); }
            at.get(key).photos.push(p);
        }
        ExamPhotoReview.photos = groups.flatMap(g => g.photos.map(p => ({ ...p, group: g.title })));
        let n = 0;
        body.innerHTML = `<div class="flex items-center justify-between mb-2 text-xs text-gray-500"><span>${all.length} photo${all.length === 1 ? '' : 's'} &middot; ${groups.length} ${byStudent ? 'exam' : 'student'}${groups.length === 1 ? '' : 's'}</span>
                <span class="flex items-center gap-4">${groups.length > 1 ? '<button type="button" data-ep-toggle-all class="font-bold text-blue-700 hover:underline min-h-[32px]">Open all</button>' : ''}
                <button type="button" data-ep-select-mode class="font-bold text-red-700 hover:underline min-h-[32px]">Select</button></span></div>
            <div class="space-y-2">${groups.map((g, gi) => {
                const first = n; n += g.photos.length;
                return `<section class="border border-gray-200 rounded-lg" data-ep-group="${gi}">
                    <button type="button" data-ep-head aria-expanded="false" class="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left">
                        <span class="min-w-0"><span class="block text-sm font-bold text-gray-800 truncate">${esc(g.title)}</span>
                        <span class="block text-[11px] text-gray-500">${g.photos.length} photo${g.photos.length === 1 ? '' : 's'}</span></span>
                        <i class="fa-solid fa-chevron-down text-gray-400 text-xs transition-transform" aria-hidden="true"></i></button>
                    <div class="hidden px-3 pb-3"><button type="button" data-ep-select-group="${gi}" class="hidden mb-2 min-h-[32px] text-xs font-bold text-red-700 hover:underline">Select all of ${esc(g.title)}</button>
                    <div class="grid grid-cols-3 sm:grid-cols-4 gap-2">${g.photos.map((p, i) => `
                        <button type="button" data-ep-photo="${first + i}" data-ep-id="${esc(p.Photo_ID)}" class="text-left m-0 p-0 bg-transparent" style="-webkit-touch-callout:none;-webkit-user-select:none;user-select:none"><div class="aspect-[4/3] bg-gray-100 rounded overflow-hidden relative"><img data-photo-id="${esc(p.Photo_ID)}" alt="" draggable="false" class="w-full h-full object-cover pointer-events-none"><span data-ep-check class="hidden absolute top-1 left-1 w-6 h-6 rounded-full border-2 border-white bg-black/40 text-white text-xs items-center justify-center shadow"><i class="fa-solid fa-check" aria-hidden="true"></i></span></div>
                        <span class="block text-[10px] text-gray-500 mt-0.5">${esc(fmtTime(p.Taken_At, byStudent))}${p.Kind === 'start' ? ' &middot; start' : ''}</span></button>`).join('')}</div></div>
                </section>`;
            }).join('')}</div>${ExamPhotoReview.moreHtml()}`;
        ExamPhotoReview.paintSelection();
        const heads = body.querySelectorAll('[data-ep-head]');
        const focusAt = focusId ? groups.findIndex(g => g.key === focusId) : -1;
        if (focusAt >= 0) { ExamPhotoReview.toggle(heads[focusAt], true); heads[focusAt].scrollIntoView({ block: 'nearest' }); }
        else if (groups.length === 1) ExamPhotoReview.toggle(heads[0], true);
        ExamPhotoReview.updateMore();
    },

    // Ticks, counts and the bottom bar follow ExamPhotoReview.selecting / selected.
    paintSelection: () => {
        const dlg = $('examPhotosDlg'); if (!dlg) return;
        const on = ExamPhotoReview.selecting, n = ExamPhotoReview.selected.size;
        dlg.querySelector('#epSelBar')?.classList.toggle('hidden', !on);
        const mode = dlg.querySelector('[data-ep-select-mode]'); if (mode) mode.textContent = on ? 'Done' : 'Select';
        dlg.querySelectorAll('[data-ep-select-group]').forEach(b => b.classList.toggle('hidden', !on));
        dlg.querySelectorAll('[data-ep-id]').forEach(b => {
            const sel = on && ExamPhotoReview.selected.has(b.dataset.epId);
            b.setAttribute('aria-pressed', on ? String(sel) : 'false');
            const box = b.querySelector('div');
            box.classList.toggle('ring-4', sel); box.classList.toggle('ring-red-500', sel);
            const tick = b.querySelector('[data-ep-check]');
            tick.classList.toggle('hidden', !on); tick.classList.toggle('flex', on);
            tick.classList.toggle('bg-red-600', sel); tick.classList.toggle('bg-black/40', !sel);
            tick.querySelector('i').classList.toggle('invisible', !sel);
        });
        const c = dlg.querySelector('#epSelCount'); if (c) c.textContent = `${n} selected`;
        const shown = ExamPhotoReview.shownIds();
        const sa = dlg.querySelector('[data-ep-select-all]'); if (sa) sa.textContent = shown.length && shown.every(id => ExamPhotoReview.selected.has(id)) ? 'Clear shown' : 'Select shown';
        const del = dlg.querySelector('#epDeleteBtn'); if (del) del.disabled = n === 0;
    },

    // Draws the gallery again from ctx.all (after a delete or an Undo).
    redraw: () => {
        const ctx = ExamPhotoReview.ctx, body = $('epBody');
        if (!ctx || !body) return;
        if (ctx.all.length) ExamPhotoReview.render(body, ctx.all, ctx.byStudent, null);
        else { ExamPhotoReview.photos = []; body.innerHTML = '<p class="text-sm text-gray-500">No photos left here.</p>'; ExamPhotoReview.paintSelection(); }
    },

    // The pictures leave the screen at once; Drive and the list are only touched when the Undo window ends (or the gallery closes).
    deleteSelected: () => {
        const ids = [...ExamPhotoReview.selected];
        const ctx = ExamPhotoReview.ctx;
        if (!ids.length || !ctx || !AppState.user || !AppState.user.isAdmin) return;
        const before = ctx.all, gone = new Set(ids);
        ctx.all = before.filter(p => !gone.has(p.Photo_ID));
        ExamPhotoReview.selected = new Set(); ExamPhotoReview.selecting = false; ExamPhotoReview.changed = true;
        ExamPhotoReview.redraw();
        UI.deferred(`${ids.length} photo${ids.length === 1 ? '' : 's'} deleted.`, {
            ms: 8000,
            restore: () => { if (ExamPhotoReview.ctx === ctx) { ctx.all = before; ExamPhotoReview.redraw(); } },
            commit: async () => {
                for (let i = 0; i < ids.length; i += 200) await apiPost('/api/admin-delete-exam-photos', { photoIds: ids.slice(i, i + 200) });
                ids.forEach(id => ExamPhotoReview.cache.delete(id));
            }
        });
    },

    toggle: (head, force) => {
        const panel = head.nextElementSibling;
        const open = force === undefined ? panel.classList.contains('hidden') : force;
        panel.classList.toggle('hidden', !open);
        head.setAttribute('aria-expanded', open ? 'true' : 'false');
        head.querySelector('i').style.transform = open ? 'rotate(180deg)' : '';
        if (open) ExamPhotoReview.fill();
        else ExamPhotoReview.updateMore();
    },

    // Photo_IDs of the pictures on screen: inside an open group and loaded.
    shownIds: () => [...document.querySelectorAll('#epBody [data-ep-id]')].filter(b => !b.closest('.hidden') && b.querySelector('img')?.getAttribute('src')).map(b => b.dataset.epId),

    // ---- paged loading: 10 pictures first, then 5 more each time "Load more" is tapped (only pictures in open groups count)
    moreHtml: () => '<div id="epMore" class="hidden mt-3 text-center"><button type="button" data-ep-more class="min-h-[44px] px-4 text-sm font-bold text-blue-700 hover:underline"></button></div>',
    waiting: () => [...document.querySelectorAll('#epBody img[data-photo-id]')].filter(img => !img.getAttribute('src') && !img.dataset.req && !img.closest('.hidden')),
    fill: () => {
        for (const img of ExamPhotoReview.waiting()) {
            const id = img.dataset.photoId;
            const cached = ExamPhotoReview.cache.get(id);
            if (!cached && ExamPhotoReview.budget <= 0) break;
            if (!cached) ExamPhotoReview.budget--;
            img.dataset.req = '1';
            ExamPhotoReview.want(id, (src) => { if (src) img.src = src; else { img.alt = 'Could not load'; delete img.dataset.req; } });
        }
        ExamPhotoReview.updateMore();
    },
    updateMore: () => {
        const box = $('epMore'); if (!box) return;
        const left = ExamPhotoReview.waiting().length;
        box.classList.toggle('hidden', left === 0);
        const b = box.querySelector('button'); if (b) b.textContent = `Load ${Math.min(NEXT_PAGE, left)} more (${left} not loaded)`;
    },

    // ---- drag to select (Select mode): hold a picture ~0.3 s and drag across others; a quick drag with a mouse works at once
    itemAt: (x, y) => { const el = document.elementFromPoint(x, y); return el ? el.closest('#examPhotosDlg [data-ep-id]') : null; },
    apply: (item) => {
        const P = ExamPhotoReview.paint; if (!P || !item || item === P.last) return;
        P.last = item;
        const id = item.dataset.epId, has = ExamPhotoReview.selected.has(id);
        if (P.mode === 'add' && !has) ExamPhotoReview.selected.add(id);
        else if (P.mode === 'remove' && has) ExamPhotoReview.selected.delete(id);
        else return;
        P.dirty = true;
    },
    onDown: (e) => {
        if (!ExamPhotoReview.selecting || (e.pointerType === 'mouse' && e.button !== 0)) return;
        const item = e.target.closest('[data-ep-id]'); if (!item) return;
        const P = ExamPhotoReview.paint = { id: e.pointerId, start: item, last: null, on: false, dirty: false, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, mode: ExamPhotoReview.selected.has(item.dataset.epId) ? 'remove' : 'add', touch: e.pointerType !== 'mouse', timer: null };
        const begin = () => { P.on = true; P.last = null; ExamPhotoReview.apply(P.start); ExamPhotoReview.paintSelection(); try { navigator.vibrate && navigator.vibrate(12); } catch (err) { /* no vibration */ } ExamPhotoReview.edgeScroll(); };
        P.begin = begin;
        if (P.touch) P.timer = setTimeout(begin, LONG_PRESS);
    },
    onMove: (e) => {
        const P = ExamPhotoReview.paint; if (!P || e.pointerId !== P.id) return;
        P.x = e.clientX; P.y = e.clientY;
        if (!P.on) {
            if (P.touch) { if (Math.abs(e.clientX - P.sx) + Math.abs(e.clientY - P.sy) > 14) clearTimeout(P.timer); return; }   // a finger that moves before the hold is a scroll
            const over = ExamPhotoReview.itemAt(e.clientX, e.clientY);
            if (over && over !== P.start) P.begin();   // mouse: dragging onto another picture starts selecting
            else return;
        }
        ExamPhotoReview.apply(ExamPhotoReview.itemAt(e.clientX, e.clientY));
        if (P.dirty) { P.dirty = false; ExamPhotoReview.paintSelection(); }
    },
    onUp: (e) => {
        const P = ExamPhotoReview.paint; if (!P) return;
        clearTimeout(P.timer); cancelAnimationFrame(P.raf);
        if (P.on) ExamPhotoReview.swallowClickUntil = Date.now() + 500;   // the release must not also count as a tap
        ExamPhotoReview.paint = null;
    },
    // Holding a finger near the top or bottom edge scrolls the list so a long drag can reach more pictures.
    edgeScroll: () => {
        const P = ExamPhotoReview.paint, body = $('epBody'); if (!P || !P.on || !body) return;
        const r = body.getBoundingClientRect(), zone = 56;
        const dy = P.y < r.top + zone ? -10 : P.y > r.bottom - zone ? 10 : 0;
        if (dy) { body.scrollTop += dy; ExamPhotoReview.apply(ExamPhotoReview.itemAt(P.x, P.y)); if (P.dirty) { P.dirty = false; ExamPhotoReview.paintSelection(); } }
        P.raf = requestAnimationFrame(ExamPhotoReview.edgeScroll);
    },

    // Fetch one picture (cached), at most PARALLEL at a time.
    want: (photoId, cb) => {
        const hit = ExamPhotoReview.cache.get(photoId);
        if (hit) { cb(hit); return; }
        ExamPhotoReview.queue.push({ photoId, cb });
        ExamPhotoReview.pump();
    },
    pump: () => {
        while (ExamPhotoReview.running < PARALLEL && ExamPhotoReview.queue.length) {
            const job = ExamPhotoReview.queue.shift();
            if (!$('examPhotosDlg')) { ExamPhotoReview.queue = []; return; }
            const hit = ExamPhotoReview.cache.get(job.photoId);
            if (hit) { job.cb(hit); continue; }
            ExamPhotoReview.running++;
            apiFetch(`/api/exam-photos?photoId=${encodeURIComponent(job.photoId)}`)
                .then(r => { const src = `data:${r.mimeType || 'image/jpeg'};base64,${r.base64}`; ExamPhotoReview.cache.set(job.photoId, src); job.cb(src); })
                .catch(() => job.cb(null))
                .finally(() => { ExamPhotoReview.running--; ExamPhotoReview.pump(); });
        }
    },

    onClick: (e) => {
        if (e.target.closest('[data-ep-close]')) { ExamPhotoReview.close(); return; }
        if (e.target.closest('[data-ep-more]')) { ExamPhotoReview.budget += NEXT_PAGE; ExamPhotoReview.fill(); return; }
        const head = e.target.closest('[data-ep-head]');
        if (head) { ExamPhotoReview.toggle(head); return; }
        if (e.target.closest('[data-ep-toggle-all]')) {
            const btn = e.target.closest('[data-ep-toggle-all]');
            const opening = btn.textContent.trim() === 'Open all';
            document.querySelectorAll('#examPhotosDlg [data-ep-head]').forEach(h => ExamPhotoReview.toggle(h, opening));
            btn.textContent = opening ? 'Close all' : 'Open all';
            return;
        }
        if (e.target.closest('[data-ep-select-mode]')) {
            ExamPhotoReview.selecting = !ExamPhotoReview.selecting;
            if (!ExamPhotoReview.selecting) ExamPhotoReview.selected = new Set();
            ExamPhotoReview.paintSelection();
            return;
        }
        if (e.target.closest('[data-ep-select-all]') && ExamPhotoReview.ctx) {
            // Only the pictures on screen: in open groups and already loaded. Closed groups and not-yet-loaded pictures are never touched.
            const ids = ExamPhotoReview.shownIds();
            const allIn = ids.length > 0 && ids.every(id => ExamPhotoReview.selected.has(id));
            ids.forEach(id => allIn ? ExamPhotoReview.selected.delete(id) : ExamPhotoReview.selected.add(id));
            ExamPhotoReview.paintSelection();
            return;
        }
        const grp = e.target.closest('[data-ep-select-group]');
        if (grp) {
            const ids = [...grp.closest('section').querySelectorAll('[data-ep-id]')].map(b => b.dataset.epId);
            const allIn = ids.every(id => ExamPhotoReview.selected.has(id));
            ids.forEach(id => allIn ? ExamPhotoReview.selected.delete(id) : ExamPhotoReview.selected.add(id));
            ExamPhotoReview.paintSelection();
            return;
        }
        if (e.target.closest('[data-ep-delete]')) { ExamPhotoReview.deleteSelected(); return; }
        const ph = e.target.closest('[data-ep-photo]');
        if (ph && ExamPhotoReview.selecting) {
            if (Date.now() < ExamPhotoReview.swallowClickUntil) return;   // the end of a drag-select
            const id = ph.dataset.epId;
            if (ExamPhotoReview.selected.has(id)) ExamPhotoReview.selected.delete(id); else ExamPhotoReview.selected.add(id);
            ExamPhotoReview.paintSelection();
            return;
        }
        if (ph) ExamPhotoReview.show(Number(ph.dataset.epPhoto));
    },

    // Full-size view with Previous / Next across every photo in the list.
    show: (i) => {
        const list = ExamPhotoReview.photos;
        if (!list.length) return;
        i = (i + list.length) % list.length;
        ExamPhotoReview.index = i;
        let lb = $('examPhotoLightbox');
        if (!lb) {
            lb = document.createElement('div');
            lb.id = 'examPhotoLightbox';
            lb.className = 'fixed inset-0 z-[130] bg-black flex flex-col fade-in';
            lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true'); lb.setAttribute('aria-label', 'Exam photo');
            lb.innerHTML = `<div class="shrink-0 flex items-start gap-3 p-3 text-white" style="padding-top:max(0.75rem, env(safe-area-inset-top))">
                    <div class="min-w-0 flex-1"><div id="eplName" class="font-bold truncate"></div><div id="eplMeta" class="text-xs text-gray-300"></div></div>
                    <button type="button" data-epl-close class="p-2 text-white" aria-label="Close photo"><i class="fa-solid fa-xmark text-xl" aria-hidden="true"></i></button></div>
                <div class="flex-1 min-h-0 flex items-center justify-center px-2"><img id="eplImg" alt="Exam photo" class="max-w-full max-h-full object-contain bg-gray-900" style="min-width:60%"><span id="eplMsg" class="text-gray-300 text-sm absolute"></span></div>
                <div class="shrink-0 flex items-center justify-between gap-3 p-3 text-white" style="padding-bottom:max(0.75rem, env(safe-area-inset-bottom))">
                    <button type="button" data-epl-prev class="px-4 py-2.5 rounded-lg bg-white/15 font-bold text-sm"><i class="fa-solid fa-chevron-left mr-1" aria-hidden="true"></i>Previous</button>
                    <span id="eplPos" class="text-xs text-gray-300"></span>
                    <button type="button" data-epl-next class="px-4 py-2.5 rounded-lg bg-white/15 font-bold text-sm">Next<i class="fa-solid fa-chevron-right ml-1" aria-hidden="true"></i></button></div>`;
            lb.addEventListener('click', (e) => {
                if (e.target.closest('[data-epl-close]')) ExamPhotoReview.closeLightbox();
                else if (e.target.closest('[data-epl-prev]')) ExamPhotoReview.show(ExamPhotoReview.index - 1);
                else if (e.target.closest('[data-epl-next]')) ExamPhotoReview.show(ExamPhotoReview.index + 1);
            });
            let x0 = null;
            lb.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
            lb.addEventListener('touchend', (e) => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 60) ExamPhotoReview.show(ExamPhotoReview.index + (dx < 0 ? 1 : -1)); }, { passive: true });
            document.body.appendChild(lb);
            lb.querySelector('[data-epl-close]').focus();
        }
        const p = list[i];
        lb.querySelector('#eplName').textContent = ExamPhotoReview.mode === 'student' ? p.group : (p.Name || 'Student');
        lb.querySelector('#eplMeta').textContent = `${fmtTime(p.Taken_At, true)}${p.Kind === 'start' ? ' · at the start' : ''}`;
        lb.querySelector('#eplPos').textContent = `${i + 1} of ${list.length}`;
        const img = lb.querySelector('#eplImg'), msg = lb.querySelector('#eplMsg');
        img.removeAttribute('src'); msg.textContent = 'Loading...';
        ExamPhotoReview.want(p.Photo_ID, (src) => {
            if (ExamPhotoReview.index !== i || !$('examPhotoLightbox')) return;
            if (src) { img.src = src; msg.textContent = ''; } else msg.textContent = 'Could not load this photo.';
        });
        // Warm the next one so Next feels instant.
        const nx = list[(i + 1) % list.length];
        if (nx && nx.Photo_ID !== p.Photo_ID) ExamPhotoReview.want(nx.Photo_ID, () => {});
    },

    closeLightbox: () => { $('examPhotoLightbox')?.remove(); },
    close: () => {
        ExamPhotoReview.closeLightbox();
        const had = !!$('examPhotosDlg');
        $('examPhotosDlg')?.remove(); ExamPhotoReview.queue = [];
        if (had && ExamPhotoReview.changed) { ExamPhotoReview.changed = false; UI.flushDeferred().then(() => adminDlg.refresh()); }   // the counts behind it are stale
    }
};

// Admin tools > Exam Photos: every class that has photos, then its exams, then the gallery of the exam.
const adminDlg = {
    open: () => {
        $('adminPhotosDlg')?.remove();
        const dlg = document.createElement('div');
        dlg.id = 'adminPhotosDlg';
        dlg.className = 'fixed inset-0 z-[115] flex items-start sm:items-center justify-center fade-in';
        dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-label', 'Exam photos of all classes');
        dlg.innerHTML = `<div class="absolute inset-0 bg-gray-900 bg-opacity-60" data-ap-close></div>
            <div class="relative z-10 bg-white w-full sm:max-w-lg h-full sm:h-auto sm:max-h-[90vh] sm:rounded-lg shadow-xl p-4 flex flex-col" style="padding-top:max(1rem, env(safe-area-inset-top))">
                <div class="shrink-0 flex items-center gap-2 mb-3 border-b pb-3">
                    <button type="button" id="apBack" data-ap-back class="hidden p-2 text-gray-500 hover:text-gray-800" aria-label="Back"><i class="fa-solid fa-arrow-left text-lg" aria-hidden="true"></i></button>
                    <div class="min-w-0 flex-1"><h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-camera text-rose-600 mr-2" aria-hidden="true"></i>Exam Photos</h3><p id="apSub" class="text-xs text-gray-500 truncate">All classes &middot; Admin only</p></div>
                    <button type="button" data-ap-close class="p-2 text-gray-500 hover:text-gray-800" aria-label="Close"><i class="fa-solid fa-xmark text-xl" aria-hidden="true"></i></button>
                </div>
                <div id="apBody" class="flex-1 min-h-0 overflow-y-auto"></div>
            </div>`;
        document.body.appendChild(dlg);
        dlg.addEventListener('click', (e) => {
            if (e.target.closest('[data-ap-close]')) { dlg.remove(); return; }
            if (e.target.closest('[data-ap-back]')) { adminDlg.classes(); return; }
            const cls = e.target.closest('[data-ap-class]');
            if (cls) { adminDlg.exams(cls.dataset.apClass, cls.dataset.apTitle); return; }
            const ex = e.target.closest('[data-ap-exam]');
            if (ex) ExamPhotoReview.open({ classExamId: ex.dataset.apExam });
        });
        dlg.addEventListener('input', (e) => {
            if (e.target.id !== 'apFind') return;
            const q = e.target.value.trim().toLowerCase();
            dlg.querySelectorAll('[data-ap-class]').forEach(b => { b.style.display = !q || b.dataset.apSearch.includes(q) ? '' : 'none'; });
        });
        adminDlg.classes();
    },
    show: (html, sub, back) => {
        const dlg = $('adminPhotosDlg'); if (!dlg) return false;
        dlg.querySelector('#apBody').innerHTML = html;
        dlg.querySelector('#apSub').textContent = sub;
        dlg.querySelector('#apBack').classList.toggle('hidden', !back);
        return true;
    },
    view: null,
    refresh: () => { const v = adminDlg.view; if (!$('adminPhotosDlg') || !v) return; if (v.courseId) adminDlg.exams(v.courseId, v.title); else adminDlg.classes(); },
    classes: async () => {
        adminDlg.view = {};
        adminDlg.show('<p class="text-sm text-gray-500">Loading...</p>', 'All classes · Admin only', false);
        try {
            const res = await apiFetch('/api/admin-exam-photos');
            const list = res.classes || [];
            adminDlg.show(list.length ? `<input id="apFind" type="search" placeholder="Find a class or lecturer" class="ctl w-full mb-3 px-3 text-sm border border-gray-300 rounded-md bg-gray-50">
                <div class="space-y-2">${list.map(c => `<button type="button" data-ap-class="${esc(c.Course_ID)}" data-ap-title="${esc(c.CourseCode)}" data-ap-search="${esc((c.CourseCode + ' ' + c.CourseTitle + ' ' + (c.Lecturer || '')).toLowerCase())}" class="w-full text-left border border-gray-200 rounded-lg px-3 py-2.5 hover:bg-gray-50">
                    <span class="block text-sm font-bold text-gray-800 truncate">${esc(c.CourseCode)} <span class="font-normal text-gray-600">${esc(c.CourseTitle || '')}</span></span>
                    <span class="block text-[11px] text-gray-500 truncate">${esc(c.Lecturer || '')} &middot; ${c.Exams} exam${c.Exams === 1 ? '' : 's'} &middot; ${c.Students} student${c.Students === 1 ? '' : 's'} &middot; ${c.Photos} photos</span></button>`).join('')}</div>`
                : '<p class="text-sm text-gray-500">No exam photos have been taken yet.</p>', 'All classes · Admin only', false);
        } catch (e) { adminDlg.show(`<p class="text-sm text-red-700">${esc(e.message || 'Could not load.')}</p>`, 'All classes', false); }
    },
    exams: async (courseId, title) => {
        adminDlg.view = { courseId, title };
        adminDlg.show('<p class="text-sm text-gray-500">Loading...</p>', title, true);
        try {
            const res = await apiFetch(`/api/admin-exam-photos?courseId=${encodeURIComponent(courseId)}`);
            const list = res.exams || [];
            adminDlg.show(list.length ? `<div class="space-y-2">${list.map(x => `<button type="button" data-ap-exam="${esc(x.Class_Exam_ID)}" class="w-full text-left border border-gray-200 rounded-lg px-3 py-2.5 hover:bg-gray-50">
                    <span class="block text-sm font-bold text-gray-800 truncate">${esc(x.Exam_Title || 'Exam')}</span>
                    <span class="block text-[11px] text-gray-500">${esc(x.Term || '')} &middot; ${x.Students} student${x.Students === 1 ? '' : 's'} &middot; ${x.Photos} photos &middot; ${esc(fmtTime(x.Last_At, true))}</span></button>`).join('')}</div>`
                : '<p class="text-sm text-gray-500">No photos for this class.</p>', title, true);
        } catch (e) { adminDlg.show(`<p class="text-sm text-red-700">${esc(e.message || 'Could not load.')}</p>`, title, true); }
    }
};
document.addEventListener('click', (e) => { if (e.target.closest('#openAdminPhotosBtn') && AppState.user && AppState.user.isAdmin) adminDlg.open(); });

document.addEventListener('keydown', (e) => {
    if (!$('examPhotoLightbox')) { if (e.key === 'Escape') ExamPhotoReview.close(); return; }
    if (e.key === 'Escape') ExamPhotoReview.closeLightbox();
    else if (e.key === 'ArrowLeft') ExamPhotoReview.show(ExamPhotoReview.index - 1);
    else if (e.key === 'ArrowRight') ExamPhotoReview.show(ExamPhotoReview.index + 1);
});
window.addEventListener('hashchange', ExamPhotoReview.close);

// Manage Student > Exam photos: that student's photos across this class's exams.
document.addEventListener('click', (e) => {
    if (!e.target.closest('#manageExamPhotosBtn')) return;
    const studentId = $('manageStudentId')?.value;
    const courseId = window.location.hash.replace('#class-', '');
    if (studentId && courseId) ExamPhotoReview.open({ courseId, studentId, name: $('manageStudentName')?.textContent || '' });
});
