// js/course.js
import { apiFetch, AppState } from './globals.js';
import { CourseDashboard } from './course-dashboard.js';
import { CourseClass } from './course-class.js';
import { CourseAttendance } from './course-attendance.js';
import { CourseRecitation } from './course-recitation.js';

export const CourseModule = {
    init: () => {
        document.addEventListener('submit', CourseModule.handleForms);
        document.addEventListener('click', CourseModule.handleClicks);
        document.addEventListener('change', CourseModule.handleChanges);
        document.addEventListener('input', CourseModule.handleInput);
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
                    document.getElementById('ssGroup').textContent = data.enrollment.Group_Name || 'N/A';
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
                alert(err.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        }
        
        if (e.target.closest('.remove-no-class-btn')) {
            const btn = e.target.closest('.remove-no-class-btn');
            const date = btn.dataset.date;
            const courseId = window.location.hash.replace('#class-', '');
            
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            try {
                await apiFetch('/api/no-class', {
                    method: 'DELETE',
                    body: JSON.stringify({ courseId, date })
                });
                await CourseAttendance.loadNoClassDays(courseId);
            } catch (err) {
                alert(err.message);
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-trash"></i>';
            }
        }

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
            
            await CourseClass.exportRoster(courseId);
            
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }

        if (e.target.closest('#copyEmailsBtn')) {
            const btn = e.target.closest('#copyEmailsBtn');
            const originalHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Copying...';
            
            await CourseClass.copyStudentEmails();
            
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
            CourseClass.updateManageStatusColor(statusSelect);

            document.getElementById('manageStudentModal').classList.remove('hidden');
        }

        if (e.target.closest('#closeManageStudentModalBtn') || e.target.id === 'closeManageStudentModalBg') {
            document.getElementById('manageStudentModal').classList.add('hidden');
            const courseId = window.location.hash.replace('#class-', '');
            await CourseClass.loadClassScreen(courseId, true); 
        }

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
            
            CourseClass.currentSummaryData = null;

            try {
                const ts = new Date().getTime();
                const data = await apiFetch(`/api/student-summary?courseId=${courseId}&studentId=${studentId}&_t=${ts}`);
                CourseClass.currentSummaryData = data;
                
                CourseAttendance.renderTermMetrics('midterm', data);
                CourseAttendance.renderTermMetrics('finalterm', data);
                CourseClass.renderSubmissionsHistory(data.submissions, 'summarySubmissionsList');

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
                    await CourseClass.loadClassScreen(courseId, true);
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
            
            await CourseClass.loadUnenrolledStudents(courseId);
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
                
                await CourseClass.loadClassScreen(courseId, true);
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
            if (courseId && dateVal) CourseAttendance.saveDraft(courseId, dateVal);
        }

        if (e.target.id === 'markAllPresent') {
            document.querySelectorAll('.student-row').forEach(row => {
                const presentBtn = row.querySelector('[data-status="Present"]');
                if (presentBtn) presentBtn.click();
            });
            const courseId = window.location.hash.replace('#class-', '');
            const dateVal = document.getElementById('attendanceDate')?.value;
            if (courseId && dateVal) CourseAttendance.saveDraft(courseId, dateVal);
        }

        if (e.target.closest('#saveAttendanceBtn')) {
            await CourseAttendance.saveAttendance();
        }

        if (e.target.closest('.save-single-attendance-btn')) {
            const btn = e.target.closest('.save-single-attendance-btn');
            const row = btn.closest('.student-row');
            const studentId = row.dataset.studentId;
            const courseId = window.location.hash.replace('#class-', '');
            const dateVal = document.getElementById('attendanceDate').value;
            const selectedBtn = row.querySelector('.attendance-btn[data-selected="true"]');
            const pointsInput = row.querySelector('.points-input');
            const banner = document.getElementById('noClassBanner');
            
            if (!dateVal) {
                alert("Please select a date first to save attendance.");
                return;
            }
            if (banner && !banner.classList.contains('hidden')) {
                alert("This date is marked as NO CLASS. Adjust it in the Course Actions menu.");
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
                    body: JSON.stringify({ courseId, studentId, date: dateVal, status, points })
                });
                
                CourseAttendance.saveDraft(courseId, dateVal);

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

        if (e.target.closest('#openRecitationBtn')) {
            const courseId = window.location.hash.replace('#class-', '');
            await CourseRecitation.openModal(courseId);
        }

        if (e.target.closest('#closeRecitationModalBtn') || e.target.id === 'recitationModalOverlay') {
            CourseRecitation.closeModal();
        }

        if (e.target.closest('#spinWheelBtn')) {
            CourseRecitation.spin();
        }
        
        if (e.target.closest('#nextStudentBtn')) {
            CourseRecitation.resetToWheel();
        }
    }
};
