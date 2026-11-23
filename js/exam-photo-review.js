// js/exam-photo-review.js
// Admin: review the photos taken during online exams, by exam (grouped by student) or by student (grouped by exam).
// A lecturer only gets the initial face verification photo (no gallery); the server decides (res.limited).
//  - By exam: Manage Exams > Results > Photos.   By student: Manage Student > Exam photos.   Every class: Admin tools > Exam Photos (admins only).
//  - Pictures are fetched from Drive one at a time (3 at most in parallel) and only for the group that is open.
//  - Tap a picture to enlarge it; Previous / Next (or the arrow keys) move through every photo in the list.
import { apiFetch, AppState } from './globals.js';
import { escapeHtml as esc } from './html-utils.js';

const $ = (id) => document.getElementById(id);
const PARALLEL = 3;
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

    // opts: { classExamId, focusStudentId? } for one exam, or { courseId, studentId, name } for one student.
    open: async (opts) => {
        ExamPhotoReview.close();
        ExamPhotoReview.cache.clear();
        ExamPhotoReview.queue = []; ExamPhotoReview.running = 0;
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
            </div>`;
        document.body.appendChild(dlg);
        dlg.addEventListener('click', ExamPhotoReview.onClick);
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
        body.querySelectorAll('img[data-photo-id]').forEach(img => ExamPhotoReview.want(img.dataset.photoId, (src) => { if (src) img.src = src; else img.alt = 'Could not load'; }));
    },

    // Groups: students (by exam) or exams (by student). Each group is a collapsible section; its pictures load when it opens.
    render: (body, all, byStudent, focusId) => {
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
                ${groups.length > 1 ? '<button type="button" data-ep-toggle-all class="font-bold text-blue-700 hover:underline">Open all</button>' : ''}</div>
            <div class="space-y-2">${groups.map((g, gi) => {
                const first = n; n += g.photos.length;
                return `<section class="border border-gray-200 rounded-lg" data-ep-group="${gi}">
                    <button type="button" data-ep-head aria-expanded="false" class="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left">
                        <span class="min-w-0"><span class="block text-sm font-bold text-gray-800 truncate">${esc(g.title)}</span>
                        <span class="block text-[11px] text-gray-500">${g.photos.length} photo${g.photos.length === 1 ? '' : 's'}</span></span>
                        <i class="fa-solid fa-chevron-down text-gray-400 text-xs transition-transform" aria-hidden="true"></i></button>
                    <div class="hidden px-3 pb-3"><div class="grid grid-cols-3 sm:grid-cols-4 gap-2">${g.photos.map((p, i) => `
                        <button type="button" data-ep-photo="${first + i}" class="text-left m-0 p-0 bg-transparent"><div class="aspect-[4/3] bg-gray-100 rounded overflow-hidden relative"><img data-photo-id="${esc(p.Photo_ID)}" alt="" class="w-full h-full object-cover"></div>
                        <span class="block text-[10px] text-gray-500 mt-0.5">${esc(fmtTime(p.Taken_At, byStudent))}${p.Kind === 'start' ? ' &middot; start' : ''}</span></button>`).join('')}</div></div>
                </section>`;
            }).join('')}</div>`;
        const heads = body.querySelectorAll('[data-ep-head]');
        const focusAt = focusId ? groups.findIndex(g => g.key === focusId) : -1;
        if (focusAt >= 0) { ExamPhotoReview.toggle(heads[focusAt], true); heads[focusAt].scrollIntoView({ block: 'nearest' }); }
        else if (groups.length === 1) ExamPhotoReview.toggle(heads[0], true);
    },

    toggle: (head, force) => {
        const panel = head.nextElementSibling;
        const open = force === undefined ? panel.classList.contains('hidden') : force;
        panel.classList.toggle('hidden', !open);
        head.setAttribute('aria-expanded', open ? 'true' : 'false');
        head.querySelector('i').style.transform = open ? 'rotate(180deg)' : '';
        if (open) panel.querySelectorAll('img[data-photo-id]').forEach(img => ExamPhotoReview.want(img.dataset.photoId, (src) => { if (src) img.src = src; else img.alt = 'Could not load'; }));
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
        const head = e.target.closest('[data-ep-head]');
        if (head) { ExamPhotoReview.toggle(head); return; }
        if (e.target.closest('[data-ep-toggle-all]')) {
            const btn = e.target.closest('[data-ep-toggle-all]');
            const opening = btn.textContent.trim() === 'Open all';
            document.querySelectorAll('#examPhotosDlg [data-ep-head]').forEach(h => ExamPhotoReview.toggle(h, opening));
            btn.textContent = opening ? 'Close all' : 'Open all';
            return;
        }
        const ph = e.target.closest('[data-ep-photo]');
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
    close: () => { ExamPhotoReview.closeLightbox(); $('examPhotosDlg')?.remove(); ExamPhotoReview.queue = []; }
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
    classes: async () => {
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
