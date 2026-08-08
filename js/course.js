// js/course.js
import { apiFetch, AppState } from './globals.js';
import { Components, getLoadableAvatarSrc } from './components.js'; 

export const CourseModule = {
    currentSummaryData: null,
    
    init: () => {
        document.addEventListener('submit', CourseModule.handleForms);
        document.addEventListener('click', CourseModule.handleClicks);
        document.addEventListener('change', CourseModule.handleChanges);
        document.addEventListener('input', CourseModule.handleInput);
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
    },
    
    clearDraft: (courseId, date) => {
        localStorage.removeItem(`attendance_draft_${courseId}_${date}`);
    },

    updateManageStatusColor: (selectEl) => {
        const status = selectEl.value;
        selectEl.className = `w-full px-3 py-2 text-sm border rounded outline-none font-medium cursor-pointer transition ${
            status === 'Active' ? 'text-green-600 border-green-300 bg-green-50 focus:ring-green-500' : 
            status === 'Inactive' ? 'text-gray-600 border-gray-300 bg-gray-50 focus:ring-gray-500' :
            status === 'Suspended' ? 'text-orange-600 border-orange-300 bg-orange-50 focus:ring-orange-500' :
            status === 'UD' ? 'text-red-600 border-red-300 bg-red-50 focus:ring-red-500' :
            status === 'Dropped' ? 'text-red-800 border-red-400 bg-red-100 focus:ring-red-500' : 'text-gray-600 border-gray-300 bg-gray-50'
        }`;
    },

    handleForms: async (e) => {
        if (e.target.id === 'addCourseForm') {
            e.preventDefault();
            await CourseModule.createCourse();
        }
        if (e.target.id === 'addProgramForm') {
            e.preventDefault();
            await CourseModule.createProgram();
        }
    },

    handleInput: async (e) => {
        if (e.target.id === 'studentSearchInput') {
            const searchTerm = e.target.value.toLowerCase();
            const items = document.querySelectorAll('.student-enroll-item');
            items.forEach(item => {
                const text = item.innerText.toLowerCase();
                if (text.includes(searchTerm)) {
                    item.style.display = 'flex';
                } else {
                    item.style.display = 'none';
                }
            });
        }

        if (e.target.classList.contains('points-input')) {
            const courseId = window.location.hash.replace('#class-', '');
            const dateVal = document.getElementById('attendanceDate')?.value;
            if (courseId && dateVal) CourseModule.saveDraft(courseId, dateVal);
        }
    },

    handleChanges: async (e) => {
        if (e.target.id === 'noClassToggle') {
            const isNoClass = e.target.checked;
            const container = document.getElementById('rosterListContainer');
            if (container) {
                if (isNoClass) {
                    container.classList.add('opacity-50', 'pointer-events-none');
                } else {
                    container.classList.remove('opacity-50', 'pointer-events-none');
                }
            }
        }
        
        if (e.target.id === 'manageSeatInput' || e.target.id === 'manageGroupInput' || e.target.id === 'manageTopicInput') {
            const studentId = document.getElementById('manageStudentId').value;
            const seatNumber = document.getElementById('manageSeatInput').value.trim();
            const groupName = document.getElementById('manageGroupInput').value.trim();
            const assignedTopic = document.getElementById('manageTopicInput').value.trim();
            const courseId = window.location.hash.replace('#class-', '');
            
            try {
                await apiFetch('/api/update-student-info', {
                    method: 'POST',
                    body: JSON.stringify({ courseId, studentId, seatNumber, groupName, assignedTopic })
                });
            } catch (err) {
                console.error('Failed to update student info:', err);
            }
        }
        
        if (e.target.id === 'manageStatusSelect') {
            const studentId = document.getElementById('manageStudentId').value;
            const status = e.target.value;
            CourseModule.updateManageStatusColor(e.target);
            
            try {
                await apiFetch('/api/update-user-status', {
                    method: 'POST',
                    body: JSON.stringify({ studentId, status })
                });
            } catch (err) {
                console.error('Failed to update user status:', err);
                alert('Failed to update student status.');
            }
        }

        if (e.target.id === 'filterCourse' || e.target.id === 'filterYear' || e.target.id === 'filterSection' || e.target.id === 'filterStatus') {
            const courseId = window.location.hash.replace('#class-', '');
            await CourseModule.loadUnenrolledStudents(courseId);
        }

        if (e.target.id === 'attendanceDate') {
            const courseId = window.location.hash.replace('#class-', '');
            const date = e.target.value;
            if (courseId && date) {
                await CourseModule.loadAttendanceData(courseId, date);
            }
        }
    },

    handleClicks: async (e) => {
        if (e.target.classList.contains('enroll-btn')) {
            const confirmation = window.confirm("Are you sure you want to enroll in this Course? This action cannot be undone.");
            if (!confirmation) {
                return;
            }
            
            const btn = e.target;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            await CourseModule.enrollCourse(btn.dataset.id);
        }

        // Hamburger Menu Logic
        if (e.target.closest('#openCourseMenuBtn')) {
            document.getElementById('courseMenuModal').classList.remove('hidden');
        }

        if (e.target.closest('#closeCourseMenuBtn') || e.target.id === 'closeCourseMenuBg') {
            document.getElementById('courseMenuModal').classList.add('hidden');
        }

        // Save Course Terms Logic
        if (e.target.closest('#saveCourseTermsBtn')) {
            const btn = e.target.closest('#saveCourseTermsBtn');
            const alertBox = document.getElementById('courseMenuAlert');
            const courseId = window.location.hash.replace('#class-', '');
            
            const payload = {
                courseId: courseId,
                midtermStart: document.getElementById('midtermStart').value,
                midtermEnd: document.getElementById('midtermEnd').value,
                finalStart: document.getElementById('finalStart').value,
                finalEnd: document.getElementById('finalEnd').value
            };

            const originalHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Saving...';

            try {
                await apiFetch('/api/update-course-terms', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                alertBox.textContent = "Term periods saved securely.";
                alertBox.className = "mb-3 p-2 rounded text-xs font-bold bg-green-100 text-green-800 block fade-in";
            } catch (err) {
                alertBox.textContent = "Failed to save: " + err.message;
                alertBox.className = "mb-3 p-2 rounded text-xs font-bold bg-red-100 text-red-800 block fade-in";
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
                setTimeout(() => { alertBox.classList.add('hidden'); }, 3000);
            }
        }

        if (e.target.closest('#exportRosterBtn')) {
            const btn = e.target.closest('#exportRosterBtn');
            const courseId = btn.dataset.courseId;
            const originalHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Generating...';
            
            await CourseModule.exportRoster(courseId);
            
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }

        if (e.target.closest('.manage-student-btn')) {
            const btn = e.target.closest('.manage-student-btn');
            document.getElementById('manageStudentName').textContent = btn.dataset.name;
            document.getElementById('manageStudentId').value = btn.dataset.studentId;
            document.getElementById('manageSeatInput').value = btn.dataset.seat;
            document.getElementById('manageGroupInput').value = btn.dataset.group;
            document.getElementById('manageTopicInput').value = btn.dataset.topic;
            
            const statusSelect = document.getElementById('manageStatusSelect');
            statusSelect.value = btn.dataset.status;
            CourseModule.updateManageStatusColor(statusSelect);

            document.getElementById('manageStudentModal').classList.remove('hidden');
        }

        if (e.target.closest('#closeManageStudentModalBtn') || e.target.id === 'closeManageStudentModalBg') {
            document.getElementById('manageStudentModal').classList.add('hidden');
            const courseId = window.location.hash.replace('#class-', '');
            await CourseModule.loadClassScreen(courseId, true); 
        }

        // Summary Modal Logic
        if (e.target.closest('.view-summary-trigger')) {
            const trigger = e.target.closest('.view-summary-trigger');
            const name = trigger.dataset.name;
            
            const confirmation = window.confirm(`Load performance summary for ${name}?`);
            if (!confirmation) return;

            const studentId = trigger.closest('.student-row').dataset.studentId;
            const courseId = window.location.hash.replace('#class-', '');
            
            document.getElementById('summaryStudentName').textContent = name;
            document.getElementById('summaryModal').classList.remove('hidden');
            document.getElementById('summaryLoading').classList.remove('hidden');
            document.getElementById('summaryContent').classList.add('hidden');
            document.getElementById('summaryError').classList.add('hidden');
            
            CourseModule.currentSummaryData = null;

            try {
                const ts = new Date().getTime(); // Cache buster to bypass outdated Cloudflare responses
                const data = await apiFetch(`/api/student-summary?courseId=${courseId}&studentId=${studentId}&_t=${ts}`);
                CourseModule.currentSummaryData = data;
                
                CourseModule.renderTermMetrics('midterm', data);
                CourseModule.renderTermMetrics('finalterm', data);

                document.getElementById('summaryLoading').classList.add('hidden');
                document.getElementById('summaryContent').classList.remove('hidden');
            } catch(err) {
                console.error("Failed to load summary", err);
                const errDiv = document.getElementById('summaryError');
                errDiv.textContent = err.message || "Failed to load summary records.";
                errDiv.classList.remove('hidden');
                document.getElementById('summaryLoading').classList.add('hidden');
            }
        }
        
        if (e.target.closest('#closeSummaryModalBtn') || e.target.id === 'closeSummaryModalBg') {
            document.getElementById('summaryModal').classList.add('hidden');
        }

        // Details Modal Logic (From Summary Cards)
        if (e.target.closest('.view-details-trigger')) {
            const trigger = e.target.closest('.view-details-trigger');
            const term = trigger.dataset.term;
            const metric = trigger.dataset.metric;
            
            if (CourseModule.currentSummaryData) {
                CourseModule.renderDetailsModal(term, metric, CourseModule.currentSummaryData);
                document.getElementById('detailsModal').classList.remove('hidden');
            }
        }
        
        if (e.target.closest('#closeDetailsModalBtn') || e.target.id === 'closeDetailsModalBg') {
            document.getElementById('detailsModal').classList.add('hidden');
        }

        if (e.target.closest('#manageResetPwdBtn')) {
            const studentId = document.getElementById('manageStudentId').value;
            const confirmReset = window.confirm("Are you sure you want to reset this student's password to '123456'?");
            
            if (confirmReset) {
                const btn = e.target.closest('#manageResetPwdBtn');
                const originalHtml = btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                
                try {
                    await apiFetch('/api/reset-student-password', {
                        method: 'POST',
                        body: JSON.stringify({ studentId })
                    });
                    alert("Password successfully reset to 123456.");
                } catch (err) {
                    alert(err.message);
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = originalHtml;
                }
            }
        }

        if (e.target.closest('#manageRemoveBtn')) {
            const studentId = document.getElementById('manageStudentId').value;
            const courseId = window.location.hash.replace('#class-', '');
            const confirmRemove = window.confirm("Are you sure you want to remove this student from the course?");
            
            if (confirmRemove) {
                const btn = e.target.closest('#manageRemoveBtn');
                const originalHtml = btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                
                try {
                    await apiFetch('/api/unenroll', {
                        method: 'POST',
                        body: JSON.stringify({ courseId, studentId })
                    });
                    document.getElementById('manageStudentModal').classList.add('hidden');
                    await CourseModule.loadClassScreen(courseId, true);
                } catch (err) {
                    alert(err.message);
                    btn.disabled = false;
                    btn.innerHTML = originalHtml;
                }
            }
        }

        if (e.target.closest('#openAddStudentModalBtn')) {
            document.getElementById('courseMenuModal').classList.add('hidden');
            document.getElementById('addStudentModal').classList.remove('hidden');
            const courseId = window.location.hash.replace('#class-', '');
            
            const filterCourse = document.getElementById('filterCourse');
            if (filterCourse && filterCourse.options.length <= 1) {
                try {
                    const programsData = await apiFetch('/api/programs');
                    if (programsData.programs) {
                        filterCourse.innerHTML = '<option value="">Course (All)</option>' + 
                            programsData.programs.map(p => `<option value="${p.ProgramCode}">${p.ProgramCode}</option>`).join('');
                    }
                } catch(err) {}
            }
            
            await CourseModule.loadUnenrolledStudents(courseId);
        }

        if (e.target.closest('#closeAddStudentModalBtn') || e.target.id === 'closeAddStudentModalBg') {
            document.getElementById('addStudentModal').classList.add('hidden');
            document.getElementById('studentSearchInput').value = '';
            document.getElementById('filterStatus').value = 'Active';
            document.getElementById('filterCourse').value = '';
            document.getElementById('filterYear').value = '';
            document.getElementById('filterSection').value = '';
        }

        if (e.target.closest('.lecturer-enroll-btn')) {
            const btn = e.target.closest('.lecturer-enroll-btn');
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            const courseId = window.location.hash.replace('#class-', '');
            const studentId = btn.dataset.studentId;
            
            try {
                await apiFetch('/api/enroll', { 
                    method: 'POST', 
                    body: JSON.stringify({ courseId: courseId, studentId: studentId }) 
                });
                
                await CourseModule.loadClassScreen(courseId, true);
            } catch (err) {
                alert(err.message);
                btn.disabled = false;
                btn.innerHTML = 'Enroll';
            }
        }

        if (e.target.classList.contains('attendance-btn')) {
            const row = e.target.closest('.student-row');
            const buttons = row.querySelectorAll('.attendance-btn');
            
            buttons.forEach(btn => {
                btn.classList.remove('bg-green-100', 'text-green-800', 'border-green-400', 'bg-yellow-100', 'text-yellow-800', 'border-yellow-400', 'bg-red-100', 'text-red-800', 'border-red-400', 'bg-purple-100', 'text-purple-800', 'border-purple-400');
                btn.classList.add('bg-gray-50', 'text-gray-600', 'border-gray-200');
                btn.removeAttribute('data-selected');
            });
            
            const status = e.target.dataset.status;
            e.target.setAttribute('data-selected', 'true');
            
            if(status === 'Present') {
                e.target.classList.replace('bg-gray-50', 'bg-green-100');
                e.target.classList.replace('text-gray-600', 'text-green-800');
                e.target.classList.replace('border-gray-200', 'border-green-400');
            } else if(status === 'Late') {
                e.target.classList.replace('bg-gray-50', 'bg-yellow-100');
                e.target.classList.replace('text-gray-600', 'text-yellow-800');
                e.target.classList.replace('border-gray-200', 'border-yellow-400');
            } else if(status === 'Absent') {
                e.target.classList.replace('bg-gray-50', 'bg-red-100');
                e.target.classList.replace('text-gray-600', 'text-red-800');
                e.target.classList.replace('border-gray-200', 'border-red-400');
            } else if(status === 'Excused') {
                e.target.classList.replace('bg-gray-50', 'bg-purple-100');
                e.target.classList.replace('text-gray-600', 'text-purple-800');
                e.target.classList.replace('border-gray-200', 'border-purple-400');
            }

            const courseId = window.location.hash.replace('#class-', '');
            const dateVal = document.getElementById('attendanceDate')?.value;
            if (courseId && dateVal) CourseModule.saveDraft(courseId, dateVal);
        }

        if (e.target.id === 'markAllPresent') {
            document.querySelectorAll('.student-row').forEach(row => {
                const presentBtn = row.querySelector('[data-status="Present"]');
                if (presentBtn) presentBtn.click();
            });
            const courseId = window.location.hash.replace('#class-', '');
            const dateVal = document.getElementById('attendanceDate')?.value;
            if (courseId && dateVal) CourseModule.saveDraft(courseId, dateVal);
        }

        if (e.target.closest('#saveAttendanceBtn')) {
            await CourseModule.saveAttendance();
        }

        // Individual Save Single Attendance Record Logic
        if (e.target.closest('.save-single-attendance-btn')) {
            const btn = e.target.closest('.save-single-attendance-btn');
            const row = btn.closest('.student-row');
            const studentId = row.dataset.studentId;
            const courseId = window.location.hash.replace('#class-', '');
            const dateVal = document.getElementById('attendanceDate').value;
            const selectedBtn = row.querySelector('.attendance-btn[data-selected="true"]');
            const pointsInput = row.querySelector('.points-input');
            const isNoClass = document.getElementById('noClassToggle').checked;
            
            if (!dateVal) {
                alert("Please select a date first to save attendance.");
                return;
            }
            
            const status = selectedBtn ? selectedBtn.dataset.status : null;
            const points = pointsInput ? (parseInt(pointsInput.value) || 0) : 0;
            
            const originalHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            
            try {
                await apiFetch('/api/attendance/single', {
                    method: 'POST',
                    body: JSON.stringify({ courseId, studentId, date: dateVal, status, points, isNoClass })
                });
                
                CourseModule.saveDraft(courseId, dateVal);

                btn.classList.replace('text-blue-600', 'text-green-600');
                btn.classList.replace('bg-blue-50', 'bg-green-50');
                btn.classList.replace('border-blue-200', 'border-green-200');
                
                setTimeout(() => {
                    btn.classList.replace('text-green-600', 'text-blue-600');
                    btn.classList.replace('bg-green-50', 'bg-blue-50');
                    btn.classList.replace('border-green-200', 'border-blue-200');
                }, 2000);
            } catch (err) {
                alert("Failed to save individually: " + err.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
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
        
        let present = 0, late = 0, excused = 0, absent = 0, totalParticipationPts = 0;
        let termTotalDays = 0;
        let studentReqDays = 0;
        let pct = 0;

        if (termStart && termEnd) {
            const tStart = new Date(termStart);
            const tEnd = new Date(termEnd);
            
            const termSessions = sessions.filter(s => {
                const sDate = new Date(s.Date);
                return sDate >= tStart && sDate <= tEnd && s.Is_No_Class === 0;
            });
            termTotalDays = termSessions.length;

            const termRecords = records.filter(r => {
                const rDate = new Date(r.Date);
                return rDate >= tStart && rDate <= tEnd;
            });

            termRecords.forEach(r => {
                if (r.Status === 'Present') present++;
                else if (r.Status === 'Late') late++;
                else if (r.Status === 'Excused') excused++;
                else if (r.Status === 'Absent') absent++;
                
                totalParticipationPts += (r.Performance_Points || 0);
            });

            studentReqDays = termTotalDays - excused;
            if (studentReqDays < 0) studentReqDays = 0;

            const attendanceScore = (present * 1) + (late * 0.5);
            if (studentReqDays > 0) {
                pct = ((attendanceScore / studentReqDays) * 100).toFixed(1);
            }
        }

        document.getElementById(`${term}Present`).textContent = present;
        document.getElementById(`${term}Late`).textContent = late;
        document.getElementById(`${term}Excused`).textContent = excused;
        document.getElementById(`${term}Absent`).textContent = absent;
        document.getElementById(`${term}TotalDays`).textContent = studentReqDays;
        document.getElementById(`${term}AttendancePct`).textContent = pct;
        document.getElementById(`${term}ParticipationScore`).textContent = totalParticipationPts;
    },

    renderDetailsModal: (term, metric, data) => {
        const course = data.course || {};
        const records = data.records || [];
        
        let termStart = '';
        let termEnd = '';
        let titleTerm = '';
        
        if (term === 'midterm') {
            termStart = course.Midterm_Start || '';
            termEnd = course.Midterm_End || '';
            titleTerm = 'Mid Term';
        } else {
            termStart = course.Final_Start || '';
            termEnd = course.Final_End || '';
            titleTerm = 'Final Term';
        }
        
        const titleMetric = metric === 'attendance' ? 'Attendance Breakdown' : 'Participation Breakdown';
        document.getElementById('detailsModalTitle').textContent = `${titleTerm} - ${titleMetric}`;
        
        const scoreHeader = document.getElementById('detailsScoreHeader');
        if (metric === 'attendance') {
            scoreHeader.textContent = "Attendance Score";
        } else {
            scoreHeader.textContent = "Points";
        }

        const tbody = document.getElementById('detailsTableBody');
        tbody.innerHTML = '';

        if (!termStart || !termEnd) {
            tbody.innerHTML = `<tr><td colspan="3" class="px-3 py-4 text-center text-gray-500 italic">Term dates are not set for this course.</td></tr>`;
            return;
        }

        const tStart = new Date(termStart);
        const tEnd = new Date(termEnd);
        
        const termRecords = records.filter(r => {
            const rDate = new Date(r.Date);
            return rDate >= tStart && rDate <= tEnd;
        });

        if (termRecords.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" class="px-3 py-4 text-center text-gray-500 italic">No records found for this period.</td></tr>`;
            return;
        }

        const rowsHtml = termRecords.map(r => {
            let statusColor = 'text-gray-600';
            let attScore = 0;
            
            if (r.Status === 'Present') { statusColor = 'text-green-600 font-bold'; attScore = 1; }
            else if (r.Status === 'Late') { statusColor = 'text-yellow-600 font-bold'; attScore = 0.5; }
            else if (r.Status === 'Excused') { statusColor = 'text-purple-600 font-bold'; attScore = 0; }
            else if (r.Status === 'Absent') { statusColor = 'text-red-600 font-bold'; attScore = 0; }
            
            const displayScore = metric === 'attendance' ? attScore : (r.Performance_Points || 0);

            return `
                <tr class="hover:bg-gray-50 transition">
                    <td class="px-3 py-2 whitespace-nowrap font-medium text-gray-700">${r.Date}</td>
                    <td class="px-3 py-2 text-center ${statusColor}">${r.Status || '--'}</td>
                    <td class="px-3 py-2 text-center font-mono font-bold text-gray-800">${displayScore}</td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = rowsHtml;
    },

    exportRoster: async (courseId) => {
        try {
            const ts = new Date().getTime();
            const data = await apiFetch(`/api/course-details?courseId=${courseId}&_t=${ts}`);
            const students = data.students;

            const eyeOrder = { 'Near Sighted': 1, 'No Eye Condition': 2, 'Far Sighted': 3 };
            students.sort((a, b) => {
                const seatAStr = (a.Seat_Number || '').toString().trim();
                const seatBStr = (b.Seat_Number || '').toString().trim();
                const hasSeatA = seatAStr !== '';
                const hasSeatB = seatBStr !== '';
                if (hasSeatA && !hasSeatB) return -1;
                if (!hasSeatA && hasSeatB) return 1;
                if (hasSeatA && hasSeatB) {
                    const numA = parseFloat(seatAStr);
                    const numB = parseFloat(seatBStr);
                    if (!isNaN(numA) && !isNaN(numB)) {
                        if (numA !== numB) return numA - numB;
                    } else {
                        if (seatAStr !== seatBStr) return seatAStr.localeCompare(seatBStr);
                    }
                }
                const eyeA = eyeOrder[a.eye_condition] || 4;
                const eyeB = eyeOrder[b.eye_condition] || 4;
                if (eyeA !== eyeB) return eyeA - eyeB;
                const nameA = a.Name || '';
                const nameB = b.Name || '';
                return nameA.localeCompare(nameB);
            });

            const printWindow = window.open('', '_blank');
            if (!printWindow) {
                alert("Please allow pop-ups to print the roster.");
                return;
            }

            const html = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <title>Class Roster - ${data.course.CourseCode}</title>
                    <style>
                        @page { size: letter; margin: 0.5in; }
                        body { font-family: 'Arial', sans-serif; font-size: 10pt; color: #333; margin: 0; padding: 0; }
                        .header { text-align: center; margin-bottom: 20px; }
                        h1 { font-size: 18pt; margin: 0 0 5px 0; color: #000; }
                        h3 { font-size: 12pt; margin: 0; color: #555; font-weight: normal; }
                        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                        th, td { border: 1px solid #000; padding: 6px; text-align: left; vertical-align: middle; }
                        th { background-color: #f0f0f0; font-weight: bold; font-size: 10pt; }
                        td { font-size: 9.5pt; }
                        .photo-cell { width: 1in; text-align: center; }
                        .photo { width: 1in; height: 1in; object-fit: cover; border: 1px solid #ccc; display: block; margin: 0 auto; }
                        .center { text-align: center; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>${data.course.CourseCode} - ${data.course.CourseTitle}</h1>
                        <h3>Schedule: ${data.course.ScheduleDay} | ${data.course.TimePeriod}</h3>
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th>Photo</th>
                                <th class="center">Seat No.</th>
                                <th>Student No.</th>
                                <th>Name</th>
                                <th>Group Name</th>
                                <th>Assigned Topic</th>
                                <th>Contact</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${students.map(s => {
                                const avatarSrc = getLoadableAvatarSrc(s.Avatar);
                                const imgTag = avatarSrc ? `<img src="${avatarSrc}" class="photo" alt="Photo">` : `<div style="width:1in; height:1in; line-height:1in; text-align:center; background:#eee; font-size:8pt; color:#999; margin:0 auto;">No Photo</div>`;
                                return `
                                <tr>
                                    <td class="photo-cell">${imgTag}</td>
                                    <td class="center"><strong>${s.Seat_Number || ''}</strong></td>
                                    <td>${s.Student_Number || ''}</td>
                                    <td><strong>${s.Name}</strong></td>
                                    <td>${s.Group_Name || ''}</td>
                                    <td>${s.Assigned_Topic || ''}</td>
                                    <td>${s.Contact_Number || ''}</td>
                                </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                    <script>
                        window.onload = function() {
                            setTimeout(function() {
                                window.print();
                            }, 500);
                        };
                    </script>
                </body>
                </html>
            `;

            printWindow.document.write(html);
            printWindow.document.close();

        } catch (err) {
            alert('Failed to generate export: ' + err.message);
        }
    },

    loadUnenrolledStudents: async (courseId) => {
        const listContainer = document.getElementById('unenrolledStudentsList');
        if (!listContainer) return;
        
        const filterStatus = document.getElementById('filterStatus')?.value ?? 'Active';
        const filterCourse = document.getElementById('filterCourse')?.value || '';
        const filterYear = document.getElementById('filterYear')?.value || '';
        const filterSection = document.getElementById('filterSection')?.value || '';

        listContainer.innerHTML = '<div class="text-center py-10 text-gray-500 text-sm"><i class="fa-solid fa-spinner fa-spin text-2xl mb-2 text-blue-600"></i><br>Loading students...</div>';
        
        try {
            let url = `/api/unenrolled-students?courseId=${courseId}`;
            if (filterStatus) url += `&statusFilter=${encodeURIComponent(filterStatus)}`;
            if (filterCourse) url += `&courseFilter=${encodeURIComponent(filterCourse)}`;
            if (filterYear) url += `&yearFilter=${encodeURIComponent(filterYear)}`;
            if (filterSection) url += `&sectionFilter=${encodeURIComponent(filterSection)}`;
            
            const ts = new Date().getTime();
            const data = await apiFetch(`${url}&_t=${ts}`);
            
            if (!data.students || data.students.length === 0) {
                listContainer.innerHTML = '<div class="p-8 text-center text-gray-500 bg-white border border-gray-200 rounded-md shadow-sm">No new students available to enroll matching criteria.</div>';
                return;
            }

            const html = data.students.map(s => {
                const displayCourse = `${s.course || ''} ${s.year || ''} ${s.section ? '- ' + s.section : ''}`.trim();
                const statusBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${
                    s.account_status === 'Active' ? 'text-green-600 border-green-200 bg-green-50' : 
                    s.account_status === 'Inactive' ? 'text-gray-500 border-gray-200 bg-gray-50' :
                    s.account_status === 'Suspended' ? 'text-orange-500 border-orange-200 bg-orange-50' :
                    s.account_status === 'UD' ? 'text-red-500 border-red-200 bg-red-50' :
                    s.account_status === 'Dropped' ? 'text-red-700 border-red-300 bg-red-100' : 'text-gray-500 border-gray-200 bg-gray-50'
                }">${s.account_status || 'Inactive'}</span>`;

                return `
                    <div class="student-enroll-item flex items-center justify-between p-3 bg-white border border-gray-200 rounded-md shadow-sm hover:border-blue-300 transition">
                        <div>
                            <div class="font-bold text-gray-800 text-sm flex items-center gap-2">
                                ${s.Name} ${statusBadge}
                            </div>
                            <div class="text-[11px] text-gray-500 mt-0.5">
                                <span class="font-bold text-gray-700">${s.Student_Number || 'N/A'}</span> &bull; ${displayCourse || 'N/A'}
                            </div>
                        </div>
                        <button type="button" data-student-id="${s.User_ID}" class="lecturer-enroll-btn bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-600 hover:text-white px-3 py-1.5 rounded text-xs font-bold transition">
                            Enroll
                        </button>
                    </div>
                `;
            }).join('');

            listContainer.innerHTML = html;
            
            const searchInput = document.getElementById('studentSearchInput');
            if (searchInput && searchInput.value) {
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            
        } catch (err) {
            listContainer.innerHTML = `<div class="p-4 bg-red-50 text-red-600 rounded text-sm font-medium border border-red-200 text-center">${err.message}</div>`;
        }
    },

    saveAttendance: async () => {
        const btn = document.getElementById('saveAttendanceBtn');
        const alertBox = document.getElementById('attendanceAlert');
        const dateVal = document.getElementById('attendanceDate').value;
        const isNoClass = document.getElementById('noClassToggle').checked;
        const courseId = window.location.hash.replace('#class-', '');
        
        if (!dateVal) {
            alertBox.textContent = "Please select a date.";
            alertBox.className = "mb-4 p-3 rounded-md text-sm font-medium bg-red-100 text-red-700 block fade-in";
            return;
        }

        const rows = document.querySelectorAll('.student-row');
        const attendanceData = [];
        let missingCount = 0;

        if (!isNoClass) {
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
        }

        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Saving...';

        try {
            const payload = {
                courseId: courseId,
                date: dateVal,
                isNoClass: isNoClass,
                records: attendanceData
            };

            await apiFetch('/api/attendance', { method: 'POST', body: JSON.stringify(payload) });
            
            CourseModule.clearDraft(courseId, dateVal);

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
            
            const noClassToggle = document.getElementById('noClassToggle');
            const container = document.getElementById('rosterListContainer');
            
            if (noClassToggle) {
                noClassToggle.checked = data.isNoClass === true;
                if (data.isNoClass === true) {
                    container.classList.add('opacity-50', 'pointer-events-none');
                } else {
                    container.classList.remove('opacity-50', 'pointer-events-none');
                }
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
                        }
                    }
                } catch(e) {}
            }

        } catch (err) {
            console.error("Failed to load attendance:", err);
        }
    },

    loadDashboardData: async () => {
        const container = document.getElementById('courseContainer');
        if (!container || !AppState.user) return;
        
        container.innerHTML = '<div class="text-center py-12"><i class="fa-solid fa-spinner fa-spin text-blue-600 text-4xl"></i><p class="mt-4 text-gray-500 font-medium">Loading Courses...</p></div>';
        
        if (AppState.user.role.toLowerCase() === 'lecturer') {
            await CourseModule.renderLecturerDashboard(container);
        } else {
            await CourseModule.renderStudentDashboard(container);
        }
    },

    loadClassScreen: async (courseId, skipSpinner = false) => {
        const root = document.getElementById('app-root');
        if (!root || !AppState.user) return;
        
        let modalWasOpen = false;
        let searchVal = '';
        let statusVal = 'Active';
        let courseVal = '';
        let yearVal = '';
        let sectionVal = '';
        
        const modal = document.getElementById('addStudentModal');
        if (modal && !modal.classList.contains('hidden')) {
            modalWasOpen = true;
            searchVal = document.getElementById('studentSearchInput')?.value || '';
            statusVal = document.getElementById('filterStatus')?.value || 'Active';
            courseVal = document.getElementById('filterCourse')?.value || '';
            yearVal = document.getElementById('filterYear')?.value || '';
            sectionVal = document.getElementById('filterSection')?.value || '';
        }
        
        if (!skipSpinner) {
            root.innerHTML = '<div class="flex justify-center items-center h-screen"><i class="fa-solid fa-spinner fa-spin text-blue-600 text-4xl"></i></div>';
        }
        
        try {
            const ts = new Date().getTime();
            const data = await apiFetch(`/api/course-details?courseId=${courseId}&_t=${ts}`);
            
            root.innerHTML = Components.renderClassScreen(data.course, data.students);
            
            const dateInput = document.getElementById('attendanceDate');
            if (dateInput) {
                await CourseModule.loadAttendanceData(courseId, dateInput.value);
            }
            
            if (modalWasOpen) {
                document.getElementById('addStudentModal').classList.remove('hidden');
                
                const filterCourseSelect = document.getElementById('filterCourse');
                if (filterCourseSelect) {
                    try {
                        const programsData = await apiFetch(`/api/programs?_t=${ts}`);
                        if (programsData.programs) {
                            filterCourseSelect.innerHTML = '<option value="">Course (All)</option>' + 
                                programsData.programs.map(p => `<option value="${p.ProgramCode}">${p.ProgramCode}</option>`).join('');
                        }
                    } catch(e) {}
                }
                
                if (document.getElementById('studentSearchInput')) document.getElementById('studentSearchInput').value = searchVal;
                if (document.getElementById('filterStatus')) document.getElementById('filterStatus').value = statusVal;
                if (document.getElementById('filterCourse')) document.getElementById('filterCourse').value = courseVal;
                if (document.getElementById('filterYear')) document.getElementById('filterYear').value = yearVal;
                if (document.getElementById('filterSection')) document.getElementById('filterSection').value = sectionVal;
                
                CourseModule.loadUnenrolledStudents(courseId);
            }
        } catch (err) {
            root.innerHTML = `<div class="p-8 text-center mt-20"><div class="text-red-500 mb-4 text-4xl"><i class="fa-solid fa-triangle-exclamation"></i></div><p class="text-gray-800 font-bold mb-4">${err.message}</p><a href="#dashboard" class="text-blue-600 underline font-bold">Back to Dashboard</a></div>`;
        }
    },

    createProgram: async () => {
        const btn = document.getElementById('addProgramBtn');
        const errorDiv = document.getElementById('programError');
        const successDiv = document.getElementById('programSuccess');
        errorDiv.classList.add('hidden');
        successDiv.classList.add('hidden');
        btn.disabled = true;
        btn.innerHTML = 'Saving...';
        
        const payload = {
            programCode: document.getElementById('programCode').value.trim()
        };
        
        try {
            await apiFetch('/api/programs', { method: 'POST', body: JSON.stringify(payload) });
            successDiv.textContent = "Added to Registration List successfully!";
            successDiv.classList.remove('hidden');
            document.getElementById('addProgramForm').reset();
            
            const ts = new Date().getTime();
            const programsData = await apiFetch(`/api/programs?_t=${ts}`);
            const targetCourseSelect = document.getElementById('targetCourse');
            if (targetCourseSelect && programsData.programs) {
                targetCourseSelect.innerHTML = '<option value="">All Courses</option>' + 
                    programsData.programs.map(p => `<option value="${p.ProgramCode}">${p.ProgramCode}</option>`).join('');
            }

            setTimeout(() => {
                successDiv.classList.add('hidden');
                document.getElementById('apModal').classList.add('hidden');
            }, 1500);
        } catch (err) {
            errorDiv.textContent = err.message;
            errorDiv.classList.remove('hidden');
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Add to Registration List';
        }
    },

    createCourse: async () => {
        const btn = document.getElementById('addCourseBtn');
        const errorDiv = document.getElementById('courseError');
        errorDiv.classList.add('hidden');
        btn.disabled = true;
        btn.innerHTML = 'Saving...';
        
        const payload = {
            courseCode: document.getElementById('courseCode').value.trim(),
            courseTitle: document.getElementById('courseTitle').value.trim(),
            scheduleDay: document.getElementById('scheduleDay').value,
            timePeriod: document.getElementById('timePeriod').value.trim(),
            targetCourse: document.getElementById('targetCourse').value.trim(),
            targetYear: document.getElementById('targetYear').value.trim(),
            targetSection: document.getElementById('targetSection').value.trim(),
            lecturerId: AppState.user.User_ID
        };
        
        try {
            await apiFetch('/api/courses', { method: 'POST', body: JSON.stringify(payload) });
            document.getElementById('addCourseForm').reset();
            document.getElementById('ccModal').classList.add('hidden');
            await CourseModule.loadDashboardData();
        } catch (err) {
            errorDiv.textContent = err.message;
            errorDiv.classList.remove('hidden');
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Create Course';
        }
    },

    enrollCourse: async (courseId) => {
        try {
            await apiFetch('/api/enroll', { 
                method: 'POST', 
                body: JSON.stringify({ courseId: courseId, studentId: AppState.user.User_ID }) 
            });
            await CourseModule.loadDashboardData();
        } catch (err) {
            alert(err.message);
            await CourseModule.loadDashboardData();
        }
    },

    renderLecturerDashboard: async (container) => {
        try {
            const ts = new Date().getTime();
            const programsData = await apiFetch(`/api/programs?_t=${ts}`);
            const targetCourseSelect = document.getElementById('targetCourse');
            if (targetCourseSelect && programsData.programs) {
                targetCourseSelect.innerHTML = '<option value="">All Courses</option>' + 
                    programsData.programs.map(p => `<option value="${p.ProgramCode}">${p.ProgramCode}</option>`).join('');
            }

            const data = await apiFetch(`/api/my-courses?userId=${AppState.user.User_ID}&role=lecturer&_t=${ts}`);
            
            const dayMap = { 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 'Thursday': 4, 'Friday': 5, 'Saturday': 6, 'Sunday': 7 };
            const parseTime = (timeStr) => {
                if (!timeStr) return 0;
                const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
                if (!match) return 0;
                let [ , h, m, period ] = match;
                h = parseInt(h);
                if (period.toUpperCase() === 'PM' && h !== 12) h += 12;
                if (period.toUpperCase() === 'AM' && h === 12) h = 0;
                return h * 60 + parseInt(m);
            };

            data.courses.sort((a, b) => {
                const dayDiff = (dayMap[a.ScheduleDay] || 8) - (dayMap[b.ScheduleDay] || 8);
                if (dayDiff !== 0) return dayDiff;
                return parseTime(a.TimePeriod) - parseTime(b.TimePeriod);
            });
            
            let coursesHtml = data.courses.map(c => `
                <a href="#class-${c.Course_ID}" class="block p-5 border rounded-xl shadow-sm bg-white transition hover:shadow-md hover:border-blue-300">
                    <div class="flex justify-between items-start mb-1">
                        <div class="font-bold text-xl text-blue-700">${c.CourseCode}</div>
                        ${(c.Target_Course || c.Target_Year || c.Target_Section) ? 
                            `<span class="bg-gray-100 text-gray-600 text-[10px] font-bold px-2 py-1 rounded border uppercase">
                                ${[c.Target_Course, c.Target_Year, c.Target_Section].filter(Boolean).join(' ')} Only
                            </span>` : 
                            `<span class="bg-blue-50 text-blue-500 text-[10px] font-bold px-2 py-1 rounded border uppercase">All Students</span>`
                        }
                    </div>
                    <div class="text-gray-800 font-bold mb-2">${c.CourseTitle}</div>
                    <div class="text-sm text-gray-500 bg-gray-50 inline-block px-3 py-1 rounded-md border">
                        <i class="fa-regular fa-calendar mr-1"></i> ${c.ScheduleDay} &nbsp;|&nbsp; <i class="fa-regular fa-clock mr-1"></i> ${c.TimePeriod}
                    </div>
                </a>
            `).join('');
            
            if (!coursesHtml) {
                coursesHtml = '<div class="col-span-full p-8 text-center text-gray-500 border-2 border-dashed rounded-xl bg-gray-50 font-medium">No courses created yet. Open the profile panel to create one.</div>';
            }
            
            container.innerHTML = `
                <div class="fade-in max-w-5xl mx-auto">
                    <h2 class="text-xl font-bold mb-6 text-gray-800 flex items-center"><div class="bg-gray-200 p-2 rounded-lg mr-3"><i class="fa-solid fa-chalkboard-user text-gray-600"></i></div>My Created Courses</h2>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        ${coursesHtml}
                    </div>
                </div>
            `;
        } catch (err) {
            container.innerHTML = `<div class="p-4 bg-red-50 text-red-600 rounded font-medium border border-red-200">Failed to load data: ${err.message}</div>`;
        }
    },

    renderStudentDashboard: async (container) => {
        try {
            const ts = new Date().getTime();
            const [myCoursesRes, allCoursesRes] = await Promise.all([
                apiFetch(`/api/my-courses?userId=${AppState.user.User_ID}&role=student&_t=${ts}`),
                apiFetch(`/api/courses?studentId=${AppState.user.User_ID}&_t=${ts}`)
            ]);
            
            const enrolledIds = myCoursesRes.courses.map(c => c.Course_ID);
            
            let enrolledHtml = myCoursesRes.courses.map(c => `
                <div class="p-5 border-2 border-green-200 rounded-xl shadow-sm bg-green-50 relative overflow-hidden transition hover:shadow-md">
                    <div class="absolute top-0 right-0 bg-green-500 text-white text-[10px] px-3 py-1 rounded-bl-xl font-bold shadow-sm tracking-widest uppercase">Enrolled</div>
                    <div class="font-black text-xl text-green-800 pr-16">${c.CourseCode}</div>
                    <div class="text-gray-800 font-bold mb-2">${c.CourseTitle}</div>
                    <div class="text-sm text-gray-700 font-medium"><i class="fa-solid fa-chalkboard-user w-5 text-gray-400"></i> ${c.LecturerName}</div>
                    <div class="text-sm text-gray-700 mt-1"><i class="fa-regular fa-calendar w-5 text-gray-400"></i> ${c.ScheduleDay} &nbsp;|&nbsp; <i class="fa-regular fa-clock text-gray-400"></i> ${c.TimePeriod}</div>
                </div>
            `).join('');
            
            if (!enrolledHtml) {
                enrolledHtml = '<div class="col-span-full p-8 text-center text-gray-500 border-2 border-dashed rounded-xl bg-gray-50 font-medium">You are not enrolled in any courses yet.</div>';
            }
            
            const availableCourses = allCoursesRes.courses.filter(c => !enrolledIds.includes(c.Course_ID));
            let availableHtml = availableCourses.map(c => `
                <div class="p-5 border rounded-xl shadow-sm bg-white flex flex-col md:flex-row justify-between items-start md:items-center transition hover:border-blue-300 gap-4">
                    <div>
                        <div class="font-black text-xl text-blue-700">${c.CourseCode}</div>
                        <div class="text-gray-800 font-bold mb-2">${c.CourseTitle}</div>
                        <div class="text-sm text-gray-600 font-medium"><i class="fa-solid fa-chalkboard-user w-5 text-gray-400"></i> ${c.LecturerName}</div>
                        <div class="text-sm text-gray-600 mt-1"><i class="fa-regular fa-calendar w-5 text-gray-400"></i> ${c.ScheduleDay} &nbsp;|&nbsp; <i class="fa-regular fa-clock text-gray-400"></i> ${c.TimePeriod}</div>
                    </div>
                    <button data-id="${c.Course_ID}" class="enroll-btn w-full md:w-auto px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm font-bold transition-colors">
                        Enroll Now
                    </button>
                </div>
            `).join('');
            
            if (!availableHtml) {
                availableHtml = '<div class="col-span-full p-8 text-center text-gray-500 border-2 border-dashed rounded-xl bg-gray-50 font-medium">No new courses available for enrollment.</div>';
            }

            container.innerHTML = `
                <div class="space-y-12 fade-in">
                    <section>
                        <h2 class="text-2xl font-black mb-6 text-gray-800 flex items-center"><div class="bg-green-100 p-2 rounded-lg mr-3"><i class="fa-solid fa-check-double text-green-600"></i></div>My Active Courses</h2>
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                            ${enrolledHtml}
                        </div>
                    </section>
                    
                    <section>
                        <h2 class="text-2xl font-black mb-6 text-gray-800 flex items-center pt-8 border-t border-gray-200"><div class="bg-blue-100 p-2 rounded-lg mr-3"><i class="fa-solid fa-book-open text-blue-600"></i></div>Available Courses</h2>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                            ${availableHtml}
                        </div>
                    </section>
                </div>
            `;
        } catch (err) {
            container.innerHTML = `<div class="p-4 bg-red-50 text-red-600 rounded font-medium border border-red-200">Failed to load data: ${err.message}</div>`;
        }
    }
};
