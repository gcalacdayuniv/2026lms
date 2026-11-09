// js/course-pending.js
// "Is everything for this class really recorded?" Attendance edits are saved automatically, but a copy (draft)
// stays on the device until the server is known to hold the same data. This module asks the server about every
// date that still has a draft, in the same spirit as the scanned-sheet queue:
//   - the server already has the same data  -> the draft is confirmed and cleared
//   - the server differs or is unreachable   -> the date is listed as waiting, with Upload and Discard
// Scanned sheets that wait in ScanQueue are listed too. Result is shown in #pendingSyncBanner (components-class.js).
import { apiFetch } from './globals.js';
import { CourseAttendance } from './course-attendance.js';
import { ScanQueue } from './course-scan-queue.js';
import { UI } from './ui-feedback.js';
import { escapeHtml } from './html-utils.js';

const courseIdNow = () => window.location.hash.startsWith('#class-') ? window.location.hash.replace('#class-', '') : '';
const openDate = () => document.getElementById('attendanceDate')?.value || '';
const banner = () => document.getElementById('pendingSyncBanner');

// Absent and Excused always keep 0 points, so they compare equal whatever the stored number is.
const norm = (status, points) => ({
    s: status || null,
    p: (status === 'Absent' || status === 'Excused') ? 0 : (parseInt(points, 10) || 0)
});

// How many students differ between the saved draft and the server's records (0 = same).
export const countChanges = (draft, records) => {
    const byStudent = {};
    (records || []).forEach(r => { byStudent[r.Student_ID] = r; });
    let changes = 0;
    Object.entries(draft || {}).forEach(([studentId, d]) => {
        const rec = byStudent[studentId];
        const a = norm(d && d.status, d && d.points);
        const b = norm(rec && rec.Status, rec && rec.Performance_Points);
        if (a.s !== b.s || a.p !== b.p) changes++;
    });
    return changes;
};

const readDraft = (courseId, date) => {
    try { return JSON.parse(localStorage.getItem(CourseAttendance.getDraftKey(courseId, date))) || {}; } catch (e) { return {}; }
};

export const CoursePending = {
    running: false,
    state: { courseId: '', waiting: [], scans: 0, offline: false },

    // Checks every draft date of the class against the server. Returns the dates it confirmed and cleared.
    check: async (courseId = courseIdNow(), { quiet = false } = {}) => {
        if (!courseId || CoursePending.running) return [];
        CoursePending.running = true;
        const confirmed = [];
        const waiting = [];
        let offline = false;
        try {
            const current = openDate();
            for (const date of CourseAttendance.getDraftDates(courseId)) {
                // The date on screen is still being saved by the normal auto-save.
                if (date === current && CourseAttendance.isDirty()) { waiting.push({ date, saving: true }); continue; }
                try {
                    const data = await apiFetch(`/api/attendance?courseId=${courseId}&date=${date}&_t=${Date.now()}`);
                    if (data.isNoClass === true) { CourseAttendance.clearDraft(courseId, date); confirmed.push({ date, noClass: true }); continue; }
                    const changes = countChanges(readDraft(courseId, date), data.records);
                    if (changes === 0 && data.records && data.records.length > 0) {
                        CourseAttendance.clearDraft(courseId, date);
                        confirmed.push({ date });
                    } else {
                        waiting.push({ date, changes: Math.max(changes, 1), onServer: !!(data.records && data.records.length) });
                    }
                } catch (err) {
                    offline = true;
                    waiting.push({ date, unknown: true });
                }
            }
        } finally {
            CoursePending.running = false;
        }
        CoursePending.state = { courseId, waiting, scans: ScanQueue.count(courseId), offline };
        CourseAttendance.updateDirty();
        CoursePending.render();
        if (confirmed.length && !quiet) {
            UI.success(confirmed.length === 1
                ? `${CourseAttendance.describeDate(confirmed[0].date)} is confirmed saved`
                : `${confirmed.length} dates confirmed saved`);
        }
        return confirmed;
    },

    render: () => {
        const el = banner();
        if (!el) return;
        const { courseId, waiting, scans, offline } = CoursePending.state;
        if (courseId !== courseIdNow() || (waiting.length === 0 && scans === 0)) {
            el.classList.add('hidden');
            el.innerHTML = '';
            return;
        }
        const rows = waiting.map(w => {
            const label = escapeHtml(CourseAttendance.describeDate(w.date));
            if (w.saving) return `<li class="flex items-center justify-between gap-2 py-1"><span class="font-bold">${label}</span><span class="text-xs text-amber-700"><i class="fa-solid fa-spinner fa-spin mr-1" aria-hidden="true"></i>saving</span></li>`;
            const note = w.unknown ? 'not checked yet' : `${w.changes} change${w.changes === 1 ? '' : 's'}${w.onServer ? '' : ', new date'}`;
            return `<li class="flex items-center justify-between gap-2 py-1">
                <span class="min-w-0"><span class="font-bold">${label}</span> <span class="text-xs text-amber-700">${note}</span></span>
                <span class="flex gap-1 flex-shrink-0">
                    <button type="button" class="pending-upload px-2.5 py-1 rounded-md bg-blue-600 text-white text-xs font-bold" data-date="${escapeHtml(w.date)}">Upload</button>
                    <button type="button" class="pending-discard px-2.5 py-1 rounded-md bg-white border border-gray-300 text-gray-700 text-xs font-bold" data-date="${escapeHtml(w.date)}">Discard</button>
                </span></li>`;
        }).join('');
        const scanRow = scans > 0
            ? `<li class="flex items-center justify-between gap-2 py-1"><span class="font-bold">${scans} scanned sheet${scans === 1 ? '' : 's'}</span><button type="button" class="pending-open-scanner px-2.5 py-1 rounded-md bg-blue-600 text-white text-xs font-bold">Open scanner</button></li>`
            : '';
        el.innerHTML = `
            <div class="flex items-center justify-between gap-2 mb-1">
                <div class="font-bold"><i class="fa-solid fa-cloud-arrow-up mr-2" aria-hidden="true"></i>Not recorded on the server yet</div>
                <button type="button" class="pending-recheck px-2 py-1 rounded-md text-xs font-bold text-amber-800 border border-amber-300 bg-white">Check again</button>
            </div>
            ${offline ? '<div class="text-xs text-amber-700 mb-1">Cannot reach the server. It checks again when you are back online.</div>' : ''}
            <ul class="divide-y divide-amber-200">${rows}${scanRow}</ul>`;
        el.classList.remove('hidden');
    },

    // Opens the date, lets the normal save path (with its new-date and weekday confirmations) record it, then verifies.
    upload: async (date) => {
        const courseId = courseIdNow();
        const input = document.getElementById('attendanceDate');
        if (!courseId || !input) return;
        input.value = date;
        await CourseAttendance.loadAttendanceData(courseId, date);
        await CourseAttendance.autoSaveAll();
        const confirmed = await CoursePending.check(courseId, { quiet: true });
        if (confirmed.some(c => c.date === date)) UI.success(`${CourseAttendance.describeDate(date)} saved`);
        else if (!CoursePending.state.waiting.some(w => w.date === date)) UI.success(`${CourseAttendance.describeDate(date)} is up to date`);
        else UI.error('Still not recorded. Check your connection and try again.');
    },

    discard: async (date) => {
        const courseId = courseIdNow();
        if (!courseId) return;
        const ok = await UI.confirm({
            title: 'Discard unsaved changes?',
            message: `The changes kept on this device for ${CourseAttendance.describeDate(date)} will be deleted. The server keeps what it already has.`,
            confirmText: 'Discard',
            danger: true
        });
        if (!ok) return;
        CourseAttendance.clearDraft(courseId, date);
        if (openDate() === date) await CourseAttendance.loadAttendanceData(courseId, date);
        await CoursePending.check(courseId, { quiet: true });
    },

    init: () => {
        document.addEventListener('click', (e) => {
            if (!e.target.closest) return;
            const up = e.target.closest('.pending-upload');
            const dis = e.target.closest('.pending-discard');
            if (up) CoursePending.upload(up.dataset.date);
            else if (dis) CoursePending.discard(dis.dataset.date);
            else if (e.target.closest('.pending-recheck')) CoursePending.check();
            else if (e.target.closest('.pending-open-scanner')) document.getElementById('openScannerBtn')?.click();
        });
        // Back online, or the app comes back to the front: ask the server again.
        window.addEventListener('online', () => CoursePending.check());
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') CoursePending.check(undefined, { quiet: true }); });
        // Scanned sheets are uploaded by their own queue; keep the count in the banner current.
        window.addEventListener('storage', () => CoursePending.render());
    }
};
