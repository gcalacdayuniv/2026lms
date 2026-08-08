// js/course-attendance.js
import { apiFetch } from './globals.js';

export const CourseAttendance = {
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
            list.innerHTML = `<div class="text-red-500 text-xs font-bold text-center py-2">${err.message}</div>`;
        }
    },

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
            const confirmProceed = window.confirm(`${missingCount} student(s) have no attendance marked. Do you want to proceed anyway? Unmarked students will not be saved.`);
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
            const payload = {
                courseId: courseId,
                date: dateVal,
                records: attendanceData
            };

            await apiFetch('/api/attendance', { method: 'POST', body: JSON.stringify(payload) });
            
            CourseAttendance.clearDraft(courseId, dateVal);

            alertBox.textContent = "All Attendance saved successfully!";
            alertBox.className = "mb-4 p-3 rounded-md text-sm font-medium bg-green-100 text-green-700 block fade-in";
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
        try {
            const ts = new Date().getTime();
            const data = await apiFetch(`/api/attendance?courseId=${courseId}&date=${date}&_t=${ts}`);
            
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

            document.querySelectorAll('.student-row').forEach(row => {
                const buttons = row.querySelectorAll('.attendance-btn');
                buttons.forEach(btn => {
                    btn.classList.remove('bg-green-100', 'text-green-800', 'border-green-400', 'bg-yellow-100', 'text-yellow-800', 'border-yellow-400', 'bg-red-100', 'text-red-800', 'border-red-400', 'bg-purple-100', 'text-purple-800', 'border-purple-400');
                    btn.classList.add('bg-gray-50', 'text-gray-600', 'border-gray-200');
                    btn.removeAttribute('data-selected');
                });
                const pointsInput = row.querySelector('.points-input');
                if (pointsInput) pointsInput.value = '0';
                
                const presentBtn = row.querySelector('.attendance-btn[data-status="Present"]');
                if (presentBtn && !data.isNoClass) {
                    presentBtn.setAttribute('data-selected', 'true');
                    presentBtn.classList.replace('bg-gray-50', 'bg-green-100');
                    presentBtn.classList.replace('text-gray-600', 'text-green-800');
                    presentBtn.classList.replace('border-gray-200', 'border-green-400');
                }
            });

            if (data.records && data.records.length > 0 && !data.isNoClass) {
                document.querySelectorAll('.student-row').forEach(row => {
                     const presentBtn = row.querySelector('.attendance-btn[data-status="Present"]');
                     if(presentBtn) {
                         presentBtn.removeAttribute('data-selected');
                         presentBtn.classList.remove('bg-green-100', 'text-green-800', 'border-green-400');
                         presentBtn.classList.add('bg-gray-50', 'text-gray-600', 'border-gray-200');
                     }
                });

                data.records.forEach(record => {
                    const row = document.querySelector(`.student-row[data-student-id="${record.Student_ID}"]`);
                    if (row) {
                        const btn = row.querySelector(`.attendance-btn[data-status="${record.Status}"]`);
                        if (btn) {
                            btn.setAttribute('data-selected', 'true');
                            btn.classList.remove('bg-gray-50', 'text-gray-600', 'border-gray-200');
                            if (record.Status === 'Present') {
                                btn.classList.add('bg-green-100', 'text-green-800', 'border-green-400');
                            } else if (record.Status === 'Late') {
                                btn.classList.add('bg-yellow-100', 'text-yellow-800', 'border-yellow-400');
                            } else if (record.Status === 'Absent') {
                                btn.classList.add('bg-red-100', 'text-red-800', 'border-red-400');
                            } else if (record.Status === 'Excused') {
                                btn.classList.add('bg-purple-100', 'text-purple-800', 'border-purple-400');
                            }
                        }
                        const pointsInput = row.querySelector('.points-input');
                        if (pointsInput) pointsInput.value = record.Performance_Points || '0';
                    }
                });
            }

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
                            const buttons = row.querySelectorAll('.attendance-btn');
                            buttons.forEach(btn => {
                                btn.classList.remove('bg-green-100', 'text-green-800', 'border-green-400', 'bg-yellow-100', 'text-yellow-800', 'border-yellow-400', 'bg-red-100', 'text-red-800', 'border-red-400', 'bg-purple-100', 'text-purple-800', 'border-purple-400');
                                btn.classList.add('bg-gray-50', 'text-gray-600', 'border-gray-200');
                                btn.removeAttribute('data-selected');
                            });
                            
                            if (r.status) {
                                const btn = row.querySelector(`.attendance-btn[data-status="${r.status}"]`);
                                if (btn) {
                                    btn.setAttribute('data-selected', 'true');
                                    btn.classList.remove('bg-gray-50', 'text-gray-600', 'border-gray-200');
                                    if (r.status === 'Present') {
                                        btn.classList.add('bg-green-100', 'text-green-800', 'border-green-400');
                                    } else if (r.status === 'Late') {
                                        btn.classList.add('bg-yellow-100', 'text-yellow-800', 'border-yellow-400');
                                    } else if (r.status === 'Absent') {
                                        btn.classList.add('bg-red-100', 'text-red-800', 'border-red-400');
                                    } else if (r.status === 'Excused') {
                                        btn.classList.add('bg-purple-100', 'text-purple-800', 'border-purple-400');
                                    }
                                }
                            }
                            
                            const pointsInput = row.querySelector('.points-input');
                            if (pointsInput) pointsInput.value = r.points || '0';
                        }
                    });
                    
                    if (hasDraftChanges) {
                        const alertBox = document.getElementById('attendanceAlert');
                        if (alertBox) {
                            alertBox.innerHTML = '<i class="fa-solid fa-clock-rotate-left mr-2"></i> Unsaved changes restored from local cache.';
                            alertBox.className = "mb-4 mx-2 sm:mx-0 p-3 rounded-md text-sm font-medium bg-blue-100 text-blue-800 block fade-in";
                            alertBox.classList.remove('hidden');
                        }
                    }
                } catch(e) {}
            }

        } catch (err) {
            console.error("Failed to load attendance:", err);
        }
    },

    renderTermMetrics: (term, data) => {
        const course = data.course || {};
        const sessions = data.sessions || [];
        const records = data.records || [];
        
        let termStart = '';
        let termEnd = '';
        
        if (term === 'midterm') {
            termStart = course.Midterm_Start || '';
            termEnd = course.Midterm_End || '';
        } else if (term === 'finalterm') {
            termStart = course.Final_Start || '';
            termEnd = course.Final_End || '';
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
                
                totalParticipationPts += (r.Performance_Points || 0);
            });

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
    }
};
