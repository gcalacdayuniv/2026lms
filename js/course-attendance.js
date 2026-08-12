// js/course-attendance.js
import { apiFetch } from './globals.js';

export const CourseAttendance = {
    loadNoClassDays: async (courseId) => {
        const listContainer = document.getElementById('noClassList');
        if (!listContainer) return;
        listContainer.innerHTML = '<div class="text-center py-4 text-gray-500"><i class="fa-solid fa-spinner fa-spin"></i></div>';
        
        try {
            const ts = new Date().getTime();
            const data = await apiFetch(`/api/no-class?courseId=${courseId}&_t=${ts}`);
            if (!data.dates || data.dates.length === 0) {
                listContainer.innerHTML = '<div class="text-center py-4 text-gray-500 text-sm">No dates marked as No Class.</div>';
                return;
            }
            listContainer.innerHTML = data.dates.map(d => `
                <div class="flex justify-between items-center p-2 bg-white border border-gray-200 rounded text-sm">
                    <span class="font-bold text-gray-700">${d.Date}</span>
                    <button type="button" class="remove-no-class-btn text-red-600 hover:text-red-800 transition px-2 py-1 bg-red-50 rounded" data-date="${d.Date}">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            `).join('');
        } catch (err) {
            listContainer.innerHTML = `<div class="text-red-500 text-sm p-2 text-center">${err.message}</div>`;
        }
    },

    loadAttendanceData: async (courseId, dateVal) => {
        const alertBox = document.getElementById('attendanceAlert');
        if (alertBox) alertBox.classList.add('hidden');

        document.querySelectorAll('.attendance-btn').forEach(btn => {
            btn.classList.remove('bg-green-100', 'text-green-800', 'border-green-400', 'bg-yellow-100', 'text-yellow-800', 'border-yellow-400', 'bg-red-100', 'text-red-800', 'border-red-400', 'bg-purple-100', 'text-purple-800', 'border-purple-400');
            btn.classList.add('bg-gray-50', 'text-gray-600', 'border-gray-200');
            btn.removeAttribute('data-selected');
        });
        document.querySelectorAll('.points-input').forEach(input => {
            input.value = '0';
        });

        try {
            const ts = new Date().getTime();
            const data = await apiFetch(`/api/attendance?courseId=${courseId}&date=${dateVal}&_t=${ts}`);
            
            const banner = document.getElementById('noClassBanner');
            if (data.isNoClass) {
                if (banner) banner.classList.remove('hidden');
                document.querySelectorAll('.attendance-btn, .points-input, #saveAttendanceBtn, #markAllPresent, .save-single-attendance-btn').forEach(el => {
                    el.disabled = true;
                    el.classList.add('opacity-50', 'cursor-not-allowed');
                });
            } else {
                if (banner) banner.classList.add('hidden');
                document.querySelectorAll('.attendance-btn, .points-input, #saveAttendanceBtn, #markAllPresent, .save-single-attendance-btn').forEach(el => {
                    el.disabled = false;
                    el.classList.remove('opacity-50', 'cursor-not-allowed');
                });
            }

            if (data.records && data.records.length > 0) {
                data.records.forEach(record => {
                    const row = document.querySelector(`.student-row[data-student-id="${record.Student_ID}"]`);
                    if (row) {
                        const btn = row.querySelector(`.attendance-btn[data-status="${record.Status}"]`);
                        if (btn) {
                            btn.setAttribute('data-selected', 'true');
                            if(record.Status === 'Present') {
                                btn.classList.replace('bg-gray-50', 'bg-green-100');
                                btn.classList.replace('text-gray-600', 'text-green-800');
                                btn.classList.replace('border-gray-200', 'border-green-400');
                            } else if(record.Status === 'Late') {
                                btn.classList.replace('bg-gray-50', 'bg-yellow-100');
                                btn.classList.replace('text-gray-600', 'text-yellow-800');
                                btn.classList.replace('border-gray-200', 'border-yellow-400');
                            } else if(record.Status === 'Absent') {
                                btn.classList.replace('bg-gray-50', 'bg-red-100');
                                btn.classList.replace('text-gray-600', 'text-red-800');
                                btn.classList.replace('border-gray-200', 'border-red-400');
                            } else if(record.Status === 'Excused') {
                                btn.classList.replace('bg-gray-50', 'bg-purple-100');
                                btn.classList.replace('text-gray-600', 'text-purple-800');
                                btn.classList.replace('border-gray-200', 'border-purple-400');
                            }
                        }
                        const pointsInput = row.querySelector('.points-input');
                        if (pointsInput) {
                            pointsInput.value = record.Performance_Points || 0;
                        }
                    }
                });
            }
        } catch (err) {
            console.error("Failed to load attendance", err);
        }
    },

    saveSingleRecord: async (row) => {
        const studentId = row.dataset.studentId;
        const courseId = window.location.hash.replace('#class-', '');
        const dateVal = document.getElementById('attendanceDate').value;
        const selectedBtn = row.querySelector('.attendance-btn[data-selected="true"]');
        const pointsInput = row.querySelector('.points-input');
        const banner = document.getElementById('noClassBanner');
        
        if (!dateVal || (banner && !banner.classList.contains('hidden'))) {
            return;
        }
        
        const status = selectedBtn ? selectedBtn.dataset.status : null;
        const points = pointsInput ? (parseInt(pointsInput.value) || 0) : 0;
        
        try {
            await apiFetch('/api/attendance/single', {
                method: 'POST',
                body: JSON.stringify({ courseId, studentId, date: dateVal, status, points })
            });
        } catch (err) {
            console.error("Auto-save failed:", err);
        }
    },

    saveAttendance: async () => {
        const courseId = window.location.hash.replace('#class-', '');
        const dateVal = document.getElementById('attendanceDate').value;
        const alertBox = document.getElementById('attendanceAlert');
        const btn = document.getElementById('saveAttendanceBtn');
        
        if (!dateVal) {
            alertBox.textContent = "Please select a date.";
            alertBox.className = "mb-4 mx-2 sm:mx-0 p-3 rounded-md text-sm font-bold bg-red-100 text-red-800 block";
            return;
        }
        
        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Saving...';
        
        const records = [];
        document.querySelectorAll('.student-row').forEach(row => {
            const studentId = row.dataset.studentId;
            const selectedBtn = row.querySelector('.attendance-btn[data-selected="true"]');
            const pointsInput = row.querySelector('.points-input');
            
            if (selectedBtn) {
                records.push({
                    studentId: studentId,
                    status: selectedBtn.dataset.status,
                    points: pointsInput ? (parseInt(pointsInput.value) || 0) : 0
                });
            }
        });

        try {
            await apiFetch('/api/attendance', {
                method: 'POST',
                body: JSON.stringify({ courseId, date: dateVal, records })
            });
            
            alertBox.textContent = "Attendance saved successfully!";
            alertBox.className = "mb-4 mx-2 sm:mx-0 p-3 rounded-md text-sm font-bold bg-green-100 text-green-800 block fade-in";
            setTimeout(() => { alertBox.classList.add('hidden'); }, 3000);
        } catch (err) {
            alertBox.textContent = err.message;
            alertBox.className = "mb-4 mx-2 sm:mx-0 p-3 rounded-md text-sm font-bold bg-red-100 text-red-800 block fade-in";
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    },

    renderTermMetrics: (term, data) => {
        const course = data.course || {};
        const records = data.records || [];
        const sessions = data.sessions || [];
        
        let termStart = '';
        let termEnd = '';
        
        if (term === 'midterm') {
            termStart = course.Midterm_Start;
            termEnd = course.Midterm_End;
        } else {
            termStart = course.Final_Start;
            termEnd = course.Final_End;
        }

        const parseLocalDate = (dateStr) => {
            if (!dateStr) return null;
            if (dateStr.includes('-')) {
                const [y, m, d] = dateStr.split('-');
                return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
            }
            const d = new Date(dateStr);
            return isNaN(d.getTime()) ? null : d;
        };

        const tStart = parseLocalDate(termStart);
        const tEnd = parseLocalDate(termEnd);
        
        let totalClassDays = 0;
        if (tStart && tEnd) {
            const termSessions = sessions.filter(s => {
                const sDate = parseLocalDate(s.Date);
                return sDate && sDate >= tStart && sDate <= tEnd && s.Is_No_Class !== 1;
            });
            totalClassDays = termSessions.length;
        }

        const termRecords = records.filter(r => {
            const rDate = parseLocalDate(r.Date);
            if (!rDate || !tStart || !tEnd) return false;
            return rDate >= tStart && rDate <= tEnd;
        });

        let present = 0, late = 0, excused = 0, absent = 0, points = 0;
        
        termRecords.forEach(r => {
            if (r.Status === 'Present') present++;
            else if (r.Status === 'Late') late++;
            else if (r.Status === 'Excused') excused++;
            else if (r.Status === 'Absent') absent++;
            points += (r.Performance_Points || 0);
        });

        let pct = 0;
        if (totalClassDays > 0) {
            const effectiveAttendance = present + (late * 0.5);
            pct = Math.round((effectiveAttendance / totalClassDays) * 100);
        }

        const elPrefix = term === 'midterm' ? 'midterm' : 'finalterm';
        const partEl = document.getElementById(`${elPrefix}ParticipationScore`);
        const pctEl = document.getElementById(`${elPrefix}AttendancePct`);
        const pEl = document.getElementById(`${elPrefix}Present`);
        const lEl = document.getElementById(`${elPrefix}Late`);
        const eEl = document.getElementById(`${elPrefix}Excused`);
        const aEl = document.getElementById(`${elPrefix}Absent`);
        const daysEl = document.getElementById(`${elPrefix}TotalDays`);

        if (partEl) partEl.textContent = points;
        if (pctEl) pctEl.textContent = pct;
        if (pEl) pEl.textContent = present;
        if (lEl) lEl.textContent = late;
        if (eEl) eEl.textContent = excused;
        if (aEl) aEl.textContent = absent;
        if (daysEl) daysEl.textContent = totalClassDays;
    }
};
