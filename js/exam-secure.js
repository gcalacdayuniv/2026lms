// js/exam-secure.js
// Secure exam mode for students sitting an online exam:
//  - before the exam: a notice and the camera permission (the exam does not start without the camera);
//  - during the exam: a small photo when it starts and every 30 seconds, sent to the lecturer's private Drive folder;
//  - leaving the exam screen (switching tab, app or window, locking the screen) starts a 5 second grace period;
//    staying away longer submits the answers (the server enforces it too, because phones freeze the page in the background).
// The notice has one Start exam button. A device that already allowed the camera goes straight in; otherwise the face verification screen asks for the camera and a photo inside an oval.
// Students flagged Legally Blind are exempt unless their lecturer turns it on (the server decides: student.secure).
// Lecturers review the photos in js/exam-photo-review.js (Manage Exams > Results > Photos, or Manage Student > Exam photos).
import { apiFetch, apiPost } from './globals.js';
import { escapeHtml } from './html-utils.js';

const PHOTO_EVERY_MS = 30000;
const AWAY_GRACE_SECONDS = 5;    // the server uses the same number (worker/exam-session.js)
const PHOTO_WIDTH = 320;
const CAMERA_OK_KEY = 'exam_camera_ok';
const OVAL_RX = 0.34, OVAL_RY = 0.34;   // the verification oval, as a share of the picture (face check looks inside it)
const $ = (id) => document.getElementById(id);

export const ExamSecure = {
    stream: null, video: null, verifyShot: null, timer: null, active: false, paused: 0, leaving: false, away: null, awayTimer: null, grace: AWAY_GRACE_SECONDS,
    ctx: null, handlers: null,

    // Opens the front camera and keeps it running (hidden) for the photos. Throws when it cannot.
    openCamera: async () => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser cannot use the camera. Open the app in Safari or Chrome.');
        ExamSecure.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        const v = document.createElement('video');
        v.setAttribute('playsinline', ''); v.muted = true; v.autoplay = true;
        v.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;left:0;top:0';
        v.srcObject = ExamSecure.stream;
        document.body.appendChild(v);
        await v.play().catch(() => {});
        ExamSecure.video = v;
        try { localStorage.setItem(CAMERA_OK_KEY, '1'); } catch (e) { /* storage blocked: the dialog just shows again next time */ }
    },

    // true when this device already allowed the camera (the browser says so, or it worked here before).
    cameraAllowed: async () => {
        try {
            if (navigator.permissions && navigator.permissions.query) {
                const st = await navigator.permissions.query({ name: 'camera' });
                if (st.state === 'granted') return true;
                if (st.state === 'denied') return false;
            }
        } catch (e) { /* Safari cannot query the camera permission */ }
        try { return localStorage.getItem(CAMERA_OK_KEY) === '1'; } catch (e) { return false; }
    },

    // Notice with a single Start exam button. A device that already allowed the camera goes straight into the exam;
    // otherwise the student goes through the face verification screen (allow the camera, take a photo inside the oval).
    // Resolves true when the camera works and the student may start.
    prepare: () => new Promise((resolve) => {
        ExamSecure.verifyShot = null;
        $('examSecureDlg')?.remove();
        const dlg = document.createElement('div');
        dlg.id = 'examSecureDlg';
        dlg.className = 'fixed inset-0 z-[130] flex items-center justify-center p-4 fade-in';
        dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-labelledby', 'examSecureTitle');
        dlg.innerHTML = `<div class="absolute inset-0 bg-gray-900 bg-opacity-70"></div>
            <div class="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
                <div class="mx-auto mb-3 w-14 h-14 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-2xl"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i></div>
                <h3 id="examSecureTitle" class="text-xl font-black text-gray-900 text-center mb-3">Secure exam</h3>
                <ul class="text-sm text-gray-700 space-y-2 mb-4 list-disc pl-5">
                    <li><b>If you leave the exam screen</b> (switch tab, app or window, or lock the phone)</b>. your exam is submitted automatically.</li>
                    <li>Signing in to your account on another device also submits your exam.</li>
                    <li>Put your phone on Do Not Disturb so calls and notifications do not pull you away.</li>
                </ul>
                <button type="button" id="examSecureGo" class="w-full min-h-[3.25rem] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-black">Start exam</button>
                <button type="button" id="examSecureNo" class="mt-2 w-full py-2 text-sm font-bold text-gray-500 hover:text-gray-800">Cancel</button>
            </div>`;
        document.body.appendChild(dlg);
        const done = (ok) => { dlg.remove(); resolve(ok); };
        dlg.querySelector('#examSecureNo').addEventListener('click', () => done(false));
        const go = dlg.querySelector('#examSecureGo');
        go.addEventListener('click', async () => {
            go.disabled = true;
            if (await ExamSecure.cameraAllowed()) {
                try { await ExamSecure.openCamera(); done(true); return; } catch (e) { ExamSecure.release(); /* blocked or busy: verify below */ }
            }
            dlg.classList.add('hidden');
            const ok = await ExamSecure.verifyFace();
            done(ok);
        });
        go.focus();
    }),

    // Brightness and contrast inside the oval (0..1 of the frame): a dark, covered or blank camera fails.
    // Where the browser has a face detector (Chrome on Android) it must also find a face in the oval.
    checkFrame: async (canvas) => {
        const W = 96, H = Math.max(1, Math.round(96 * canvas.height / canvas.width));
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(canvas, 0, 0, W, H);
        const px = g.getImageData(0, 0, W, H).data;
        let n = 0, sum = 0, sum2 = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const nx = (x + 0.5) / W - 0.5, ny = (y + 0.5) / H - 0.5;
            if ((nx * nx) / (OVAL_RX * OVAL_RX) + (ny * ny) / (OVAL_RY * OVAL_RY) > 1) continue;
            const i = (y * W + x) * 4, l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
            n++; sum += l; sum2 += l * l;
        }
        const mean = sum / (n || 1), sd = Math.sqrt(Math.max(0, sum2 / (n || 1) - mean * mean));
        if (mean < 45) return 'It is too dark. Move to a brighter place and try again.';
        if (mean > 225) return 'It is too bright. Move away from the light behind you and try again.';
        if (sd < 20) return 'We could not see a face. Make sure the camera is not covered, and fit your face inside the oval.';
        if (typeof window.FaceDetector === 'function') {
            try {
                const faces = await new window.FaceDetector({ fastMode: true, maxDetectedFaces: 3 }).detect(canvas);
                const inOval = faces.filter(f => {
                    const cx = (f.boundingBox.x + f.boundingBox.width / 2) / canvas.width - 0.5, cy = (f.boundingBox.y + f.boundingBox.height / 2) / canvas.height - 0.5;
                    return (cx * cx) / ((OVAL_RX * 1.2) ** 2) + (cy * cy) / ((OVAL_RY * 1.2) ** 2) <= 1;
                });
                if (!inOval.length) return 'We could not find your face inside the oval. Look at the camera and fit your face inside it.';
                if (faces.length > 1) return 'More than one face was found. Only the student may be in the picture.';
            } catch (e) { /* the detector is not usable here: the brightness check stands */ }
        }
        return '';
    },

    // Face verification screen: allow the camera, fit the face inside the oval, take a photo, it is checked, then the exam starts.
    verifyFace: () => new Promise((resolve) => {
        $('examVerifyScr')?.remove();
        const scr = document.createElement('div');
        scr.id = 'examVerifyScr';
        scr.className = 'fixed inset-0 z-[135] bg-gray-50 flex flex-col fade-in';
        scr.setAttribute('role', 'dialog'); scr.setAttribute('aria-modal', 'true'); scr.setAttribute('aria-labelledby', 'examVerifyTitle');
        scr.innerHTML = `<div class="shrink-0 flex items-center gap-3 px-4 py-3 border-b bg-white" style="padding-top:max(0.75rem, env(safe-area-inset-top))">
                <h3 id="examVerifyTitle" class="flex-1 min-w-0 text-lg font-black text-gray-900"><i class="fa-solid fa-user-check text-blue-600 mr-2" aria-hidden="true"></i>Face verification</h3>
                <button type="button" id="evCancel" class="text-sm font-bold text-gray-500 hover:text-gray-800 px-2 py-2">Cancel</button></div>
            <div class="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col items-center">
                <p id="evMsg" class="text-sm text-gray-700 text-center max-w-sm mb-3">Allow the camera, then fit your face inside the oval and take a photo. You need to do this before the exam starts.</p>
                <div id="evBox" class="relative w-full max-w-xs bg-gray-900 rounded-2xl overflow-hidden" style="aspect-ratio:3/4">
                    <video id="evVideo" playsinline muted autoplay class="hidden absolute inset-0 w-full h-full object-cover" style="transform:scaleX(-1)"></video>
                    <img id="evStill" alt="" class="hidden absolute inset-0 w-full h-full object-cover" style="transform:scaleX(-1)">
                    <div id="evIdle" class="absolute inset-0 flex items-center justify-center text-gray-500 text-6xl"><i class="fa-solid fa-camera" aria-hidden="true"></i></div>
                    <svg id="evOval" class="absolute inset-0 w-full h-full pointer-events-none hidden" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                        <defs><mask id="evMask"><rect width="100" height="100" fill="#fff"/><ellipse cx="50" cy="50" rx="${OVAL_RX * 100}" ry="${OVAL_RY * 100}" fill="#000"/></mask></defs>
                        <rect width="100" height="100" fill="rgba(15,23,42,.62)" mask="url(#evMask)"/>
                        <ellipse id="evRing" cx="50" cy="50" rx="${OVAL_RX * 100}" ry="${OVAL_RY * 100}" fill="none" stroke="#fff" stroke-width="0.8" stroke-dasharray="3 2" vector-effect="non-scaling-stroke"/>
                    </svg>
                </div>
                <p id="evErr" class="hidden mt-3 text-sm font-bold text-red-700 text-center max-w-sm" role="alert"></p>
            </div>
            <div class="shrink-0 px-4 pt-3 bg-white border-t" style="padding-bottom:max(1rem, env(safe-area-inset-bottom))">
                <button type="button" id="evGo" class="w-full max-w-xs mx-auto block min-h-[3.25rem] rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-lg font-black">Allow camera</button></div>`;
        document.body.appendChild(scr);
        const q = (id) => scr.querySelector(id);
        const msg = q('#evMsg'), err = q('#evErr'), go = q('#evGo'), vid = q('#evVideo'), still = q('#evStill'), oval = q('#evOval'), idle = q('#evIdle');
        let state = 'allow';      // allow -> live -> checking -> (retry -> live) | ok
        const finish = (ok) => { vid.srcObject = null; scr.remove(); if (!ok) ExamSecure.release(); resolve(ok); };
        const showErr = (t) => { err.textContent = t || ''; err.classList.toggle('hidden', !t); };
        const live = () => {
            state = 'live';
            still.classList.add('hidden'); vid.classList.remove('hidden'); oval.classList.remove('hidden'); idle.classList.add('hidden');
            msg.textContent = 'Fit your face inside the oval, look at the camera, then take the photo.';
            go.textContent = 'Take photo'; go.disabled = false;
        };
        q('#evCancel').addEventListener('click', () => finish(false));
        go.addEventListener('click', async () => {
            showErr('');
            if (state === 'allow') {
                go.disabled = true; go.textContent = 'Opening camera...';
                try {
                    await ExamSecure.openCamera();
                    vid.srcObject = ExamSecure.stream;
                    await vid.play().catch(() => {});
                    live();
                } catch (e) {
                    ExamSecure.release();
                    go.disabled = false; go.textContent = 'Allow camera';
                    showErr(e && e.name === 'NotAllowedError'
                        ? 'The camera is blocked. Allow the camera for this site in your browser settings, then tap Allow camera again.'
                        : (e && e.message) || 'The camera could not be started.');
                }
                return;
            }
            if (state === 'live' || state === 'retry') {
                if (state === 'retry') { live(); return; }
                if (!vid.videoWidth) { showErr('The camera is not ready yet. Wait a moment and try again.'); return; }
                state = 'checking'; go.disabled = true; go.textContent = 'Checking...';
                // The box is 3:4 and the video fills it (object-fit: cover), so the photo is cut the same way: what is inside the oval is what is checked.
                const vw = vid.videoWidth, vh = vid.videoHeight, want = 3 / 4;
                let sw = vw, sh = vh;
                if (vw / vh > want) sw = vh * want; else sh = vw / want;
                const c = document.createElement('canvas');
                c.width = 480; c.height = 640;
                c.getContext('2d').drawImage(vid, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, c.width, c.height);
                still.src = c.toDataURL('image/jpeg', 0.7);
                still.classList.remove('hidden'); vid.classList.add('hidden');
                msg.textContent = 'Checking your photo...';
                const problem = await ExamSecure.checkFrame(c);
                if (problem) {
                    state = 'retry'; msg.textContent = 'Fit your face inside the oval and try again.';
                    showErr(problem); go.disabled = false; go.textContent = 'Retake photo';
                    return;
                }
                state = 'ok';
                ExamSecure.verifyShot = c.toDataURL('image/jpeg', 0.7).split(',')[1];   // becomes the exam's initial photo (the one lecturers can see)
                msg.textContent = 'Verified. Starting your exam...';
                scr.querySelector('#evRing').setAttribute('stroke', '#34d399');
                go.innerHTML = '<i class="fa-solid fa-check mr-1" aria-hidden="true"></i>Verified';
                setTimeout(() => finish(true), 900);
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
        setTimeout(() => ExamSecure.initialPhoto(), 800);
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

    // The initial photo (Kind 'start') is what a lecturer sees; the face verification photo when there was one, else a new picture.
    initialPhoto: async () => {
        const shot = ExamSecure.verifyShot, c = ExamSecure.ctx;
        ExamSecure.verifyShot = null;
        if (!shot || !c) return ExamSecure.capture('start');
        try { await apiPost('/api/exam-photo', { assignmentId: c.assignmentId, studentId: c.studentId, kind: 'start', base64: shot }); }
        catch (e) { ExamSecure.capture('start'); }
    },

    capture: async (kind) => {
        const v = ExamSecure.video, c = ExamSecure.ctx;
        if (!ExamSecure.active || !v || !c || !v.videoWidth) return;
        try {
            const canvas = document.createElement('canvas');
            canvas.width = PHOTO_WIDTH;
            canvas.height = Math.round(PHOTO_WIDTH * v.videoHeight / v.videoWidth);
            canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
            const base64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
            await apiPost('/api/exam-photo', { assignmentId: c.assignmentId, studentId: c.studentId, kind, base64 });
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
