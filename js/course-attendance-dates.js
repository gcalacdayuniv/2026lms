// js/course-attendance-dates.js
// Lecturer tools for dates that have attendance records: view, change, delete and merge.
import { apiFetch } from './globals.js';
import { UI } from './ui-feedback.js';
import { CourseAttendance } from './course-attendance.js';
import { getWeekdayName, matchesScheduleDay } from './date-utils.js';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const getCourseId = () => window.location.hash.replace('#class-', '');
const getScheduleDay = () => document.getElementById('attendanceDate')?.dataset.scheduleDay || '';
const byId = (id) => document.getElementById(id);

export const CourseAttendanceDates = {
    courseId: null,
    dates: [],
    selected: [],
    editDate: null,

    init: () => {
        document.addEventListener('click', CourseAttendanceDates.handleClicks);
        document.addEventListener('change', CourseAttendanceDates.handleChanges);
    },

    showAlert: (message, type = 'error') => {
        const box = byId('adAlert');
        if (!box) return;
        const colors = type === 'error' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700';
        box.textContent = message;
        box.className = `mb-3 p-2 rounded text-xs font-bold ${colors}`;
        setTimeout(() => box.classList.add('hidden'), 4000);
    },

    handleClicks: async (e) => {
        if (e.target.closest('#openAttendanceDatesBtn')) {
            byId('courseMenuModal')?.classList.add('hidden');
            byId('attendanceDatesModal')?.classList.remove('hidden');
            CourseAttendanceDates.courseId = getCourseId();
            await CourseAttendanceDates.load();
            return;
        }

        if (e.target.closest('#closeAttendanceDatesBtn') || e.target.id === 'closeAttendanceDatesBg') {
            byId('attendanceDatesModal')?.classList.add('hidden');
            CourseAttendanceDates.resetPanels();
            return;
        }

        const editBtn = e.target.closest('.ad-edit-btn');
        if (editBtn) {
            CourseAttendanceDates.openEdit(editBtn.dataset.date);
            return;
        }

        const deleteBtn = e.target.closest('.ad-delete-btn');
        if (deleteBtn) {
            await CourseAttendanceDates.remove(deleteBtn.dataset.date);
            return;
        }

        if (e.target.closest('#adEditCancelBtn')) {
            CourseAttendanceDates.resetPanels();
            return;
        }

        if (e.target.closest('#adEditSaveBtn')) {
            await CourseAttendanceDates.saveEdit();
            return;
        }

        if (e.target.closest('#adMergeBtn')) {
            CourseAttendanceDates.openMerge();
            return;
        }

        if (e.target.closest('#adMergeCancelBtn')) {
            byId('adMergePanel')?.classList.add('hidden');
            return;
        }

        if (e.target.closest('#adMergeConfirmBtn')) {
            await CourseAttendanceDates.merge();
        }
    },

    handleChanges: (e) => {
        if (!e.target.classList || !e.target.classList.contains('ad-select')) return;
        const date = e.target.dataset.date;
        if (e.target.checked) {
            if (CourseAttendanceDates.selected.length >= 2) {
                e.target.checked = false;
                UI.warning('Select only two dates to merge.');
                return;
            }
            CourseAttendanceDates.selected.push(date);
        } else {
            CourseAttendanceDates.selected = CourseAttendanceDates.selected.filter(d => d !== date);
        }
        byId('adMergePanel')?.classList.add('hidden');
        CourseAttendanceDates.updateMergeButton();
    },

    updateMergeButton: () => {
        const btn = byId('adMergeBtn');
        if (!btn) return;
        const count = CourseAttendanceDates.selected.length;
        btn.disabled = count !== 2;
        btn.innerHTML = `<i class="fa-solid fa-code-merge mr-1"></i> Merge Selected (${count}/2)`;
    },

    resetPanels: () => {
        CourseAttendanceDates.editDate = null;
        byId('adEditPanel')?.classList.add('hidden');
        byId('adMergePanel')?.classList.add('hidden');
    },

    load: async () => {
        const list = byId('adList');
        if (!list) return;
        CourseAttendanceDates.selected = [];
        CourseAttendanceDates.resetPanels();
        CourseAttendanceDates.updateMergeButton();
        list.innerHTML = '<div class="text-center py-6 text-gray-500 text-sm"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Loading...</div>';

        try {
            const ts = new Date().getTime();
            const data = await apiFetch(`/api/attendance-dates?courseId=${CourseAttendanceDates.courseId}&_t=${ts}`);
            CourseAttendanceDates.dates = data.dates || [];
            CourseAttendanceDates.render();
        } catch (err) {
            list.innerHTML = `<div class="text-red-500 text-xs font-bold text-center py-4">${esc(err.message)}</div>`;
        }
    },

    render: () => {
        const list = byId('adList');
        const summary = byId('adSummary');
        const dates = CourseAttendanceDates.dates;
        const scheduleDay = getScheduleDay();
        if (!list) return;

        if (summary) summary.textContent = `${dates.length} date(s) with records`;

        if (dates.length === 0) {
            list.innerHTML = '<div class="text-center py-8 text-xs font-medium text-gray-500 italic">No dates with attendance records yet.</div>';
            return;
        }

        list.innerHTML = dates.map(d => {
            const weekday = getWeekdayName(d.Date);
            const offSchedule = !matchesScheduleDay(d.Date, scheduleDay);
            const checked = CourseAttendanceDates.selected.includes(d.Date) ? 'checked' : '';
            return `
                <div class="bg-white p-3 border border-gray-200 rounded flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                    <div class="flex items-center gap-3 flex-1 min-w-0">
                        <input type="checkbox" class="ad-select w-4 h-4 flex-shrink-0 accent-purple-600" data-date="${esc(d.Date)}" aria-label="Select ${esc(d.Date)} for merge" ${checked}>
                        <div class="min-w-0">
                            <div class="font-bold text-sm text-gray-800">
                                ${esc(d.Date)}
                                <span class="text-xs font-medium text-gray-500">(${esc(weekday)})</span>
                                ${offSchedule ? `<span class="ml-1 text-[10px] font-bold text-orange-700 bg-orange-100 border border-orange-200 px-1.5 py-0.5 rounded uppercase">Not ${esc(scheduleDay)}</span>` : ''}
                                ${d.Is_No_Class ? '<span class="ml-1 text-[10px] font-bold text-red-700 bg-red-100 border border-red-200 px-1.5 py-0.5 rounded uppercase">No Class</span>' : ''}
                            </div>
                            <div class="text-[11px] text-gray-500 mt-0.5">
                                ${d.Total} record(s) &bull;
                                <span class="text-green-700 font-bold">${d.Present}P</span>
                                <span class="text-yellow-700 font-bold">${d.Late}L</span>
                                <span class="text-purple-700 font-bold">${d.Excused}E</span>
                                <span class="text-red-700 font-bold">${d.Absent}A</span>
                                &bull; ${d.Points} pts
                            </div>
                        </div>
                    </div>
                    <div class="flex gap-2 sm:flex-shrink-0">
                        <button type="button" class="ad-edit-btn px-3 py-1.5 bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-200 rounded text-xs font-bold transition" data-date="${esc(d.Date)}">
                            <i class="fa-solid fa-pen mr-1"></i> Change
                        </button>
                        <button type="button" class="ad-delete-btn px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 rounded text-xs font-bold transition" data-date="${esc(d.Date)}">
                            <i class="fa-solid fa-trash mr-1"></i> Delete
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    },

    openEdit: (date) => {
        CourseAttendanceDates.editDate = date;
        byId('adMergePanel')?.classList.add('hidden');
        byId('adEditLabel').textContent = `${date} (${getWeekdayName(date)})`;
        byId('adEditDate').value = date;
        byId('adEditPanel').classList.remove('hidden');
        byId('adEditDate').focus();
    },

    // Asks the lecturer to confirm when the date is not on the class's scheduled weekday.
    confirmWeekday: (date) => CourseAttendance.confirmScheduleDay(date, getScheduleDay()),

    saveEdit: async () => {
        const oldDate = CourseAttendanceDates.editDate;
        const newDate = byId('adEditDate').value;
        if (!oldDate) return;
        if (!newDate) {
            CourseAttendanceDates.showAlert('Please choose the new date.');
            return;
        }
        if (newDate === oldDate) {
            CourseAttendanceDates.showAlert('The new date is the same as the current date.');
            return;
        }

        if (!(await CourseAttendanceDates.confirmWeekday(newDate))) return;

        const btn = byId('adEditSaveBtn');
        btn.disabled = true;
        try {
            await apiFetch('/api/attendance-dates/change', {
                method: 'POST',
                body: JSON.stringify({ courseId: CourseAttendanceDates.courseId, oldDate, newDate })
            });
            CourseAttendance.clearDraft(CourseAttendanceDates.courseId, oldDate);
            CourseAttendance.clearDraft(CourseAttendanceDates.courseId, newDate);
            UI.success('Date changed.');
            await CourseAttendanceDates.load();
            await CourseAttendanceDates.refreshRoster();
        } catch (err) {
            CourseAttendanceDates.showAlert(err.message);
        } finally {
            btn.disabled = false;
        }
    },

    remove: async (date) => {
        const row = CourseAttendanceDates.dates.find(d => d.Date === date);
        const count = row ? row.Total : 0;
        const ok = await UI.confirm({
            title: 'Delete attendance date?',
            message: `All ${count} attendance record(s) on ${date} (${getWeekdayName(date)}), including their participation points, will be permanently deleted.`,
            confirmText: 'Delete',
            danger: true
        });
        if (!ok) return;

        try {
            await apiFetch('/api/attendance-dates', {
                method: 'DELETE',
                body: JSON.stringify({ courseId: CourseAttendanceDates.courseId, date })
            });
            CourseAttendance.clearDraft(CourseAttendanceDates.courseId, date);
            UI.success('Date deleted.');
            await CourseAttendanceDates.load();
            await CourseAttendanceDates.refreshRoster();
        } catch (err) {
            CourseAttendanceDates.showAlert(err.message);
        }
    },

    openMerge: () => {
        const [a, b] = CourseAttendanceDates.selected;
        if (!a || !b) return;
        byId('adEditPanel')?.classList.add('hidden');

        const options = [a, b].sort().map((d, i) => `
            <label class="flex items-center gap-2 bg-white border border-purple-200 rounded p-2 cursor-pointer text-sm font-bold text-gray-800">
                <input type="radio" name="adKeep" value="${esc(d)}" class="accent-purple-600" ${i === 0 ? 'checked' : ''}>
                Keep ${esc(d)} <span class="text-xs font-medium text-gray-500">(${esc(getWeekdayName(d))})</span>
            </label>
        `).join('');
        byId('adKeepOptions').innerHTML = options;
        byId('adMergePanel').classList.remove('hidden');
    },

    merge: async () => {
        const [dateA, dateB] = CourseAttendanceDates.selected;
        const keepInput = document.querySelector('input[name="adKeep"]:checked');
        if (!dateA || !dateB || !keepInput) return;
        const keepDate = keepInput.value;
        const removed = keepDate === dateA ? dateB : dateA;

        if (!(await CourseAttendanceDates.confirmWeekday(keepDate))) return;

        const ok = await UI.confirm({
            title: 'Merge attendance dates?',
            message: `Records on ${removed} will be merged into ${keepDate}. Points are added; conflicts keep the stricter status (Absent > Late > Excused > Present). ${removed} will no longer have records.`,
            confirmText: 'Merge',
            danger: true
        });
        if (!ok) return;

        const btn = byId('adMergeConfirmBtn');
        btn.disabled = true;
        try {
            await apiFetch('/api/attendance-dates/merge', {
                method: 'POST',
                body: JSON.stringify({ courseId: CourseAttendanceDates.courseId, dateA, dateB, keepDate })
            });
            CourseAttendance.clearDraft(CourseAttendanceDates.courseId, dateA);
            CourseAttendance.clearDraft(CourseAttendanceDates.courseId, dateB);
            UI.success('Dates merged.');
            await CourseAttendanceDates.load();
            await CourseAttendanceDates.refreshRoster();
        } catch (err) {
            CourseAttendanceDates.showAlert(err.message);
        } finally {
            btn.disabled = false;
        }
    },

    // Reloads the roster so the date picked on the class screen shows the updated records.
    refreshRoster: async () => {
        const dateInput = byId('attendanceDate');
        if (dateInput && dateInput.value) {
            await CourseAttendance.loadAttendanceData(CourseAttendanceDates.courseId, dateInput.value);
        }
    }
};
