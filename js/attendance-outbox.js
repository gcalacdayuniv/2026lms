// js/attendance-outbox.js
// Attendance marks that could not be sent because the connection dropped. The mark stays on screen, is kept on this device
// and is sent again by itself when the signal is back (online event, every 15 s, when the app comes to the front, or a tap on the pill).
// One waiting mark per student per date: the newest wins. A server "no" (not your class, bad data) is not retried: it is dropped and shown.
// Used by the floor plan (/api/attendance/single, Rest = many singles) and the list view's one-row saves.
import { apiFetch, AppState } from './globals.js';
import { UI } from './ui-feedback.js';

const KEY = 'att_outbox_v1';
const EVERY = 15000;
let timer = null, flushing = false;

const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
const write = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* storage blocked: marks only live on screen */ } };
const me = () => String((AppState.user && AppState.user.User_ID) || '');
const same = (a, b) => a.courseId === b.courseId && a.studentId === b.studentId && a.date === b.date;
const mine = () => read().filter(e => e.uid === me());

const pill = () => {
    let el = document.getElementById('attOutboxPill');
    if (!el) {
        el = document.createElement('button');
        el.type = 'button'; el.id = 'attOutboxPill'; el.setAttribute('role', 'status');
        el.className = 'hidden fixed left-3 bottom-3 z-[400] min-h-[44px] px-3 rounded-full bg-amber-600 text-white text-sm font-bold shadow-lg';
        el.style.bottom = 'max(0.75rem, env(safe-area-inset-bottom))';
        el.addEventListener('click', () => { AttendanceOutbox.flush(true); });
        document.body.appendChild(el);
    }
    return el;
};

export const AttendanceOutbox = {
    count: () => mine().length,

    paint: () => {
        const n = AttendanceOutbox.count(), el = pill();
        el.classList.toggle('hidden', n === 0);
        el.innerHTML = `<i class="fa-solid fa-cloud-arrow-up mr-1.5" aria-hidden="true"></i>${n} mark${n === 1 ? '' : 's'} waiting to sync`;
        el.title = 'No signal. Marks are saved on this phone and sent when you are back online. Tap to try now.';
        if (n && !timer) timer = setInterval(() => AttendanceOutbox.flush(), EVERY);
        if (!n && timer) { clearInterval(timer); timer = null; }
    },

    // Keep a mark for later (replaces an older waiting mark for the same student and date).
    queue: (entry) => {
        const e = { ...entry, uid: me(), ts: Date.now() };
        write([...read().filter(x => !(x.uid === e.uid && same(x, e))), e]);
        AttendanceOutbox.paint();
    },

    // Sends one mark. Resolves 'saved' or 'queued' (no signal). A server refusal throws, as before.
    send: async (entry) => {
        try {
            await apiFetch('/api/attendance/single', { method: 'POST', body: JSON.stringify(entry), timeoutMs: 12000 });
            if (read().some(x => x.uid === me() && same(x, entry))) { write(read().filter(x => !(x.uid === me() && same(x, entry)))); AttendanceOutbox.paint(); }   // a newer save replaces a waiting one
            return 'saved';
        } catch (err) {
            if (!err || !err.network) throw err;
            AttendanceOutbox.queue(entry);
            return 'queued';
        }
    },

    // Waiting marks for one class day, to lay over what the server says (so a reload while offline still shows them).
    overlay: (courseId, date, records) => {
        mine().filter(e => e.courseId === courseId && e.date === date).forEach(e => {
            if (e.status) records.set(e.studentId, { status: e.status, points: Number(e.points) || 0 }); else records.delete(e.studentId);
        });
        return records;
    },

    flush: async (verbose = false) => {
        if (flushing) return;
        const list = mine();
        if (!list.length || !AppState.token) { AttendanceOutbox.paint(); return; }
        flushing = true;
        let sent = 0, dropped = 0;
        try {
            for (const e of list) {
                try {
                    await apiFetch('/api/attendance/single', { method: 'POST', body: JSON.stringify({ courseId: e.courseId, studentId: e.studentId, date: e.date, status: e.status, points: e.points }), timeoutMs: 12000 });
                    sent++;
                } catch (err) {
                    if (err && err.network) { if (verbose) UI.warning('Still no signal. Your marks are kept on this phone.'); break; }
                    dropped++;   // the server refused it: retrying cannot help
                    UI.error(`A waiting mark was not accepted: ${err.message}`);
                }
                write(read().filter(x => !(x.uid === e.uid && same(x, e) && x.ts === e.ts)));   // only if it was not replaced meanwhile
            }
        } finally { flushing = false; }
        AttendanceOutbox.paint();
        if (sent) {
            UI.success(`Synced ${sent} attendance mark${sent === 1 ? '' : 's'}.`);
            document.dispatchEvent(new CustomEvent('attendance-synced', { detail: { sent } }));
        }
    },

    init: () => {
        window.addEventListener('online', () => AttendanceOutbox.flush());
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') AttendanceOutbox.flush(); });
        AttendanceOutbox.paint();
        setTimeout(() => AttendanceOutbox.flush(), 2500);   // marks left from last time, once the session is ready
    }
};
