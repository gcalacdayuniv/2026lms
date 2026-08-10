// js/course-dashboard.js
import { apiFetch, AppState } from './globals.js';

export const CourseDashboard = {
    submitDocument: async () => {
        const btn = document.getElementById('submitDocBtn');
        const errorDiv = document.getElementById('submitDocError');
        const successDiv = document.getElementById('submitDocSuccess');
        const progressDiv = document.getElementById('submitDocProgress');

        errorDiv.classList.add('hidden');
        successDiv.classList.add('hidden');
        progressDiv.classList.remove('hidden');
        btn.disabled = true;

        try {
            const term = document.getElementById('submitTerm').value;
            const title = document.getElementById('submitTitle').value.trim();
            const desc = document.getElementById('submitDesc').value.trim();
            const type = document.getElementById('submissionType').value;
            
            const user = AppState.user;
            const now = new Date();
            const yyyy = now.getFullYear();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            const hh = String(now.getHours()).padStart(2, '0');
            const ss = String(now.getSeconds()).padStart(2, '0');
            const timestamp = `${yyyy}${mm}${dd}${hh}${ss}`;
            
            const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, ' ');
            const studentName = user.Name.replace(/[^a-zA-Z0-9_-]/g, ' ');
            const baseFilename = `${term}_${timestamp}_${user.Student_Number}_${studentName}_${safeTitle}`;
            
            const courseYearSection = [user.course, user.year, user.section].filter(Boolean).join(" ") || "General";
            
            let base64Data = "";
            let mimeType = "";
            let finalFilename = "";

            if (type === 'file') {
                const fileInput = document.getElementById('submitFileInput');
                if (!fileInput.files || fileInput.files.length === 0) throw new Error("Please select a file.");
                const file = fileInput.files[0];
                mimeType = file.type;
                const ext = file.name.split('.').pop();
                finalFilename = `${baseFilename}.${ext}`;
                
                base64Data = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result.split(',')[1]);
                    reader.onerror = error => reject(error);
                    reader.readAsDataURL(file);
                });
            } else {
                const urlLink = document.getElementById('submitUrlInput').value.trim();
                if (!urlLink) throw new Error("Please enter a URL link.");
                
                const content = `Title: ${title}\nTerm: ${term}\nDescription: ${desc}\nLink: ${urlLink}`;
                base64Data = btoa(unescape(encodeURIComponent(content)));
                mimeType = "text/plain";
                finalFilename = `${baseFilename}.txt`;
            }
            
            const payload = {
                filename: finalFilename,
                mimeType: mimeType,
                base64: base64Data,
                pathParts: [courseYearSection, "Submitted"]
            };

            await apiFetch('/api/upload-submission', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            
            progressDiv.classList.add('hidden');
            successDiv.textContent = "Submission uploaded successfully!";
            successDiv.classList.remove('hidden');
            document.getElementById('submitDocForm').reset();
            
            setTimeout(() => {
                document.getElementById('submitDocModal').classList.add('hidden');
                successDiv.classList.add('hidden');
            }, 2000);
        } catch (error) {
            progressDiv.classList.add('hidden');
            errorDiv.textContent = error.message;
            errorDiv.classList.remove('hidden');
        } finally {
            btn.disabled = false;
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
            await CourseDashboard.loadDashboardData();
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
            await CourseDashboard.loadDashboardData();
        } catch (err) {
            alert(err.message);
            await CourseDashboard.loadDashboardData();
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
                <div class="cursor-pointer student-active-course p-5 border-2 border-green-200 rounded-xl shadow-sm bg-green-50 relative overflow-hidden transition hover:shadow-md hover:border-green-400 transform hover:-translate-y-1" data-course-id="${c.Course_ID}" data-course-title="${c.CourseCode} | ${c.CourseTitle}">
                    <div class="absolute top-0 right-0 bg-green-500 text-white text-[10px] px-3 py-1 rounded-bl-xl font-bold shadow-sm tracking-widest uppercase">Enrolled</div>
                    <div class="font-black text-xl text-green-800 pr-16">${c.CourseCode}</div>
                    <div class="text-gray-800 font-bold mb-2">${c.CourseTitle}</div>
                    <div class="text-sm text-gray-700 font-medium"><i class="fa-solid fa-chalkboard-user w-5 text-gray-400"></i> ${c.LecturerName}</div>
                    <div class="text-sm text-gray-700 mt-1"><i class="fa-regular fa-calendar w-5 text-gray-400"></i> ${c.ScheduleDay} &nbsp;|&nbsp; <i class="fa-regular fa-clock text-gray-400"></i> ${c.TimePeriod}</div>
                    <div class="text-sm text-gray-700 mt-1"><i class="fa-solid fa-chair w-5 text-gray-400"></i> Seat: <span class="font-bold">${c.Seat_Number || 'Unassigned'}</span></div>
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
    },

    loadDashboardData: async () => {
        const container = document.getElementById('courseContainer');
        if (!container || !AppState.user) return;
        
        container.innerHTML = '<div class="text-center py-12"><i class="fa-solid fa-spinner fa-spin text-blue-600 text-4xl"></i><p class="mt-4 text-gray-500 font-medium">Loading Courses...</p></div>';
        
        if (AppState.user.role.toLowerCase() === 'lecturer') {
            await CourseDashboard.renderLecturerDashboard(container);
        } else {
            await CourseDashboard.renderStudentDashboard(container);
        }
    }
};
