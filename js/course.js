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
        
        container.innerHTML = '<div class="text-center py-12"><i class="fa-solid fa-spinner fa-spin text-blue-600 text-4xl"></i><p class="mt-4 text-gray-500 font-medium">Loading modules...</p></div>';
        
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
            await CourseModule.loadDashboardData();
        }
    },

    renderLecturerDashboard: async (container) => {
        try {
            const data = await apiFetch(`/api/my-courses?userId=${AppState.user.User_ID}&role=lecturer`);
            
            let coursesHtml = data.courses.map(c => `
                <div class="p-5 border rounded-xl shadow-sm bg-white transition hover:shadow-md">
                    <div class="font-bold text-xl text-blue-700">${c.CourseCode}</div>
                    <div class="text-gray-800 font-bold mb-2">${c.CourseTitle}</div>
                    <div class="text-sm text-gray-500 bg-gray-50 inline-block px-3 py-1 rounded-md border">
                        <i class="fa-regular fa-calendar mr-1"></i> ${c.ScheduleDay} | <i class="fa-regular fa-clock mr-1"></i> ${c.TimePeriod}
                    </div>
                </div>
            `).join('');
            
            if(!coursesHtml) {
                coursesHtml = '<div class="p-6 text-center text-gray-500 border-2 border-dashed rounded-xl bg-gray-50 font-medium">No courses created yet.</div>';
            }
            
            container.innerHTML = `
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 fade-in">
                    <div>
                        <h2 class="text-xl font-bold mb-6 text-gray-800 flex items-center"><div class="bg-blue-100 p-2 rounded-lg mr-3"><i class="fa-solid fa-folder-plus text-blue-600"></i></div>Create Course</h2>
                        <form id="addCourseForm" class="space-y-5 bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                            <div id="courseError" class="hidden bg-red-100 text-red-700 p-3 rounded text-sm font-medium"></div>
                            
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Course Code</label>
                                <input type="text" id="courseCode" required class="w-full border border-gray-300 p-3 rounded-lg mt-1 focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50" placeholder="e.g. CS101">
                            </div>
                            
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Course Title</label>
                                <input type="text" id="courseTitle" required class="w-full border border-gray-300 p-3 rounded-lg mt-1 focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50" placeholder="e.g. Introduction to Programming">
                            </div>
                            
                            <div class="grid grid-cols-2 gap-4">
                                <div>
                                    <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Schedule Day</label>
                                    <select id="scheduleDay" class="w-full border border-gray-300 p-3 rounded-lg mt-1 focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50">
                                        <option>Monday</option><option>Tuesday</option><option>Wednesday</option>
                                        <option>Thursday</option><option>Friday</option><option>Saturday</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Time Period</label>
                                    <input type="text" id="timePeriod" required class="w-full border border-gray-300 p-3 rounded-lg mt-1 focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50" placeholder="9:00 AM - 12:00 PM">
                                </div>
                            </div>
                            
                            <button type="submit" id="addCourseBtn" class="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 shadow-sm font-bold transition-colors mt-4">
                                Add Course
                            </button>
                        </form>
                    </div>
                    <div>
                        <h2 class="text-xl font-bold mb-6 text-gray-800 flex items-center"><div class="bg-gray-200 p-2 rounded-lg mr-3"><i class="fa-solid fa-chalkboard-user text-gray-600"></i></div>My Created Courses</h2>
                        <div class="space-y-4">
                            ${coursesHtml}
                        </div>
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
                apiFetch('/api/courses')
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
                availableHtml = '<div class="p-8 text-center text-gray-500 border-2 border-dashed rounded-xl bg-gray-50 font-medium">No new courses available for enrollment.</div>';
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
