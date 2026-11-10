// js/components-dashboard.js
import { getLoadableAvatarSrc } from './components-utils.js';
import { ExamUI } from './components-exam.js';
import { escapeHtml, safeUrl } from './html-utils.js';

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
                    <div class="ss-term bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-sm" data-term-block="${term}">
                        <h4 class="text-lg font-black text-gray-800 mb-2 flex items-center justify-between"><span><i class="${t.icon} mr-2"></i>${label}</span><span class="ss-pill" id="${term}Pill">&ndash;</span></h4>
                        <div class="ss-bar mb-4" role="img" aria-label="${label} attendance"><span id="${term}BarFill" style="width:0%"></span></div>

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
        <header id="dashHeader" class="bg-white shadow-sm fixed top-0 w-full z-40 border-b border-gray-200">
            <div class="w-full mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">
                <div class="flex justify-between items-center h-16">
                    <div class="flex items-center">
                        <h1 class="text-lg sm:text-xl font-bold text-gray-800 tracking-tight"><i class="fa-solid fa-house mr-2 text-blue-600"></i>Dashboard</h1>
                    </div>
                    <button type="button" id="profileToggleBtn" aria-haspopup="dialog" aria-label="Open profile menu for ${escapeHtml(user.Name)}" class="flex items-center cursor-pointer hover:bg-gray-50 px-2 sm:px-3 py-1 rounded-full transition-colors duration-200 border border-transparent hover:border-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                        <span class="mr-3 text-sm font-bold text-gray-700 hidden sm:block">${escapeHtml(user.Name)}</span>${headerAvatar}
                    </button>
                </div>
            </div>
        </header>
    `,

    renderTabBar: (isLecturer) => `
        <nav id="dashTabBar" class="class-tabbar dash-tabbar" aria-label="Main" style="--cols:4">
            <button type="button" class="class-tab is-active" data-dash-tab="courses" aria-current="page"><i class="fa-solid fa-house" aria-hidden="true"></i><span>Courses</span></button>
            ${isLecturer ? `
            <button type="button" class="class-tab" data-dash-tab="new"><i class="fa-solid fa-circle-plus" aria-hidden="true"></i><span>New</span></button>
            <button type="button" class="class-tab" data-dash-tab="admin"><i class="fa-solid fa-screwdriver-wrench" aria-hidden="true"></i><span>Admin</span></button>` : `
            <button type="button" class="class-tab" data-dash-tab="exams"><i class="fa-solid fa-file-pen" aria-hidden="true"></i><span>Exams</span></button>
            <button type="button" class="class-tab" data-dash-tab="browse"><i class="fa-solid fa-book-open" aria-hidden="true"></i><span>Browse</span></button>`}
            <button type="button" class="class-tab" data-dash-tab="profile"><i class="fa-solid fa-circle-user" aria-hidden="true"></i><span>Profile</span></button>
        </nav>
    `,

    renderAdminPage: () => `
        <div id="adminPage" class="hidden fixed inset-0 z-[55] flex items-center justify-center fade-in p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Admin tools">
            <div id="closeAdminPageBg" class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm"></div>
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full sm:max-w-sm h-full sm:h-auto p-4 sm:p-6 relative z-10 sheet-panel app-page max-h-full sm:max-h-[90vh] overflow-y-auto">
                <div class="flex items-center gap-3 mb-5 border-b pb-3 app-page-header">
                    <div class="min-w-0 flex-1"><h3 class="text-lg font-bold text-gray-800 truncate"><i class="fa-solid fa-screwdriver-wrench text-blue-600 mr-2"></i>Admin Tools</h3><p class="keep-sub text-xs text-gray-500 truncate">Courses, registration list and users</p></div>
                    <button id="closeAdminPageBtn" type="button" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-500 sm:text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden" aria-hidden="true"></i><i class="fa-solid fa-xmark text-xl hidden sm:inline" aria-hidden="true"></i>
                    </button>
                </div>
                <section aria-label="Admin">
                    <h4 class="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">Manage</h4>
                    <div class="grid grid-cols-3 gap-2">
                        <button type="button" id="openCreateCourseModalBtn" class="menu-tile">
                            <span class="menu-tile-icon bg-blue-100 text-blue-700"><i class="fa-solid fa-folder-plus" aria-hidden="true"></i></span>
                            <span class="menu-tile-label">Create Course</span>
                        </button>
                        <button type="button" id="openApModalBtn" class="menu-tile">
                            <span class="menu-tile-icon bg-purple-100 text-purple-700"><i class="fa-solid fa-graduation-cap" aria-hidden="true"></i></span>
                            <span class="menu-tile-label">Registration List</span>
                        </button>
                        <button type="button" id="openMuModalBtn" class="menu-tile">
                            <span class="menu-tile-icon bg-green-100 text-green-700"><i class="fa-solid fa-users-gear" aria-hidden="true"></i></span>
                            <span class="menu-tile-label">Manage Users</span>
                        </button>
                        <button type="button" class="menu-tile open-unsaved" style="position:relative">
                            <span class="menu-tile-icon bg-amber-100 text-amber-700"><i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i></span>
                            <span class="menu-tile-label">Unsaved on Device</span>
                            <span class="unsaved-badge hidden" style="position:absolute;top:.35rem;right:.5rem;min-width:1.2rem;padding:0 .3rem;border-radius:9999px;background:#f59e0b;color:#fff;font-size:.7rem;font-weight:800;text-align:center;line-height:1.2rem">0</span>
                        </button>
                    </div>
                </section>
            </div>
        </div>
    `,

    renderProfilePanel: (user, panelAvatar, displayCourse, lecturerBtns) => `
        <div id="profilePanelOverlay" class="fixed inset-0 bg-gray-900 bg-opacity-40 backdrop-blur-sm z-40 hidden transition-opacity"></div>
        <div id="profilePanel" class="fixed inset-y-0 right-0 w-full sm:w-96 bg-white shadow-2xl z-50 transform translate-x-full transition-transform duration-300 ease-in-out overflow-y-auto flex flex-col">
            <div class="p-6 bg-gradient-to-b from-blue-50 to-white flex-grow relative">
                <button id="closeProfilePanel" class="absolute top-4 right-4 text-gray-400 hover:text-gray-800 focus:outline-none transition-colors">
                    <i class="fa-solid fa-xmark text-2xl"></i>
                </button>

                <div class="text-center mt-6">
                    ${panelAvatar}
                    <h2 id="profileNameText" class="text-xl sm:text-2xl font-bold text-gray-800 mt-4">${escapeHtml(user.Name)}</h2>
                    <p class="text-sm font-medium text-gray-500">@<span id="profileUsernameText">${escapeHtml(user.Username || 'N/A')}</span></p>
                </div>

                <div class="mt-6 px-2">
                    <div class="flex justify-between items-start border-b border-gray-200 pb-4">
                        <div class="flex-1 pr-1">
                            <span class="block text-xs sm:text-sm font-bold text-blue-600">${escapeHtml(user.role || 'N/A')}</span>
                        </div>
                        <div class="flex-1 text-center border-x border-gray-200 px-1">
                            <span class="block text-xs sm:text-sm font-medium text-gray-800 break-all">${escapeHtml(user.Student_Number || 'N/A')}</span>
                        </div>
                        <div class="flex-1 text-right pl-1">
                            <span class="block text-xs sm:text-sm font-medium text-gray-800">${escapeHtml(displayCourse)}</span>
                        </div>
                    </div>
                </div>

                ${DashboardUI.renderProfileDetails(user)}

                ${lecturerBtns}

                <div class="mt-6 space-y-3">
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
        <div id="muModal" class="hidden fixed inset-0 z-[60] flex items-center justify-center fade-in p-0 sm:p-4">
            <div id="muModalOverlay" class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm"></div>
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full max-w-4xl h-full sm:h-auto p-4 sm:p-6 relative z-10 sheet-panel app-page max-h-full sm:max-h-[90vh] flex flex-col">
                <div class="flex items-center gap-3 mb-4 border-b pb-3 app-page-header">
                    <h3 class="min-w-0 flex-1 truncate text-lg font-bold text-gray-800"><i class="fa-solid fa-users-gear text-green-600 mr-2"></i>Manage Users</h3>
                    <button id="closeMuModalBtn" type="button" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-500 sm:text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden" aria-hidden="true"></i><i class="fa-solid fa-xmark text-xl hidden sm:inline" aria-hidden="true"></i>
                    </button>
                </div>

                <div class="mb-3">
                    <input type="search" id="muSearchInput" autocomplete="off" placeholder="Search by Name or Student No..." class="w-full px-4 py-2.5 border border-gray-300 rounded-full text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
                    <div id="muChips" class="flex gap-2 overflow-x-auto mt-3 pb-1 -mx-1 px-1" role="group" aria-label="Filter by status"></div>
                    <select id="muFilterStatus" class="hidden" aria-hidden="true" tabindex="-1">
                        <option value="">All Statuses</option>
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                        <option value="Suspended">Suspended</option>
                        <option value="UD">UD</option>
                        <option value="Dropped">Dropped</option>
                    </select>
                    <p class="text-[11px] text-gray-400 mt-1 sm:hidden"><i class="fa-solid fa-hand-pointer mr-1" aria-hidden="true"></i>Swipe a card right to activate, left for more statuses.</p>
                </div>

                <div id="manageUsersList" class="flex-1 overflow-y-auto space-y-2 min-h-[300px] bg-gray-50 p-2 rounded border border-gray-200">
                </div>
            </div>
        </div>
    `,

    renderChangePasswordModal: () => `
        <div id="cpModal" class="hidden fixed inset-0 z-[60] flex items-center justify-center fade-in p-0 sm:p-4">
            <div id="cpModalOverlay" class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm"></div>
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full sm:max-w-sm h-full sm:h-auto p-4 sm:p-6 relative z-10 sm:scale-up sheet-panel app-page max-h-full sm:max-h-[90vh] overflow-y-auto">
                <div class="flex items-center gap-3 mb-5 border-b pb-3 app-page-header">
                    <h3 class="min-w-0 flex-1 truncate text-lg font-bold text-gray-800"><i class="fa-solid fa-shield-halved text-blue-600 mr-2"></i>Change Password</h3>
                    <button id="closeCpModalBtn" type="button" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-500 sm:text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden" aria-hidden="true"></i><i class="fa-solid fa-xmark text-xl hidden sm:inline" aria-hidden="true"></i>
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

                    <button type="submit" id="cpSubmitBtn" class="form-save w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none transition-colors mt-2">
                        Update Password
                    </button>
                </form>
            </div>
        </div>
    `,

    // Details shown inside the profile page. Fields are read-only until "Edit" is pressed (js/profile-edit.js);
    // saving asks for the password (see the hidden #udPassword).
    renderProfileDetails: (user) => {
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
            <section class="mt-6" aria-label="Details">
                <div class="flex items-center justify-between mb-3">
                    <h3 class="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Details</h3>
                    <button type="button" id="udEditBtn" class="px-3 py-1 rounded-full border border-blue-300 text-blue-700 bg-blue-50 text-xs font-bold hover:bg-blue-100 focus:outline-none"><i class="fa-solid fa-pen mr-1" aria-hidden="true"></i>Edit</button>
                </div>
                <form id="updateDetailsForm" class="space-y-4" autocomplete="off">
                        <div id="udError" class="hidden bg-red-100 text-red-700 p-3 rounded text-sm font-medium"></div>
                        <div id="udSuccess" class="hidden bg-green-100 text-green-700 p-3 rounded text-sm font-medium"></div>

                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Given Name</label>
                                <input type="text" id="udGivenName" readonly required value="${escapeHtml(givenName)}" class="ud-field block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Last Name</label>
                                <input type="text" id="udLastName" readonly required value="${escapeHtml(lastName)}" class="ud-field block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Suffix</label>
                                <input type="text" id="udSuffix" readonly value="${escapeHtml(suffix)}" placeholder="e.g. Jr. (Optional)" class="ud-field block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50">
                            </div>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Username</label>
                                <input type="text" id="udUsername" readonly required value="${escapeHtml(user.Username || '')}" class="ud-field block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Email</label>
                                <input type="email" id="udEmail" readonly required value="${escapeHtml(user.Email || '')}" class="ud-field block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50">
                            </div>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Contact Number</label>
                                <input type="text" id="udContact" readonly value="${escapeHtml(user.Contact_Number || '')}" class="ud-field block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Student Number</label>
                                <input type="text" id="udStudentNumber" readonly required value="${escapeHtml(user.Student_Number || '')}" maxlength="7" placeholder="00-0000" class="ud-field block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50 font-mono">
                            </div>
                        </div>

                        ${(user.role || '').toLowerCase() === 'student' ? `
                        <div>
                            <div class="text-xs font-bold text-blue-700 uppercase tracking-wider mb-2"><i class="fa-solid fa-graduation-cap mr-1"></i>Program</div>
                            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Program Course</label>
                                <input type="text" id="udProgramCourse" readonly value="${escapeHtml(user.Program_Course || '')}" placeholder="e.g. BSCS" class="ud-field block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Program Year</label>
                                <input type="text" id="udProgramYear" readonly value="${escapeHtml(user.Program_Year || '')}" placeholder="e.g. 2" class="ud-field block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50">
                            </div>
                            <div>
                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Program Section</label>
                                <input type="text" id="udProgramSection" readonly value="${escapeHtml(user.Program_Section || '')}" placeholder="e.g. A" class="ud-field block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-gray-50">
                            </div>
                            </div>
                        </div>
                        ` : ''}

                        <input type="hidden" id="udPassword" value="">

                        <div id="udActions" class="hidden grid grid-cols-2 gap-3 pt-2">
                            <button type="button" id="udCancelBtn" class="py-2.5 px-4 border border-gray-300 rounded-md text-sm font-bold text-gray-700 bg-white hover:bg-gray-50 focus:outline-none">Cancel</button>
                            <button type="submit" id="udSubmitBtn" class="form-save py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none">Save Details</button>
                        </div>
                    </form>
            </section>
        `;
    },

    renderCreateCourseModal: () => `
        <div id="ccModal" class="hidden fixed inset-0 z-[60] flex items-center justify-center fade-in p-0 sm:p-4">
            <div id="ccModalOverlay" class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm"></div>
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full sm:max-w-md h-full sm:h-auto p-4 sm:p-6 relative z-10 sm:scale-up sheet-panel app-page max-h-full sm:max-h-[90vh] overflow-y-auto">
                <div class="flex items-center gap-3 mb-5 border-b pb-3 app-page-header">
                    <h3 class="min-w-0 flex-1 truncate text-lg font-bold text-gray-800"><i class="fa-solid fa-folder-plus text-blue-600 mr-2"></i>Create Course</h3>
                    <button id="closeCcModalBtn" type="button" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-500 sm:text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden" aria-hidden="true"></i><i class="fa-solid fa-xmark text-xl hidden sm:inline" aria-hidden="true"></i>
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
                                <option>Thursday</option><option>Friday</option><option>Saturday</option><option>Sunday</option>
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

                    <button type="submit" id="addCourseBtn" class="form-save w-full bg-blue-600 text-white py-2.5 px-4 rounded-md hover:bg-blue-700 shadow-sm font-bold transition-colors mt-4">
                        Create Course
                    </button>
                </form>
            </div>
        </div>
    `,

    renderAddProgramModal: () => `
        <div id="apModal" class="hidden fixed inset-0 z-[60] flex items-center justify-center fade-in p-0 sm:p-4">
            <div id="apModalOverlay" class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm"></div>
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full sm:max-w-sm h-full sm:h-auto p-4 sm:p-6 relative z-10 sm:scale-up sheet-panel app-page max-h-full sm:max-h-[90vh] overflow-y-auto">
                <div class="flex items-center gap-3 mb-5 border-b pb-3 app-page-header">
                    <h3 class="min-w-0 flex-1 truncate text-lg font-bold text-gray-800"><i class="fa-solid fa-graduation-cap text-purple-600 mr-2"></i>Add Course (Program)</h3>
                    <button id="closeApModalBtn" type="button" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-500 sm:text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden" aria-hidden="true"></i><i class="fa-solid fa-xmark text-xl hidden sm:inline" aria-hidden="true"></i>
                    </button>
                </div>

                <form id="addProgramForm" class="space-y-4">
                    <div id="programError" class="hidden bg-red-100 text-red-700 p-3 rounded text-sm font-medium"></div>
                    <div id="programSuccess" class="hidden bg-green-100 text-green-700 p-3 rounded text-sm font-medium"></div>

                    <div>
                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider">Course / Program Code</label>
                        <input type="text" id="programCode" required class="w-full border border-gray-300 p-2 rounded-md mt-1 focus:ring-2 focus:ring-purple-500 outline-none bg-gray-50 text-sm uppercase" placeholder="e.g. BSCS">
                    </div>

                    <button type="submit" id="addProgramBtn" class="form-save w-full bg-purple-600 text-white py-2.5 px-4 rounded-md hover:bg-purple-700 shadow-sm font-bold transition-colors mt-4">
                        Add to Registration List
                    </button>
                </form>
            </div>
        </div>
    `,

    renderSubmitDocumentModal: () => `
        <div id="submitDocModal" class="hidden fixed inset-0 z-[100] flex items-center justify-center fade-in p-0 sm:p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeSubmitDocModalBg"></div>
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full sm:max-w-md h-full sm:h-auto p-4 sm:p-6 relative z-10 sheet-panel app-page max-h-full sm:max-h-[92vh] overflow-y-auto">
                <div class="flex items-center gap-3 mb-4 border-b pb-3 app-page-header">
                    <h3 class="text-lg font-bold text-gray-800 flex-1 min-w-0"><i class="fa-solid fa-cloud-arrow-up text-blue-600 mr-2"></i>Submit Document</h3>
                    <button id="closeSubmitDocModalBtn" type="button" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden"></i>
                        <i class="fa-solid fa-xmark text-xl hidden sm:inline"></i>
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

                    <button type="submit" id="submitDocBtn" class="form-save w-full flex justify-center py-2.5 px-4 rounded-md shadow-sm text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none transition-colors mt-4">
                        Submit
                    </button>
                </form>
            </div>
        </div>
    `,

    renderSubmissionHistoryModal: () => `
        <div id="submissionHistoryModal" class="hidden fixed inset-0 z-[100] flex items-end sm:items-center justify-center fade-in p-0 sm:p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeSubmissionHistoryModalBg"></div>
            <div class="bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full max-w-md p-4 sm:p-6 relative z-10 sheet-panel max-h-[85vh] flex flex-col">
                <div class="sm:hidden mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300" aria-hidden="true"></div>
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
        <div id="groupMembersModal" class="hidden fixed inset-0 z-[110] flex items-end sm:items-center justify-center fade-in p-0 sm:p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeGroupMembersModalBg"></div>
            <div class="bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full p-4 sm:p-6 relative z-10 sheet-panel max-h-[85vh] flex flex-col">
                <div class="sm:hidden mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300" aria-hidden="true"></div>
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
        <div id="studentSummaryModal" class="hidden fixed inset-0 z-[80] bg-gray-50 flex flex-col fade-in overflow-y-auto w-full h-full ss-page">
            <div class="ss-top sticky top-0 z-10 w-full">
                <div class="max-w-4xl mx-auto px-2 sm:px-6 py-2 flex items-center gap-1">
                    <button id="closeStudentSummaryModalBtn" type="button" aria-label="Back" class="app-page-close text-white/90 hover:text-white focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl"></i>
                    </button>
                    <div class="min-w-0 flex-1">
                        <div class="text-[11px] font-bold uppercase tracking-wider text-blue-100">My Course Summary</div>
                        <div id="ssCourseTitle" class="font-black text-white text-lg leading-tight truncate"></div>
                    </div>
                </div>
                <div id="ssEnrollmentInfo" class="hidden max-w-4xl mx-auto px-4 sm:px-6 pb-3 flex flex-wrap gap-2">
                    <span class="ss-chip"><i class="fa-solid fa-chair" aria-hidden="true"></i> Seat <b id="ssSeat">-</b></span>
                    <span class="ss-chip"><i class="fa-solid fa-user-group" aria-hidden="true"></i> Group <b id="ssGroup">-</b></span>
                    <button type="button" id="ssTopicChip" class="ss-chip ss-chip-topic" aria-haspopup="dialog" aria-label="Show full topic">
                        <i class="fa-solid fa-lightbulb" aria-hidden="true"></i>
                        <span class="ss-topic-text">Topic <b id="ssTopic">-</b></span>
                        <i class="fa-solid fa-circle-info ss-info" aria-hidden="true"></i>
                    </button>
                </div>
                <div id="ssTermTabs" class="ss-tabs max-w-4xl mx-auto" role="tablist" aria-label="Term">
                    <button type="button" role="tab" class="ss-term-tab is-active" data-term="midterm" aria-selected="true">Mid Term</button>
                    <button type="button" role="tab" class="ss-term-tab" data-term="finalterm" aria-selected="false">Final Term</button>
                </div>
            </div>

            <div class="max-w-4xl mx-auto w-full p-4 sm:p-6 flex-1 ss-body">
                <div id="summaryLoading" class="space-y-4" aria-busy="true" role="status">
                    <span class="sr-only">Loading summary</span>
                    <div class="ss-skel h-24"></div><div class="ss-skel h-40"></div><div class="ss-skel h-24"></div>
                </div>
                <div id="summaryError" class="hidden text-center py-12 text-red-500 font-bold text-lg"></div>

                <div id="summaryContent" class="hidden space-y-6">
                    ${renderTermBlock('midterm', 'Mid Term')}
                    ${renderTermBlock('finalterm', 'Final Term')}
                </div>
            </div>

        </div>
        <div id="ssActionBar" class="hidden ss-actions">
            <button id="openHistoryModalBtn" type="button" class="ss-act ss-act-secondary">
                <i class="fa-solid fa-clock-rotate-left mr-2" aria-hidden="true"></i> History
            </button>
            <button id="openSubmitDocModalBtn" type="button" class="ss-act ss-act-primary">
                <i class="fa-solid fa-cloud-arrow-up mr-2" aria-hidden="true"></i> Upload Document
            </button>
        </div>
    `,

    renderDetailsModal: () => `
        <div id="detailsModal" class="hidden fixed inset-0 flex flex-col bg-gray-50 fade-in details-page" style="z-index:90">
            <div id="closeDetailsModalBg" class="hidden"></div>
            <div class="details-top sticky top-0">
                <div class="max-w-4xl mx-auto px-2 sm:px-6 py-2 flex items-center gap-1">
                    <button type="button" id="closeDetailsModalBtn" aria-label="Back" class="app-page-close text-white/90 hover:text-white focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl"></i>
                    </button>
                    <h3 class="text-base sm:text-lg font-black text-white truncate" id="detailsModalTitle">Details</h3>
                </div>
            </div>
            <div class="flex-1 overflow-y-auto" style="padding-bottom:env(safe-area-inset-bottom)">
                <div class="max-w-4xl mx-auto bg-white sm:my-4 sm:rounded-xl sm:border sm:border-gray-200 overflow-hidden">
                    <table class="w-full text-sm text-left details-table">
                        <thead class="bg-gray-100 text-gray-700 sticky top-0 shadow-sm">
                            <tr>
                                <th class="px-4 py-3">Date</th>
                                <th class="px-4 py-3 text-center">Status / Info</th>
                                <th class="px-4 py-3 text-center" id="detailsScoreHeader">Score</th>
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
        const headerAvatar = avatarSrc ? `<img src="${safeUrl(avatarSrc)}" class="w-10 h-10 rounded-full object-cover aspect-square border-2 border-gray-200 shadow-sm" alt="Profile Picture" />` : '<i class="fa-solid fa-circle-user text-3xl text-gray-400"></i>';

        let displayCourse = 'N/A';
        if (user.course) {
            displayCourse = `${user.course} ${user.year || ''} ${user.section ? '- ' + user.section : ''}`.trim().replace(/\s+/g, ' ');
        }

        const panelAvatar = avatarSrc ? `<img src="${safeUrl(avatarSrc)}" class="w-28 h-28 rounded-full object-cover aspect-square border-4 border-white shadow-lg mx-auto cursor-pointer view-avatar-btn hover:opacity-80 transition" data-src="${safeUrl(avatarSrc)}" data-name="${escapeHtml(user.Name)}" data-info="${displayCourse}" role="button" tabindex="0" alt="Profile Picture" />` : '<i class="fa-solid fa-circle-user text-7xl text-gray-400 mx-auto block text-center"></i>';

        let lecturerBtns = '';
        const appearanceHtml = `
            <div class="mt-6">
                <button type="button" id="openUnsavedBtn" class="open-unsaved w-full mb-5 flex items-center justify-between py-2.5 px-3 border border-gray-300 rounded-md text-sm font-bold text-gray-700 bg-white hover:bg-gray-50">
                    <span><i class="fa-solid fa-cloud-arrow-up mr-2" aria-hidden="true"></i>Unsaved on this device</span>
                    <span class="unsaved-badge hidden min-w-[1.4rem] text-center px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-xs">0</span>
                </button>
                <div class="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Appearance</div>
                <div class="grid grid-cols-3 gap-2" role="group" aria-label="Appearance">
                    <button type="button" class="theme-choice" data-theme-choice="auto" aria-pressed="false"><i class="fa-solid fa-circle-half-stroke mr-1" aria-hidden="true"></i>Auto</button>
                    <button type="button" class="theme-choice" data-theme-choice="light" aria-pressed="false"><i class="fa-solid fa-sun mr-1" aria-hidden="true"></i>Light</button>
                    <button type="button" class="theme-choice" data-theme-choice="dark" aria-pressed="false"><i class="fa-solid fa-moon mr-1" aria-hidden="true"></i>Dark</button>
                </div>
                <button type="button" id="installAppBtn" class="w-full mt-3 flex justify-center items-center py-2 px-4 border border-gray-300 rounded-md text-sm font-bold text-gray-700 bg-white hover:bg-gray-50 focus:outline-none transition-colors">
                    <i class="fa-solid fa-mobile-screen-button mr-2" aria-hidden="true"></i> Install app
                </button>
            </div>
        `;

        lecturerBtns += appearanceHtml;

        return `
            ${DashboardUI.renderHeader(user, headerAvatar)}

            <main class="pt-24 pb-28 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full fade-in">
                <div id="courseContainer" class="w-full"></div>
            </main>

            ${user.role.toLowerCase() === 'lecturer' ? `<button type="button" class="open-create-course-btn dash-fab fixed bottom-6 right-6 z-30 h-14 pl-4 pr-5 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center gap-2 text-sm font-bold focus:outline-none focus-visible:ring-4 ring-blue-300 transition-colors" aria-label="Create new course"><i class="fa-solid fa-plus text-lg" aria-hidden="true"></i><span class="hidden sm:inline">New Course</span></button>` : ''}

            ${DashboardUI.renderTabBar(user.role.toLowerCase() === 'lecturer')}
            ${DashboardUI.renderProfilePanel(user, panelAvatar, displayCourse, lecturerBtns)}
            ${user.role.toLowerCase() === 'lecturer' ? DashboardUI.renderAdminPage() : ''}
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
};