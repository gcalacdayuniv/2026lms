// js/course.js
import { apiFetch, AppState } from './globals.js';

export const CourseModule = {
    init: () => {
        document.addEventListener('submit', CourseModule.handleForms);
        document.addEventListener('click', CourseModule.handleClicks);
    },

    handleForms: async (e) => {
        if (e.target.id === 'addCourseForm') {
            e.preventDefault();
            await CourseModule.createCourse();
        }
    },

    handleClicks: async (e) => {
        if (e.target.classList.contains('enroll-btn')) {
            const btn = e.target;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            await CourseModule.enrollCourse(btn.dataset.id);
        }
    },

    loadDashboardData: async () => {
        const container = document.getElementById('courseContainer');
        if (!container || !AppState.user) return;
        
        container.innerHTML = '<div class="text-center py-8"><i class="fa-solid fa-spinner fa-spin text-blue-600 text-3xl"></i><p class="mt-2 text-gray-500">Loading courses...</p></div>';
        
        if (AppState.user.role.toLowerCase() === 'lecturer') {
            await CourseModule.renderLecturerDashboard(container);
        } else {
            await CourseModule.renderStudentDashboard(container);
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
            lecturerId: AppState.user.User_ID
        };
        
        try {
            await apiFetch('/api/courses', { method: 'POST', body: JSON.stringify(payload) });
            document.getElementById('addCourseForm').reset();
            await CourseModule.loadDashboardData();
        } catch (err) {
            errorDiv.textContent = err.message;
            errorDiv.classList.remove('hidden');
            btn.disabled = false;
            btn.innerHTML = 'Add Course';
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
            await CourseModule.loadDashboardData(); // Reload to reset buttons
        }
    },

    renderLecturerDashboard: async (container) => {
        try {
            const data = await apiFetch(`/api/my-courses?userId=${AppState.user.User_ID}&role=lecturer`);
            
            let coursesHtml = data.courses.map(c => `
                <div class="p-4 border rounded-md shadow-sm bg-white transition hover:shadow-md">
                    <div class="font-bold text-lg text-blue-700">${c.CourseCode}</div>
                    <div class="text-gray-800 font-medium">${c.CourseTitle}</div>
                    <div class="text-sm text-gray-500 mt-2">
                        <i class="fa-regular fa-calendar mr-1"></i> ${c.ScheduleDay} | <i class="fa-regular fa-clock mr-1"></i> ${c.TimePeriod}
                    </div>
                </div>
            `).join('');
            
            if(!coursesHtml) {
                coursesHtml = '<div class="p-4 text-center text-gray-500 border border-dashed rounded bg-gray-50">No courses created yet.</div>';
            }
            
            container.innerHTML = `
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-4 fade-in">
                    <div>
                        <h2 class="text-xl font-bold mb-4 border-b pb-2 text-gray-800"><i class="fa-solid fa-folder-plus text-blue-600 mr-2"></i>Create Course</h2>
                        <form id="addCourseForm" class="space-y-4 bg-gray-50 p-6 rounded-lg border shadow-sm">
                            <div id="courseError" class="hidden bg-red-100 text-red-700 p-3 rounded text-sm font-medium"></div>
                            
                            <div>
                                <label class="block text-sm font-medium text-gray-700">Course Code</label>
                                <input type="text" id="courseCode" required class="w-full border border-gray-300 p-2 rounded mt-1 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="e.g. CS101">
                            </div>
                            
                            <div>
                                <label class="block text-sm font-medium text-gray-700">Course Title</label>
                                <input type="text" id="courseTitle" required class="w-full border border-gray-300 p-2 rounded mt-1 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="e.g. Introduction to Programming">
                            </div>
                            
                            <div class="grid grid-cols-2 gap-4">
                                <div>
                                    <label class="block text-sm font-medium text-gray-700">Schedule Day</label>
                                    <select id="scheduleDay" class="w-full border border-gray-300 p-2 rounded mt-1 focus:ring-2 focus:ring-blue-500 outline-none">
                                        <option>Monday</option><option>Tuesday</option><option>Wednesday</option>
                                        <option>Thursday</option><option>Friday</option><option>Saturday</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700">Time Period</label>
                                    <input type="text" id="timePeriod" required class="w-full border border-gray-300 p-2 rounded mt-1 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="9:00 AM - 12:00 PM">
                                </div>
                            </div>
                            
                            <button type="submit" id="addCourseBtn" class="w-full bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 shadow-sm font-medium transition-colors mt-2">
                                Add Course
                            </button>
                        </form>
                    </div>
                    <div>
                        <h2 class="text-xl font-bold mb-4 border-b pb-2 text-gray-800"><i class="fa-solid fa-chalkboard-user text-blue-600 mr-2"></i>My Created Courses</h2>
                        <div class="space-y-4">
                            ${coursesHtml}
                        </div>
                    </div>
                </div>
            `;
        } catch (err) {
            container.innerHTML = `<div class="p-4 bg-red-50 text-red-600 rounded">Failed to load data: ${err.message}</div>`;
        }
    },

    renderStudentDashboard: async (container) => {
        try {
            const [myCoursesRes, allCoursesRes] = await Promise.all([
                apiFetch(`/api/my-courses?userId=${AppState.user.User_ID}&role=user`),
                apiFetch('/api/courses')
            ]);
            
            const enrolledIds = myCoursesRes.courses.map(c => c.Course_ID);
            
            let enrolledHtml = myCoursesRes.courses.map(c => `
                <div class="p-4 border border-green-200 rounded-md shadow-sm bg-green-50 relative overflow-hidden transition hover:shadow-md">
                    <div class="absolute top-0 right-0 bg-green-500 text-white text-xs px-2 py-1 rounded-bl-lg font-bold shadow-sm">ENROLLED</div>
                    <div class="font-bold text-lg text-green-800 pr-16">${c.CourseCode}</div>
                    <div class="text-gray-800 font-medium">${c.CourseTitle}</div>
                    <div class="text-sm text-gray-600 mt-2 font-medium"><i class="fa-solid fa-chalkboard-user mr-1 text-gray-400"></i> ${c.LecturerName}</div>
                    <div class="text-sm text-gray-600 mt-1"><i class="fa-regular fa-calendar mr-1 text-gray-400"></i> ${c.ScheduleDay} | <i class="fa-regular fa-clock mr-1 text-gray-400"></i> ${c.TimePeriod}</div>
                </div>
            `).join('');
            
            if(!enrolledHtml) {
                enrolledHtml = '<div class="col-span-full p-4 text-center text-gray-500 border border-dashed rounded bg-gray-50">You are not enrolled in any courses yet.</div>';
            }
            
            const availableCourses = allCoursesRes.courses.filter(c => !enrolledIds.includes(c.Course_ID));
            let availableHtml = availableCourses.map(c => `
                <div class="p-4 border rounded-md shadow-sm bg-white flex flex-col md:flex-row justify-between items-start md:items-center transition hover:shadow-md gap-4">
                    <div>
                        <div class="font-bold text-lg text-blue-700">${c.CourseCode}</div>
                        <div class="text-gray-800 font-medium">${c.CourseTitle}</div>
                        <div class="text-sm text-gray-600 mt-2 font-medium"><i class="fa-solid fa-chalkboard-user mr-1 text-gray-400"></i> ${c.LecturerName}</div>
                        <div class="text-sm text-gray-600 mt-1"><i class="fa-regular fa-calendar mr-1 text-gray-400"></i> ${c.ScheduleDay} | <i class="fa-regular fa-clock mr-1 text-gray-400"></i> ${c.TimePeriod}</div>
                    </div>
                    <button data-id="${c.Course_ID}" class="enroll-btn w-full md:w-auto px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 shadow-sm font-medium transition-colors">
                        Enroll Now
                    </button>
                </div>
            `).join('');
            
            if(!availableHtml) {
                availableHtml = '<div class="p-4 text-center text-gray-500 border border-dashed rounded bg-gray-50">No new courses available for enrollment.</div>';
            }

            container.innerHTML = `
                <div class="space-y-10 mt-4 fade-in">
                    <div>
                        <h2 class="text-xl font-bold mb-4 border-b pb-2 text-green-800"><i class="fa-solid fa-check-circle mr-2"></i>My Enrolled Courses</h2>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            ${enrolledHtml}
                        </div>
                    </div>
                    <div>
                        <h2 class="text-xl font-bold mb-4 border-b pb-2 text-blue-800"><i class="fa-solid fa-book-open text-blue-600 mr-2"></i>Available Courses</h2>
                        <div class="grid grid-cols-1 gap-4">
                            ${availableHtml}
                        </div>
                    </div>
                </div>
            `;
        } catch (err) {
            container.innerHTML = `<div class="p-4 bg-red-50 text-red-600 rounded">Failed to load data: ${err.message}</div>`;
        }
    }
};
