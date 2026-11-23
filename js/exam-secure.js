// js/exam-secure.js
// Secure exam mode for students sitting an online exam:
//  - before the exam: a notice and the camera permission (the exam does not start without the camera);
//  - during the exam: a small photo when it starts and every 30 seconds, sent to the lecturer's private Drive folder;
//  - leaving the exam screen (switching tab, app or window, locking the screen) starts a 5 second grace period;
//    staying away longer submits the answers (the server enforces it too, because phones freeze the page in the background).
// Students flagged Legally Blind are exempt unless their lecturer turns it on (the server decides: student.secure).
// Lecturers review the photos in js/exam-photo-review.js (Manage Exams > Results > Photos, or Manage Student > Exam photos).
import { apiFetch } from './globals.js';
import { escapeHtml } from './html-utils.js';

const PHOTO_EVERY_MS = 30000;
const AWAY_GRACE_SECONDS = 5;    // the server uses the same number (worker/exam-session.js)
const PHOTO_WIDTH = 320;
const $ = (id) => document.getElementById(id);

export const ExamSecure = {
    stream: null, video: null, timer: null, active: false, paused: 0, leaving: false, away: null, awayTimer: null, grace: AWAY_GRACE_SECONDS,
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
                    <li><b>If you leave the exam screen</b> (switch tab, app or window, or lock the phone) you have <b>only 5 seconds to come back</b>. After that your exam is submitted automatically.</li>
                    <li>Signing in to your account on another device also submits your exam. Put your phone on Do Not Disturb so calls and notifications do not pull you away.</li>
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
    // hooks.getAnswers() returns the answers so far; hooks.onLeave(reason) submits the exam from this device;
    // hooks.onSubmitted(reason) is called when the server already submitted it (the student stayed away too long).
    // Leaving starts a grace period (a call, a pulled notification, a screen that turned off); the banner counts it down.
    begin: (examObj, student, hooks) => {
        ExamSecure.end(false);
        ExamSecure.active = true;
        ExamSecure.leaving = false;
        ExamSecure.away = null;
        ExamSecure.grace = AWAY_GRACE_SECONDS;
        ExamSecure.ctx = { assignmentId: examObj.assignmentId, studentId: student.User_ID };

        const badge = document.createElement('div');
        badge.id = 'examSecureBadge';
        badge.className = 'fixed top-2 right-2 z-[125] px-2 py-1 rounded-full bg-red-600 text-white text-[10px] font-black shadow';
        badge.innerHTML = '<i class="fa-solid fa-circle text-[7px] mr-1" aria-hidden="true"></i>CAMERA ON';
        document.body.appendChild(badge);

        const submitNow = (reason) => {
            if (!ExamSecure.active || ExamSecure.leaving) return;
            ExamSecure.leaving = true;
            ExamSecure.hideBanner();
            hooks.onLeave(reason);
        };
        const tellServer = (away) => apiFetch('/api/exam-away', {
            method: 'POST', keepalive: true, timeoutMs: 8000,
            body: JSON.stringify({ ...ExamSecure.ctx, away, answers: away && hooks.getAnswers ? hooks.getAnswers() : undefined })
        });

        const startAway = () => {
            if (!ExamSecure.active || ExamSecure.paused > 0 || ExamSecure.leaving || ExamSecure.away) return;
            ExamSecure.away = { since: Date.now() };
            tellServer(true).then(r => { if (r && r.graceSeconds) ExamSecure.grace = r.graceSeconds; }).catch(() => {});
            ExamSecure.showBanner();
            ExamSecure.awayTimer = setInterval(() => {
                const left = ExamSecure.grace - Math.floor((Date.now() - ExamSecure.away.since) / 1000);
                ExamSecure.showBanner(left);
                if (left <= 0) submitNow('focus-lost');
            }, 1000);
        };
        const endAway = async () => {
            if (!ExamSecure.active || ExamSecure.leaving || !ExamSecure.away || document.hidden) return;
            const since = ExamSecure.away.since;
            if (Date.now() - since > ExamSecure.grace * 1000) { submitNow('focus-lost'); return; }
            ExamSecure.away = null;
            clearInterval(ExamSecure.awayTimer);
            ExamSecure.hideBanner();
            try {
                const r = await tellServer(false);
                if (r && r.submitted && ExamSecure.active && !ExamSecure.leaving) { ExamSecure.leaving = true; hooks.onSubmitted(r.reason); return; }
            } catch (e) { /* offline for a moment: the server decides when it hears from us again */ }
            // iOS and Android may stop the camera while the app is in the background: start it again.
            const t = ExamSecure.stream && ExamSecure.stream.getVideoTracks()[0];
            if (!t || t.readyState === 'ended') {
                if (!(await ExamSecure.restartCamera())) submitNow('camera-off');
            }
        };
        const onVis = () => { if (document.hidden) startAway(); else endAway(); };
        const onBlur = () => startAway();
        const onFocus = () => endAway();
        const onHide = () => startAway();
        document.addEventListener('visibilitychange', onVis);
        window.addEventListener('blur', onBlur);
        window.addEventListener('focus', onFocus);
        window.addEventListener('pagehide', onHide);
        window.addEventListener('pageshow', onFocus);
        const track = ExamSecure.stream && ExamSecure.stream.getVideoTracks()[0];
        // The camera stopping while the exam is on screen ends it; while the app is away it is restarted on return.
        const onEnded = () => { if (!ExamSecure.away && !document.hidden) submitNow('camera-off'); };
        if (track) track.addEventListener('ended', onEnded);
        ExamSecure.handlers = { onVis, onBlur, onFocus, onHide, track, onEnded };

        const snap = (kind) => ExamSecure.capture(kind);
        setTimeout(() => snap('start'), 800);
        ExamSecure.timer = setInterval(() => snap('check'), PHOTO_EVERY_MS);
    },

    showBanner: (left) => {
        let b = $('examAwayBanner');
        if (!b) {
            b = document.createElement('div');
            b.id = 'examAwayBanner';
            b.setAttribute('role', 'alert');
            b.className = 'fixed top-0 inset-x-0 z-[140] px-4 py-3 bg-red-700 text-white text-center text-sm font-black shadow-lg';
            document.body.appendChild(b);
        }
        const n = left === undefined ? ExamSecure.grace : Math.max(0, left);
        b.textContent = `You left the exam screen. Come back within ${n} second${n === 1 ? '' : 's'} or your exam will be submitted.`;
    },
    hideBanner: () => { clearInterval(ExamSecure.awayTimer); ExamSecure.awayTimer = null; $('examAwayBanner')?.remove(); },

    restartCamera: async () => {
        try {
            if (ExamSecure.stream) ExamSecure.stream.getTracks().forEach(t => t.stop());
            ExamSecure.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
            if (ExamSecure.video) { ExamSecure.video.srcObject = ExamSecure.stream; await ExamSecure.video.play().catch(() => {}); }
            const h = ExamSecure.handlers;
            const t = ExamSecure.stream.getVideoTracks()[0];
            if (h && t) { h.track = t; t.addEventListener('ended', h.onEnded); }
            return true;
        } catch (e) { return false; }
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
            window.removeEventListener('focus', h.onFocus);
            window.removeEventListener('pageshow', h.onFocus);
            window.removeEventListener('pagehide', h.onHide);
            if (h.track) h.track.removeEventListener('ended', h.onEnded);
        }
        ExamSecure.handlers = null;
        ExamSecure.away = null;
        ExamSecure.hideBanner();
        $('examSecureBadge')?.remove();
        if (releaseCamera) ExamSecure.release();
    },

};
