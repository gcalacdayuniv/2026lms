// js/course.js
import { apiFetch, AppState } from './globals.js';
import { CourseDashboard } from './course-dashboard.js';
import { CourseClass } from './course-class.js';
import { CourseAttendance } from './course-attendance.js';
import { CourseRecitation } from './course-recitation.js';
import { CourseExam } from './course-exam.js';
import { getLoadableAvatarSrc } from './components.js';

export const CourseModule = {
    lastTap: 0,
    
    init: () => {
        document.addEventListener('submit', CourseModule.handleForms);
        document.addEventListener('click', CourseModule.handleClicks);
        document.addEventListener('change', CourseModule.handleChanges);
        document.addEventListener('input', CourseModule.handleInput);
        document.addEventListener('keydown', CourseModule.handleKeydown);
        document.addEventListener('touchend', CourseModule.handleTouchEnd, { passive: false });
    },

    handleTouchEnd: (e) => {
        const card = e.target.closest('.dash-exam-card');
        if (card) {
            const currentTime = new Date().getTime();
            const tapLength = currentTime - CourseModule.lastTap;
            if (tapLength < 500 && tapLength > 0) {
                const btn = card.querySelector('.start-accessible-exam-btn');
                if (btn) btn.click();
                if(e.cancelable) e.preventDefault();
            }
            CourseModule.lastTap = currentTime;
        }
    },

    handleKeydown: (e) => {
        const activeEl = document.activeElement;
        if (activeEl && activeEl.classList.contains('dash-exam-card')) {
            const cards = Array.from(document.querySelectorAll('.dash-exam-card'));
            const idx = cards.indexOf(activeEl);
            
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                if (idx < cards.length - 1) cards[idx + 1].focus();
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                if (idx > 0) cards[idx - 1].focus();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const btn = activeEl.querySelector('.start-accessible-exam-btn');
                if (btn) btn.click();
            }
        }
    },

    handleForms: async (e) => {
        if (e.target.id === 'addCourseForm') {
            e.preventDefault();
            await CourseDashboard.createCourse();
        }
        if (e.target.id === 'addProgramForm') {
            e.preventDefault();
            await CourseDashboard.createProgram();
        }
        if (e.target.id === 'submitDocForm') {
            e.preventDefault();
            await CourseDashboard.submitDocument();
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
            if (courseId && dateVal) CourseAttendance.saveDraft(courseId, dateVal);
        }
    },

    handleChanges: async (e) => {
        if (e.target.id === 'submissionType') {
            if (e.target.value === 'url') {
                document.getElementById('fileInputContainer').classList.add('hidden');
                document.getElementById('urlInputContainer').classList.remove('hidden');
                document.getElementById('submitFileInput').removeAttribute('required');
                document.getElementById('submitUrlInput').setAttribute('required', 'true');
            } else {
                document.getElementById('urlInputContainer').classList.add('hidden');
                document.getElementById('fileInputContainer').classList.remove('hidden');
                document.getElementById('submitUrlInput').removeAttribute('required');
                document.getElementById('submitFileInput').setAttribute('required', 'true');
            }
        }

        if (e.target.id === 'isGroupUpload') {
            const list = document.getElementById('groupMembersList');
            if (e.target.checked) {
                list.classList.remove('hidden');
            } else {
                list.classList.add('hidden');
            }
        }

        if (
            e.target.id === 'manageSeatInput' ||
            e.target.id === 'manageGroupInput' ||
            e.target.id === 'manageTopicInput' ||
            e.target.id === 'manageEyeConditionSelect'
        ) {
            const studentId = document.getElementById('manageStudentId').value;
            const seatNumber = document.getElementById('manageSeatInput').value.trim();
            const groupName = document.getElementById('manageGroupInput').value.trim();
            const assignedTopic = document.getElementById('manageTopicInput').value.trim();
            const eyeCondition = document.getElementById('manageEyeConditionSelect')?.value || 'No Eye Condition';
            const courseId = window.location.hash.replace('#class-', '');

            try {
                await apiFetch('/api/update-student-info', {
                    method: 'POST',
                    body: JSON.stringify({ courseId, studentId, seatNumber, groupName, assignedTopic, eyeCondition })
                });
                const stu = CourseClass.currentStudents.find(s => s.User_ID === studentId);
                if (stu) {
                    stu.Seat_Number = seatNumber;
                    stu.Group_Name = groupName;
                    stu.Assigned_Topic = assignedTopic;
                    stu.eye_condition = eyeCondition;
                }
            } catch (err) {
                console.error('Failed to update student info:', err);
            }
        }

        if (e.target.id === 'manageStatusSelect') {
            const studentId = document.getElementById('manageStudentId').value;
            const status = e.target.value;
            CourseClass.updateManageStatusColor(e.target);

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
            await CourseClass.loadUnenrolledStudents(courseId);
        }

        if (e.target.id === 'attendanceDate') {
            const courseId = window.location.hash.replace('#class-', '');
            const date = e.target.value;
            if (courseId && date) {
                await CourseAttendance.loadAttendanceData(courseId, date);
            }
        }

        if (e.target.name === 'callerMode') {
            const toggleBtn = document.getElementById('toggleCalledListBtn');
            const calledContainer = document.getElementById('calledListContainer');
            if (e.target.value === '2') {
                toggleBtn.classList.remove('hidden');
            } else {
                toggleBtn.classList.add('hidden');
                calledContainer.classList.add('hidden');
                toggleBtn.textContent = "View Called List";
            }
            CourseRecitation.drawWheel();
        }
    },

    handleClicks: async (e) => {
        if (e.target.closest('.group-name-trigger') || e.target.closest('#ssGroup')) {
            const trigger = e.target.closest('.group-name-trigger') || e.target.closest('#ssGroup');
            if (!trigger.dataset.group) return;

            const courseId = trigger.dataset.courseId;
            const groupName = trigger.dataset.group;

            document.getElementById('gmmTitle').textContent = `Group: ${groupName}`;
            document.getElementById('groupMembersModal').classList.remove('hidden');
            document.getElementById('gmmLoading').classList.remove('hidden');
            document.getElementById('gmmContent').classList.add('hidden');

            try {
                const data = await apiFetch(`/api/group-members?courseId=${courseId}&groupName=${encodeURIComponent(groupName)}`);
                const content = document.getElementById('gmmContent');

                if (data.members && data.members.length > 0) {
                    content.innerHTML = data.members.map(m => {
                        const avatarSrc = getLoadableAvatarSrc(m.Avatar);
                        const avatarImg = avatarSrc ? `<img src="${avatarSrc}" class="w-10 h-10 rounded-full object-cover border border-gray-200">` : `<i class="fa-solid fa-circle-user text-[40px] text-gray-300"></i>`;
                        return `
                            <div class="flex items-center space-x-3 p-2 bg-gray-50 border border-gray-200 rounded">
                                <div class="flex-shrink-0">${avatarImg}</div>
                                <div>
                                    <div class="text-sm font-bold text-gray-800">${m.Name}</div>
                                    <div class="text-[10px] text-gray-500">${m.Student_Number || 'N/A'}</div>
                                </div>
                            </div>
                        `;
                    }).join('');
                } else {
                    content.innerHTML = '<div class="text-sm text-gray-500 italic text-center py-4">No members found.</div>';
                }
                document.getElementById('gmmLoading').classList.add('hidden');
                content.classList.remove('hidden');
            } catch (err) {
                document.getElementById('gmmLoading').classList.add('hidden');
                document.getElementById('gmmContent').innerHTML = `<div class="text-sm text-red-500 font-bold text-center py-4">${err.message}</div>`;
                document.getElementById('gmmContent').classList.remove('hidden');
            }
        }

        if (e.target.closest('#closeGroupMembersModalBtn') || e.target.id === 'closeGroupMembersModalBg') {
            document.getElementById('groupMembersModal').classList.add('hidden');
        }

        if (e.target.closest('#openSubmitDocModalBtn')) {
            document.getElementById('submitDocModal').classList.remove('hidden');
            const btn = e.target.closest('#openSubmitDocModalBtn');
            if(btn && btn.dataset.courseId) {
                CourseDashboard.loadGroupMembersForUpload(btn.dataset.courseId);
            }
        }
        if (e.target.closest('#closeSubmitDocModalBtn') || e.target.id === 'closeSubmitDocModalBg') {
            document.getElementById('submitDocModal').classList.add('hidden');
        }

        if (e.target.closest('#openHistoryModalBtn')) {
            document.getElementById('submissionHistoryModal').classList.remove('hidden');
        }
        if (e.target.closest('#closeSubmissionHistoryModalBtn') || e.target.id === 'closeSubmissionHistoryModalBg') {
            document.getElementById('submissionHistoryModal').classList.add('hidden');
        }

        if (e.target.closest('#toggleCalledListBtn')) {
            const container = document.getElementById('calledListContainer');
            const btn = document.getElementById('toggleCalledListBtn');
            if (container.classList.contains('hidden')) {
                container.classList.remove('hidden');
                btn.textContent = "Hide Called List";
            } else {
                container.classList.add('hidden');
                btn.textContent = "View Called List";
            }
        }

        if (e.target.closest('.remove-called-student')) {
            const btn = e.target.closest('.remove-called-student');
            CourseRecitation.removeCalledStudent(btn.dataset.userId);
        }

        if (e.target.closest('#resetCalledListBtn')) {
            const confirmation = window.confirm("Are you sure you want to reset all called students for today?");
            if (confirmation) {
                CourseRecitation.resetCalledList();
            }
        }

        if (e.target.closest('.student-active-course')) {
            const card = e.target.closest('.student-active-course');
            const courseId = card.dataset.courseId;
            const courseTitle = card.dataset.courseTitle;

            document.getElementById('ssCourseTitle').textContent = courseTitle;
            document.getElementById('ssEnrollmentInfo').classList.add('hidden');

            document.getElementById('studentSummaryModal').classList.remove('hidden');
            document.getElementById('summaryLoading').classList.remove('hidden');
            document.getElementById('summaryContent').classList.add('hidden');
            document.getElementById('summaryError').classList.add('hidden');

            CourseClass.currentSummaryData = null;

            try {
                const ts = new Date().getTime();
                const data = await apiFetch(`/api/student-summary?courseId=${courseId}&studentId=${AppState.user.User_ID}&_t=${ts}`);
                CourseClass.currentSummaryData = data;

                CourseAttendance.renderTermMetrics('midterm', data);
                CourseAttendance.renderTermMetrics('finalterm', data);
                CourseClass.renderSubmissionsHistory(data.submissions, 'historySubmissionsList');

                if (data.enrollment) {
                    document.getElementById('ssSeat').textContent = data.enrollment.Seat_Number || 'N/A';

                    const groupEl = document.getElementById('ssGroup');
                    if (data.enrollment.Group_Name) {
                        groupEl.textContent = data.enrollment.Group_Name;
                        groupEl.classList.add('cursor-pointer', 'underline');
                        groupEl.dataset.courseId = courseId;
                        groupEl.dataset.group = data.enrollment.Group_Name;
                    } else {
                        groupEl.textContent = 'N/A';
                        groupEl.classList.remove('cursor-pointer', 'underline');
                        delete groupEl.dataset.courseId;
                        delete groupEl.dataset.group;
                    }

                    document.getElementById('ssTopic').textContent = data.enrollment.Assigned_Topic || 'N/A';
                    document.getElementById('ssEnrollmentInfo').classList.remove('hidden');
                }

                const submitBtn = document.getElementById('openSubmitDocModalBtn');
                if (submitBtn) submitBtn.dataset.courseId = courseId;

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

        if (e.target.closest('#closeStudentSummaryModalBtn') || e.target.id === 'closeStudentSummaryModalBg') {
            document.getElementById('studentSummaryModal').classList.add('hidden');
        }

        if (e.target.closest('.enroll-btn')) {
            const confirmation = window.confirm("Are you sure you want to enroll in this Course? This action cannot be undone.");
            if (!confirmation) {
                return;
            }

            const btn = e.target.closest('.enroll-btn');
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            await CourseDashboard.enrollCourse(btn.dataset.id);
        }

        if (e.target.closest('#openCourseMenuBtn')) {
            document.getElementById('courseMenuModal').classList.remove('hidden');
        }

        if (e.target.closest('#closeCourseMenuBtn') || e.target.id === 'closeCourseMenuBg') {
            document.getElementById('courseMenuModal').classList.add('hidden');
        }

        if (e.target.closest('#openNoClassModalBtn')) {
            document.getElementById('courseMenuModal').classList.add('hidden');
            document.getElementById('noClassModal').classList.remove('hidden');
            const courseId = window.location.hash.replace('#class-', '');
            await CourseAttendance.loadNoClassDays(courseId);
        }

        if (e.target.closest('#closeNoClassModalBtn') || e.target.id === 'closeNoClassModalBg') {
            document.getElementById('noClassModal').classList.add('hidden');
            const courseId = window.location.hash.replace('#class-', '');
            const dateInput = document.getElementById('attendanceDate');
            if (dateInput && dateInput.value) {
                await CourseAttendance.loadAttendanceData(courseId, dateInput.value);
            }
        }

        if (e.target.closest('#addNoClassBtn')) {
            const dateInput = document.getElementById('addNoClassDate');
            if (!dateInput.value) return;
            const courseId = window.location.hash.replace('#class-', '');
            const btn = e.target.closest('#addNoClassBtn');
            const originalHtml = btn.innerHTML;

            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

            try {
                await apiFetch('/api/no-class', {
                    method: 'POST',
                    body: JSON.stringify({ courseId, date: dateInput.value })
                });
                dateInput.value = '';
                await CourseAttendance.loadNoClassDays(courseId);
            } catch (err) {
                alert('Failed to add date: ' + err.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        }

        if (e.target.closest('.remove-no-class-btn')) {
            const btn = e.target.closest('.remove-no-class-btn');
            const date = btn.dataset.date;
            const courseId = window.location.hash.replace('#class-', '');
            const originalHtml = btn.innerHTML;

            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

            try {
                await apiFetch('/api/no-class', {
                    method: 'DELETE',
                    body: JSON.stringify({ courseId, date })
                });
                await CourseAttendance.loadNoClassDays(courseId);
            } catch (err) {
                alert('Failed to remove date: ' + err.message);
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        }

        if (e.target.closest('#saveCourseTermsBtn')) {
            const courseId = window.location.hash.replace('#class-', '');
            const midStart = document.getElementById('midtermStart').value;
            const midEnd = document.getElementById('midtermEnd').value;
            const finStart = document.getElementById('finalStart').value;
            const finEnd = document.getElementById('finalEnd').value;
            const btn = e.target.closest('#saveCourseTermsBtn');
            const alertBox = document.getElementById('courseMenuAlert');

            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Saving...';
            alertBox.classList.add('hidden');

            try {
                await apiFetch('/api/update-course-terms', {
                    method: 'POST',
                    body: JSON.stringify({
                        courseId,
                        midtermStart: midStart, midtermEnd: midEnd,
                        finalStart: finStart, finalEnd: finEnd
                    })
                });

                alertBox.textContent = "Term periods saved successfully!";
                alertBox.className = "mb-3 p-2 rounded text-xs font-bold bg-green-100 text-green-800 block fade-in";
            } catch (err) {
                alertBox.textContent = err.message;
                alertBox.className = "mb-3 p-2 rounded text-xs font-bold bg-red-100 text-red-700 block fade-in";
            } finally {
                btn.disabled = false;
                btn.innerHTML = 'Save Term Periods';
                setTimeout(() => alertBox.classList.add('hidden'), 3000);
            }
        }

        if (e.target.closest('.manage-student-btn')) {
            const btn = e.target.closest('.manage-student-btn');
            document.getElementById('manageStudentId').value = btn.dataset.studentId;
            document.getElementById('manageStudentName').textContent = btn.dataset.name;
            document.getElementById('manageSeatInput').value = btn.dataset.seat || '';
            document.getElementById('manageGroupInput').value = btn.dataset.group || '';
            document.getElementById('manageTopicInput').value = btn.dataset.topic || '';
            
            const eyeConditionSelect = document.getElementById('manageEyeConditionSelect');
            if (eyeConditionSelect) {
                eyeConditionSelect.value = btn.dataset.eye || 'No Eye Condition';
            }

            const statusSelect = document.getElementById('manageStatusSelect');
            statusSelect.value = btn.dataset.status || 'Inactive';
            CourseClass.updateManageStatusColor(statusSelect);

            document.getElementById('courseMenuModal')?.classList.add('hidden');
            document.getElementById('manageStudentModal').classList.remove('hidden');
        }

        if (e.target.closest('#closeManageStudentModalBtn') || e.target.id === 'closeManageStudentModalBg') {
            document.getElementById('manageStudentModal').classList.add('hidden');
            const courseId = window.location.hash.replace('#class-', '');
            CourseClass.loadClassScreen(courseId, true);
        }

        if (e.target.closest('#manageResetPwdBtn')) {
            const studentId = document.getElementById('manageStudentId').value;
            if (window.confirm("Are you sure you want to reset this student's password to 'password123'?")) {
                try {
                    await apiFetch('/api/reset-password', {
                        method: 'POST',
                        body: JSON.stringify({ userId: studentId })
                    });
                    alert("Password successfully reset to 'password123'.");
                } catch (err) {
                    alert("Failed to reset password: " + err.message);
                }
            }
        }

        if (e.target.closest('#manageRemoveBtn')) {
            const studentId = document.getElementById('manageStudentId').value;
            const courseId = window.location.hash.replace('#class-', '');
            if (window.confirm("Are you sure you want to remove this student from the course? This action cannot be undone.")) {
                try {
                    await apiFetch('/api/unenroll', {
                        method: 'POST',
                        body: JSON.stringify({ courseId: courseId, studentId: studentId })
                    });
                    document.getElementById('manageStudentModal').classList.add('hidden');
                    CourseClass.loadClassScreen(courseId, true);
                } catch (err) {
                    alert("Failed to remove student: " + err.message);
                }
            }
        }

        if (e.target.closest('#openAddStudentModalBtn')) {
            document.getElementById('courseMenuModal').classList.add('hidden');
            document.getElementById('addStudentModal').classList.remove('hidden');
            
            const courseId = window.location.hash.replace('#class-', '');
            const filterCourseSelect = document.getElementById('filterCourse');
            
            try {
                const ts = new Date().getTime();
                const programsData = await apiFetch(`/api/programs?_t=${ts}`);
                if (programsData.programs) {
                    filterCourseSelect.innerHTML = '<option value="">Course (All)</option>' + 
                        programsData.programs.map(p => `<option value="${p.ProgramCode}">${p.ProgramCode}</option>`).join('');
                }
            } catch(e) {}
            
            CourseClass.loadUnenrolledStudents(courseId);
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
            const studentId = btn.dataset.studentId;
            const courseId = window.location.hash.replace('#class-', '');

            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

            try {
                await apiFetch('/api/enroll', {
                    method: 'POST',
                    body: JSON.stringify({ courseId: courseId, studentId: studentId })
                });
                await CourseClass.loadUnenrolledStudents(courseId);
                CourseClass.loadClassScreen(courseId, true);
            } catch (err) {
                alert(err.message);
                btn.disabled = false;
                btn.innerHTML = 'Enroll';
            }
        }

        if (e.target.closest('.attendance-btn')) {
            const btn = e.target.closest('.attendance-btn');
            const container = btn.closest('.flex');
            const buttons = container.querySelectorAll('.attendance-btn');
            const pointsInput = btn.closest('.student-row').querySelector('.points-input');

            buttons.forEach(b => {
                b.classList.remove('bg-green-100', 'text-green-800', 'border-green-400', 'bg-yellow-100', 'text-yellow-800', 'border-yellow-400', 'bg-red-100', 'text-red-800', 'border-red-400', 'bg-purple-100', 'text-purple-800', 'border-purple-400');
                b.classList.add('bg-gray-50', 'text-gray-600', 'border-gray-200');
                b.removeAttribute('data-selected');
            });

            btn.setAttribute('data-selected', 'true');
            btn.classList.remove('bg-gray-50', 'text-gray-600', 'border-gray-200');

            const status = btn.dataset.status;
            if (status === 'Present') {
                btn.classList.add('bg-green-100', 'text-green-800', 'border-green-400');
                if (pointsInput && pointsInput.value === '0') pointsInput.value = '10';
            } else if (status === 'Late') {
                btn.classList.add('bg-yellow-100', 'text-yellow-800', 'border-yellow-400');
                if (pointsInput && pointsInput.value === '0') pointsInput.value = '5';
            } else if (status === 'Absent') {
                btn.classList.add('bg-red-100', 'text-red-800', 'border-red-400');
                if (pointsInput) pointsInput.value = '0';
            } else if (status === 'Excused') {
                btn.classList.add('bg-purple-100', 'text-purple-800', 'border-purple-400');
                if (pointsInput) pointsInput.value = '0';
            }

            const courseId = window.location.hash.replace('#class-', '');
            const dateVal = document.getElementById('attendanceDate')?.value;
            if (courseId && dateVal) CourseAttendance.saveDraft(courseId, dateVal);
        }
        
        if (e.target.closest('.save-single-attendance-btn')) {
            const btn = e.target.closest('.save-single-attendance-btn');
            const row = btn.closest('.student-row');
            const studentId = row.dataset.studentId;
            const selectedBtn = row.querySelector('.attendance-btn[data-selected="true"]');
            const pointsInput = row.querySelector('.points-input');
            const points = pointsInput ? (parseInt(pointsInput.value) || 0) : 0;
            
            const dateVal = document.getElementById('attendanceDate').value;
            const courseId = window.location.hash.replace('#class-', '');
            
            if (!dateVal) {
                alert("Please select a date first.");
                return;
            }
            
            if (!selectedBtn) {
                alert("Please select an attendance status (Present, Late, etc.) first.");
                return;
            }
            
            const status = selectedBtn.dataset.status;
            const originalHtml = btn.innerHTML;
            
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            
            try {
                await apiFetch('/api/attendance', { 
                    method: 'POST', 
                    body: JSON.stringify({
                        courseId: courseId,
                        date: dateVal,
                        records: [{
                            studentId: studentId,
                            status: status,
                            points: points
                        }]
                    }) 
                });
                
                const draftStr = localStorage.getItem(`attendance_draft_${courseId}_${dateVal}`);
                if (draftStr) {
                    try {
                        const draft = JSON.parse(draftStr);
                        if (draft[studentId]) {
                            delete draft[studentId];
                            localStorage.setItem(`attendance_draft_${courseId}_${dateVal}`, JSON.stringify(draft));
                        }
                    } catch(e) {}
                }
                
                btn.innerHTML = '<i class="fa-solid fa-check text-green-600"></i>';
                btn.classList.replace('border-blue-200', 'border-green-300');
                btn.classList.replace('bg-blue-50', 'bg-green-50');
                
                setTimeout(() => {
                    btn.innerHTML = originalHtml;
                    btn.classList.replace('border-green-300', 'border-blue-200');
                    btn.classList.replace('bg-green-50', 'bg-blue-50');
                    btn.disabled = false;
                }, 1500);
                
            } catch (err) {
                alert("Failed to save individual attendance: " + err.message);
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        }

        if (e.target.closest('#markAllPresent')) {
            const rows = document.querySelectorAll('.student-row');
            rows.forEach(row => {
                const presentBtn = row.querySelector('.attendance-btn[data-status="Present"]');
                if (presentBtn) {
                    presentBtn.click();
                }
            });
        }

        if (e.target.closest('#saveAttendanceBtn')) {
            await CourseAttendance.saveAttendance();
        }

        if (e.target.closest('#exportRosterBtn')) {
            const courseId = e.target.closest('#exportRosterBtn').dataset.courseId;
            await CourseClass.exportRoster(courseId);
        }

        if (e.target.closest('#openRecitationBtn')) {
            const courseId = window.location.hash.replace('#class-', '');
            await CourseRecitation.openModal(courseId);
        }

        if (e.target.closest('#closeRecitationModalBtn')) {
            CourseRecitation.closeModal();
        }
        
        if (e.target.id === 'recitationModalOverlay') {
            CourseRecitation.closeModal();
        }

        if (e.target.closest('#spinWheelBtn')) {
            CourseRecitation.spin();
        }

        if (e.target.closest('#nextStudentBtn')) {
            CourseRecitation.resetToWheel();
        }

        if (e.target.closest('.view-summary-trigger')) {
            const trigger = e.target.closest('.view-summary-trigger');
            const studentId = trigger.closest('.student-row').dataset.studentId;
            const courseId = window.location.hash.replace('#class-', '');
            const name = trigger.dataset.name;

            document.getElementById('summaryStudentName').textContent = name;
            document.getElementById('summaryModal').classList.remove('hidden');
            document.getElementById('summaryLoading').classList.remove('hidden');
            document.getElementById('summaryContent').classList.add('hidden');
            document.getElementById('summaryError').classList.add('hidden');

            CourseClass.currentSummaryData = null;

            try {
                const ts = new Date().getTime();
                const data = await apiFetch(`/api/student-summary?courseId=${courseId}&studentId=${studentId}&_t=${ts}`);
                CourseClass.currentSummaryData = data;

                CourseAttendance.renderTermMetrics('midterm', data);
                CourseAttendance.renderTermMetrics('finalterm', data);
                CourseClass.renderSubmissionsHistory(data.submissions, 'historySubmissionsList');

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

        if (e.target.closest('.view-details-trigger')) {
            const trigger = e.target.closest('.view-details-trigger');
            const term = trigger.dataset.term;
            const metric = trigger.dataset.metric;
            
            if (CourseClass.currentSummaryData) {
                CourseClass.renderDetailsModal(term, metric, CourseClass.currentSummaryData);
                document.getElementById('detailsModal').classList.remove('hidden');
            }
        }

        if (e.target.closest('#closeDetailsModalBtn') || e.target.id === 'closeDetailsModalBg') {
            document.getElementById('detailsModal').classList.add('hidden');
        }

        if (e.target.closest('#copyEmailsBtn')) {
            await CourseClass.copyStudentEmails();
        }
        
        if (e.target.closest('.save-grade-btn')) {
            const btn = e.target.closest('.save-grade-btn');
            const subId = btn.dataset.subId;
            const container = btn.closest('.flex');
            
            const narrativeVal = container.querySelector('.grade-narrative').value;
            const individualVal = container.querySelector('.grade-individual').value;
            const reportVal = container.querySelector('.grade-report').value;
            
            const originalHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            
            try {
                await apiFetch('/api/grade-submission', {
                    method: 'POST',
                    body: JSON.stringify({
                        submissionId: subId,
                        narrative: narrativeVal !== '' ? parseFloat(narrativeVal) : null,
                        individual: individualVal !== '' ? parseFloat(individualVal) : null,
                        report: reportVal !== '' ? parseFloat(reportVal) : null
                    })
                });
                
                btn.innerHTML = '<i class="fa-solid fa-check text-green-600"></i> Saved';
                btn.classList.replace('bg-blue-50', 'bg-green-50');
                btn.classList.replace('text-blue-600', 'text-green-700');
                btn.classList.replace('border-blue-200', 'border-green-300');
                
                setTimeout(() => {
                    btn.innerHTML = 'Save Grades';
                    btn.classList.replace('bg-green-50', 'bg-blue-50');
                    btn.classList.replace('text-green-700', 'text-blue-600');
                    btn.classList.replace('border-green-300', 'border-blue-200');
                    btn.disabled = false;
                }, 2000);
                
                const currentCourseId = window.location.hash.replace('#class-', '');
                if (CourseClass.currentSummaryData && CourseClass.currentSummaryData.enrollment) {
                    const studentId = CourseClass.currentSummaryData.enrollment.Student_ID;
                    const ts = new Date().getTime();
                    const updatedData = await apiFetch(`/api/student-summary?courseId=${currentCourseId}&studentId=${studentId}&_t=${ts}`);
                    CourseClass.currentSummaryData = updatedData;
                    CourseAttendance.renderTermMetrics('midterm', updatedData);
                    CourseAttendance.renderTermMetrics('finalterm', updatedData);
                }
                
            } catch(err) {
                alert("Failed to save grades: " + err.message);
                btn.innerHTML = originalHtml;
                btn.disabled = false;
            }
        }
    }
};
