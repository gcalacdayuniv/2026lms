// js/course.js
import { apiFetch, AppState } from './globals.js';
import { Components } from './components.js'; 

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
            await CourseModule.createCourse();
        }
        if (e.target.id === 'addProgramForm') {
            e.preventDefault();
            await CourseModule.createProgram();
        }
    },

    handleInput: (e) => {
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
    },

    handleChanges: async (e) => {
        // Auto-save logic for Seat Number and Group Name
        if (e.target.classList.contains('seat-input') || e.target.classList.contains('group-input')) {
            const row = e.target.closest('.student-row');
            const studentId = row.dataset.studentId;
            const seatNumber = row.querySelector('.seat-input').value.trim();
            const groupName = row.querySelector('.group-input').value.trim();
            const courseId = window.location.hash.replace('#class-', '');
            
            try {
                await apiFetch('/api/update-student-info', {
                    method: 'POST',
                    body: JSON.stringify({ courseId, studentId, seatNumber, groupName })
                });
            } catch (err) {
                console.error('Failed to update student info:', err);
            }
        }
    },

    handleClicks: async (e) => {
        if (e.target.classList.contains('enroll-btn')) {
            const confirmation = window.confirm("Are you sure you want to enroll in this module? This action cannot be undone.");
            if (!confirmation) {
                return;
            }
            
            const btn = e.target;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            await CourseModule.enrollCourse(btn.dataset.id);
        }

        // Add Student Modal Logic
        if (e.target.closest('#openAddStudentModalBtn')) {
            document.getElementById('addStudentModal').classList.remove('hidden');
            const courseId = window.location.hash.replace('#class-', '');
            await CourseModule.loadUnenrolledStudents(courseId);
        }

        if (e.target.closest('#closeAddStudentModalBtn') || e.target.id === 'closeAddStudentModalBg') {
            document.getElementById('addStudentModal').classList.add('hidden');
            document.getElementById('studentSearchInput').value = '';
        }

        // Lecturer manually enrolling a student
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
                // Reload the modal list and the main roster
                await CourseModule.loadUnenrolledStudents(courseId);
                await CourseModule.loadClassScreen(courseId, true); // true param prevents full spinner reload if implemented
            } catch (err) {
                alert(err.message);
                btn.disabled = false;
                btn.innerHTML = 'Enroll';
            }
        }

        // Student Password Reset Logic
        if (e.target.closest('.reset-pwd-btn')) {
            const btn = e.target.closest('.reset-pwd-btn');
            const studentId = btn.dataset.studentId;
            const confirmReset = window.confirm("Are you sure you want to reset this student's password to '123456'?");
            
            if (confirmReset) {
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

        // Attendance Toggle Logic
        if (e.target.classList.contains('attendance-btn')) {
            const row = e.target.closest('.student-row');
            const buttons = row.querySelectorAll('.attendance-btn');
            
            buttons.forEach(btn => {
                btn.classList.remove('bg-green-100', 'text-green-800', 'border-green-400', 'bg-yellow-100', 'text-yellow-800', 'border-yellow-400', 'bg-red-100', 'text-red-800', 'border-red-400');
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
            }
        }

        // Mark All Present Logic
        if (e.target.id === 'markAllPresent') {
            document.querySelectorAll('.student-row').forEach(row => {
                const presentBtn = row.querySelector('[data-status="Present"]');
                if (presentBtn) presentBtn.click();
            });
        }

        // Save Attendance Submission
        if (e.target.closest('#saveAttendanceBtn')) {
            await CourseModule.saveAttendance();
        }
    },

    loadUnenrolledStudents: async (courseId) => {
        const listContainer = document.getElementById('unenrolledStudentsList');
        if (!listContainer) return;

        listContainer.innerHTML = '<div class="text-center py-10 text-gray-500 text-sm"><i class="fa-solid fa-spinner fa-spin text-2xl mb-2 text-blue-600"></i><br>Loading students...</div>';
        
        try {
            const data = await apiFetch(`/api/unenrolled-students?courseId=${courseId}`);
            if (!data.students || data.students.length === 0) {
                listContainer.innerHTML = '<div class="p-8 text-center text-gray-500 bg-white border border-gray-200 rounded-md shadow-sm">No new students available to enroll.</div>';
                return;
            }

            const html = data.students.map(s => {
                const displayCourse = `${s.course || ''} ${s.year || ''} ${s.section ? '- ' + s.section : ''}`.trim();
                return `
                    <div class="student-enroll-item flex items-center justify-between p-3 bg-white border border-gray-200 rounded-md shadow-sm hover:border-blue-300 transition">
                        <div>
                            <div class="font-bold text-gray-800 text-sm">${s.Name}</div>
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
        } catch (err) {
            listContainer.innerHTML = `<div class="p-4 bg-red-50 text-red-600 rounded text-sm font-medium border border-red-200 text-center">${err.message}</div>`;
        }
    },

    saveAttendance: async () => {
        const btn = document.getElementById('saveAttendanceBtn');
        const alertBox = document.getElementById('attendanceAlert');
        const dateVal = document.getElementById('attendanceDate').value;
        const courseId = window.location.hash.replace('#class-', '');
        
        if (!dateVal) {
            alertBox.textContent = "Please select a date.";
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
            
            alertBox.textContent = "Attendance saved successfully!";
            alertBox.className = "mb-4 p-3 rounded-md text-sm font-medium bg-green-100 text-green-700 block fade-in";
        } catch (err) {
            alertBox.textContent = err.message;
            alertBox.className = "mb-4 p-3 rounded-md text-sm font-medium bg-red-100 text-red-700 block fade-in";
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk mr-2"></i> Save Attendance';
            setTimeout(() => { alertBox.classList.add('hidden'); }, 3000);
        }
    },

    loadDashboardData: async () => {
        const container = document.getElementById('courseContainer');
        if (!container || !AppState.user) return;
        
        container.innerHTML = '<div class="text-center py-12"><i class="fa-solid fa-spinner fa-spin text-blue-600 text-4xl"></i><p class="mt-4 text-gray-500 font-medium">Loading modules...</p></div>';
        
        if (AppState.user.role.toLowerCase() === 'lecturer') {
            await CourseModule.renderLecturerDashboard(container);
        } else {
            await CourseModule.renderStudentDashboard(container);
        }
    },

    loadClassScreen: async (courseId, skipSpinner = false) => {
        const root = document.getElementById('app-root');
        if (!root || !AppState.user) return;
        
        if(!skipSpinner) {
            root.innerHTML = '<div class="flex justify-center items-center h-screen"><i class="fa-solid fa-spinner fa-spin text-blue-600 text-4xl"></i></div>';
        }
        
        try {
            const data = await apiFetch(`/api/course-details?courseId=${courseId}`);
            // Check if modal was open to keep it open on re-render
            const modalWasOpen = document.getElementById('addStudentModal') && !document.getElementById('addStudentModal').classList.contains('hidden');
            
            root.innerHTML = Components.renderClassScreen(data.course, data.students);
            
            if (modalWasOpen) {
                document.getElementById('addStudentModal').classList.remove('hidden');
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
            
            // Repopulate Target Course list in the Course Module modal
            const programsData = await apiFetch('/api/programs');
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
            // Load programs for the target course select in Create Course Modal
            const programsData = await apiFetch('/api/programs');
            const targetCourseSelect = document.getElementById('targetCourse');
            if (targetCourseSelect && programsData.programs) {
                targetCourseSelect.innerHTML = '<option value="">All Courses</option>' + 
                    programsData.programs.map(p => `<option value="${p.ProgramCode}">${p.ProgramCode}</option>`).join('');
            }

            const data = await apiFetch(`/api/my-courses?userId=${AppState.user.User_ID}&role=lecturer`);
            
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
            
            if(!coursesHtml) {
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
            const [myCoursesRes, allCoursesRes] = await Promise.all([
                apiFetch(`/api/my-courses?userId=${AppState.user.User_ID}&role=student`),
                apiFetch(`/api/courses?studentId=${AppState.user.User_ID}`)
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
            
            if(!enrolledHtml) {
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
            
            if(!availableHtml) {
                availableHtml = '<div class="col-span-full p-8 text-center text-gray-500 border-2 border-dashed rounded-xl bg-gray-50 font-medium">No new courses available for enrollment.</div>';
            }

            container.innerHTML = `
                <div class="space-y-12 fade-in">
                    <section>
                        <h2 class="text-2xl font-black mb-6 text-gray-800 flex items-center"><div class="bg-green-100 p-2 rounded-lg mr-3"><i class="fa-solid fa-check-double text-green-600"></i></div>My Active Modules</h2>
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                            ${enrolledHtml}
                        </div>
                    </section>
                    
                    <section>
                        <h2 class="text-2xl font-black mb-6 text-gray-800 flex items-center pt-8 border-t border-gray-200"><div class="bg-blue-100 p-2 rounded-lg mr-3"><i class="fa-solid fa-book-open text-blue-600"></i></div>Available Modules</h2>
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
