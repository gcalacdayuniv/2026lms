// js/components.js
export const Components = {
    // ... [Previous code remains unchanged up to renderClassScreen]

    renderClassScreen: (course, students) => {
        const studentList = students.map((s, index) => {
            const avatarSrc = getLoadableAvatarSrc(s.Avatar);
            const avatarImg = avatarSrc 
                ? `<img src="${avatarSrc}" class="w-12 h-12 rounded-full object-cover border border-gray-200" alt="${s.Name}">` 
                : `<i class="fa-solid fa-circle-user text-[48px] text-gray-300"></i>`;
            
            const displayCourse = `${s.course || ''} ${s.year || ''} ${s.section ? '- ' + s.section : ''}`.trim();
            
            return `
                <div class="flex items-center justify-between p-4 bg-white border-b border-gray-100 hover:bg-gray-50 transition student-row" data-student-id="${s.User_ID}">
                    <div class="flex items-center space-x-4">
                        <span class="text-xs font-bold text-gray-400 w-6 text-center">${index + 1}</span>
                        <div class="flex-shrink-0">
                            ${avatarImg}
                        </div>
                        <div>
                            <div class="font-bold text-gray-800">${s.Name}</div>
                            <div class="text-xs text-gray-500 mt-0.5">
                                <span class="font-medium text-gray-700">${s.Student_Number || 'N/A'}</span> &bull; ${displayCourse || 'N/A'}
                            </div>
                        </div>
                    </div>
                    
                    <!-- Attendance Action Toggles -->
                    <div class="flex items-center space-x-2">
                        <button type="button" data-status="Present" class="attendance-btn px-3 py-1.5 rounded-lg text-xs font-bold border border-gray-200 text-gray-600 bg-gray-50 hover:bg-green-50 hover:text-green-700 hover:border-green-300 transition">
                            Present
                        </button>
                        <button type="button" data-status="Late" class="attendance-btn px-3 py-1.5 rounded-lg text-xs font-bold border border-gray-200 text-gray-600 bg-gray-50 hover:bg-yellow-50 hover:text-yellow-700 hover:border-yellow-300 transition">
                            Late
                        </button>
                        <button type="button" data-status="Absent" class="attendance-btn px-3 py-1.5 rounded-lg text-xs font-bold border border-gray-200 text-gray-600 bg-gray-50 hover:bg-red-50 hover:text-red-700 hover:border-red-300 transition">
                            Absent
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        const emptyState = `<div class="p-8 text-center text-gray-500 bg-white rounded-b-xl border-dashed border-gray-300">No students enrolled yet.</div>`;

        return `
        <!-- Top Header Bar -->
        <header class="bg-blue-700 shadow-md fixed top-0 w-full z-40">
            <div class="w-full mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl">
                <div class="flex items-center h-16">
                    <a href="#dashboard" class="text-white hover:text-blue-200 transition mr-4 p-2 -ml-2">
                        <i class="fa-solid fa-arrow-left text-xl"></i>
                    </a>
                    <div class="overflow-hidden">
                        <h1 class="text-lg font-bold text-white truncate">${course.CourseCode}</h1>
                        <p class="text-xs text-blue-200 truncate">${course.CourseTitle}</p>
                    </div>
                </div>
            </div>
        </header>

        <!-- Main Content -->
        <main class="pt-20 pb-12 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto w-full fade-in">
            <!-- Action Header -->
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-6 mt-4 gap-4">
                <div>
                    <h2 class="text-2xl font-black text-gray-800 tracking-tight">Class Roster & Attendance</h2>
                    <p class="text-sm text-gray-500 mt-1"><i class="fa-regular fa-clock mr-1"></i> ${course.ScheduleDay} | ${course.TimePeriod}</p>
                </div>
                
                <div class="flex items-center space-x-3 w-full sm:w-auto">
                    <input type="date" id="attendanceDate" class="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white font-medium focus:ring-2 focus:ring-blue-500 outline-none" value="${new Date().toISOString().split('T')[0]}">
                    <button id="saveAttendanceBtn" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center flex-1 sm:flex-initial">
                        <i class="fa-solid fa-floppy-disk mr-2"></i> Save Attendance
                    </button>
                </div>
            </div>
            
            <div id="attendanceAlert" class="hidden mb-4 p-3 rounded-md text-sm font-medium"></div>

            <!-- Student List Container -->
            <div class="bg-white shadow-sm rounded-xl border border-gray-200 overflow-hidden">
                <div class="bg-gray-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                    <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">
                        ${students.length} Enrolled Students (Sorted A-Z)
                    </span>
                    <div class="space-x-2">
                        <button type="button" id="markAllPresent" class="text-xs font-bold text-green-600 hover:text-green-800 underline">Mark All Present</button>
                    </div>
                </div>
                <div>
                    ${students.length > 0 ? studentList : emptyState}
                </div>
            </div>
        </main>
        `;
    }
};
