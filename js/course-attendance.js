// js/course-attendance.js
import { ClassMode } from './class-mode.js';
import { PlanDay } from './course-plan.js';
import { escapeHtml } from './html-utils.js';
import { apiFetch, apiPost } from './globals.js';
import { CourseScores } from './course-scores.js';
import { UI } from './ui-feedback.js';
import { termPoints } from './participation.js';
import { parseLocalDate, getWeekdayName, matchesScheduleDay } from './date-utils.js';

// ---- one place that paints a status on a student row (Present / Late / Absent / Excused, or null = nothing selected)
const STATUS_CLASSES = {
    Present: ['bg-green-100', 'text-green-800', 'border-green-400'],
    Late: ['bg-yellow-100', 'text-yellow-800', 'border-yellow-400'],
    Absent: ['bg-red-100', 'text-red-800', 'border-red-400'],
    Excused: ['bg-purple-100', 'text-purple-800', 'border-purple-400']
};
const IDLE_CLASSES = ['bg-gray-50', 'text-gray-600', 'border-gray-200'];
const ALL_STATUS_CLASSES = Object.values(STATUS_CLASSES).flat();
// Live P / L / A / E count for the date, shown in the roster header.
const COUNT_COLORS = { Present: 'text-green-700', Late: 'text-yellow-700', Absent: 'text-red-700', Excused: 'text-purple-700' };
let countFrame = 0;
export const refreshCounts = () => {
    if (countFrame) return;
    countFrame = requestAnimationFrame(() => {
        countFrame = 0;
        const box = document.getElementById('rosterCounts');
        if (!box) return;
        const c = { Present: 0, Late: 0, Absent: 0, Excused: 0 };
        document.querySelectorAll('.student-row .attendance-btn[data-selected="true"]').forEach(b => { if (c[b.dataset.status] !== undefined) c[b.dataset.status]++; });
        box.innerHTML = Object.keys(c).map(k => `<span class="${COUNT_COLORS[k]}">${c[k]}${k[0]}</span>`).join('');
    });
};
export const paintRowStatus = (row, status) => {
    row.querySelectorAll('.attendance-btn').forEach(btn => {
        btn.classList.remove(...ALL_STATUS_CLASSES);
        btn.classList.add(...IDLE_CLASSES);
        btn.removeAttribute('data-selected');
    });
    const btn = status ? row.querySelector(`.attendance-btn[data-status="${status}"]`) : null;
    if (btn && STATUS_CLASSES[status]) {
        btn.setAttribute('data-selected', 'true');
        btn.classList.remove(...IDLE_CLASSES);
        btn.classList.add(...STATUS_CLASSES[status]);
    }
    refreshCounts();
};

const getCourseId = () => window.location.hash.replace('#class-', '');
const getDate = () => document.getElementById('attendanceDate')?.value || '';
const dateKey = (courseId, date) => `${courseId}_${date}`;

export const CourseAttendance = {
    // What the server currently has for the selected date. The roster is "dirty"
    // (unsaved changes) whenever the on-screen state differs from this.
    baseline: {},
    baselineReady: false,

    // Direct-save state
    dateHasRecords: false,      // the server already holds records for the shown date
    confirmedDates: new Set(),  // dates the lecturer already confirmed/saved in this session
    gate: null,                 // confirmation in progress: { key, promise }
    chains: {},                 // per-student save queue
    timers: {},                 // per-student debounce timers
    bulkTimer: null,

    // Must be registered AFTER CourseModule.init() so the row is already updated when this runs.
    init: () => {
        document.addEventListener('click', CourseAttendance.handleAutoSaveClicks);
        document.addEventListener('input', CourseAttendance.handleAutoSaveInput);
    },

    handleAutoSaveClicks: (e) => {
        // Clicks fired by code (Mark All Present clicks every row) are ignored; #markAllPresent saves once.
        if (!e.isTrusted) return;

        const statusBtn = e.target.closest('.attendance-btn');
        if (statusBtn && statusBtn.closest('.student-row[data-auto-absent]')) return;
        if (statusBtn) {
            if (navigator.vibrate) navigator.vibrate(8);
            const row = statusBtn.closest('.student-row');
            if (row) CourseAttendance.queueAutoSave(row.dataset.studentId, 0);
            return;
        }

        const step = e.target.closest('.pts-step');
        if (step) {
            const row = step.closest('.student-row');
            if (row) CourseAttendance.queueAutoSave(row.dataset.studentId, 600);
            return;
        }

        if (e.target.closest('#markAllPresent')) {
            clearTimeout(CourseAttendance.bulkTimer);
            CourseAttendance.bulkTimer = setTimeout(CourseAttendance.autoSaveAll, 0);
        }
    },

    // Real keystrokes in a points box (code-made events are ignored).
    handleAutoSaveInput: (e) => {
        if (!e.isTrusted) return;
        if (!e.target.classList || !e.target.classList.contains('points-input')) return;
        const row = e.target.closest('.student-row');
        if (row) CourseAttendance.queueAutoSave(row.dataset.studentId, 700);
    },

    // Students with UD or Dropped status are always Absent with no points: the row is set, locked and tagged.
    applyAutoAbsent: () => {
        document.querySelectorAll('.student-row[data-auto-absent]').forEach(row => {
            paintRowStatus(row, 'Absent');
            row.querySelectorAll('.attendance-btn').forEach(btn => { btn.disabled = true; });
            const pts = row.querySelector('.points-input');
            if (pts) { pts.value = '0'; pts.disabled = true; }
            row.querySelectorAll('.pts-step').forEach(b => { b.disabled = true; });
            if (!row.querySelector('.auto-absent-tag')) {
                const tag = document.createElement('span');
                tag.className = 'auto-absent-tag inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-700 border border-red-200';
                tag.textContent = 'Absent automatically (UD / Dropped)';
                (row.querySelector('.attendance-btn')?.parentElement || row).appendChild(tag);
            }
        });
    },

    snapshotRow: (row) => {
        const selected = row.querySelector('.attendance-btn[data-selected="true"]');
        const pointsInput = row.querySelector('.points-input');
        return {
            status: selected ? selected.dataset.status : null,
            points: parseInt(pointsInput ? pointsInput.value : '0', 10) || 0
        };
    },

    snapshot: () => {
        const snap = {};
        document.querySelectorAll('.student-row').forEach(row => {
            snap[row.dataset.studentId] = CourseAttendance.snapshotRow(row);
        });
        return snap;
    },

    setBaseline: () => {
        CourseAttendance.baseline = CourseAttendance.snapshot();
        CourseAttendance.baselineReady = true;
    },

    isDirty: () => {
        if (!CourseAttendance.baselineReady) return true;
        return Array.from(document.querySelectorAll('.student-row')).some(row => {
            const base = CourseAttendance.baseline[row.dataset.studentId];
            const cur = CourseAttendance.snapshotRow(row);
            return !base || base.status !== cur.status || base.points !== cur.points;
        });
    },

    // How many students differ from what is saved (shown on Save All).
    dirtyCount: () => {
        if (!CourseAttendance.baselineReady) return 0;
        return Array.from(document.querySelectorAll('.student-row')).filter(row => {
            const base = CourseAttendance.baseline[row.dataset.studentId];
            const cur = CourseAttendance.snapshotRow(row);
            return !base || base.status !== cur.status || base.points !== cur.points;
        }).length;
    },

    // Puts the rows back to a snapshot() taken earlier, then saves each changed row (a cleared row is removed on the server).
    restoreSnapshot: (snap) => {
        document.querySelectorAll('.student-row').forEach(row => {
            const want = snap[row.dataset.studentId];
            if (!want) return;
            const cur = CourseAttendance.snapshotRow(row);
            if (cur.status === want.status && cur.points === want.points) return;
            paintRowStatus(row, want.status);
            const pts = row.querySelector('.points-input');
            if (pts) pts.value = String(want.points || 0);
            CourseAttendance.queueAutoSave(row.dataset.studentId, 0);
        });
        const courseId = getCourseId(), date = getDate();
        if (courseId && date) CourseAttendance.saveDraft(courseId, date);
    },

    // Shows or hides the "unsaved changes" dot on the sticky bar. Returns the dirty state.
    updateDirty: () => {
        const bar = document.getElementById('attendanceBar');
        if (!bar) return false;
        const dirty = CourseAttendance.isDirty();
        const courseId = window.location.hash.replace('#class-', '');
        const dateVal = document.getElementById('attendanceDate')?.value || '';
        const others = CourseAttendance.getDraftDates(courseId).filter(d => d !== dateVal);

        // Say exactly which date(s) hold unsaved changes.
        const parts = [];
        if (dirty && dateVal) parts.push(`Unsaved changes for ${CourseAttendance.describeDate(dateVal)}`);
        else if (dirty) parts.push('Unsaved changes');
        if (others.length > 0) {
            const shown = others.slice(0, 2).map(CourseAttendance.describeDate).join(', ');
            const more = others.length > 2 ? ` +${others.length - 2} more` : '';
            parts.push(`${dirty ? 'also unsaved' : 'Unsaved changes'} on ${shown}${more}`);
        }
        const text = parts.join(' | ');

        bar.dataset.dirty = dirty ? 'true' : 'false';
        bar.dataset.drafts = others.length > 0 ? 'true' : 'false';

        const label = document.getElementById('attendanceDirtyLabel');
        if (label) label.innerHTML = `<i class="fa-solid fa-circle text-[6px] align-middle mr-1"></i>${text}`;
        // Nothing unsaved (on screen or kept on this device): the label and the dot are hidden.
        const anyUnsaved = dirty || others.length > 0;
        if (label) label.classList.toggle('hidden', !anyUnsaved);
        const dot = document.getElementById('attendanceDirtyDot');
        if (dot) {
            dot.classList.toggle('hidden', !anyUnsaved);
            dot.title = dirty && dateVal ? `Unsaved changes for ${CourseAttendance.describeDate(dateVal)}` : 'Unsaved changes';
        }
        const status = document.getElementById('attendanceDirtyStatus');
        if (status) status.textContent = text;
        // "Save All (3)": how many students still differ from what is saved.
        const saveBtn = document.getElementById('saveAttendanceBtn');
        if (saveBtn && !saveBtn.disabled) {
            const n = dirty ? CourseAttendance.dirtyCount() : 0;
            saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk mr-2"></i> Save All${n ? ` (${n})` : ''}`;
        }
        return dirty;
    },

    // "2026-10-26 (Mon)"
    describeDate: (dateStr) => `${dateStr} (${getWeekdayName(dateStr).slice(0, 3)})`,

    // Dates (other than the saved state) that still have a local unsaved draft for this class.
    getDraftDates: (courseId) => {
        const prefix = `attendance_draft_${courseId}_`;
        const dates = [];
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(prefix)) dates.push(key.slice(prefix.length));
            }
        } catch (e) {}
        return dates.sort();
    },

    // Called after a single student's row has been saved.
    markSaved: (studentId) => {
        const row = document.querySelector(`.student-row[data-student-id="${studentId}"]`);
        if (row) CourseAttendance.baseline[studentId] = CourseAttendance.snapshotRow(row);
        if (!CourseAttendance.updateDirty()) {
            const courseId = window.location.hash.replace('#class-', '');
            const date = document.getElementById('attendanceDate')?.value;
            if (courseId && date) CourseAttendance.clearDraft(courseId, date);
        }
    },

    // Asks the lecturer to confirm when the date is not on the class's scheduled weekday.
    // Returns true when the date matches the schedule or the lecturer confirms it.
    confirmScheduleDay: async (dateStr, scheduleDay) => {
        const day = scheduleDay !== undefined
            ? scheduleDay
            : (document.getElementById('attendanceDate')?.dataset.scheduleDay || '');
        if (matchesScheduleDay(dateStr, day)) return true;
        return UI.confirm({
            title: 'Different day of the week',
            message: `${dateStr} is a ${getWeekdayName(dateStr)}, but this class is scheduled on ${day}. Is this date correct?`,
            confirmText: 'Yes, use this date'
        });
    },

    // ---------- Direct saving ----------

    isKnownDate: (courseId, date) =>
        CourseAttendance.dateHasRecords || CourseAttendance.confirmedDates.has(dateKey(courseId, date)),

    // Layer 1: first save for a date asks "new date?". Layer 2: a different weekday asks again.
    // Dates that already hold records skip both.
    confirmDateForSave: async (courseId, date) => {
        if (CourseAttendance.isKnownDate(courseId, date)) return true;

        const okNew = await UI.confirm({
            title: 'Save attendance for a new date?',
            message: `No attendance has been saved for ${CourseAttendance.describeDate(date)} yet. Save attendance for this new date?`,
            confirmText: 'Yes, save'
        });
        if (!okNew) return false;

        return CourseAttendance.confirmScheduleDay(date);
    },

    // Makes sure the shown date may be saved. For a brand-new date this confirms, then saves
    // the whole roster once. Returns false (declined/failed), 'saved' or 'known'.
    ensureDateReady: async (courseId, date) => {
        if (CourseAttendance.isKnownDate(courseId, date)) return 'known';

        const key = dateKey(courseId, date);
        if (CourseAttendance.gate && CourseAttendance.gate.key === key) return CourseAttendance.gate.promise;

        const promise = (async () => {
            if (!(await CourseAttendance.confirmDateForSave(courseId, date))) return false;
            const ok = await CourseAttendance.saveAllRows(courseId, date);
            return ok ? 'saved' : false;
        })();

        CourseAttendance.gate = { key, promise };
        try {
            return await promise;
        } finally {
            if (CourseAttendance.gate && CourseAttendance.gate.promise === promise) CourseAttendance.gate = null;
        }
    },

    // Declined confirmation: drop the unsaved edits and show what the server has.
    revertDate: async (courseId, date) => {
        CourseAttendance.clearDraft(courseId, date);
        UI.info('Not saved. Changes were discarded.');
        await CourseAttendance.loadAttendanceData(courseId, date);
    },

    queueAutoSave: (studentId, delay = 0) => {
        clearTimeout(CourseAttendance.timers[studentId]);
        CourseAttendance.timers[studentId] = setTimeout(() => CourseAttendance.autoSaveStudent(studentId), delay);
    },

    autoSaveStudent: async (studentId) => {
        const courseId = getCourseId();
        const date = getDate();
        if (!courseId || !date) return;

        const banner = document.getElementById('noClassBanner');
        if (banner && !banner.classList.contains('hidden')) return;

        const row = document.querySelector(`.student-row[data-student-id="${studentId}"]`);
        if (!row) return;

        // Nothing changed for a date that is already saved.
        if (CourseAttendance.dateHasRecords && CourseAttendance.baselineReady) {
            const base = CourseAttendance.baseline[studentId];
            const cur = CourseAttendance.snapshotRow(row);
            if (base && base.status === cur.status && base.points === cur.points) return;
        }

        const ready = await CourseAttendance.ensureDateReady(courseId, date);
        if (!ready) {
            if (getDate() === date) await CourseAttendance.revertDate(courseId, date);
            return;
        }
        await CourseAttendance.saveStudentNow(courseId, date, studentId);
    },

    // Saves one student's row. Saves for the same student run one after another.
    saveStudentNow: (courseId, date, studentId) => {
        const prev = CourseAttendance.chains[studentId] || Promise.resolve();
        const run = prev.then(async () => {
            if (getDate() !== date) return; // the screen moved to another date
            const row = document.querySelector(`.student-row[data-student-id="${studentId}"]`);
            if (!row) return;
            const snap = CourseAttendance.snapshotRow(row);
            try {
                await apiFetch('/api/attendance/single', {
                    method: 'POST',
                    body: JSON.stringify({ courseId, studentId, date, status: snap.status, points: snap.points })
                });
                CourseAttendance.baseline[studentId] = snap;
                CourseAttendance.baselineReady = true;
                if (snap.status) {
                    CourseAttendance.dateHasRecords = true;
                    CourseAttendance.confirmedDates.add(dateKey(courseId, date));
                }
                if (!CourseAttendance.updateDirty()) CourseAttendance.clearDraft(courseId, date);
            } catch (err) {
                const name = row.querySelector('.view-summary-trigger')?.dataset.name || 'student';
                UI.error(`Not saved for ${name}: ${err.message}`);
            }
        });
        CourseAttendance.chains[studentId] = run.catch(() => {});
        return run;
    },

    // Mark All Present: confirm if the date is new, then save the whole roster once.
    autoSaveAll: async () => {
        const courseId = getCourseId();
        const date = getDate();
        if (!courseId || !date) return;

        const banner = document.getElementById('noClassBanner');
        if (banner && !banner.classList.contains('hidden')) return;

        const ready = await CourseAttendance.ensureDateReady(courseId, date);
        if (!ready) {
            if (getDate() === date) await CourseAttendance.revertDate(courseId, date);
            return;
        }
        if (ready === 'known') {
            const before = CourseAttendance.preBulk;
            const saved = await CourseAttendance.saveAllRows(courseId, date);
            // Mark All Present can be taken back for a few seconds.
            if (saved && before && getDate() === date) {
                CourseAttendance.preBulk = null;
                UI.undo('Marked present', () => CourseAttendance.restoreSnapshot(before));
            }
        }
    },

    // Sends every marked row for the date in one request (replaces that date's records).
    saveAllRows: async (courseId, date) => {
        await Promise.all(Object.values(CourseAttendance.chains));

        const records = [];
        document.querySelectorAll('.student-row').forEach(row => {
            const snap = CourseAttendance.snapshotRow(row);
            if (snap.status) records.push({ studentId: row.dataset.studentId, status: snap.status, points: snap.points });
        });
        if (records.length === 0) return false;

        try {
            await apiFetch('/api/attendance', {
                method: 'POST',
                body: JSON.stringify({ courseId, date, records })
            });
        } catch (err) {
            UI.error(`Not saved: ${err.message}`);
            return false;
        }

        CourseAttendance.clearDraft(courseId, date);
        CourseAttendance.setBaseline();
        CourseAttendance.updateDirty();
        CourseAttendance.dateHasRecords = true;
        CourseAttendance.confirmedDates.add(dateKey(courseId, date));
        return true;
    },

    getDraftKey: (courseId, date) => `attendance_draft_${courseId}_${date}`,

    saveDraft: (courseId, date) => {
        const draft = {};
        document.querySelectorAll('.student-row').forEach(row => {
            const studentId = row.dataset.studentId;
            const selectedBtn = row.querySelector('.attendance-btn[data-selected="true"]');
            const pointsInput = row.querySelector('.points-input');

            draft[studentId] = {
                status: selectedBtn ? selectedBtn.dataset.status : null,
                points: pointsInput ? (pointsInput.value || '0') : '0'
            };
        });
        localStorage.setItem(`attendance_draft_${courseId}_${date}`, JSON.stringify(draft));
        // Nothing differs from what is saved, so there is no draft worth keeping.
        if (!CourseAttendance.updateDirty()) CourseAttendance.clearDraft(courseId, date);
    },

    clearDraft: (courseId, date) => {
        localStorage.removeItem(`attendance_draft_${courseId}_${date}`);
    },

    loadNoClassDays: async (courseId) => {
        const list = document.getElementById('noClassList');
        if (!list) return;

        list.innerHTML = '<div class="text-center py-4 text-gray-500 text-sm"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Loading...</div>';

        try {
            const ts = new Date().getTime();
            const data = await apiFetch(`/api/no-class?courseId=${courseId}&_t=${ts}`);

            if (!data.dates || data.dates.length === 0) {
                list.innerHTML = '<div class="text-center py-4 text-xs font-medium text-gray-500 italic">No dates currently set.</div>';
                return;
            }

            list.innerHTML = data.dates.map(d => `
                <div class="flex justify-between items-center bg-white p-2 border border-gray-200 rounded">
                    <span class="font-bold text-sm text-gray-700"><i class="fa-regular fa-calendar text-gray-400 mr-2"></i> ${d.Date}</span>
                    <button type="button" class="remove-no-class-btn text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2 py-1 rounded transition focus:outline-none" data-date="${d.Date}">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            `).join('');

        } catch (err) {
            list.innerHTML = `<div class="text-red-500 text-xs font-bold text-center py-2">${escapeHtml(err.message)}</div>`;
        }
    },

    // Save All button: saves every marked row (also the retry path if a direct save failed).
    saveAttendance: async () => {
        const btn = document.getElementById('saveAttendanceBtn');
        const alertBox = document.getElementById('attendanceAlert');
        const dateVal = document.getElementById('attendanceDate').value;
        const banner = document.getElementById('noClassBanner');
        const courseId = window.location.hash.replace('#class-', '');

        if (!dateVal) {
            alertBox.textContent = "Please select a date.";
            alertBox.className = "mb-4 p-3 rounded-md text-sm font-medium bg-red-100 text-red-700 block fade-in";
            return;
        }

        if (banner && !banner.classList.contains('hidden')) {
            alertBox.textContent = "Cannot save attendance on a designated No Class day.";
            alertBox.className = "mb-4 p-3 rounded-md text-sm font-medium bg-red-100 text-red-700 block fade-in";
            return;
        }

        // New date: confirm, then weekday check. Dates that already have records skip both.
        if (!(await CourseAttendance.confirmDateForSave(courseId, dateVal))) return;

        const rows = document.querySelectorAll('.student-row');
        const attendanceData = [];
        let missingCount = 0;

        rows.forEach(row => {
            const studentId = row.dataset.studentId;
            const selectedBtn = row.querySelector('.attendance-btn[data-selected="true"]');
            const pointsInput = row.querySelector('.points-input');
            const points = pointsInput ? (parseInt(pointsInput.value) || 0) : 0;

            if (selectedBtn) {
                attendanceData.push({
                    studentId: studentId,
                    status: selectedBtn.dataset.status,
                    points: points
                });
            } else {
                missingCount++;
            }
        });

        if (missingCount > 0) {
            const confirmProceed = await UI.confirm({
                title: 'Unmarked students',
                message: `${missingCount} student(s) have no attendance marked. Unmarked students will not be saved. Proceed anyway?`,
                confirmText: 'Save anyway'
            });
            if (!confirmProceed) return;
        }

        if (attendanceData.length === 0) {
             alertBox.textContent = "No attendance data to save.";
             alertBox.className = "mb-4 p-3 rounded-md text-sm font-medium bg-red-100 text-red-700 block fade-in";
             return;
        }

        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Saving...';

        try {
            await Promise.all(Object.values(CourseAttendance.chains));

            const payload = {
                courseId: courseId,
                date: dateVal,
                records: attendanceData
            };

            await apiPost('/api/attendance', payload);

            CourseAttendance.clearDraft(courseId, dateVal);
            CourseAttendance.setBaseline();
            CourseAttendance.updateDirty();
            CourseAttendance.dateHasRecords = true;
            CourseAttendance.confirmedDates.add(dateKey(courseId, dateVal));

            alertBox.textContent = "All Attendance saved successfully!";
            alertBox.className = "mb-4 p-3 rounded-md text-sm font-medium bg-green-100 text-green-700 block fade-in";
            UI.success('Attendance saved.');
            if (navigator.vibrate) navigator.vibrate(15);
        } catch (err) {
            alertBox.textContent = err.message;
            alertBox.className = "mb-4 p-3 rounded-md text-sm font-medium bg-red-100 text-red-700 block fade-in";
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-2"></i> Save All';
            setTimeout(() => { alertBox.classList.add('hidden'); }, 3000);
        }
    },

    loadAttendanceData: async (courseId, date) => {
        CourseAttendance.baselineReady = false;
        CourseAttendance.dateHasRecords = false;
        try {
            const ts = new Date().getTime();
            const data = await apiFetch(`/api/attendance?courseId=${courseId}&date=${date}&_t=${ts}`);

            ClassMode.load(courseId, date);
            PlanDay.load(courseId, date);

            // Remember whether this date is already saved on the server (drives the new-date confirmation).
            CourseAttendance.dateHasRecords = !!(data.records && data.records.length > 0) && !data.isNoClass;
            if (!CourseAttendance.dateHasRecords) CourseAttendance.confirmedDates.delete(dateKey(courseId, date));

            const noClassBanner = document.getElementById('noClassBanner');
            const container = document.getElementById('rosterListContainer');
            const saveBtn = document.getElementById('saveAttendanceBtn');
            const markAllBtn = document.getElementById('markAllPresent');

            if (data.isNoClass === true) {
                if(noClassBanner) noClassBanner.classList.remove('hidden');
                if(container) container.classList.add('opacity-50', 'pointer-events-none');
                if(saveBtn) saveBtn.disabled = true;
                if(markAllBtn) markAllBtn.disabled = true;
            } else {
                if(noClassBanner) noClassBanner.classList.add('hidden');
                if(container) container.classList.remove('opacity-50', 'pointer-events-none');
                if(saveBtn) saveBtn.disabled = false;
                if(markAllBtn) markAllBtn.disabled = false;
            }

            // Everyone starts Present (nothing on a no-class day); then the saved records replace that.
            const hasSaved = !!(data.records && data.records.length > 0) && !data.isNoClass;
            document.querySelectorAll('.student-row').forEach(row => {
                paintRowStatus(row, data.isNoClass || hasSaved ? null : 'Present');
                const pointsInput = row.querySelector('.points-input');
                if (pointsInput) pointsInput.value = '0';
            });

            if (hasSaved) {
                data.records.forEach(record => {
                    const row = document.querySelector(`.student-row[data-student-id="${record.Student_ID}"]`);
                    if (!row) return;
                    paintRowStatus(row, record.Status);
                    const pointsInput = row.querySelector('.points-input');
                    if (pointsInput) pointsInput.value = record.Performance_Points || '0';
                });
            }

            if (!data.isNoClass) CourseAttendance.applyAutoAbsent();

            // The saved state is now on screen; remember it before any local draft is applied.
            CourseAttendance.setBaseline();
            CourseAttendance.updateDirty();

            const draftStr = localStorage.getItem(`attendance_draft_${courseId}_${date}`);
            if (draftStr && !data.isNoClass) {
                try {
                    const draft = JSON.parse(draftStr);
                    let hasDraftChanges = false;

                    document.querySelectorAll('.student-row').forEach(row => {
                        const studentId = row.dataset.studentId;
                        if (draft[studentId]) {
                            hasDraftChanges = true;

                            const r = draft[studentId];
                            paintRowStatus(row, r.status || null);

                            const pointsInput = row.querySelector('.points-input');
                            if (pointsInput) pointsInput.value = r.points || '0';
                        }
                    });

                    if (hasDraftChanges && !CourseAttendance.updateDirty()) {
                        // Stale draft that matches what is already saved.
                        CourseAttendance.clearDraft(courseId, date);
                    } else if (hasDraftChanges) {
                        const alertBox = document.getElementById('attendanceAlert');
                        if (alertBox) {
                            alertBox.innerHTML = `<i class="fa-solid fa-clock-rotate-left mr-2"></i> Unsaved changes for ${CourseAttendance.describeDate(date)} restored from local cache. Press Save All to save them.`;
                            alertBox.className = "mb-4 mx-2 sm:mx-0 p-3 rounded-md text-sm font-medium bg-blue-100 text-blue-800 block fade-in";
                            alertBox.classList.remove('hidden');
                        }
                    }
                } catch(e) {}
            }

            CourseAttendance.updateDirty();

        } catch (err) {
            console.error("Failed to load attendance:", err);
        }
    },

    renderTermMetrics: (term, data) => {
        const course = data.course || {};
        const sessions = data.sessions || [];
        const records = data.records || [];
        const submissions = data.submissions || [];

        let termStart = '';
        let termEnd = '';

        if (term === 'midterm') {
            termStart = course.Midterm_Start || '';
            termEnd = course.Midterm_End || '';
        } else if (term === 'finalterm') {
            termStart = course.Final_Start || '';
            termEnd = course.Final_End || '';
        }

        const subTerm = term === 'midterm' ? 'MidTerm' : 'FinalTerm';
        const termSubmissions = submissions.filter(s => s.Term === subTerm);

        let totalNarrative = 0, totalIndividual = 0, totalReport = 0;
        termSubmissions.forEach(s => {
            totalNarrative += (s.Grade_Narrative || 0);
            totalIndividual += (s.Grade_Individual || 0);
            totalReport += (s.Grade_Report || 0);
        });

        const elNarrative = document.getElementById(`${term}NarrativeScore`);
        const elIndividual = document.getElementById(`${term}IndividualScore`);
        const elReport = document.getElementById(`${term}ReportScore`);

        if (elNarrative) elNarrative.textContent = totalNarrative;
        if (elIndividual) elIndividual.textContent = totalIndividual;
        if (elReport) elReport.textContent = totalReport;

        let present = 0, late = 0, excused = 0, absent = 0, totalParticipationPts = 0;
        let classDays = 0;
        let pct = 0;

        if (termStart && termEnd) {
            const tStart = parseLocalDate(termStart);
            const tEnd = parseLocalDate(termEnd);

            const dayMap = { 'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6 };
            const dayStr = (course.ScheduleDay || '').trim().toLowerCase();
            const targetDay = dayMap[dayStr];

            let theoreticalDays = 0;

            if (targetDay !== undefined && tStart && tEnd) {
                let currentDate = new Date(tStart.getFullYear(), tStart.getMonth(), tStart.getDate());
                let endDate = new Date(tEnd.getFullYear(), tEnd.getMonth(), tEnd.getDate());

                while (currentDate <= endDate) {
                    if (currentDate.getDay() === targetDay) {
                        theoreticalDays++;
                    }
                    currentDate.setDate(currentDate.getDate() + 1);
                }
            }

            let noClassDaysCount = 0;
            sessions.forEach(s => {
                if (s.Is_No_Class === 1) {
                    const sDate = parseLocalDate(s.Date);
                    if (sDate && tStart && tEnd && sDate >= tStart && sDate <= tEnd && sDate.getDay() === targetDay) {
                        noClassDaysCount++;
                    }
                }
            });

            const baseClassDays = theoreticalDays - noClassDaysCount;

            const termRecords = records.filter(r => {
                const rDate = parseLocalDate(r.Date);
                if (!rDate || !tStart || !tEnd) return false;
                return rDate >= tStart && rDate <= tEnd;
            });

            termRecords.forEach(r => {
                if (r.Status === 'Present') present++;
                else if (r.Status === 'Late') late++;
                else if (r.Status === 'Excused') excused++;
                else if (r.Status === 'Absent') absent++;

            });
            totalParticipationPts = termPoints(termRecords, baseClassDays);

            classDays = baseClassDays - excused;
            if (classDays < 0) classDays = 0;

            const attendanceScore = (present * 1) + (late * 0.5);
            if (classDays > 0) {
                pct = ((attendanceScore / classDays) * 100).toFixed(1);
            }
        }

        document.getElementById(`${term}Present`).textContent = present;
        document.getElementById(`${term}Late`).textContent = late;
        document.getElementById(`${term}Excused`).textContent = excused;
        document.getElementById(`${term}Absent`).textContent = absent;
        document.getElementById(`${term}TotalDays`).textContent = classDays;
        document.getElementById(`${term}AttendancePct`).textContent = pct;
        document.getElementById(`${term}ParticipationScore`).textContent = totalParticipationPts;

        CourseScores.renderTermScores(term, data);
    }
};
