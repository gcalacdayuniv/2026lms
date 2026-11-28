// js/components-class.js
import { isAutoAbsent } from './student-status.js';
import { getLoadableAvatarSrc } from './components-utils.js';
import { ExamUI } from './components-exam.js';
import { ScannerUI } from './components-scanner.js';
import { Skeleton } from './skeletons.js';
import { getLocalDateString } from './date-utils.js';
import { escapeHtml, safeUrl } from './html-utils.js';
import { renderSubmitDocumentModal } from './components-dashboard.js';

// Remembers whether the Present/Late/Excused/Absent buttons are collapsed in the class list.
export const STATUS_COLLAPSED_KEY = 'attendance_status_collapsed';
const isStatusCollapsed = () => {
    try { return localStorage.getItem(STATUS_COLLAPSED_KEY) === '1'; } catch (e) { return false; }
};

// Class summary columns. The first two are pinned while scrolling sideways
// (on phones only the Student column is pinned, to leave room to scroll).
const SUMMARY_COLUMNS = [
    { label: '#',             cls: 'px-1 w-8 min-w-[2rem] sm:w-12 sm:min-w-[3rem] text-center sm:left-0 z-30' },
    { label: 'Student',       cls: 'px-2 sm:px-3 min-w-[118px] max-w-[118px] sm:min-w-[220px] sm:max-w-none left-0 sm:left-12 z-30 pin-edge' },
    { label: 'Seat',          cls: 'px-3 text-center z-20' },
    { label: 'Email',         cls: 'px-3 z-20' },
    { label: 'Contact',       cls: 'px-3 z-20' },
    { label: 'Status',        cls: 'px-3 text-center z-20' },
    { label: 'Group',         cls: 'px-3 z-20' },
    { label: 'Topic',         cls: 'px-3 z-20' },
    { label: 'Attendance',    cls: 'px-3 text-center z-20' },
    { label: 'Participation', cls: 'px-3 text-center z-20' },
    { label: 'Written',       cls: 'px-3 text-center z-20' },
    { label: 'Narrative',     cls: 'px-3 text-center z-20' },
    { label: 'Individual',    cls: 'px-3 text-center z-20' },
    { label: 'Report',        cls: 'px-3 text-center z-20' },
    { label: 'Tasks',         cls: 'px-3 text-center z-20' },
    { label: 'Major Exam',    cls: 'px-3 text-center z-20' },
    { label: 'Log',           cls: 'px-3 z-20' }
];

const ClassUI = {
    renderCourseMenuModal: (course) => `
        <div id="courseMenuModal" class="hidden fixed inset-0 z-[60] flex items-center justify-center fade-in p-0 sm:p-4">
            <div id="closeCourseMenuBg" class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm"></div>
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full sm:max-w-sm h-full sm:h-auto p-4 sm:p-6 relative z-10 sheet-panel app-page max-h-full sm:max-h-[90vh] overflow-y-auto">
                <div class="flex items-center gap-3 mb-5 border-b pb-3 app-page-header">
                    <div class="min-w-0 flex-1"><h3 class="text-lg font-bold text-gray-800 truncate"><i class="fa-solid fa-layer-group text-blue-600 mr-2"></i>Course Actions</h3><p class="keep-sub text-xs text-gray-500 truncate">${escapeHtml(course.CourseCode || '')} ${escapeHtml(course.CourseTitle || '')}</p></div>
                    <button id="closeCourseMenuBtn" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-500 sm:text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden" aria-hidden="true"></i><i class="fa-solid fa-xmark text-xl hidden sm:inline" aria-hidden="true"></i>
                    </button>
                </div>

                <div class="space-y-5 mb-5">
                    <section aria-label="Students">
                        <h4 class="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">Students</h4>
                        <div class="grid grid-cols-3 gap-2">
                        <button type="button" id="openAddStudentModalBtn" class="menu-tile">
                            <span class="menu-tile-icon bg-green-100 text-green-700"><i class="fa-solid fa-user-plus" aria-hidden="true"></i></span>
                            <span class="menu-tile-label">Enroll Student</span>
                        </button>
                        <button type="button" id="openInviteBtn" class="menu-tile">
                            <span class="menu-tile-icon bg-amber-100 text-amber-700"><i class="fa-solid fa-key" aria-hidden="true"></i></span>
                            <span class="menu-tile-label">Invite Code</span>
                        </button>
                        <button type="button" id="copyEmailsBtn" class="menu-tile">
                            <span class="menu-tile-icon bg-blue-100 text-blue-700"><i class="fa-regular fa-copy" aria-hidden="true"></i></span>
                            <span class="menu-tile-label">Copy Emails</span>
                        </button>
                        <button type="button" id="exportRosterBtn" data-course-id="${course.Course_ID}" class="menu-tile">
                            <span class="menu-tile-icon bg-gray-200 text-gray-800"><i class="fa-solid fa-print" aria-hidden="true"></i></span>
                            <span class="menu-tile-label">Print Roster</span>
                        </button>
                        <button type="button" id="openSeatPlanBtn" class="menu-tile">
                            <span class="menu-tile-icon bg-sky-100 text-sky-700"><i class="fa-solid fa-chair" aria-hidden="true"></i></span>
                            <span class="menu-tile-label">Seat Plan</span>
                        </button>
                        <button type="button" id="openGroupsBtn" class="menu-tile">
                            <span class="menu-tile-icon bg-violet-100 text-violet-700"><i class="fa-solid fa-people-group" aria-hidden="true"></i></span>
                            <span class="menu-tile-label">Groups</span>
                        </button>
                        <button type="button" id="openClassSummaryBtn" class="menu-tile">
                            <span class="menu-tile-icon bg-purple-100 text-purple-700"><i class="fa-solid fa-table-list" aria-hidden="true"></i></span>
                            <span class="menu-tile-label">Class Summary</span>
                        </button>
                        <button type="button" class="menu-tile open-unsaved" style="position:relative">
                            <span class="menu-tile-icon bg-amber-100 text-amber-700"><i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i></span>
                            <span class="menu-tile-label">Unsaved on Device</span>
                            <span class="unsaved-badge hidden" style="position:absolute;top:.35rem;right:.5rem;min-width:1.2rem;padding:0 .3rem;border-radius:9999px;background:#f59e0b;color:#fff;font-size:.7rem;font-weight:800;text-align:center;line-height:1.2rem">0</span>
                        </button>
                        </div>
                    </section>
                    <section aria-label="Grades & Exams">
                        <h4 class="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">Grades & Exams</h4>
                        <div class="grid grid-cols-3 gap-2">
                        <button type="button" id="openScoresModalBtn" class="menu-tile">
                            <span class="menu-tile-icon bg-teal-100 text-teal-700"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i></span>
                            <span class="menu-tile-label">Record Scores</span>
                        </button>
                        <button type="button" id="openExamManagerBtn" class="menu-tile">
                            <span class="menu-tile-icon bg-indigo-100 text-indigo-700"><i class="fa-solid fa-file-contract" aria-hidden="true"></i></span>
                            <span class="menu-tile-label">Manage Exams</span>
                        </button>
                        <button type="button" id="openScannerBtn" class="menu-tile">
                            <span class="menu-tile-icon bg-rose-100 text-rose-700"><i class="fa-solid fa-camera" aria-hidden="true"></i></span>
                            <span class="menu-tile-label">Scan Sheets</span>
                        </button>
                        </div>
                    </section>
                    <section aria-label="This class">
                        <h4 class="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">This class</h4>
                        <div class="grid grid-cols-3 gap-2">
                        <button type="button" class="menu-tile duplicate-course-btn" data-course-id="${course.Course_ID}" data-term="${escapeHtml([course.AcademicYear, course.Semester].filter(Boolean).join('|'))}">
                            <span class="menu-tile-icon bg-indigo-100 text-indigo-700"><i class="fa-solid fa-copy" aria-hidden="true"></i></span>
                            <span class="menu-tile-label">Copy to another term</span>
                        </button>
                        <button type="button" class="menu-tile archive-course-btn" data-course-id="${course.Course_ID}" data-archive="${Number(course.Archived) === 1 ? '0' : '1'}">
                            <span class="menu-tile-icon bg-gray-200 text-gray-800"><i class="fa-solid ${Number(course.Archived) === 1 ? 'fa-box-open' : 'fa-box-archive'}" aria-hidden="true"></i></span>
                            <span class="menu-tile-label">${Number(course.Archived) === 1 ? 'Restore class' : 'Archive class'}</span>
                        </button>
                        </div>
                    </section>
                    <section aria-label="Calendar">
                        <h4 class="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">Calendar</h4>
                        <div class="grid grid-cols-3 gap-2">
                        <button type="button" id="openAttendanceDatesBtn" class="menu-tile">
                            <span class="menu-tile-icon bg-sky-100 text-sky-700"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i></span>
                            <span class="menu-tile-label">Attendance Dates</span>
                        </button>
                        <button type="button" id="openNoClassModalBtn" class="menu-tile">
                            <span class="menu-tile-icon bg-orange-100 text-orange-700"><i class="fa-solid fa-calendar-xmark" aria-hidden="true"></i></span>
                            <span class="menu-tile-label">No Class Days</span>
                        </button>
                        <button type="button" id="openCoursePlanBtn" class="menu-tile">
                            <span class="menu-tile-icon bg-emerald-100 text-emerald-700"><i class="fa-solid fa-book-open" aria-hidden="true"></i></span>
                            <span class="menu-tile-label">Course Plan</span>
                        </button>
                        </div>
                    </section>
                </div>

                <details class="border-t border-gray-200 pt-3 group">
                    <summary class="menu-row"><span class="menu-tile-icon bg-purple-100 text-purple-700 !w-9 !h-9"><i class="fa-regular fa-calendar-days" aria-hidden="true"></i></span><span class="flex-1 text-sm font-bold text-gray-800">Term Period Settings</span><i class="fa-solid fa-chevron-down text-xs text-gray-400 transition-transform group-open:rotate-180" aria-hidden="true"></i></summary>
                    <div id="courseMenuAlert" class="hidden text-xs my-3 p-2 rounded"></div>

                    <div class="space-y-4">
                        <div class="bg-gray-50 p-3 rounded border border-gray-200">
                            <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Mid Term</label>
                            <div class="flex items-center space-x-2">
                                <input type="date" id="midtermStart" class="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500" value="${course.Midterm_Start || ''}">
                                <span class="text-gray-400 text-xs font-bold">to</span>
                                <input type="date" id="midtermEnd" class="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500" value="${course.Midterm_End || ''}">
                            </div>
                        </div>
                        <div class="bg-gray-50 p-3 rounded border border-gray-200">
                            <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Final Term</label>
                            <div class="flex items-center space-x-2">
                                <input type="date" id="finalStart" class="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500" value="${course.Final_Start || ''}">
                                <span class="text-gray-400 text-xs font-bold">to</span>
                                <input type="date" id="finalEnd" class="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500" value="${course.Final_End || ''}">
                            </div>
                        </div>
                        <button type="button" id="saveCourseTermsBtn" class="w-full bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-4 py-2 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center">
                            Save Term Periods
                        </button>
                    </div>
                </details>
            </div>
        </div>
    `,

    renderSeatPlanModal: () => `
        <div id="seatPlanModal" class="hidden fixed inset-0 z-[75] flex items-center justify-center fade-in p-0 sm:p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeSeatPlanBg"></div>
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full max-w-xl h-full sm:h-auto p-4 sm:p-6 relative z-10 sheet-panel page-full app-page max-h-full sm:max-h-[95vh] flex flex-col">
                <div class="flex items-center gap-3 mb-3 border-b pb-3 app-page-header">
                    <div class="flex-1 min-w-0">
                        <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-chair text-sky-600 mr-2" aria-hidden="true"></i>Seat Plan</h3>
                        <p class="text-xs text-gray-500">One seat per student, no duplicates. Lock a seat to keep it when you auto-assign.</p>
                    </div>
                    <button id="closeSeatPlanBtn" type="button" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-500 sm:text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden" aria-hidden="true"></i><i class="fa-solid fa-xmark text-xl hidden sm:inline" aria-hidden="true"></i>
                    </button>
                </div>
                <div id="csAlert" role="status" class="hidden mb-3 p-2 rounded text-xs font-bold"></div>
                <div class="grid grid-cols-2 gap-2 mb-2">
                    <button type="button" id="csAutoAllBtn" class="min-h-[44px] px-3 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-md text-sm font-bold"><i class="fa-solid fa-wand-magic-sparkles mr-1" aria-hidden="true"></i>Reassign all seats</button>
                    <button type="button" id="csAutoNewBtn" class="min-h-[44px] px-3 py-2 bg-white border border-sky-300 text-sky-700 hover:bg-sky-50 rounded-md text-sm font-bold"><i class="fa-solid fa-user-plus mr-1" aria-hidden="true"></i>Seat new students</button>
                    <button type="button" id="csMapBtn" class="col-span-2 min-h-[44px] px-3 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded-md text-sm font-bold"><i class="fa-solid fa-table-cells mr-1" aria-hidden="true"></i>View floor plan</button>
                </div>
                <p class="text-[11px] text-gray-500 mb-3">Drag <i class="fa-solid fa-grip-vertical" aria-hidden="true"></i> or use the arrows to move a student: the seat numbers follow. Press <b>+</b> on a student with no seat to place them. Reassign order: Legally Blind, Near Sighted, No Eye Condition, Far Sighted, then A to Z by last name. Locked seats never move. UD, Dropped and Graduated students get no seat.</p>
                <div id="csList" class="overflow-auto flex-1 min-h-[200px] border border-gray-200 rounded-lg divide-y divide-gray-100"></div>
            </div>
        </div>
    `,

    renderGroupsModal: () => `
        <div id="groupsModal" class="hidden fixed inset-0 z-[75] flex items-center justify-center fade-in p-0 sm:p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeGroupsBg"></div>
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full max-w-3xl h-full sm:h-auto p-4 sm:p-6 relative z-10 sheet-panel page-full app-page max-h-full sm:max-h-[95vh] flex flex-col">
                <div class="flex items-center gap-3 mb-4 border-b pb-3 app-page-header">
                    <div class="flex-1 min-w-0">
                        <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-people-group text-violet-600 mr-2"></i>Groups</h3>
                        <p class="text-xs text-gray-500">Make sets of groups for different activities. A student is in one group per set.</p>
                    </div>
                    <button id="closeGroupsBtn" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-500 sm:text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden" aria-hidden="true"></i><i class="fa-solid fa-xmark text-xl hidden sm:inline" aria-hidden="true"></i>
                    </button>
                </div>
                <div id="cgAlert" class="hidden mb-3 p-2 rounded text-xs font-bold"></div>
                <div class="overflow-auto flex-1 min-h-[200px]">
                    <div class="flex flex-wrap items-center gap-2 mb-1">
                        <select id="cgSetSelect" aria-label="Group set" class="px-3 py-2 border border-gray-300 rounded-md text-sm bg-gray-50 font-medium"></select>
                        <input type="text" id="cgSetName" maxlength="80" class="flex-1 min-w-[8rem] px-3 py-2 border border-gray-300 rounded-md text-sm bg-gray-50" placeholder="Set name" aria-label="Set name">
                        <button type="button" id="cgNewSetBtn" class="px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded text-xs font-bold">New set</button>
                        <button type="button" id="cgRenameSetBtn" class="hidden px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded text-xs font-bold">Rename</button>
                        <button type="button" id="cgDeleteSetBtn" class="hidden px-3 py-2 bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 rounded text-xs font-bold"><i class="fa-solid fa-trash"></i></button>
                    </div>
                    <p id="cgSetNote" class="text-[11px] text-gray-500 mb-3"></p>
                    <div class="flex flex-wrap items-center gap-2 mb-3 p-2 bg-gray-50 border border-gray-200 rounded">
                        <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Random split into</span>
                        <input type="number" id="cgSplitCount" min="1" value="4" class="w-16 px-2 py-1.5 border border-gray-300 rounded text-sm text-center" aria-label="Number of groups">
                        <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider">groups</span>
                        <button type="button" id="cgSplitBtn" class="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded text-xs font-bold"><i class="fa-solid fa-shuffle mr-1"></i>Split</button>
                        <button type="button" id="cgClearBtn" class="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded text-xs font-bold">Clear all</button>
                    </div>
                    <div id="cgGroups" class="mb-2"></div>
                    <button type="button" id="cgAddGroupBtn" class="mb-4 px-3 py-1.5 border border-violet-300 text-violet-700 hover:bg-violet-50 rounded text-xs font-bold"><i class="fa-solid fa-plus mr-1"></i>Add group</button>
                    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <span id="cgSummary" class="text-[10px] font-bold text-gray-500 uppercase tracking-wider"></span>
                        <label class="flex items-center gap-1 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Sort by
                            <select id="cgSort" class="px-2 py-1 border border-gray-300 rounded text-xs bg-gray-50 normal-case font-medium">
                                <option value="last">Last name</option>
                                <option value="given">Given name</option>
                                <option value="seat">Seat number</option>
                                <option value="number">Student number</option>
                                <option value="group">Group</option>
                            </select>
                        </label>
                    </div>
                    <div class="border border-gray-200 rounded-lg bg-white">
                        <table class="w-full text-xs text-left">
                            <thead class="bg-gray-200 text-gray-700"><tr><th class="px-3 py-2">Student</th><th class="px-3 py-2">Group</th></tr></thead>
                            <tbody id="cgStudents" class="divide-y divide-gray-200"></tbody>
                        </table>
                    </div>
                </div>
                <div class="mt-4">
                    <button type="button" id="cgSaveBtn" class="w-full bg-violet-700 hover:bg-violet-800 disabled:opacity-50 text-white px-4 py-2.5 rounded-md text-sm font-bold shadow-sm transition"><i class="fa-solid fa-floppy-disk mr-2"></i>Save Groups</button>
                </div>
            </div>
        </div>
    `,

    renderAttendanceDatesModal: () => `
        <div id="attendanceDatesModal" class="hidden fixed inset-0 z-[75] flex items-center justify-center fade-in p-0 sm:p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeAttendanceDatesBg"></div>
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full max-w-3xl h-full sm:h-auto p-4 sm:p-6 relative z-10 sheet-panel page-full app-page max-h-full sm:max-h-[95vh] flex flex-col">
                <div class="flex items-center gap-3 mb-4 border-b pb-3 app-page-header">
                    <div class="flex-1 min-w-0">
                        <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-calendar-check text-sky-600 mr-2"></i>Attendance Dates</h3>
                        <p class="text-xs text-gray-500">All dates with saved records. Change, delete, or merge two dates.</p>
                    </div>
                    <button id="closeAttendanceDatesBtn" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-500 sm:text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden" aria-hidden="true"></i><i class="fa-solid fa-xmark text-xl hidden sm:inline" aria-hidden="true"></i>
                    </button>
                </div>

                <div id="adAlert" class="hidden mb-3 p-2 rounded text-xs font-bold"></div>

                <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <span id="adSummary" class="text-[10px] font-bold text-gray-500 uppercase tracking-wider"></span>
                    <button type="button" id="adMergeBtn" disabled class="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded text-xs font-bold transition shadow-sm">
                        <i class="fa-solid fa-code-merge mr-1"></i> Merge Selected (select 2)
                    </button>
                </div>

                <div id="adList" class="flex-1 overflow-y-auto space-y-2 bg-gray-50 p-2 rounded border border-gray-200 min-h-[220px]"></div>

                <div id="adEditPanel" class="hidden mt-3 p-3 bg-sky-50 border border-sky-200 rounded-lg">
                    <div class="text-xs font-bold text-sky-900 mb-2">Change date of records from <span id="adEditLabel" class="font-black"></span></div>
                    <div class="flex flex-col sm:flex-row gap-2">
                        <input type="date" id="adEditDate" class="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm bg-white outline-none focus:ring-2 focus:ring-sky-500">
                        <button type="button" id="adEditSaveBtn" class="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-md text-sm font-bold transition">Save New Date</button>
                        <button type="button" id="adEditCancelBtn" class="px-4 py-2 bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 rounded-md text-sm font-bold transition">Cancel</button>
                    </div>
                </div>

                <div id="adMergePanel" class="hidden mt-3 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                    <div class="text-xs font-bold text-purple-900 mb-2">Choose the date to keep:</div>
                    <div id="adKeepOptions" class="space-y-1.5 mb-2"></div>
                    <p class="text-[11px] text-purple-800 mb-3">Participation points are added together. If a student has a different status on each date, the stricter one is kept (Absent &gt; Late &gt; Excused &gt; Present). The other date is removed.</p>
                    <div class="flex flex-col sm:flex-row gap-2">
                        <button type="button" id="adMergeConfirmBtn" class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm font-bold transition">Merge Records</button>
                        <button type="button" id="adMergeCancelBtn" class="px-4 py-2 bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 rounded-md text-sm font-bold transition">Cancel</button>
                    </div>
                </div>
            </div>
        </div>
    `,

    renderClassSummaryModal: () => `
        <div id="classSummaryModal" class="hidden fixed inset-0 z-[75] flex items-center justify-center fade-in p-0">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeClassSummaryBg"></div>
            <div class="bg-white rounded-none shadow-xl w-full h-full p-4 sm:p-6 relative z-10 sheet-panel app-page flex flex-col">
                <div class="flex items-center gap-3 mb-4 border-b pb-3 app-page-header">
                    <div class="flex-1 min-w-0">
                        <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-table-list text-purple-600 mr-2"></i>Class Summary</h3>
                        <div id="csCourseTitle" class="keep-sub text-xs font-bold text-blue-700 mt-0.5"></div>
                    </div>
                    <button id="closeClassSummaryBtn" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-500 sm:text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden" aria-hidden="true"></i><i class="fa-solid fa-xmark text-xl hidden sm:inline" aria-hidden="true"></i>
                    </button>
                </div>

                <div class="mb-3 flex flex-col md:flex-row gap-2">
                    <input type="text" id="csSearchInput" placeholder="Search name, student no., email, contact, group, topic, status..." class="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-gray-50">
                    <select id="csTermSelect" aria-label="Term" class="w-full md:w-44 px-2 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 bg-gray-50 font-medium">
                        <option value="midterm">Mid Term</option>
                        <option value="finalterm">Final Term</option>
                        <option value="all">Mid + Final Term</option>
                    </select>
                    <button type="button" id="csExportCsvBtn" disabled class="bg-green-700 hover:bg-green-800 disabled:opacity-50 text-white px-4 py-2 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center">
                        <i class="fa-solid fa-file-csv mr-2"></i> Export CSV
                    </button>
                    <button type="button" id="csExportGradeBtn" disabled class="bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white px-4 py-2 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center min-h-[44px]">
                        <i class="fa-solid fa-file-excel mr-2" aria-hidden="true"></i> <span id="csExportGradeLabel">Class Grade (.xlsx)</span>
                    </button>
                </div>

                <div id="csLoading" class="flex-1 flex flex-col min-h-0" role="status">
                    <p id="csLoadingText" aria-live="off" class="mb-2 text-xs font-bold text-gray-500 uppercase tracking-wider">Loading class list...</p>
                    ${Skeleton.summaryTable()}
                </div>
                <div id="csError" class="hidden text-center py-12 text-red-500 font-bold"></div>

                <div id="csContent" class="hidden flex-1 flex flex-col min-h-0">
                    <div id="csTermWarning" class="hidden mb-2 p-2 rounded text-xs font-bold bg-orange-100 text-orange-800 border border-orange-200">
                        Term dates are not set for the selected term. Set them in Course Actions to compute attendance.
                    </div>
                    <div id="csCount" class="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2"></div>
                    <div class="overflow-auto flex-1 border border-gray-200 rounded-lg bg-white">
                        <table class="w-full text-xs text-left min-w-[2000px]">
                            <thead class="text-gray-700 shadow-sm">
                                <tr>
                                    ${SUMMARY_COLUMNS.map(c => `<th class="sticky top-0 bg-gray-200 py-2 ${c.cls}">${c.label}</th>`).join('')}
                                </tr>
                            </thead>
                            <tbody id="csTableBody" class="divide-y divide-gray-200 bg-white"></tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    `,

    renderScoresModal: () => `
        <div id="scoresModal" class="hidden fixed inset-0 z-[75] flex items-center justify-center fade-in p-0 sm:p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeScoresModalBg"></div>
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full max-w-3xl h-full sm:h-auto p-4 sm:p-6 relative z-10 sheet-panel page-full app-page max-h-full sm:max-h-[95vh] flex flex-col">
                <div class="flex items-center gap-3 mb-4 border-b pb-3 app-page-header">
                    <h3 class="flex-1 min-w-0 text-lg font-bold text-gray-800"><i class="fa-solid fa-pen-to-square text-teal-600 mr-2"></i>Record Scores</h3>
                    <button id="closeScoresModalBtn" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-500 sm:text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden" aria-hidden="true"></i><i class="fa-solid fa-xmark text-xl hidden sm:inline" aria-hidden="true"></i>
                    </button>
                </div>

                <div id="scAlert" class="hidden mb-3 p-2 rounded text-xs font-bold"></div>

                <div class="mb-3">
                    <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Assessment</label>
                    <select id="scAssessmentSelect" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 bg-gray-50 font-medium"></select>
                </div>

                <div class="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3">
                    <div class="col-span-2">
                        <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Title</label>
                        <input type="text" id="scTitle" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50" placeholder="e.g. Quiz 1">
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Term</label>
                        <select id="scTerm" class="w-full px-2 py-2 border border-gray-300 rounded-md text-sm outline-none bg-gray-50">
                            <option value="MidTerm">Mid Term</option>
                            <option value="FinalTerm">Final Term</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Category</label>
                        <select id="scCategory" class="w-full px-2 py-2 border border-gray-300 rounded-md text-sm outline-none bg-gray-50">
                            <option value="Written">Written (Quiz/Long)</option>
                            <option value="Narrative">Written (Narrative)</option>
                            <option value="Individual">Written (Individual)</option>
                            <option value="Performance">Performance (Task)</option>
                            <option value="Report">Performance (Report)</option>
                            <option value="MajorExam">Major Exam</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Max Score</label>
                        <input type="number" step="any" min="0" id="scMax" class="w-full px-2 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 text-center font-mono" placeholder="20">
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Date</label>
                        <input type="date" id="scDate" class="w-full px-2 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50">
                    </div>
                </div>

                <div class="flex flex-wrap items-center gap-2 mb-2">
                    <label for="scGroupSet" class="text-[10px] font-bold text-gray-500 uppercase tracking-wider">One score per group</label>
                    <select id="scGroupSet" class="px-2 py-1.5 border border-gray-300 rounded-md text-xs bg-gray-50"><option value="">Off</option></select>
                    <span class="text-[10px] text-gray-500">A score typed for one member fills the whole group.</span>
                </div>
                <div id="scStudentCount" class="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2"></div>
                <p id="scExtraNote" class="hidden text-[11px] font-bold text-amber-700 mb-2"></p>
                <div class="overflow-auto flex-1 border border-gray-200 rounded-lg bg-white min-h-[200px]">
                    <table class="w-full text-xs text-left">
                        <thead class="bg-gray-200 text-gray-700 sticky top-0 shadow-sm z-10">
                            <tr>
                                <th class="px-3 py-2 text-center">#</th>
                                <th class="px-3 py-2 text-center">Seat</th>
                                <th class="px-3 py-2">Student</th>
                                <th class="px-3 py-2 text-center">Score</th>
                            </tr>
                        </thead>
                        <tbody id="scGridBody" class="divide-y divide-gray-200 bg-white"></tbody>
                    </table>
                </div>

                <div class="mt-4 flex gap-2">
                    <button type="button" id="scDeleteBtn" class="hidden px-4 py-2.5 bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 rounded-md text-sm font-bold transition">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                    <button type="button" id="scSaveBtn" class="flex-1 bg-teal-700 hover:bg-teal-800 text-white px-4 py-2.5 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center">
                        <i class="fa-solid fa-floppy-disk mr-2"></i> Save Assessment & Scores
                    </button>
                </div>
            </div>
        </div>
    `,

    renderNoClassModal: () => `
        <div id="noClassModal" class="hidden fixed inset-0 z-[70] flex items-center justify-center fade-in p-0 sm:p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeNoClassModalBg"></div>
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full sm:max-w-sm h-full sm:h-auto p-4 sm:p-6 relative z-10 sheet-panel app-page max-h-full sm:max-h-[90vh] flex flex-col">
                <div class="flex items-center gap-3 mb-4 border-b pb-3 app-page-header">
                    <h3 class="flex-1 min-w-0 text-lg font-bold text-gray-800"><i class="fa-solid fa-calendar-xmark text-orange-600 mr-2"></i>No Class Days</h3>
                    <button id="closeNoClassModalBtn" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-500 sm:text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden" aria-hidden="true"></i><i class="fa-solid fa-xmark text-xl hidden sm:inline" aria-hidden="true"></i>
                    </button>
                </div>

                <div class="flex gap-2 mb-4">
                    <input type="date" id="addNoClassDate" class="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50">
                    <button type="button" id="addNoClassBtn" class="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-md text-sm font-bold transition">Add</button>
                </div>

                <div id="noClassList" class="flex-1 overflow-y-auto space-y-2 bg-gray-50 p-2 rounded border border-gray-200 min-h-[150px] max-h-[300px]">
                </div>
            </div>
        </div>
    `,

    // Full-screen page on phones (centered dialog from 640px up).
    renderManageStudentModal: () => `
        <div id="manageStudentModal" class="hidden fixed inset-0 z-[70] flex items-center justify-center fade-in p-0 sm:p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeManageStudentModalBg"></div>
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full sm:max-w-md h-full sm:h-auto p-4 sm:p-6 relative z-10 sheet-panel app-page max-h-full sm:max-h-[92vh] overflow-y-auto">
                <div class="flex items-center gap-3 mb-4 border-b pb-3 app-page-header">
                    <h3 class="flex-1 min-w-0 truncate text-lg font-bold text-gray-800"><i class="fa-solid fa-user-gear text-blue-600 mr-2"></i>Manage Student</h3>
                    <button id="closeManageStudentModalBtn" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-500 sm:text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden" aria-hidden="true"></i><i class="fa-solid fa-xmark text-xl hidden sm:inline" aria-hidden="true"></i>
                    </button>
                </div>
                <div id="manageStudentName" class="font-black text-gray-800 text-center mb-4 text-base sm:text-lg"></div>
                <input type="hidden" id="manageStudentId">

                <div class="space-y-4">
                    <div class="grid grid-cols-3 gap-2">
                        <div>
                            <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Seat</label>
                            <input type="text" id="manageSeatInput" class="w-full px-2 py-2 text-xs border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition text-center">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Group</label>
                            <input type="text" id="manageGroupInput" class="w-full px-2 py-2 text-xs border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition text-center">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Topic</label>
                            <input type="text" id="manageTopicInput" class="w-full px-2 py-2 text-xs border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition text-center" placeholder="Assigned">
                        </div>
                    </div>

                    <div>
                        <div class="text-[10px] font-bold text-blue-700 uppercase tracking-wider mb-1"><i class="fa-solid fa-graduation-cap mr-1"></i>Program (assigned by lecturer)</div>
                        <div class="grid grid-cols-3 gap-2">
                        <div>
                            <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Course</label>
                            <input type="text" id="manageProgramCourseInput" class="w-full px-2 py-2 text-xs border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition text-center" placeholder="e.g. BSCS">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Year</label>
                            <input type="text" id="manageProgramYearInput" class="w-full px-2 py-2 text-xs border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition text-center" placeholder="e.g. 2">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Section</label>
                            <input type="text" id="manageProgramSectionInput" class="w-full px-2 py-2 text-xs border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition text-center" placeholder="e.g. A">
                        </div>
                        </div>
                    </div>

                    <div>
                        <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Eye Condition / Disability Tag</label>
                        <select id="manageEyeConditionSelect" class="w-full px-3 py-2 text-sm border border-gray-300 rounded outline-none font-bold bg-gray-50 cursor-pointer transition focus:ring-2 focus:ring-blue-500">
                            <option value="No Eye Condition">No Eye Condition</option>
                            <option value="Near Sighted">Near Sighted</option>
                            <option value="Far Sighted">Far Sighted</option>
                            <option value="Legally Blind">Legally Blind (Accessible Read-Aloud)</option>
                        </select>
                    </div>

                    <div>
                        <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Account Status</label>
                        <select id="manageStatusSelect" class="w-full px-3 py-2 text-sm border rounded outline-none font-medium cursor-pointer transition">
                            <option value="Active">Active</option>
                            <option value="Inactive">Inactive</option>
                            <option value="Suspended">Suspended</option>
                            <option value="UD">UD</option>
                            <option value="Dropped">Dropped</option>
                            <option value="Graduated">Graduated</option>
                        </select>
                    </div>

                    <button type="button" id="manageExamPhotosBtn" class="w-full py-2 border border-blue-300 text-blue-700 hover:bg-blue-50 rounded text-sm font-bold transition"><i class="fa-solid fa-camera mr-1.5" aria-hidden="true"></i>Review exam photos</button>
                    <button type="button" id="manageUploadDocBtn" class="w-full py-2 border border-blue-300 text-blue-700 hover:bg-blue-50 rounded text-sm font-bold transition"><i class="fa-solid fa-cloud-arrow-up mr-1.5" aria-hidden="true"></i>Upload document for student</button>

                    <details class="border border-gray-200 rounded-lg p-3 bg-gray-50/50" id="manageDetailsBox">
                        <summary class="text-xs font-bold text-gray-700 cursor-pointer select-none"><i class="fa-solid fa-id-card text-blue-600 mr-1"></i>Edit Student Details</summary>
                        <div class="space-y-3 mt-3">
                        <div>
                            <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Full Name</label>
                            <input type="text" id="manageNameInput" class="w-full px-2 py-2 text-xs border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition" placeholder="">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Student Number</label>
                            <input type="text" id="manageStudentNumberInput" class="w-full px-2 py-2 text-xs border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition" placeholder="00-0000">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Email</label>
                            <input type="text" id="manageEmailInput" class="w-full px-2 py-2 text-xs border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition" placeholder="">
                        </div>
                        <p id="manageResidence" class="text-xs text-gray-600"></p>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Contact Number</label>
                            <input type="text" id="manageContactInput" class="w-full px-2 py-2 text-xs border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition" placeholder="">
                        </div>

                            <button type="button" id="manageSaveDetailsBtn" class="w-full py-2 bg-blue-600 text-white hover:bg-blue-700 rounded text-sm font-bold transition focus:outline-none">
                                <i class="fa-solid fa-floppy-disk mr-2"></i> Save Details
                            </button>
                        </div>
                    </details>

                    <div class="border-t border-gray-200 pt-4 mt-4 flex flex-col space-y-2">
                        <button type="button" id="manageResetPwdBtn" class="w-full py-2 bg-red-50 text-red-600 hover:bg-red-100 rounded text-sm font-bold border border-red-200 transition focus:outline-none">
                            <i class="fa-solid fa-key mr-2"></i> Reset Password
                        </button>
                        <button type="button" id="manageRemoveBtn" class="w-full py-2 bg-white text-gray-500 hover:bg-red-600 hover:text-white rounded text-sm font-bold border border-gray-300 hover:border-red-600 transition focus:outline-none">
                            <i class="fa-solid fa-trash mr-2"></i> Remove from Course
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `,

    // Lecturer's view of one student's summary: full-screen page on phones.
    renderSummaryModal: () => `
        <div id="summaryModal" class="hidden fixed inset-0 z-[80] flex items-center justify-center fade-in p-0 sm:p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeSummaryModalBg"></div>
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full sm:max-w-2xl h-full sm:h-auto p-4 sm:p-6 relative z-10 sheet-panel page-full app-page max-h-full sm:max-h-[92vh] overflow-y-auto">
                <div class="flex items-center gap-3 mb-4 border-b pb-3 app-page-header">
                    <h3 class="flex-1 min-w-0 truncate text-lg font-bold text-gray-800"><i class="fa-solid fa-chart-pie text-purple-600 mr-2"></i>Performance Summary</h3>
                    <button id="closeSummaryModalBtn" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-500 sm:text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden" aria-hidden="true"></i><i class="fa-solid fa-xmark text-xl hidden sm:inline" aria-hidden="true"></i>
                    </button>
                </div>
                <div id="summaryStudentName" class="font-black text-gray-800 text-center mb-4 text-base sm:text-lg"></div>

                <div id="summaryLoading" class="text-center py-6 text-gray-500"><i class="fa-solid fa-spinner fa-spin text-2xl"></i></div>
                <div id="summaryError" class="hidden text-center py-6 text-red-500 font-bold"></div>

                <div id="summaryContent" class="hidden space-y-4">
                    <div class="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <h4 class="text-sm font-bold text-gray-800 mb-2 border-b pb-1 border-gray-200"><i class="fa-solid fa-star-half-stroke text-blue-500 mr-2"></i>Mid Term</h4>

                        <div class="space-y-2">
                            <div>
                                <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Written Output</span>
                                <div class="grid grid-cols-3 gap-2 mt-1 text-xs">
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-scores-trigger hover:border-blue-400 transition" data-term="midterm" data-category="Written" title="Click to view quizzes/long exam scores"><div class="text-gray-500 text-[9px] uppercase font-bold">Quizzes/Long</div><span class="font-black text-blue-600 text-base block mt-0.5" id="midtermWrittenScore">...</span></div>
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-scores-trigger hover:border-blue-400 transition" data-term="midterm" data-category="Narrative" title="Click to view narrative grades"><div class="text-gray-500 text-[9px] uppercase font-bold">Narrative</div><span class="font-black text-blue-600 text-base block mt-0.5" id="midtermNarrativeScore">...</span></div>
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-scores-trigger hover:border-blue-400 transition" data-term="midterm" data-category="Individual" title="Click to view individual grades"><div class="text-gray-500 text-[9px] uppercase font-bold">Individual</div><span class="font-black text-blue-600 text-base block mt-0.5" id="midtermIndividualScore">...</span></div>
                                </div>
                            </div>

                            <div>
                                <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Performance Output</span>
                                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1 text-xs">
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-scores-trigger hover:border-blue-400 transition" data-term="midterm" data-category="Report" title="Click to view report grades"><div class="text-gray-500 text-[9px] uppercase font-bold">Report</div><span class="font-black text-blue-600 text-base block mt-0.5" id="midtermReportScore">...</span></div>
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-scores-trigger hover:border-blue-400 transition" data-term="midterm" data-category="Performance" title="Click to view performance task scores"><div class="text-gray-500 text-[9px] uppercase font-bold">Tasks</div><span class="font-black text-blue-600 text-base block mt-0.5" id="midtermPerformanceTaskScore">...</span></div>
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-details-trigger hover:border-blue-400 transition" data-term="midterm" data-metric="participation" title="Click to view participation details">
                                        <div class="text-gray-500 text-[9px] uppercase font-bold">Participation</div>
                                        <span class="font-black text-blue-600 text-base block mt-0.5" id="midtermParticipationScore">...</span>
                                    </div>
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-details-trigger hover:border-blue-400 transition" data-term="midterm" data-metric="attendance" title="Click to view attendance details">
                                        <div class="text-gray-500 text-[9px] uppercase font-bold">Attendance</div>
                                        <span class="font-black text-blue-600 text-base block mt-0.5"><span id="midtermAttendancePct">...</span>%</span>
                                        <div class="text-[8px] text-gray-500 mt-0.5"><span id="midtermPresent">0</span>P, <span id="midtermLate">0</span>L, <span id="midtermExcused">0</span>E, <span id="midtermAbsent">0</span>A</div>
                                        <div class="text-[8px] text-gray-400 mt-0.5 font-bold">Class days: <span id="midtermTotalDays">0</span></div>
                                    </div>
                                </div>
                            </div>

                            <div class="bg-white p-2 border rounded flex justify-between items-center">
                                <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Major Exam</span>
                                <span class="font-black text-blue-600 text-sm cursor-pointer view-scores-trigger" data-term="midterm" data-category="MajorExam" title="Click to view major exam scores" id="midtermMajorExamScore">...</span>
                            </div>
                        </div>
                    </div>

                    <div class="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <h4 class="text-sm font-bold text-gray-800 mb-2 border-b pb-1 border-gray-200"><i class="fa-solid fa-star text-yellow-500 mr-2"></i>Final Term</h4>

                        <div class="space-y-2">
                            <div>
                                <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Written Output</span>
                                <div class="grid grid-cols-3 gap-2 mt-1 text-xs">
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-scores-trigger hover:border-yellow-400 transition" data-term="finalterm" data-category="Written" title="Click to view quizzes/long exam scores"><div class="text-gray-500 text-[9px] uppercase font-bold">Quizzes/Long</div><span class="font-black text-yellow-600 text-base block mt-0.5" id="finaltermWrittenScore">...</span></div>
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-scores-trigger hover:border-yellow-400 transition" data-term="finalterm" data-category="Narrative" title="Click to view narrative grades"><div class="text-gray-500 text-[9px] uppercase font-bold">Narrative</div><span class="font-black text-yellow-600 text-base block mt-0.5" id="finaltermNarrativeScore">...</span></div>
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-scores-trigger hover:border-yellow-400 transition" data-term="finalterm" data-category="Individual" title="Click to view individual grades"><div class="text-gray-500 text-[9px] uppercase font-bold">Individual</div><span class="font-black text-yellow-600 text-base block mt-0.5" id="finaltermIndividualScore">...</span></div>
                                </div>
                            </div>

                            <div>
                                <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Performance Output</span>
                                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1 text-xs">
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-scores-trigger hover:border-yellow-400 transition" data-term="finalterm" data-category="Report" title="Click to view report grades"><div class="text-gray-500 text-[9px] uppercase font-bold">Report</div><span class="font-black text-yellow-600 text-base block mt-0.5" id="finaltermReportScore">...</span></div>
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-scores-trigger hover:border-yellow-400 transition" data-term="finalterm" data-category="Performance" title="Click to view performance task scores"><div class="text-gray-500 text-[9px] uppercase font-bold">Tasks</div><span class="font-black text-yellow-600 text-base block mt-0.5" id="finaltermPerformanceTaskScore">...</span></div>
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-details-trigger hover:border-yellow-400 transition" data-term="finalterm" data-metric="participation" title="Click to view participation details">
                                        <div class="text-gray-500 text-[9px] uppercase font-bold">Participation</div>
                                        <span class="font-black text-yellow-600 text-base block mt-0.5" id="finaltermParticipationScore">...</span>
                                    </div>
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-details-trigger hover:border-yellow-400 transition" data-term="finalterm" data-metric="attendance" title="Click to view attendance details">
                                        <div class="text-gray-500 text-[9px] uppercase font-bold">Attendance</div>
                                        <span class="font-black text-yellow-600 text-base block mt-0.5"><span id="finaltermAttendancePct">...</span>%</span>
                                        <div class="text-[8px] text-gray-500 mt-0.5"><span id="finaltermPresent">0</span>P, <span id="finaltermLate">0</span>L, <span id="finaltermExcused">0</span>E, <span id="finaltermAbsent">0</span>A</div>
                                        <div class="text-[8px] text-gray-400 mt-0.5 font-bold">Class days: <span id="finaltermTotalDays">0</span></div>
                                    </div>
                                </div>
                            </div>

                            <div class="bg-white p-2 border rounded flex justify-between items-center">
                                <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Major Exam</span>
                                <span class="font-black text-yellow-600 text-sm cursor-pointer view-scores-trigger" data-term="finalterm" data-category="MajorExam" title="Click to view major exam scores" id="finaltermMajorExamScore">...</span>
                            </div>
                        </div>
                    </div>

                    <div class="mt-4 flex justify-center">
                        <button id="openHistoryModalBtn" class="w-full bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 font-bold py-2 px-4 rounded-lg shadow-sm transition flex items-center justify-center">
                            <i class="fa-solid fa-file-lines mr-2"></i> View Submission History
                        </button>
                    </div>
                </div>
            </div>
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
    `,

    renderEditSubmissionModal: () => `
        <div id="editSubmissionModal" class="hidden fixed inset-0 z-[120] flex items-center justify-center fade-in p-0 sm:p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeEditSubmissionBg"></div>
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full sm:max-w-md h-full sm:h-auto p-4 sm:p-6 relative z-10 sheet-panel app-page max-h-full sm:max-h-[92vh] overflow-y-auto">
                <div class="flex items-center gap-3 mb-4 border-b pb-3 app-page-header">
                    <h3 class="text-lg font-bold text-gray-800 flex-1 min-w-0"><i class="fa-solid fa-pen text-blue-600 mr-2"></i>Edit upload</h3>
                    <button id="closeEditSubmissionBtn" type="button" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden"></i><i class="fa-solid fa-xmark text-xl hidden sm:inline"></i>
                    </button>
                </div>
                <div id="seAlert" class="hidden mb-3 p-2 rounded text-xs font-bold bg-red-100 text-red-700"></div>
                <div class="space-y-4">
                    <div>
                        <label for="seTerm" class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Term</label>
                        <select id="seTerm" class="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-sm"><option value="MidTerm">Mid Term</option><option value="FinalTerm">Final Term</option></select>
                    </div>
                    <div>
                        <label for="seTitle" class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Title</label>
                        <input type="text" id="seTitle" maxlength="150" class="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-sm">
                    </div>
                    <div>
                        <label for="seDesc" class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Description</label>
                        <textarea id="seDesc" rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-sm"></textarea>
                    </div>
                    <p class="text-[10px] text-gray-500">The file itself is not changed. For a group upload, every member's copy is updated.</p>
                    <button type="button" id="seSaveBtn" class="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-md text-sm font-bold shadow-sm transition">Save</button>
                </div>
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

    // Full-screen page on phones: search box + long list need the space and the keyboard.
    renderAddStudentModal: () => `
        <div id="addStudentModal" class="hidden fixed inset-0 z-[60] flex items-center justify-center fade-in p-0 sm:p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm modal-backdrop" id="closeAddStudentModalBg"></div>
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full sm:max-w-3xl h-full sm:h-auto p-4 sm:p-6 relative z-10 sheet-panel page-full app-page max-h-full sm:max-h-[90vh] flex flex-col">
                <div class="flex items-center gap-3 mb-4 border-b pb-3 app-page-header">
                    <h3 class="flex-1 min-w-0 truncate text-lg font-bold text-gray-800"><i class="fa-solid fa-user-plus text-green-600 mr-2"></i>Manually Enroll Student</h3>
                    <button id="closeAddStudentModalBtn" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-500 sm:text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden" aria-hidden="true"></i><i class="fa-solid fa-xmark text-xl hidden sm:inline" aria-hidden="true"></i>
                    </button>
                </div>

                <div class="mb-4 flex flex-col md:flex-row gap-2">
                    <input type="text" id="studentSearchInput" placeholder="Search by Name or Student No..." class="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-gray-50">
                    <div class="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
                        <select id="filterStatus" class="w-full sm:w-32 px-2 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 bg-gray-50 font-medium">
                            <option value="Active">Active Only</option>
                            <option value="">All Statuses</option>
                            <option value="Inactive">Inactive</option>
                            <option value="Suspended">Suspended</option>
                            <option value="UD">UD</option>
                            <option value="Dropped">Dropped</option>
                            <option value="Graduated">Graduated</option>
                        </select>
                        <select id="enrollSort" aria-label="Sort students" class="w-full sm:w-40 px-2 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 bg-gray-50">
                            ${[['', 'Default order'], ['name', 'Sort: Name (A-Z)'], ['number', 'Sort: Student number']].map(([v, l]) => `<option value="${v}"${v === savedStudentSort() ? ' selected' : ''}>${l}</option>`).join('')}
                        </select>
                        <select id="filterCourse" class="w-full sm:w-32 px-2 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 bg-gray-50">
                            <option value="">Program (All)</option>
                        </select>
                        <div class="flex gap-2 w-full sm:w-auto">
                            <input type="text" id="filterYear" aria-label="Program year" placeholder="Prog. year" class="w-full sm:w-20 px-2 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 bg-gray-50">
                            <input type="text" id="filterSection" aria-label="Program section" placeholder="Prog. section" class="w-full sm:w-24 px-2 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 bg-gray-50">
                        </div>
                    </div>
                </div>

                <div id="unenrolledStudentsList" class="flex-1 min-h-0 overflow-y-auto space-y-2 sm:min-h-[300px] bg-gray-50 p-2 rounded border border-gray-200">
                    <div class="text-center py-10 text-gray-500 text-sm"><i class="fa-solid fa-spinner fa-spin text-2xl mb-2 text-blue-600"></i><br>Loading students...</div>
                </div>
            </div>
        </div>
    `,

    renderRecitationModal: () => `
        <div id="recitationModal" class="hidden fixed inset-0 z-[100] flex items-center justify-center fade-in p-4">
            <div id="recitationModalOverlay" class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm cursor-pointer"></div>
            <div id="recitationCard" class="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 relative z-10 scale-up flex flex-col items-center">
                <div id="recitationDragBar" title="Drag to move" class="w-full flex justify-between items-center mb-4 border-b pb-3 cursor-grab select-none" style="touch-action:none">
                    <h3 class="text-lg font-black text-gray-800"><i class="fa-solid fa-grip-vertical text-gray-300 mr-2" aria-hidden="true"></i><i class="fa-solid fa-bullhorn text-purple-600 mr-2"></i>Student Caller</h3>
                    <button id="closeRecitationModalBtn" aria-label="Close" class="w-11 h-11 -mr-2 text-gray-400 hover:text-gray-800 focus:outline-none transition-colors">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>

                <div class="w-full flex justify-between items-center mb-4">
                    <div class="flex space-x-3">
                        <label class="flex items-center space-x-1.5 text-xs font-bold text-gray-700 cursor-pointer">
                            <input type="radio" name="callerMode" value="1" checked class="form-radio text-purple-600 focus:ring-purple-500">
                            <span>Mode 1</span>
                        </label>
                        <label class="flex items-center space-x-1.5 text-xs font-bold text-gray-700 cursor-pointer">
                            <input type="radio" name="callerMode" value="2" class="form-radio text-purple-600 focus:ring-purple-500">
                            <span>Mode 2 (Unique)</span>
                        </label>
                    </div>
                    <button type="button" id="toggleCalledListBtn" class="hidden text-xs font-bold text-purple-600 hover:text-purple-800 underline focus:outline-none">
                        Called List
                    </button>
                </div>

                <div id="wheelContainer" class="w-full flex flex-col items-center">
                    <div id="wheelDial" class="relative w-64 h-64 mb-6">
                        <div id="wheelPointer" class="absolute top-[-15px] left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-[15px] border-l-transparent border-r-[15px] border-r-transparent border-t-[30px] border-t-red-600 z-20 filter drop-shadow-md"></div>
                        <div id="recitationWheel" class="w-full h-full rounded-full border-4 border-gray-700 shadow-inner overflow-hidden relative">
                        </div>
                        <div id="recitationResultAvatar" class="hidden absolute inset-0 z-10 rounded-full border-4 border-gray-700 bg-gray-100 overflow-hidden flex items-center justify-center shadow-inner"></div>
                    </div>
                </div>

                <button id="spinWheelBtn" class="w-full bg-purple-600 hover:bg-purple-700 text-white font-black py-3 rounded-lg shadow-md transition transform active:scale-95 focus:outline-none">
                    CALL STUDENT
                </button>

                <div id="recitationResult" class="w-full text-center bg-purple-50 p-5 mt-3 rounded-xl border border-purple-200">
                    <p class="text-xs font-bold text-purple-600 uppercase tracking-widest mb-2">Selected Student</p>
                    <div id="recitationBody" class="grid">
                    <div id="recitationSkeleton" class="col-start-1 row-start-1 animate-pulse flex flex-col items-center" aria-hidden="true">
                        <div class="h-8 w-3/4 bg-purple-200 rounded mb-4"></div>
                        <div class="h-11 w-40 bg-purple-100 rounded-lg mb-6"></div>
                        <div class="h-3 w-32 bg-purple-200 rounded mb-3"></div>
                        <div class="flex items-center gap-3 mb-3">
                            <div class="w-12 h-12 rounded-full bg-purple-100"></div>
                            <div class="w-24 h-12 rounded-lg bg-purple-100"></div>
                            <div class="w-12 h-12 rounded-full bg-purple-100"></div>
                        </div>
                        <div class="h-3 w-56 bg-purple-100 rounded"></div>
                    </div>
                    <div id="recitationDetails" class="col-start-1 row-start-1 invisible">
                    <h4 id="recitationResultName" class="text-2xl font-black text-gray-900 mb-4"></h4>

                    <div class="flex flex-col items-center mb-6 w-full px-4">
                        <div class="bg-purple-100 text-purple-800 px-4 py-2 rounded-lg border border-purple-200">
                            <span class="text-xs font-bold uppercase tracking-wider">Seat Number: </span>
                            <span id="recitationResultSeat" class="text-lg font-black ml-1"></span>
                        </div>
                    </div>

                    <div class="flex flex-col items-center mb-6 w-full px-4">
                        <label for="recitationPointsInput" class="text-xs font-bold text-purple-700 uppercase tracking-wider mb-1">Participation Points</label>
                        <div class="flex items-center justify-center gap-3">
                            <button type="button" id="recitationPointsMinus" aria-label="Subtract 1 point" class="w-12 h-12 flex items-center justify-center rounded-full bg-white border-2 border-purple-300 text-purple-700 text-2xl font-black leading-none hover:bg-purple-100 active:scale-95 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-40 disabled:cursor-not-allowed transition">&minus;</button>
                            <input id="recitationPointsInput" type="number" min="0" max="999" step="1" inputmode="numeric" placeholder="0" class="w-24 px-3 py-2 text-center text-2xl font-black text-gray-900 border-2 border-purple-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 disabled:bg-gray-100 disabled:text-gray-400 transition">
                            <button type="button" id="recitationPointsPlus" aria-label="Add 1 point" class="w-12 h-12 flex items-center justify-center rounded-full bg-purple-600 border-2 border-purple-600 text-white text-2xl font-black leading-none hover:bg-purple-700 active:scale-95 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed transition">+</button>
                        </div>
                        <p id="recitationPointsHint" class="text-[11px] text-purple-700 mt-1.5 leading-snug min-h-[30px]"></p>
                        <p id="recitationPointsStatus" role="status" aria-live="polite" class="text-[11px] font-bold mt-1 min-h-[16px]"></p>
                    </div>
                    </div>
                    </div>
                </div>
            </div>
        </div>

        <div id="calledListModal" class="hidden fixed inset-0 z-[110] flex items-center justify-center fade-in p-4" role="dialog" aria-modal="true" aria-labelledby="calledListTitle">
            <div id="calledListModalOverlay" class="absolute inset-0 bg-gray-900 bg-opacity-60 cursor-pointer"></div>
            <div class="bg-white rounded-xl shadow-2xl w-full max-w-md p-5 relative z-10 scale-up flex flex-col max-h-[85vh]">
                <div class="flex justify-between items-center mb-3 border-b pb-3">
                    <h3 id="calledListTitle" class="text-lg font-black text-gray-800"><i class="fa-solid fa-list-check text-purple-600 mr-2" aria-hidden="true"></i>Called Today <span id="calledListCount" class="text-sm font-bold text-gray-500"></span></h3>
                    <button type="button" id="closeCalledListBtn" aria-label="Close called list" class="text-gray-400 hover:text-gray-800 focus:outline-none transition-colors">
                        <i class="fa-solid fa-xmark text-xl" aria-hidden="true"></i>
                    </button>
                </div>
                <div id="calledStudentsListContent" class="space-y-1.5 overflow-y-auto min-h-[4rem] flex-1"></div>
                <div class="flex gap-2 mt-4 pt-3 border-t">
                    <button type="button" id="copyCalledListBtn" class="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 rounded-lg text-sm flex items-center justify-center gap-2"><i class="fa-regular fa-copy" aria-hidden="true"></i> Copy list</button>
                    <button type="button" id="resetCalledListBtn" class="px-4 border border-red-300 text-red-700 hover:bg-red-50 font-bold rounded-lg text-sm">Reset all</button>
                </div>
            </div>
        </div>
    `,

    // Short list: stays a bottom sheet, now the full width of the screen.
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
    `
};

// The chosen student sort (''=default, 'name', 'number') is remembered on this device.
// Each class remembers its own sort; a class never sorted yet uses the last one chosen anywhere.
const savedStudentSort = (courseId) => { try { return localStorage.getItem(`student_sort_${courseId}`) ?? localStorage.getItem('student_sort') ?? ''; } catch (e) { return ''; } };

export const ClassComponents = {
    renderClassScreen: (course, students) => {
        const eyeOrder = { 'Legally Blind': 0, 'Near Sighted': 1, 'No Eye Condition': 2, 'Far Sighted': 3 };

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

            const eyeA = eyeOrder[a.eye_condition] !== undefined ? eyeOrder[a.eye_condition] : 4;
            const eyeB = eyeOrder[b.eye_condition] !== undefined ? eyeOrder[b.eye_condition] : 4;
            if (eyeA !== eyeB) return eyeA - eyeB;

            const nameA = a.Name || '';
            const nameB = b.Name || '';
            return nameA.localeCompare(nameB);
        });

        // A name / student number order picked in the list header (kept on this device) replaces the default order.
        const sortMode = savedStudentSort(course.Course_ID);
        if (sortMode) {
            const col = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
            const keyOf = (s) => String(sortMode === 'number' ? s.Student_Number : s.Name || '').trim();
            students.sort((a, b) => {
                const ka = keyOf(a), kb = keyOf(b);
                if (!ka && kb) return 1;
                if (ka && !kb) return -1;
                return col.compare(ka, kb) || col.compare(String(a.Name || ''), String(b.Name || ''));
            });
        }

        const studentList = students.map((s, index) => {
            const avatarSrc = getLoadableAvatarSrc(s.Avatar);
            const displayProgram = `${s.Program_Course || ''} ${s.Program_Year || ''} ${s.Program_Section ? '- ' + s.Program_Section : ''}`.trim();

            const avatarImg = avatarSrc
                ? `<img src="${safeUrl(getLoadableAvatarSrc(s.Avatar, 128))}" loading="lazy" decoding="async" class="avatar-img w-10 h-10 sm:w-12 sm:h-12 rounded-full object-cover border border-gray-200 cursor-pointer view-avatar-btn hover:opacity-80 transition" data-src="${safeUrl(avatarSrc)}" data-name="${escapeHtml(s.Name)}" data-info="${escapeHtml(displayProgram)}" alt="${escapeHtml(s.Name)}">`
                : `<i class="fa-solid fa-circle-user text-[40px] sm:text-[48px] text-gray-300"></i>`;

            let eyeConditionBadge = '';
            if (s.eye_condition === 'Legally Blind') {
                eyeConditionBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300"><i class="fa-solid fa-universal-access mr-1"></i> Legally Blind</span>`;
            } else if (s.eye_condition) {
                eyeConditionBadge = `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-800 border border-purple-200"><i class="fa-regular fa-eye mr-1"></i> ${escapeHtml(s.eye_condition)}</span>`;
            }

            const groupDisplay = s.Group_Name
                ? `<span class="group-name-trigger text-blue-600 cursor-pointer hover:underline font-black" data-group="${escapeHtml(s.Group_Name)}" data-course-id="${course.Course_ID}">${escapeHtml(s.Group_Name)}</span>`
                : `<span class="text-gray-800">None</span>`;

            return `
                <div class="flex flex-col lg:flex-row items-start lg:items-center justify-between p-4 bg-white border-b border-gray-100 hover:bg-gray-50 transition student-row gap-4 lg:gap-2" data-student-id="${s.User_ID}"${isAutoAbsent(s.account_status) ? ' data-auto-absent="1"' : ''} data-search="${escapeHtml([s.Name, s.Student_Number, s.Seat_Number, s.Group_Name, s.Assigned_Topic].filter(Boolean).join(' ').toLowerCase())}" data-eye="${escapeHtml(s.eye_condition || '')}" data-group="${escapeHtml(s.Group_Name || '')}" data-seat="${escapeHtml(s.Seat_Number || '')}" data-name="${escapeHtml(s.Name || '')}" data-number="${escapeHtml(s.Student_Number || '')}">

                    <div class="flex items-start justify-between w-full lg:w-1/2">
                        <div class="flex items-center space-x-3 p-1.5 -ml-1.5 rounded-lg transition">
                            <input type="checkbox" class="roster-check hidden w-5 h-5 rounded text-blue-600 focus:ring-blue-500 shrink-0" aria-label="Select ${escapeHtml(s.Name)}">
                            <span class="text-xs font-bold text-gray-400 w-5 text-center">${index + 1}</span>
                            <div class="flex-shrink-0">
                                ${avatarImg}
                            </div>
                            <div>
                                <div class="font-bold text-blue-600 text-sm sm:text-base cursor-pointer view-summary-trigger hover:underline hover:text-blue-800 transition inline-block" data-name="${escapeHtml(s.Name)}" title="View Performance Summary">${escapeHtml(s.Name)}</div>
                                <div class="text-[11px] sm:text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-1">
                                    <span class="font-medium text-gray-700">${escapeHtml(s.Student_Number || 'N/A')}</span> ${eyeConditionBadge}
                                </div>
                                ${displayProgram ? `<div class="text-[11px] text-blue-700 font-medium mt-0.5"><i class="fa-solid fa-graduation-cap mr-1"></i>Program: ${escapeHtml(displayProgram)}</div>` : ''}
                                <div class="text-[10px] font-bold text-gray-500 mt-1 uppercase">
                                    Seat: <span class="text-gray-800">${escapeHtml(s.Seat_Number || '')}</span>${Number(s.Seat_Locked) === 1 && s.Seat_Number ? ' <i class="fa-solid fa-lock text-sky-600" title="Seat locked" aria-label="Seat locked"></i>' : ''}
                                    &nbsp;|&nbsp; Group: ${groupDisplay}
                                    &nbsp;|&nbsp; Topic: <span class="text-gray-800">${escapeHtml(s.Assigned_Topic || '')}</span>
                                </div>
                            </div>
                        </div>

                        <div class="lg:hidden flex items-center gap-1.5">
                            <button type="button" aria-label="Notes for ${escapeHtml(s.Name)}" class="student-notes-btn min-w-[44px] min-h-[40px] px-2 py-1 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded text-xs font-bold border border-amber-200 transition" data-student-id="${s.User_ID}" data-name="${escapeHtml(s.Name)}"><i class="fa-solid fa-note-sticky" aria-hidden="true"></i></button>
                            <button type="button" aria-label="Manage ${escapeHtml(s.Name)}" class="manage-student-btn min-w-[44px] min-h-[40px] px-2 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800 rounded text-xs font-bold border border-blue-200 transition shadow-sm"
                                data-student-id="${s.User_ID}"
                                data-name="${escapeHtml(s.Name)}"
                                data-seat="${escapeHtml(s.Seat_Number || '')}"
                                data-group="${escapeHtml(s.Group_Name || '')}"
                                data-topic="${escapeHtml(s.Assigned_Topic || '')}"
                                data-eye="${escapeHtml(s.eye_condition || 'No Eye Condition')}"
                                data-status="${s.account_status || 'Inactive'}">
                                <i class="fa-solid fa-gear"></i>
                            </button>
                        </div>
                    </div>

                    <div class="hidden lg:flex items-center justify-center gap-2 w-auto px-2">
                        <button type="button" aria-label="Notes for ${escapeHtml(s.Name)}" class="student-notes-btn px-3 py-1.5 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded text-xs font-bold border border-amber-200 transition flex items-center" data-student-id="${s.User_ID}" data-name="${escapeHtml(s.Name)}"><i class="fa-solid fa-note-sticky mr-1" aria-hidden="true"></i> Notes</button>
                        <button type="button" aria-label="Manage ${escapeHtml(s.Name)}" class="manage-student-btn px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800 rounded text-xs font-bold border border-blue-200 transition flex items-center shadow-sm"
                            data-student-id="${s.User_ID}"
                            data-name="${escapeHtml(s.Name)}"
                            data-seat="${escapeHtml(s.Seat_Number || '')}"
                            data-group="${escapeHtml(s.Group_Name || '')}"
                            data-topic="${escapeHtml(s.Assigned_Topic || '')}"
                            data-eye="${escapeHtml(s.eye_condition || 'No Eye Condition')}"
                            data-status="${s.account_status || 'Inactive'}">
                            <i class="fa-solid fa-gear mr-1"></i> Manage
                        </button>
                    </div>

                    <div class="row-points-area flex items-end justify-between lg:justify-end w-full lg:w-auto space-x-2 border-t lg:border-t-0 border-gray-100 pt-3 lg:pt-0 mt-1 lg:mt-0 overflow-x-auto lg:overflow-visible lg:flex-shrink-0">
                        <div class="flex items-center lg:items-start lg:flex-col gap-2 lg:gap-0">
                            <label class="block text-[9px] font-bold text-gray-500 uppercase tracking-wider lg:mb-0.5 text-center">Pts</label>
                            <div class="flex items-center gap-1">
                                <button type="button" class="pts-step w-9 h-9 flex items-center justify-center rounded-lg bg-white border border-gray-300 text-gray-700 text-lg font-black leading-none hover:bg-gray-100 active:scale-95 focus:outline-none focus:ring-2 focus:ring-blue-500 transition" data-step="-1" aria-label="Subtract 1 participation point for ${escapeHtml(s.Name)}">&minus;</button>
                                <input type="number" min="0" max="999" placeholder="0" aria-label="Participation points for ${escapeHtml(s.Name)}" class="points-input w-12 px-1 py-1.5 text-sm border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500 outline-none text-center bg-gray-50 focus:bg-white transition font-mono font-bold" value="0">
                                <button type="button" class="pts-step w-9 h-9 flex items-center justify-center rounded-lg bg-blue-600 border border-blue-600 text-white text-lg font-black leading-none hover:bg-blue-700 active:scale-95 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 transition" data-step="1" aria-label="Add 1 participation point for ${escapeHtml(s.Name)}">+</button>
                                <span class="row-status-note"></span>
                            </div>
                        </div>
                        <div class="status-btn-group flex space-x-1 flex-1 lg:flex-initial justify-end items-center min-w-max">
                            <button type="button" data-status="Present" data-selected="true" class="attendance-btn flex-1 lg:flex-initial px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold border border-green-400 text-green-800 bg-green-100 hover:bg-green-50 hover:text-green-700 transition text-center">
                                Present
                            </button>
                            <button type="button" data-status="Late" class="attendance-btn flex-1 lg:flex-initial px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold border border-gray-200 text-gray-600 bg-gray-50 hover:bg-yellow-50 hover:text-yellow-700 transition text-center">
                                Late
                            </button>
                            <button type="button" data-status="Excused" class="attendance-btn flex-1 lg:flex-initial px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold border border-gray-200 text-gray-600 bg-gray-50 hover:bg-purple-50 hover:text-purple-700 transition text-center">
                                Excused
                            </button>
                            <button type="button" data-status="Absent" class="attendance-btn flex-1 lg:flex-initial px-2 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-bold border border-gray-200 text-gray-600 bg-gray-50 hover:bg-red-50 hover:text-red-700 transition text-center">
                                Absent
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        const emptyState = `<div class="p-8 text-center text-gray-500 bg-white rounded-b-xl">
            <div class="mx-auto mb-3 w-14 h-14 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-2xl"><i class="fa-solid fa-user-plus" aria-hidden="true"></i></div>
            <p class="font-bold text-gray-700">No students enrolled yet</p>
            <p class="text-sm mt-1 mb-4">Add students to start taking attendance, scanning and grading.</p>
            <button type="button" class="open-add-student bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-4 py-2 rounded-md shadow-sm">Add students</button>
        </div>`;

        return `
            <header class="bg-blue-700 shadow-md fixed top-0 w-full z-40">
                <div class="w-full mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl">
                    <div class="flex items-center h-16">
                        <a href="#dashboard" class="text-white hover:text-blue-200 transition mr-2 sm:mr-4 p-2 -ml-2">
                            <i class="fa-solid fa-arrow-left text-xl"></i>
                        </a>
                        <div class="overflow-hidden">
                            <h1 class="text-base sm:text-lg font-bold text-white truncate">${escapeHtml(course.CourseCode)}</h1>
                            <p class="text-[11px] sm:text-xs text-blue-200 truncate">${escapeHtml(course.CourseTitle)}${(course.Target_Course || course.Target_Year || course.Target_Section) ? ' &bull; ' + escapeHtml([course.Target_Course, [course.Target_Year, course.Target_Section].filter(Boolean).join('-')].filter(Boolean).join(' ')) : ''}</p>
                            ${(course.AcademicYear || course.Semester) ? `<p class="text-[10px] text-blue-100 truncate">${escapeHtml([course.AcademicYear && 'AY ' + course.AcademicYear, course.Semester].filter(Boolean).join(' · '))}</p>` : ''}
                        </div>
                        <div class="ml-auto pl-2 flex flex-col items-end text-[10px] sm:text-xs text-blue-100 leading-tight min-w-0 flex-shrink-0 max-w-[55%]">
                            <span class="truncate max-w-full"><i class="fa-regular fa-clock mr-1" aria-hidden="true"></i>${escapeHtml(course.ScheduleDay)} | ${escapeHtml(course.TimePeriod)}</span>
                            <span class="flex items-center max-w-full min-w-0">
                                <i class="fa-solid fa-door-open mr-1" aria-hidden="true"></i><span id="classRoomText" class="truncate" data-room="${escapeHtml(course.Room || '')}">${course.Room ? escapeHtml(course.Room) : '<span class="italic text-blue-200">No room</span>'}</span>
                                <button type="button" id="editRoomBtn" data-course-id="${escapeHtml(course.Course_ID)}" data-code="${escapeHtml(course.CourseCode || '')}" data-title="${escapeHtml(course.CourseTitle || '')}" data-day="${escapeHtml(course.ScheduleDay || '')}" data-time="${escapeHtml(course.TimePeriod || '')}" data-room="${escapeHtml(course.Room || '')}" data-target-course="${escapeHtml(course.Target_Course || '')}" data-target-year="${escapeHtml(course.Target_Year || '')}" data-target-section="${escapeHtml(course.Target_Section || '')}" data-academic-year="${escapeHtml(course.AcademicYear || '')}" data-semester="${escapeHtml(course.Semester || '')}" class="ml-1 w-7 h-7 inline-flex items-center justify-center rounded-md text-white hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-white flex-shrink-0" aria-label="Edit class details" title="Edit class details"><i class="fa-solid fa-pen text-[11px]" aria-hidden="true"></i></button>
                            </span>
                        </div>
                    </div>
                </div>
            </header>

            <main class="pt-20 pb-36 sm:pb-28 px-2 sm:px-6 lg:px-8 max-w-6xl mx-auto w-full fade-in relative">
                <div id="attendanceBar" data-dirty="false" class="sticky top-16 z-30 mb-4 px-2 sm:px-3 py-2 bg-gray-50/95 backdrop-blur border border-gray-200 rounded-lg shadow-sm">
                    <div class="flex flex-wrap items-center gap-2">
                        <input type="date" id="attendanceDate" aria-label="Attendance date" data-schedule-day="${escapeHtml(course.ScheduleDay || '')}" class="flex-1 min-w-0 sm:flex-none sm:min-w-[9.5rem] px-2 sm:px-3 py-2 border border-gray-300 rounded-md text-sm bg-white font-medium focus:ring-2 focus:ring-blue-500 outline-none" value="${getLocalDateString()}">
                        <button type="button" id="attendanceFloorBtn" aria-label="Floor plan view" title="Floor plan view" class="flex-shrink-0 w-11 h-11 inline-flex items-center justify-center rounded-md border border-gray-300 bg-white text-sky-700 hover:bg-sky-50"><i class="fa-solid fa-table-cells" aria-hidden="true"></i></button>
                        <button type="button" id="classModeBtn" class="cm-toggle flex-shrink-0 w-11 h-11 inline-flex items-center justify-center rounded-md border border-gray-300 bg-white text-indigo-700" aria-label="Class mode" aria-pressed="false"><i class="fa-solid fa-school" aria-hidden="true"></i></button>
                        <button type="button" id="attendanceMoreBtn" aria-label="Sort, filter and select students" aria-expanded="false" aria-controls="attendanceBarTools" class="sm:hidden flex-shrink-0 w-10 h-10 inline-flex items-center justify-center border border-gray-300 rounded-md bg-white text-gray-700 hover:bg-gray-50 transition"><i class="fa-solid fa-ellipsis-vertical" aria-hidden="true"></i></button>
                        <div id="attendanceBarTools" class="hidden sm:flex items-center gap-2 w-full sm:w-auto order-last sm:order-none">
                        <select id="rosterSort" aria-label="Sort students" class="min-w-0 flex-1 sm:flex-none px-2 py-2 border border-gray-300 rounded-md text-xs font-bold bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                            ${[['', 'Default order'], ['name', 'Sort: Name (A-Z)'], ['number', 'Sort: Student number']].map(([v, l]) => `<option value="${v}"${v === savedStudentSort(course.Course_ID) ? ' selected' : ''}>${l}</option>`).join('')}
                        </select>
                        <select id="rosterFilter" aria-label="Show" class="min-w-0 flex-1 sm:flex-none px-2 py-2 border border-gray-300 rounded-md text-xs font-bold bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                            <option value="all">All students</option>
                            <option value="blind">Legally Blind</option>
                            <option value="notpresent">Not present today</option>
                            <option value="noseat">No seat yet</option>
                            ${[...new Set(students.map(s => s.Group_Name).filter(Boolean))].sort().map(g => `<option value="group:${escapeHtml(g)}">Group: ${escapeHtml(g)}</option>`).join('')}
                        </select>
                        <button type="button" id="rosterSelectToggle" aria-pressed="false" class="flex-shrink-0 px-3 py-2 border border-gray-300 rounded-md text-xs font-bold bg-white hover:bg-gray-50 text-gray-700 transition"><i class="fa-regular fa-square-check mr-1" aria-hidden="true"></i>Select</button>
                        </div>
                        <span id="attendanceDirtyLabel" class="hidden absolute right-2 -bottom-2.5 px-1.5 rounded-full bg-orange-50 border border-orange-200 text-[10px] font-bold text-orange-600 whitespace-nowrap"><i class="fa-solid fa-circle text-[6px] align-middle mr-1"></i>Unsaved changes</span>
                        <span id="attendanceDirtyStatus" class="sr-only" role="status"></span>
                        <div class="relative flex-shrink-0 sm:ml-0">
                            <button id="saveAttendanceBtn" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center whitespace-nowrap">
                                <i class="fa-solid fa-floppy-disk sm:mr-2"></i><span class="ml-1 sm:ml-0">Save<span class="hidden sm:inline"> All</span></span>
                            </button>
                            <span id="attendanceDirtyDot" title="Unsaved changes" aria-hidden="true" class="hidden absolute -top-1 -right-1 w-3 h-3 rounded-full bg-orange-400 border-2 border-white pointer-events-none"></span>
                        </div>
                        <button id="openCourseMenuBtn" aria-label="Menu" class="tabbar-hide flex-shrink-0 bg-gray-800 hover:bg-gray-900 text-white px-3 sm:px-4 py-2 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center">
                            <i class="fa-solid fa-bars sm:mr-2"></i><span class="hidden sm:inline">Menu</span>
                        </button>
                    </div>
                </div>

                <div id="noClassBanner" class="hidden mb-4 mx-2 sm:mx-0 p-3 rounded-md text-sm font-bold bg-orange-100 text-orange-800 border border-orange-200 uppercase tracking-wider flex items-center justify-center">
                    <i class="fa-solid fa-triangle-exclamation mr-2 text-lg"></i> This date is marked as No Class
                </div>
                <div id="attendanceAlert" class="hidden mb-4 mx-2 sm:mx-0 p-3 rounded-md text-sm font-medium"></div>
                <div id="pendingSyncBanner" class="hidden mb-4 mx-2 sm:mx-0 p-3 rounded-md text-sm font-medium bg-amber-50 text-amber-900 border border-amber-200" role="status" aria-live="polite"></div>

                <div class="bg-white shadow-sm rounded-xl border border-gray-200 overflow-hidden mx-0 sm:mx-0">
                    <div class="bg-gray-50 px-4 py-1.5 border-b border-gray-200 flex justify-between items-center">
                        <div class="w-full grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
                            <button type="button" id="rosterTopic" class="pd-open min-w-0 min-h-[32px] text-left text-xs sm:text-sm font-bold text-emerald-700 truncate" aria-label="Topic of the day. Tap to change"><i class="fa-solid fa-link mr-1" aria-hidden="true"></i><span>Topic of the day</span></button>
                            <button type="button" id="toggleStatusButtons" aria-controls="rosterListContainer" aria-expanded="${isStatusCollapsed() ? 'false' : 'true'}" class="text-[10px] sm:text-xs font-bold text-gray-600 hover:text-gray-900 underline min-h-[32px]">
                                <i class="fa-solid ${isStatusCollapsed() ? 'fa-chevron-down' : 'fa-chevron-up'} mr-1" aria-hidden="true"></i><span>${isStatusCollapsed() ? 'Expand Status' : 'Collapse Status'}</span>
                            </button>
                            <span class="flex items-baseline gap-2 min-w-0"><span class="text-[10px] sm:text-xs font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">${students.length} Enrolled</span><span id="rosterCounts" class="flex gap-x-2 text-sm font-black text-gray-800" role="status" aria-label="Attendance count for the date"></span><span id="cmProofSlot" class="flex items-center gap-1"></span></span>
                            <button type="button" id="markAllPresent" class="text-[10px] sm:text-xs font-bold text-green-700 hover:text-green-900 underline min-h-[32px]">Mark All Present</button>
                        </div>
                    </div>
                    ${students.length > 1 ? `
                    <div id="rosterTools" class="px-3 py-2 border-b border-gray-200 bg-white flex flex-wrap items-center gap-2">
                        <div class="relative flex-1 min-w-[10rem]">
                            <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs" aria-hidden="true"></i>
                            <input type="search" id="rosterSearch" placeholder="Search name, number, seat, group..." aria-label="Search the class roster" class="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                        </div>
                        <span id="rosterCount" class="w-full sm:w-auto text-[11px] font-bold text-gray-500" role="status" aria-live="polite"></span>
                    </div>
                    <div id="rosterBulkBar" class="hidden sticky top-[7.25rem] z-20 px-3 py-2 border-b border-blue-200 bg-blue-50/95 backdrop-blur" role="region" aria-label="Actions for selected students">
                        <div class="flex flex-wrap items-center gap-2">
                            <span id="rosterSelCount" class="text-xs font-black text-blue-900 mr-1" role="status" aria-live="polite">0 selected</span>
                            <button type="button" id="rosterSelectShown" class="text-[11px] font-bold text-blue-700 underline">Select all shown</button>
                            <button type="button" id="rosterClearSel" class="text-[11px] font-bold text-gray-600 underline">Clear</button>
                            <span class="hidden sm:inline text-gray-300">|</span>
                            <div class="flex flex-wrap gap-1" role="group" aria-label="Set attendance for selected">
                                <button type="button" data-bulk-status="Present" class="roster-bulk px-2.5 py-1.5 rounded-md text-[11px] font-bold border border-green-400 bg-green-100 text-green-800">Present</button>
                                <button type="button" data-bulk-status="Late" class="roster-bulk px-2.5 py-1.5 rounded-md text-[11px] font-bold border border-yellow-400 bg-yellow-100 text-yellow-800">Late</button>
                                <button type="button" data-bulk-status="Excused" class="roster-bulk px-2.5 py-1.5 rounded-md text-[11px] font-bold border border-purple-300 bg-purple-100 text-purple-800">Excused</button>
                                <button type="button" data-bulk-status="Absent" class="roster-bulk px-2.5 py-1.5 rounded-md text-[11px] font-bold border border-red-300 bg-red-100 text-red-800">Absent</button>
                            </div>
                            <button type="button" id="rosterExamToggle" aria-expanded="false" aria-controls="rosterExamPanel" class="roster-bulk ml-auto px-2.5 py-1.5 rounded-md text-[11px] font-bold border border-indigo-300 bg-indigo-100 text-indigo-800"><i class="fa-solid fa-universal-access mr-1" aria-hidden="true"></i>Exam access</button>
                        </div>
                        <div id="rosterExamPanel" class="hidden mt-2 p-2 bg-white border border-indigo-200 rounded-md flex flex-wrap items-center gap-2">
                            <select id="rosterExamSelect" aria-label="Exam" class="flex-1 min-w-[10rem] px-2 py-1.5 border border-gray-300 rounded text-xs font-bold bg-white"></select>
                            <button type="button" id="rosterExamEnable" class="px-3 py-1.5 rounded-md text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700">Enable for selected</button>
                            <button type="button" id="rosterExamDisable" class="px-3 py-1.5 rounded-md text-xs font-bold bg-white text-gray-700 border border-gray-300 hover:bg-gray-50">Disable for selected</button>
                            <span id="rosterExamNote" class="w-full text-[11px] text-gray-500">Only exams already linked to this class are listed.</span>
                        </div>
                    </div>
                    <div id="rosterNoMatch" class="hidden p-8 text-center text-sm text-gray-500 bg-white">No student matches. Clear the search or change the filter.</div>` : ''}
                    <style>
                        /* Collapsed: all status buttons are hidden so the list stays short. */
                        #rosterListContainer.status-collapsed .status-btn-group { display: none; }
                        /* Collapsed: the points controls take over the freed space, centred on phones and at the right on wide screens. */
                        #rosterListContainer.status-collapsed .row-points-area { justify-content: center; padding-top: .5rem; }
                        @media (min-width: 1024px) { #rosterListContainer.status-collapsed .row-points-area { justify-content: flex-end; padding-top: 0; } }
                        #rosterListContainer.status-collapsed .row-points-area .pts-step { width: 2.75rem; height: 2.75rem; font-size: 1.5rem; }
                        #rosterListContainer.status-collapsed .row-points-area .points-input { width: 4rem; font-size: 1.25rem; padding: .5rem .25rem; }
                        /* Absent and Excused students cannot be given points. */
                        .student-row:has(.attendance-btn[data-selected="true"][data-status="Absent"]) .pts-step,
                        .student-row:has(.attendance-btn[data-selected="true"][data-status="Excused"]) .pts-step { opacity: .35; cursor: not-allowed; }
                        /* While collapsed, a short note still shows when a student is not simply Present. */
                        .row-status-note { display: none; }
                        #rosterListContainer.status-collapsed .row-status-note { display: inline; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; margin-left: .25rem; }
                        #rosterListContainer.status-collapsed .student-row:has(.attendance-btn[data-selected="true"][data-status="Late"]) .row-status-note::after { content: "Late"; color: #a16207; }
                        #rosterListContainer.status-collapsed .student-row:has(.attendance-btn[data-selected="true"][data-status="Excused"]) .row-status-note::after { content: "Excused"; color: #7e22ce; }
                        #rosterListContainer.status-collapsed .student-row:has(.attendance-btn[data-selected="true"][data-status="Absent"]) .row-status-note::after { content: "Absent"; color: #b91c1c; }
                    </style>
                    <div id="rosterListContainer" class="${isStatusCollapsed() ? 'status-collapsed' : ''}">
                        ${students.length > 0 ? studentList : emptyState}
                    </div>
                </div>

<div id="classFab" class="fixed bottom-6 right-6 z-50 flex flex-col items-center gap-3" style="transition: opacity 0.3s;">
                    <button type="button" id="openRecitationBtn" aria-label="Student Caller" title="Student Caller" class="w-14 h-14 bg-purple-600 hover:bg-purple-700 text-white rounded-full shadow-lg flex items-center justify-center focus:outline-none focus-visible:ring-4 ring-purple-300 transition">
                        <i class="fa-solid fa-bullhorn text-2xl" aria-hidden="true"></i>
                    </button>
                </div>

            </main>

            <!-- Outside <main> so it stays usable (not inert) while a full-screen page is open -->
            <nav id="classTabBar" class="class-tabbar" aria-label="Class sections">
                    <button type="button" class="class-tab is-active" aria-current="page" data-tab-target="top" aria-label="Roster"><i class="fa-solid fa-users" aria-hidden="true"></i><span>Roster</span></button>
                    <button type="button" class="class-tab" data-tab-target="openScoresModalBtn" aria-label="Scores"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i><span>Scores</span></button>
                    <button type="button" class="class-tab" data-tab-target="openScannerBtn" aria-label="Scan"><i class="fa-solid fa-camera" aria-hidden="true"></i><span>Scan</span></button>
                    <button type="button" class="class-tab" data-tab-target="openExamManagerBtn" aria-label="Exams"><i class="fa-solid fa-file-contract" aria-hidden="true"></i><span>Exams</span></button>
                    <button type="button" class="class-tab" data-tab-target="openCourseMenuBtn" aria-label="More"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i><span>More</span></button>
            </nav>

            ${ClassUI.renderCourseMenuModal(course)}
            ${ClassUI.renderClassSummaryModal()}
            ${ClassUI.renderScoresModal()}
            ${ClassUI.renderAttendanceDatesModal()}
            ${ClassUI.renderGroupsModal()}
            ${ClassUI.renderSeatPlanModal()}
            ${ClassUI.renderNoClassModal()}
            ${ClassUI.renderManageStudentModal()}
            ${ClassUI.renderSummaryModal()}
            ${ClassUI.renderSubmissionHistoryModal()}
            ${ClassUI.renderEditSubmissionModal()}
            ${ClassUI.renderDetailsModal()}
            ${ClassUI.renderAddStudentModal()}
            ${ClassUI.renderRecitationModal()}
            ${ClassUI.renderGroupMembersModal()}
            ${renderSubmitDocumentModal()}
            ${ExamUI.renderManagerModal()}
            ${ScannerUI.renderScannerModal()}
            ${ExamUI.renderPresentationOverlay()}
            ${ExamUI.renderAccessibleExamOverlay ? ExamUI.renderAccessibleExamOverlay() : ''}
        `;
    }
};
