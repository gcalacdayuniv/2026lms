// js/course-dashboard.js
import { apiFetch, AppState, CONFIG } from './globals.js';
import { CourseExam } from './course-exam.js';

const TERM_THEMES = {
    midterm: {
        icon: 'fa-solid fa-star-half-stroke text-blue-500',
        hover: 'hover:border-blue-400',
        text: 'text-blue-700',
        accent: 'bg-blue-50 border-blue-100',
        label: 'text-blue-400'
    },
    finalterm: {
        icon: 'fa-solid fa-star text-yellow-500',
        hover: 'hover:border-yellow-400',
        text: 'text-yellow-600',
        accent: 'bg-yellow-50 border-yellow-100',
        label: 'text-yellow-500'
    }
};

const renderTermBlock = (term, label) => {
    const t = TERM_THEMES[term];
    return `
                    <div class="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                        <h4 class="text-lg font-black text-gray-800 mb-4 border-b pb-2 border-gray-200"><i class="${t.icon} mr-2"></i>${label}</h4>

                        <div class="space-y-4">
                            <div>
                                <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">Written Output</span>
                                <div class="grid grid-cols-3 gap-3 mt-2">
                                    <div class="bg-gray-50 p-3 border border-gray-100 rounded-lg text-center cursor-pointer view-scores-trigger ${t.hover} transition hover:shadow-md" data-term="${term}" data-category="Written" title="Click to view quizzes and long exam scores">
                                        <div class="text-gray-400 text-[10px] uppercase font-bold mb-1">Quizzes/Long</div>
                                        <span class="font-black ${t.text} text-xl block" id="${term}WrittenScore">...</span>
                                    </div>
                                    <div class="bg-gray-50 p-3 border border-gray-100 rounded-lg text-center cursor-pointer view-scores-trigger ${t.hover} transition hover:shadow-md" data-term="${term}" data-category="Narrative" title="Click to view narrative grades">
                                        <div class="text-gray-400 text-[10px] uppercase font-bold mb-1">Narrative</div>
                                        <span class="font-black ${t.text} text-xl block" id="${term}NarrativeScore">...</span>
                                    </div>
                                    <div class="bg-gray-50 p-3 border border-gray-100 rounded-lg text-center cursor-pointer view-scores-trigger ${t.hover} transition hover:shadow-md" data-term="${term}" data-category="Individual" title="Click to view individual grades">
                                        <div class="text-gray-400 text-[10px] uppercase font-bold mb-1">Individual</div>
                                        <span class="font-black ${t.text} text-xl block" id="${term}IndividualScore">...</span>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">Performance Output</span>
                                <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                                    <div class="bg-gray-50 p-3 border border-gray-100 rounded-lg text-center cursor-pointer view-scores-trigger ${t.hover} transition hover:shadow-md" data-term="${term}" data-category="Report" title="Click to view report grades">
                                        <div class="text-gray-400 text-[10px] uppercase font-bold mb-1">Report</div>
                                        <span class="font-black ${t.text} text-xl block" id="${term}ReportScore">...</span>
                                    </div>
                                    <div class="bg-gray-50 p-3 border border-gray-100 rounded-lg text-center cursor-pointer view-scores-trigger ${t.hover} transition hover:shadow-md" data-term="${term}" data-category="Performance" title="Click to view performance task scores">
                                        <div class="text-gray-400 text-[10px] uppercase font-bold mb-1">Tasks</div>
                                        <span class="font-black ${t.text} text-xl block" id="${term}PerformanceTaskScore">...</span>
                                    </div>
                                    <div class="${t.accent} p-3 border rounded-lg text-center cursor-pointer view-details-trigger ${t.hover} transition hover:shadow-md" data-term="${term}" data-metric="participation" title="Click to view participation details">
                                        <div class="${t.label} text-[10px] uppercase font-bold mb-1">Participation</div>
                                        <span class="font-black ${t.text} text-xl block" id="${term}ParticipationScore">...</span>
                                    </div>
                                    <div class="${t.accent} p-3 border rounded-lg text-center cursor-pointer view-details-trigger ${t.hover} transition hover:shadow-md" data-term="${term}" data-metric="attendance" title="Click to view attendance details">
                                        <div class="${t.label} text-[10px] uppercase font-bold mb-1">Attendance</div>
                                        <span class="font-black ${t.text} text-xl block mb-1"><span id="${term}AttendancePct">...</span>%</span>
                                        <div class="text-[10px] text-gray-600 font-medium"><span id="${term}Present">0</span>P, <span id="${term}Late">0</span>L, <span id="${term}Excused">0</span>E, <span id="${term}Absent">0</span>A</div>
                                        <div class="text-[9px] text-gray-400 mt-1 font-bold uppercase">Class days: <span id="${term}TotalDays">0</span></div>
                                    </div>
                                </div>
                            </div>

                            <div class="bg-gray-50 p-4 border border-gray-100 rounded-lg flex justify-between items-center cursor-pointer view-scores-trigger ${t.hover} transition hover:shadow-md" data-term="${term}" data-category="MajorExam" title="Click to view major exam scores">
                                <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">Major Exam</span>
                                <span class="font-black ${t.text} text-lg" id="${term}MajorExamScore">...</span>
                            </div>
                        </div>
                    </div>
    `;
};

const DashboardUI = {
    renderHeader: (user, headerAvatar) => `
        <header class="bg-white shadow-sm fixed top-0 w-full z-40 border-b border-gray-200">
            <div class="w-full mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">
                <div class="flex justify-between items-center h-16">
                    <div class="flex items-center">
                        <h1 class="text-lg sm:text-xl font-bold text-gray-800 tracking-tight"><i class="fa-solid fa-house mr-2 text-blue-600"></i>Dashboard</h1>
                    </div>
                    <div class="flex items-center cursor-pointer hover:bg-gray-50 px-2 sm:px-3 py-1 rounded-full transition-colors duration-200 border border-transparent hover:border-gray-200" id="profileToggleBtn">
                        <span class="mr-3 text-sm font-bold text-gray-700 hidden sm:block">${user.Name}</span>${headerAvatar}
                    </div>
                </div>
            </div>
        </header>
    `,

    renderProfilePanel: (user, panelAvatar, displayCourse, lecturerBtns) => `
        <div id="profilePanelOverlay" class="fixed inset-0 bg-gray-900 bg-opacity-40 backdrop-blur-sm z-40 hidden transition-opacity"></div>
        <div id="profilePanel" class="fixed inset-y-0 right-0 w-4/5 sm:w-96 bg-white shadow-2xl z-50 transform translate-x-full transition-transform duration-300 ease-in-out overflow-y-auto flex flex-col">
            <div class="p-6 bg-gradient-to-b from-blue-50 to-white flex-grow relative">
                <button id="closeProfilePanel" class="absolute top-4 right-4 text-gray-400 hover:text-gray-800 focus:outline-none transition-colors">
                    <i class="fa-solid fa-xmark text-2xl"></i>
                </button>

                <div class="text-center mt-6">
                    ${panelAvatar}
                    <h2 class="text-xl sm:text-2xl font-bold text-gray-800 mt-4">${user.Name}</h2>
                    <p class="text-sm font-medium text-gray-500">@${user.Username || 'N/A'}</p>
                </div>

                <div class="mt-8 px-2 space-y-4">
                    <div class="flex justify-between items-start border-b border-gray-200 pb-4">
                        <div class="flex-1 pr-1">
                            <span class="block text-xs sm:text-sm font-bold text-blue-600">${user.role || 'N/A'}</span>
                        </div>
                        <div class="flex-1 text-center border-x border-gray-200 px-1">
                            <span class="block text-xs sm:text-sm font-medium text-gray-800 break-all">${user.Student_Number || 'N/A'}</span>
                        </div>
                        <div class="flex-1 text-right pl-1">
                            <span class="block text-xs sm:text-sm font-medium text-gray-800">${displayCourse}</span>
                        </div>
                    </div>

                    <div class="flex flex-col sm:flex-row justify-between items-start space-y-2 sm:space-y-0">
                        <div class="flex-1 pr-2 w-full">
                            <span class="block text-xs sm:text-sm font-medium text-gray-800 break-all">${user.Email || 'N/A'}</span>
                        </div>
                        <div class="flex-1 text-left sm:text-right sm:border-l border-gray-200 sm:pl-2 w-full">
                            <span class="block text-xs sm:text-sm font-medium text-gray-800">${user.Contact_Number || 'N/A'}</span>
                        </div>
                    </div>
                </div>

                ${lecturerBtns}

                <div class="mt-6 space-y-3">
                    <button id="openUdModalBtn" class="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-bold text-gray-700 bg-white hover:bg-gray-50 focus:outline-none transition-colors">
                        <i class="fa-solid fa-user-pen text-gray-400 mr-2 mt-0.5"></i> Update Details
                    </button>
                    <button id="openCpModalBtn" class="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-bold text-gray-700 bg-white hover:bg-gray-50 focus:outline-none transition-colors">
                        <i class="fa-solid fa-lock text-gray-400 mr-2 mt-0.5"></i> Change Password
                    </button>
                </div>
            </div>

            <div class="p-4 border-t border-gray-200 bg-white">
                <button id="logoutBtn" class="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-bold text-white bg-red-600 hover:bg-red-700 focus:outline-none transition-colors">
                    <i class="fa-solid fa-power-off mr-2"></i> Log Out
                </button>
            </div>
        </div>
    `,

    renderManageUsersModal: () => `
        <div id="muModal" class="hidden fixed inset-0 z-[60] flex items-center justify-center fade-in p-2 sm:p-4">
            <div id="muModalOverlay" class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm"></div>
            <div class="bg-white rounded-lg shadow-xl w-full max-w-4xl p-4 sm:p-6 relative z-10 scale-up max-h-[95vh] sm:max-h-[90vh] flex flex-col">
                <div class="flex justify-between items-center mb-5 border-b pb-3">
                    <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-users-gear text-green-600 mr-2"></i>Manage Users</h3>
                    <button id="closeMuModalBtn" class="text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>

                <div class="mb-4 flex flex-col sm:flex-row gap-2">
                    <input type="text" id="muSearchInput" placeholder="Search by Name or Student No..." class="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-gray-50">
                    <select id="muFilterStatus" class="w-full sm:w-40 px-2 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 bg-gray-50 font-medium">
                        <option value="">All Statuses</option>
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                        <option value="Suspended">Suspended</option>
                        <option value="UD">UD</option>
                        <option value="Dropped">Dropped</option>
                    </select>
                </div>

                <div id="manageUsersList" class="flex-1 overflow-y-auto space-y-2 min-h-[300px] bg-gray-50 p-2 rounded border border-gray-200">
                </div>
            </div>
        </div>
    `,

    renderChangePasswordModal: () => `
        <div id="cpModal" class="hidden fixed inset-0 z-[60] flex items-center justify-center fade-in p-4">
            <div id="cpModalOverlay" class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm"></div>
            <div class="bg-white rounded-lg shadow-xl w-full max-w-sm p-4 sm:p-6 relative z-10 scale-up">
                <div class="flex justify-between items-center mb-5 border-b pb-3">
                    <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-shield-halved text-blue-600 mr-2"></i>Change Password</h3>
                    <button id="closeCpModalBtn" class="text-gray-400 hover:text-gray-800 focus:outline-none transition-colors">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>

                <form id="changePasswordForm" class="space-y-4">
                    <div id="cpError" class="hidden bg-red-100 text-red-700 p-3 rounded text-sm font-medium"></div>
                    <div id="cpSuccess" class="hidden bg-green-100 text-green-700 p-3 rounded text-sm font-medium"></div>

                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Current Password</label>
                        <input type="password" id="cpCurrent" required class="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">New Password</label>
                        <input type="password" id="cpNew" required minlength="6" class="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Repeat New Password</label>
                        <input type="password" id="cpRepeat" required minlength="6" class="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50">
                    </div>

                    <button type="submit" id="cpSubmitBtn" class="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none transition-colors mt-2">
                        Update Password
                    </button>
                </form>
            </div>
        </div>
    `,

    renderUpdateDetailsModal: (user) => {
        let lastName = '', givenName = '', suffix = '';
        if (user && user.Name) {
            if (user.Name.includes(',')) {
                const parts = user.Name.split(',');
                lastName = parts[0].trim();
                const rest = parts.slice(1).join(',').trim();
                const words = rest.split(' ').filter(Boolean);
                const knownSuffixes = ['jr.', 'jr', 'sr.', 'sr', 'i', 'ii', 'iii', 'iv', 'v', 'vi', '1st', '2nd', '3rd', 'ph.d.', 'md'];
                if (words.length > 1 && knownSuffixes.includes(words[words.length - 1].toLowerCase())) {
                    suffix = words.pop();
                    givenName = words.join(' ');
                } else {
                    givenName = rest;
                }
            } else {
                lastName = user.Name;
            }
        }

        return `
            <div id="udModal" class="hidden fixed inset-0 z-[60] flex items-center justify-center fade-in p-4">
                <div id="udModalOverlay" class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm"></div>
                <div class="bg-white rounded-lg shadow-xl w-full max-w-lg p-4 sm:p-6 relative z-10 scale-up max-h-[90vh] overflow-y-auto">
                    <div class="flex justify-between items-center mb-5 border-b pb-3">
                        <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-user-pen text-blue-600 mr-2"></i>Update Details</h3>
                        <button id="closeUdModalBtn" class="text-gray-400 hover:text-gray-800 focus:outline-none transition-colors">
                            <i class="fa-solid fa-xmark text-xl"></i>
                        </button>
                    </div>

                    <form id="updateDetailsForm" class="space-y-4">
                        <div id="udError" class="hidden bg-red-100 text-red-700 p-3 rounded text-sm font-medium"></div>
                        <div id="udSuccess" class="hidden bg-green-100 text-green-700 p-3 rounded text-sm font-medium"></div>

                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Given Name</label>
                                <input type="text" id="udGivenName" required value="${givenName}" class="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Last Name</label>
                                <input type="text" id="udLastName" required value="${lastName}" class="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Suffix</label>
                                <input type="text" id="udSuffix" value="${suffix}" placeholder="e.g. Jr. (Optional)" class="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50">
                            </div>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Username</label>
                                <input type="text" id="udUsername" required value="${user.Username || ''}" class="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Email</label>
                                <input type="email" id="udEmail" required value="${user.Email || ''}" class="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50">
                            </div>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Contact Number</label>
                                <input type="text" id="udContact" value="${user.Contact_Number || ''}" class="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Student Number</label>
                                <input type="text" id="udStudentNumber" required value="${user.Student_Number || ''}" maxlength="7" placeholder="00-0000" class="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50 font-mono">
                            </div>
                        </div>

                        <div class="border-t border-gray-200 mt-4 pt-4">
                            <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Verify Password</label>
                            <input type="password" id="udPassword" required placeholder="Enter current password to save" class="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50">
                        </div>

                        <button type="submit" id="udSubmitBtn" class="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none transition-colors mt-2">
                            Save Details
                        </button>
                    </form>
                </div>
            </div>
        `;
    },

    renderCreateCourseModal: () => `
        <div id="ccModal" class="hidden fixed inset-0 z-[60] flex items-center justify-center fade-in p-4">
            <div id="ccModalOverlay" class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm"></div>
            <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-4 sm:p-6 relative z-10 scale-up max-h-[90vh] overflow-y-auto">
                <div class="flex justify-between items-center mb-5 border-b pb-3">
                    <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-folder-plus text-blue-600 mr-2"></i>Create Course</h3>
                    <button id="closeCcModalBtn" class="text-gray-400 hover:text-gray-800 focus:outline-none transition-colors">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>

                <form id="addCourseForm" class="space-y-4">
                    <div id="courseError" class="hidden bg-red-100 text-red-700 p-3 rounded text-sm font-medium"></div>

                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Course Code</label>
                        <input type="text" id="courseCode" required class="w-full border border-gray-300 p-2 rounded-md mt-1 focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50 text-sm" placeholder="e.g. CS101">
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Course Title</label>
                        <input type="text" id="courseTitle" required class="w-full border border-gray-300 p-2 rounded-md mt-1 focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50 text-sm" placeholder="e.g. Introduction to Programming">
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Schedule Day</label>
                            <select id="scheduleDay" class="w-full border border-gray-300 p-2 rounded-md mt-1 focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50 text-sm">
                                <option>Monday</option><option>Tuesday</option><option>Wednesday</option>
                                <option>Thursday</option><option>Friday</option><option>Saturday</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Time Period</label>
                            <input type="text" id="timePeriod" required class="w-full border border-gray-300 p-2 rounded-md mt-1 focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50 text-sm" placeholder="9:00 AM - 12:00 PM">
                        </div>
                    </div>

                    <div class="border-t border-gray-200 pt-4 mt-4">
                        <p class="text-xs font-bold text-gray-800 mb-2 uppercase">Target Audience (Restriction)</p>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Target Course</label>
                                <select id="targetCourse" class="w-full border border-gray-300 p-2 rounded-md mt-1 focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50 text-sm">
                                    <option value="">All Courses</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Target Year</label>
                                <input type="text" id="targetYear" class="w-full border border-gray-300 p-2 rounded-md mt-1 focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50 text-sm" placeholder="e.g. 1">
                            </div>
                        </div>
                        <div class="mt-4">
                            <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Target Section</label>
                            <input type="text" id="targetSection" class="w-full border border-gray-300 p-2 rounded-md mt-1 focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50 text-sm" placeholder="e.g. A">
                        </div>
                        <p class="text-[10px] text-gray-500 mt-1 italic">*Leave blank to make it available to all students.</p>
                    </div>

                    <button type="submit" id="addCourseBtn" class="w-full bg-blue-600 text-white py-2.5 px-4 rounded-md hover:bg-blue-700 shadow-sm font-bold transition-colors mt-4">
                        Create Course
                    </button>
                </form>
            </div>
        </div>
    `,

    renderAddProgramModal: () => `
        <div id="apModal" class="hidden fixed inset-0 z-[60] flex items-center justify-center fade-in p-4">
            <div id="apModalOverlay" class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm"></div>
            <div class="bg-white rounded-lg shadow-xl w-full max-w-sm p-4 sm:p-6 relative z-10 scale-up">
                <div class="flex justify-between items-center mb-5 border-b pb-3">
                    <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-graduation-cap text-purple-600 mr-2"></i>Add Course (Program)</h3>
                    <button id="closeApModalBtn" class="text-gray-400 hover:text-gray-800 focus:outline-none transition-colors">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>

                <form id="addProgramForm" class="space-y-4">
                    <div id="programError" class="hidden bg-red-100 text-red-700 p-3 rounded text-sm font-medium"></div>
                    <div id="programSuccess" class="hidden bg-green-100 text-green-700 p-3 rounded text-sm font-medium"></div>

                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Course / Program Code</label>
                        <input type="text" id="programCode" required class="w-full border border-gray-300 p-2 rounded-md mt-1 focus:ring-2 focus:ring-purple-500 outline-none bg-gray-50 text-sm uppercase" placeholder="e.g. BSCS">
                    </div>

                    <button type="submit" id="addProgramBtn" class="w-full bg-purple-600 text-white py-2.5 px-4 rounded-md hover:bg-purple-700 shadow-sm font-bold transition-colors mt-4">
                        Add to Registration List
                    </button>
                </form>
            </div>
        </div>
    `,

    renderSubmitDocumentModal: () => `
        <div id="submitDocModal" class="hidden fixed inset-0 z-[90] flex items-center justify-center fade-in p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeSubmitDocModalBg"></div>
            <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-4 sm:p-6 relative z-10 scale-up max-h-[90vh] overflow-y-auto">
                <div class="flex justify-between items-center mb-4 border-b pb-3">
                    <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-cloud-arrow-up text-blue-600 mr-2"></i>Submit Document</h3>
                    <button id="closeSubmitDocModalBtn" class="text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>
                <form id="submitDocForm" class="space-y-4">
                    <div id="submitDocError" class="hidden bg-red-100 text-red-700 p-3 rounded text-sm font-medium"></div>
                    <div id="submitDocSuccess" class="hidden bg-green-100 text-green-700 p-3 rounded text-sm font-medium"></div>

                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Term</label>
                        <select id="submitTerm" required class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 outline-none bg-gray-50 text-sm">
                            <option value="" disabled selected>Select Term</option>
                            <option value="MidTerm">Mid Term</option>
                            <option value="FinalTerm">Final Term</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Title</label>
                        <input type="text" id="submitTitle" required class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 outline-none bg-gray-50 text-sm" placeholder="Document Title (No dots or slashes)">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Description</label>
                        <textarea id="submitDesc" required rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 outline-none bg-gray-50 text-sm" placeholder="Brief description"></textarea>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Submission Type</label>
                        <select id="submissionType" required class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 outline-none bg-gray-50 text-sm">
                            <option value="file">File Upload (PDF, Word, Slides)</option>
                            <option value="url">URL Link</option>
                        </select>
                    </div>
                    <div id="fileInputContainer">
                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Upload File</label>
                        <input type="file" id="submitFileInput" required accept=".pdf,.doc,.docx,.ppt,.pptx" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 outline-none bg-gray-50 text-sm">
                    </div>
                    <div id="urlInputContainer" class="hidden">
                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Link URL</label>
                        <input type="url" id="submitUrlInput" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 outline-none bg-gray-50 text-sm" placeholder="https://...">
                    </div>

                    <div id="groupUploadSection" class="hidden border border-purple-200 bg-purple-50 p-3 rounded-md mt-2">
                        <label class="flex items-center space-x-2 text-xs font-bold text-purple-800 cursor-pointer mb-2">
                            <input type="checkbox" id="isGroupUpload" class="rounded text-purple-600 focus:ring-purple-500">
                            <span>Submit as Group Upload</span>
                        </label>
                        <div id="groupMembersList" class="hidden space-y-1.5 mt-2 pt-2 border-t border-purple-200 max-h-32 overflow-y-auto">
                        </div>
                    </div>

                    <div id="submitDocProgress" class="hidden text-center text-blue-600 font-bold text-sm py-2">
                        <i class="fa-solid fa-spinner fa-spin mr-2"></i> <span id="submitDocProgressText">Uploading...</span>
                    </div>

                    <button type="submit" id="submitDocBtn" class="w-full flex justify-center py-2.5 px-4 rounded-md shadow-sm text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none transition-colors mt-4">
                        Submit
                    </button>
                </form>
            </div>
        </div>
    `,

    renderSubmissionHistoryModal: () => `
        <div id="submissionHistoryModal" class="hidden fixed inset-0 z-[100] flex items-center justify-center fade-in p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeSubmissionHistoryModalBg"></div>
            <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-4 sm:p-6 relative z-10 scale-up max-h-[90vh] flex flex-col">
                <div class="flex justify-between items-center mb-4 border-b pb-3">
                    <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-clock-rotate-left text-green-600 mr-2"></i>Submission History</h3>
                    <button id="closeSubmissionHistoryModalBtn" class="text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>
                <div id="historySubmissionsList" class="flex-1 overflow-y-auto space-y-2 p-1">
                </div>
            </div>
        </div>
    `,

    renderGroupMembersModal: () => `
        <div id="groupMembersModal" class="hidden fixed inset-0 z-[110] flex items-center justify-center fade-in p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeGroupMembersModalBg"></div>
            <div class="bg-white rounded-lg shadow-xl w-full max-w-sm p-4 sm:p-6 relative z-10 scale-up max-h-[90vh] flex flex-col">
                <div class="flex justify-between items-center mb-4 border-b pb-3">
                    <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-users text-blue-600 mr-2"></i><span id="gmmTitle">Group Members</span></h3>
                    <button id="closeGroupMembersModalBtn" class="text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>
                <div id="gmmLoading" class="text-center py-6 text-gray-500"><i class="fa-solid fa-spinner fa-spin text-2xl"></i></div>
                <div id="gmmContent" class="hidden flex-1 overflow-y-auto space-y-2 p-1">
                </div>
            </div>
        </div>
    `,

    renderStudentSummaryModal: () => `
        <div id="studentSummaryModal" class="hidden fixed inset-0 z-[80] bg-gray-50 flex flex-col fade-in overflow-y-auto w-full h-full">
            <div class="bg-white shadow-sm sticky top-0 z-10 w-full">
                <div class="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex justify-between items-center border-b border-gray-200">
                    <h3 class="text-xl sm:text-2xl font-black text-gray-800"><i class="fa-solid fa-chart-pie text-purple-600 mr-2"></i>My Course Summary</h3>
                    <button id="closeStudentSummaryModalBtn" class="text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-xmark text-2xl"></i>
                    </button>
                </div>
            </div>

            <div class="max-w-4xl mx-auto w-full p-4 sm:p-6 flex-1">
                <div id="ssCourseTitle" class="font-black text-blue-700 text-center mb-6 text-xl sm:text-2xl"></div>

                <div id="ssEnrollmentInfo" class="hidden grid grid-cols-3 gap-4 mb-6 text-center border border-blue-200 bg-blue-50 p-4 rounded-xl shadow-sm">
                    <div>
                        <div class="text-xs sm:text-sm font-bold text-blue-400 uppercase tracking-wider">Seat</div>
                        <div id="ssSeat" class="text-lg sm:text-xl font-black text-blue-800">-</div>
                    </div>
                    <div class="border-x border-blue-200">
                        <div class="text-xs sm:text-sm font-bold text-blue-400 uppercase tracking-wider">Group</div>
                        <div id="ssGroup" class="text-lg sm:text-xl font-black text-blue-800 transition hover:text-blue-600">-</div>
                    </div>
                    <div>
                        <div class="text-xs sm:text-sm font-bold text-blue-400 uppercase tracking-wider">Topic</div>
                        <div id="ssTopic" class="text-lg sm:text-xl font-black text-blue-800">-</div>
                    </div>
                </div>

                <div id="summaryLoading" class="text-center py-12 text-gray-500"><i class="fa-solid fa-spinner fa-spin text-4xl"></i></div>
                <div id="summaryError" class="hidden text-center py-12 text-red-500 font-bold text-lg"></div>

                <div id="summaryContent" class="hidden space-y-6">
                    ${renderTermBlock('midterm', 'Mid Term')}
                    ${renderTermBlock('finalterm', 'Final Term')}

                    <div class="mt-8 flex flex-col sm:flex-row justify-center gap-3 border-t border-gray-200 pt-6">
                        <button id="openHistoryModalBtn" class="bg-white border-2 border-green-500 text-green-600 hover:bg-green-50 font-bold py-3 px-6 rounded-lg shadow-sm transition flex items-center justify-center w-full sm:w-auto">
                            <i class="fa-solid fa-clock-rotate-left mr-2"></i> View History
                        </button>
                        <button id="openSubmitDocModalBtn" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition flex items-center justify-center w-full sm:w-auto">
                            <i class="fa-solid fa-cloud-arrow-up mr-2"></i> Upload Document
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `,

    renderDetailsModal: () => `
        <div id="detailsModal" class="hidden fixed inset-0 z-[90] flex items-center justify-center fade-in p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeDetailsModalBg"></div>
            <div class="bg-white rounded-lg shadow-xl w-full max-w-sm p-4 sm:p-6 relative z-10 scale-up max-h-[90vh] flex flex-col">
                <div class="flex justify-between items-center mb-4 border-b pb-3">
                    <h3 class="text-base sm:text-lg font-bold text-gray-800" id="detailsModalTitle">Details</h3>
                    <button id="closeDetailsModalBtn" class="text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>
                <div class="overflow-y-auto flex-1 bg-gray-50 border border-gray-200 rounded-lg">
                    <table class="w-full text-xs text-left">
                        <thead class="bg-gray-200 text-gray-700 sticky top-0 shadow-sm">
                            <tr>
                                <th class="px-3 py-2">Date</th>
                                <th class="px-3 py-2 text-center">Status / Info</th>
                                <th class="px-3 py-2 text-center" id="detailsScoreHeader">Score</th>
                            </tr>
                        </thead>
                        <tbody id="detailsTableBody" class="divide-y divide-gray-200 bg-white">
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `
};

export const DashboardComponents = {
    renderDashboard: (user) => {
        const avatarSrc = getLoadableAvatarSrc(user.Avatar);
        const headerAvatar = avatarSrc ? `<img src="${avatarSrc}" class="w-10 h-10 rounded-full object-cover aspect-square border-2 border-gray-200 shadow-sm" alt="Profile Picture" />` : '<i class="fa-solid fa-circle-user text-3xl text-gray-400"></i>';

        let displayCourse = 'N/A';
        if (user.course) {
            displayCourse = `${user.course} ${user.year || ''} ${user.section ? '- ' + user.section : ''}`.trim().replace(/\s+/g, ' ');
        }

        const panelAvatar = avatarSrc ? `<img src="${avatarSrc}" class="w-28 h-28 rounded-full object-cover aspect-square border-4 border-white shadow-lg mx-auto cursor-pointer view-avatar-btn hover:opacity-80 transition" data-src="${avatarSrc}" data-name="${user.Name}" data-info="${displayCourse}" role="button" tabindex="0" alt="Profile Picture" />` : '<i class="fa-solid fa-circle-user text-7xl text-gray-400 mx-auto block text-center"></i>';

        let lecturerBtns = '';
        if (user.role.toLowerCase() === 'lecturer') {
            lecturerBtns = `
                <div class="mt-6">
                    <button id="openCreateCourseModalBtn" class="w-full flex justify-center py-2 px-4 border border-blue-300 rounded-md shadow-sm text-sm font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 focus:outline-none transition-colors">
                        <i class="fa-solid fa-folder-plus mr-2 mt-0.5"></i> Create New Course
                    </button>
                </div>
                <div class="mt-3">
                    <button id="openApModalBtn" class="w-full flex justify-center py-2 px-4 border border-purple-300 rounded-md shadow-sm text-sm font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 focus:outline-none transition-colors">
                        <i class="fa-solid fa-graduation-cap mr-2 mt-0.5"></i> Add Registration Course List
                    </button>
                </div>
                <div class="mt-3">
                    <button id="openMuModalBtn" class="w-full flex justify-center py-2 px-4 border border-green-300 rounded-md shadow-sm text-sm font-bold text-green-700 bg-green-50 hover:bg-green-100 focus:outline-none transition-colors">
                        <i class="fa-solid fa-users-gear mr-2 mt-0.5"></i> Manage Users
                    </button>
                </div>
            `;
        }

        return `
            ${DashboardUI.renderHeader(user, headerAvatar)}

            <main class="pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full fade-in">
                <div id="courseContainer" class="w-full"></div>
            </main>

            ${DashboardUI.renderProfilePanel(user, panelAvatar, displayCourse, lecturerBtns)}
            ${DashboardUI.renderUpdateDetailsModal(user)}
            ${user.role.toLowerCase() === 'lecturer' ? DashboardUI.renderManageUsersModal() : ''}
            ${DashboardUI.renderChangePasswordModal()}
            ${user.role.toLowerCase() === 'lecturer' ? DashboardUI.renderCreateCourseModal() : ''}
            ${user.role.toLowerCase() === 'lecturer' ? DashboardUI.renderAddProgramModal() : ''}
            ${user.role.toLowerCase() === 'student' ? DashboardUI.renderStudentSummaryModal() : ''}
            ${user.role.toLowerCase() === 'student' ? DashboardUI.renderSubmitDocumentModal() : ''}
            ${user.role.toLowerCase() === 'student' ? DashboardUI.renderSubmissionHistoryModal() : ''}
            ${user.role.toLowerCase() === 'student' ? DashboardUI.renderDetailsModal() : ''}
            ${user.role.toLowerCase() === 'student' && ExamUI.renderAccessibleExamOverlay ? ExamUI.renderAccessibleExamOverlay() : ''}
            ${DashboardUI.renderGroupMembersModal()}
        `;
    }
};// js/course-dashboard.js
import { apiFetch, AppState, CONFIG } from './globals.js';
import { CourseExam } from './course-exam.js';

export const CourseDashboard = {
    loadGroupMembersForUpload: async (courseId) => {
        const section = document.getElementById('groupUploadSection');
        const list = document.getElementById('groupMembersList');
        const checkbox = document.getElementById('isGroupUpload');
        
        if (!section || !list) return;
        
        section.classList.add('hidden');
        list.innerHTML = '<div class="text-[10px] text-purple-600"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Loading group...</div>';
        if (checkbox) checkbox.checked = false;
        list.classList.add('hidden');

        try {
            const data = await apiFetch(`/api/group-members?courseId=${courseId}&studentId=${AppState.user.User_ID}`);
            if (data.groupName && data.members && data.members.length > 0) {
                section.classList.remove('hidden');
                list.innerHTML = data.members.map(m => `
                    <label class="flex items-center space-x-2 text-[10px] font-medium text-gray-700 cursor-pointer">
                        <input type="checkbox" class="group-member-checkbox rounded text-purple-600 focus:ring-purple-500" value="${m.User_ID}" checked>
                        <span>${m.Name} (${m.Student_Number || 'N/A'})</span>
                    </label>
                `).join('');
            }
        } catch (err) {
            console.error("Failed to load group members", err);
        }
    },

    submitDocument: async () => {
        const btn = document.getElementById('submitDocBtn');
        const errorDiv = document.getElementById('submitDocError');
        const successDiv = document.getElementById('submitDocSuccess');
        const progressDiv = document.getElementById('submitDocProgress');
        const progressText = document.getElementById('submitDocProgressText');

        errorDiv.classList.add('hidden');
        successDiv.classList.add('hidden');
        progressDiv.classList.remove('hidden');
        btn.disabled = true;

        try {
            const courseId = document.getElementById('openSubmitDocModalBtn').dataset.courseId;
            if (!courseId) throw new Error("Could not identify the active course.");

            const term = document.getElementById('submitTerm').value;
            const titleInput = document.getElementById('submitTitle').value.trim();
            
            if (/[.\/\\:*?"<>|]/.test(titleInput)) {
                throw new Error("Title cannot contain special characters like dots (.) or slashes (/).");
            }
            
            const title = titleInput;
            const desc = document.getElementById('submitDesc').value.trim();
            const type = document.getElementById('submissionType').value;
            
            const isGroupCheckbox = document.getElementById('isGroupUpload');
            const isGroup = isGroupCheckbox && !isGroupCheckbox.closest('#groupUploadSection').classList.contains('hidden') ? isGroupCheckbox.checked : false;
            
            const includedMembers = [];
            if (isGroup) {
                document.querySelectorAll('.group-member-checkbox:checked').forEach(cb => {
                    includedMembers.push(cb.value);
                });
            }
            
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
                
                if (file.size > 5 * 1024 * 1024) {
                    throw new Error("File size exceeds 5MB. Please upload your document to Google Drive, set the sharing access to 'Anyone with the link', and submit it here as a URL Link instead.");
                }

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
                courseId: courseId,
                studentId: user.User_ID,
                term: term,
                title: title,
                description: desc,
                type: type,
                filename: finalFilename,
                mimeType: mimeType,
                base64: base64Data,
                pathParts: [courseYearSection, "Submitted"],
                isGroup: isGroup,
                includedMembers: includedMembers
            };
            
            progressText.textContent = 'Starting upload...';
            
            const dbData = await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', `${CONFIG.API_URL}/api/upload-submission`, true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                
                xhr.upload.onprogress = (event) => {
                    if (event.lengthComputable) {
                        const uploadedMB = (event.loaded / (1024 * 1024)).toFixed(2);
                        const totalMB = (event.total / (1024 * 1024)).toFixed(2);
                        progressText.textContent = `Uploading to Portal... ${uploadedMB} MB / ${totalMB} MB`;
                    }
                };
                
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try {
                            resolve(JSON.parse(xhr.responseText));
                        } catch (e) {
                            reject(new Error("Failed to parse server response"));
                        }
                    } else {
                        try {
                            const err = JSON.parse(xhr.responseText);
                            reject(new Error(err.error || `Upload failed with status ${xhr.status}`));
                        } catch (e) {
                            reject(new Error(`Upload failed with status ${xhr.status}`));
                        }
                    }
                };
                
                xhr.onerror = () => reject(new Error("Network error occurred during upload."));
                xhr.send(JSON.stringify(payload));
            });
            
            if (!dbData.success) {
                throw new Error("Server Error: " + (dbData.error || "Unknown error occurred"));
            }
            
            progressDiv.classList.add('hidden');
            successDiv.textContent = "Submission uploaded successfully!";
            successDiv.classList.remove('hidden');
            document.getElementById('submitDocForm').reset();
            
            setTimeout(() => {
                document.getElementById('submitDocModal').classList.add('hidden');
                successDiv.classList.add('hidden');
                
                const summaryModal = document.getElementById('studentSummaryModal');
                if (summaryModal && !summaryModal.classList.contains('hidden')) {
                    const activeCard = document.querySelector(`.student-active-course[data-course-id="${courseId}"]`);
                    if (activeCard) activeCard.click();
                }
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
            const [myCoursesRes, allCoursesRes, examsRes] = await Promise.all([
                apiFetch(`/api/my-courses?userId=${AppState.user.User_ID}&role=student&_t=${ts}`),
                apiFetch(`/api/courses?studentId=${AppState.user.User_ID}&_t=${ts}`),
                apiFetch(`/api/student-accessible-exams?studentId=${AppState.user.User_ID}&_t=${ts}`).catch(() => ({ exams: [] }))
            ]);

            const assignedExams = examsRes.exams || [];
            CourseExam.studentAssignedExams = assignedExams;
            if (examsRes.student) {
                AppState.user.eye_condition = examsRes.student.eye_condition;
            }

            const isBlind = AppState.user.eye_condition === 'Legally Blind';
            let assignedExamsSectionHtml = '';

            if (assignedExams.length > 0 || isBlind) {
                const examCardsHtml = assignedExams.length > 0
                    ? assignedExams.map(ex => {
                        const isDone = ex.status === 'Completed';
                        return `
                            <div class="dash-exam-card p-5 rounded-xl border-2 ${isDone ? 'bg-indigo-900/70 border-indigo-700' : 'bg-indigo-900 border-yellow-400'} flex flex-col justify-between gap-4 shadow-md transition hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-yellow-400 cursor-pointer" tabindex="0">
                                <div>
                                    <div class="flex justify-between items-start gap-2">
                                        <span class="px-2.5 py-0.5 bg-yellow-400 text-gray-950 font-black text-[10px] rounded uppercase tracking-wider">${ex.courseCode} &bull; ${ex.term}</span>
                                        ${ex.toDate ? `<span class="text-[10px] text-indigo-200 font-mono">Open until: ${ex.toDate}</span>` : ''}
                                    </div>
                                    <h3 class="text-lg sm:text-xl font-black text-white mt-2">${ex.examTitle}</h3>
                                    <p class="text-xs text-indigo-200 font-medium mt-0.5">${ex.courseTitle}</p>
                                    <div class="text-xs text-yellow-300 font-bold mt-2">
                                        Questions: ${ex.regularCount}${ex.bonusCount > 0 ? ` + ${ex.bonusCount} Bonus` : ''} &nbsp;|&nbsp; Max Score: ${ex.maxScore}
                                    </div>
                                </div>
                                ${isDone ? `
                                    <div class="w-full py-3 px-4 bg-green-700 text-white font-black text-sm rounded-lg text-center border border-green-400">
                                        <i class="fa-solid fa-circle-check mr-1.5"></i> Completed - Score: ${ex.finalScore} /${ex.maxScore}
                                    </div>
                                ` : `
                                    <button type="button" class="start-accessible-exam-btn w-full py-3.5 px-4 bg-yellow-400 hover:bg-yellow-300 text-gray-950 font-black text-sm sm:text-base rounded-lg shadow-md transition flex items-center justify-center focus:outline-none focus:ring-4 focus:ring-white" data-assignment-id="${ex.assignmentId}">
                                        <i class="fa-solid fa-headphones mr-2 text-lg"></i> Enter Exam: ${ex.examTitle}
                                    </button>
                                `}
                            </div>
                        `;
                    }).join('')
                    : `<div class="col-span-full p-6 text-center text-indigo-200 border-2 border-dashed border-indigo-700 rounded-xl font-bold text-sm">You have no active assigned exams at this moment.</div>`;

                assignedExamsSectionHtml = `
                    <section class="bg-indigo-950 text-white p-5 sm:p-6 rounded-2xl shadow-lg border-2 border-yellow-400">
                        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-5 pb-3 border-b border-indigo-800">
                            <div class="flex items-center">
                                <div class="bg-yellow-400 text-gray-950 p-2.5 rounded-xl mr-3">
                                    <i class="fa-solid fa-universal-access text-xl"></i>
                                </div>
                                <div>
                                    <h2 class="text-xl sm:text-2xl font-black text-white">Assigned Accessible Exams</h2>
                                    <p class="text-xs text-indigo-200">Full-screen exam mode with voice read-aloud and automatic score recording</p>
                                </div>
                            </div>
                            <button type="button" id="readDashboardExamsBtn" class="w-full sm:w-auto px-4 py-2.5 bg-yellow-400 hover:bg-yellow-300 text-gray-950 font-black text-xs sm:text-sm rounded-lg shadow transition flex items-center justify-center focus:outline-none focus:ring-4 focus:ring-white">
                                <i class="fa-solid fa-volume-high mr-2"></i> Read Aloud Assigned Exams
                            </button>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            ${examCardsHtml}
                        </div>
                    </section>
                `;
            }

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
                    ${assignedExamsSectionHtml}
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

            if (isBlind && assignedExams.some(e => e.status !== 'Completed') && CourseExam.announceDashboardExams) {
                CourseExam.announceDashboardExams();
            }
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
