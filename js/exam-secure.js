// js/exam-secure.js
// Secure exam mode for students sitting an online exam:
//  - before the exam: a notice and the camera permission (the exam does not start without the camera);
//  - during the exam: a small photo when it starts and every 30 seconds, sent to the lecturer's private Drive folder;
//  - leaving the exam (switching tab, app or window, locking the screen) submits the answers at once.
// Students flagged Legally Blind are exempt unless their lecturer turns it on (the server decides: student.secure).
// Lecturers see the photos from Manage Exams > Results > Photos.
import { apiFetch } from './globals.js';
import { escapeHtml } from './html-utils.js';

const PHOTO_EVERY_MS = 30000;
const PHOTO_WIDTH = 320;
const $ = (id) => document.getElementById(id);

export const ExamSecure = {
    stream: null, video: null, timer: null, active: false, paused: 0, leaving: false,
    ctx: null, handlers: null,

    // Notice + camera permission. Resolves true when the student agreed and the camera works.
    prepare: () => new Promise((resolve) => {
        $('examSecureDlg')?.remove();
        const dlg = document.createElement('div');
        dlg.id = 'examSecureDlg';
        dlg.className = 'fixed inset-0 z-[130] flex items-center justify-center p-4 fade-in';
        dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-labelledby', 'examSecureTitle');
        dlg.innerHTML = `<div class="absolute inset-0 bg-gray-900 bg-opacity-70"></div>
            <div class="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
                <div class="mx-auto mb-3 w-14 h-14 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-2xl"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i></div>
                <h3 id="examSecureTitle" class="text-xl font-black text-gray-900 text-center mb-3">Secure exam</h3>
                <ul class="text-sm text-gray-700 space-y-2 mb-3 list-disc pl-5">
                    <li>Your camera takes a photo when the exam starts and every 30 seconds. Only your lecturer can see them.</li>
                    <li><b>If you leave the exam screen</b> (switch tab, app or window, or lock the phone) <b>your exam is submitted immediately.</b></li>
                    <li>Put your phone on Do Not Disturb so a call or notification does not end your exam.</li>
                </ul>
                <p id="examSecureErr" class="hidden text-sm font-bold text-red-700 mb-2" role="alert"></p>
                <button type="button" id="examSecureGo" class="w-full min-h-[3.25rem] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-black">Allow camera and continue</button>
                <button type="button" id="examSecureNo" class="mt-2 w-full py-2 text-sm font-bold text-gray-500 hover:text-gray-800">Cancel</button>
            </div>`;
        document.body.appendChild(dlg);
        const err = dlg.querySelector('#examSecureErr');
        const done = (ok) => { dlg.remove(); resolve(ok); };
        dlg.querySelector('#examSecureNo').addEventListener('click', () => done(false));
        const go = dlg.querySelector('#examSecureGo');
        go.addEventListener('click', async () => {
            go.disabled = true;
            err.classList.add('hidden');
            try {
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser cannot use the camera. Open the app in Safari or Chrome.');
                ExamSecure.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
                const v = document.createElement('video');
                v.setAttribute('playsinline', ''); v.muted = true; v.autoplay = true;
                v.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;left:0;top:0';
                v.srcObject = ExamSecure.stream;
                document.body.appendChild(v);
                await v.play().catch(() => {});
                ExamSecure.video = v;
                done(true);
            } catch (e) {
                ExamSecure.release();
                go.disabled = false;
                err.textContent = e && e.name === 'NotAllowedError'
                    ? 'The camera is blocked. Allow the camera for this site in your browser settings, then try again.'
                    : (e && e.message) || 'The camera could not be started.';
                err.classList.remove('hidden');
            }
        });
        go.focus();
    }),

    // The exam is on screen: start photos and watch for the student leaving.
    // onLeave(reason) is called once when the student leaves; the caller submits the exam.
    begin: (examObj, student, onLeave) => {
        ExamSecure.end(false);
        ExamSecure.active = true;
        ExamSecure.leaving = false;
        ExamSecure.ctx = { assignmentId: examObj.assignmentId, studentId: student.User_ID };

        const badge = document.createElement('div');
        badge.id = 'examSecureBadge';
        badge.className = 'fixed top-2 right-2 z-[125] px-2 py-1 rounded-full bg-red-600 text-white text-[10px] font-black shadow';
        badge.innerHTML = '<i class="fa-solid fa-circle text-[7px] mr-1" aria-hidden="true"></i>CAMERA ON';
        document.body.appendChild(badge);

        const leave = (reason) => {
            if (!ExamSecure.active || ExamSecure.paused > 0 || ExamSecure.leaving) return;
            ExamSecure.leaving = true;
            onLeave(reason);
        };
        const onVis = () => { if (document.hidden) leave('focus-lost'); };
        const onBlur = () => leave('focus-lost');
        const onHide = () => leave('focus-lost');
        document.addEventListener('visibilitychange', onVis);
        window.addEventListener('blur', onBlur);
        window.addEventListener('pagehide', onHide);
        const track = ExamSecure.stream && ExamSecure.stream.getVideoTracks()[0];
        const onEnded = () => leave('camera-off');
        if (track) track.addEventListener('ended', onEnded);
        ExamSecure.handlers = { onVis, onBlur, onHide, track, onEnded };

        const snap = (kind) => ExamSecure.capture(kind);
        setTimeout(() => snap('start'), 800);
        ExamSecure.timer = setInterval(() => snap('check'), PHOTO_EVERY_MS);
    },

    // Dialogs the app itself opens (confirm / alert) take focus away, so they must not count as leaving.
    pause: () => { ExamSecure.paused += 1; },
    resume: () => { setTimeout(() => { ExamSecure.paused = Math.max(0, ExamSecure.paused - 1); }, 400); },

    capture: async (kind) => {
        const v = ExamSecure.video, c = ExamSecure.ctx;
        if (!ExamSecure.active || !v || !c || !v.videoWidth) return;
        try {
            const canvas = document.createElement('canvas');
            canvas.width = PHOTO_WIDTH;
            canvas.height = Math.round(PHOTO_WIDTH * v.videoHeight / v.videoWidth);
            canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
            const base64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
            await apiFetch('/api/exam-photo', { method: 'POST', body: JSON.stringify({ assignmentId: c.assignmentId, studentId: c.studentId, kind, base64 }) });
        } catch (e) { /* a missed photo must never interrupt the exam */ }
    },

    release: () => {
        if (ExamSecure.stream) ExamSecure.stream.getTracks().forEach(t => t.stop());
        ExamSecure.stream = null;
        ExamSecure.video?.remove();
        ExamSecure.video = null;
    },

    // Stops everything (exam submitted or closed). keepCamera = true keeps the stream for a restart.
    end: (releaseCamera = true) => {
        ExamSecure.active = false;
        clearInterval(ExamSecure.timer);
        ExamSecure.timer = null;
        const h = ExamSecure.handlers;
        if (h) {
            document.removeEventListener('visibilitychange', h.onVis);
            window.removeEventListener('blur', h.onBlur);
            window.removeEventListener('pagehide', h.onHide);
            if (h.track) h.track.removeEventListener('ended', h.onEnded);
        }
        ExamSecure.handlers = null;
        $('examSecureBadge')?.remove();
        if (releaseCamera) ExamSecure.release();
    },

    // ---- Lecturer: photos of one class exam, per student ----
    openPhotos: async (classExamId, studentId, name) => {
        $('examPhotosDlg')?.remove();
        const dlg = document.createElement('div');
        dlg.id = 'examPhotosDlg';
        dlg.className = 'fixed inset-0 z-[120] flex items-start sm:items-center justify-center fade-in';
        dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-label', `Exam photos of ${name}`);
        dlg.innerHTML = `<div class="absolute inset-0 bg-gray-900 bg-opacity-60" data-ep-close></div>
            <div class="relative z-10 bg-white w-full sm:max-w-lg h-full sm:h-auto sm:max-h-[90vh] sm:rounded-lg shadow-xl p-4 flex flex-col" style="padding-top:max(1rem, env(safe-area-inset-top))">
                <div class="shrink-0 flex items-center gap-3 mb-3 border-b pb-3">
                    <div class="min-w-0 flex-1"><h3 class="text-lg font-bold text-gray-800">Exam photos</h3><p class="text-xs text-gray-500 truncate">${escapeHtml(name)} &middot; taken at the start and every 30 seconds</p></div>
                    <button type="button" data-ep-close class="p-2 text-gray-500 hover:text-gray-800" aria-label="Close"><i class="fa-solid fa-xmark text-xl" aria-hidden="true"></i></button>
                </div>
                <div id="epBody" class="flex-1 min-h-0 overflow-y-auto"><p class="text-sm text-gray-500">Loading...</p></div>
            </div>`;
        document.body.appendChild(dlg);
        dlg.addEventListener('click', (e) => { if (e.target.closest('[data-ep-close]')) dlg.remove(); });
        const body = dlg.querySelector('#epBody');
        try {
            const res = await apiFetch(`/api/exam-photos?classExamId=${encodeURIComponent(classExamId)}`);
            const mine = (res.photos || []).filter(p => p.Student_ID === studentId);
            if (!mine.length) { body.innerHTML = '<p class="text-sm text-gray-500">No photos for this student.</p>'; return; }
            body.innerHTML = `<div class="grid grid-cols-3 gap-2">${mine.map(p => `
                <figure class="m-0"><div class="aspect-[4/3] bg-gray-100 rounded overflow-hidden"><img data-photo-id="${escapeHtml(p.Photo_ID)}" alt="" class="w-full h-full object-cover"></div>
                <figcaption class="text-[10px] text-gray-500 mt-0.5">${escapeHtml(new Date(p.Taken_At).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit' }))}${p.Kind === 'start' ? ' (start)' : ''}</figcaption></figure>`).join('')}</div>`;
            // One picture at a time, so a long exam does not flood the connection.
            for (const img of body.querySelectorAll('img[data-photo-id]')) {
                if (!document.body.contains(dlg)) return;
                try {
                    const r = await apiFetch(`/api/exam-photos?photoId=${encodeURIComponent(img.dataset.photoId)}`);
                    img.src = `data:${r.mimeType || 'image/jpeg'};base64,${r.base64}`;
                } catch (e) { img.alt = 'Could not load'; }
            }
        } catch (e) { body.innerHTML = `<p class="text-sm text-red-700">${escapeHtml(e.message || 'Could not load photos.')}</p>`; }
    }
};
