// js/components-class.js
import { getLoadableAvatarSrc } from './components-utils.js';
import { ExamUI } from './components-exam.js';
import { Skeleton } from './skeletons.js';
import { getLocalDateString } from './date-utils.js';
import { escapeHtml, safeUrl } from './html-utils.js';

// Class summary columns. The first two are pinned while scrolling sideways
// (on phones only the Student column is pinned, to leave room to scroll).
const SUMMARY_COLUMNS = [
    { label: '#',             cls: 'px-1 w-12 min-w-[3rem] text-center sm:left-0 z-30' },
    { label: 'Student',       cls: 'px-3 min-w-[220px] left-0 sm:left-12 z-30 pin-edge' },
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
        <div id="courseMenuModal" class="hidden fixed inset-0 z-[60] flex items-end sm:items-center justify-center fade-in p-0 sm:p-4">
            <div id="closeCourseMenuBg" class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm"></div>
            <div class="bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full max-w-sm p-4 sm:p-6 relative z-10 sheet-panel max-h-[90vh] overflow-y-auto">
                <div class="sm:hidden mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300" aria-hidden="true"></div>
                <div class="flex justify-between items-center mb-5 border-b pb-3">
                    <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-layer-group text-blue-600 mr-2"></i>Course Actions</h3>
                    <button id="closeCourseMenuBtn" class="text-gray-400 hover:text-gray-800 focus:outline-none transition-colors">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>

                <div class="space-y-3 mb-6">
                    <button id="openAddStudentModalBtn" class="w-full bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center">
                        <i class="fa-solid fa-user-plus mr-2"></i> Enroll Student
                    </button>
                    <button id="copyEmailsBtn" class="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center">
                        <i class="fa-regular fa-copy mr-2"></i> Copy Student Emails
                    </button>
                    <button id="exportRosterBtn" data-course-id="${course.Course_ID}" class="w-full bg-gray-800 hover:bg-gray-900 text-white px-4 py-2.5 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center">
                        <i class="fa-solid fa-print mr-2"></i> Print Roster
                    </button>
                    <button id="openClassSummaryBtn" class="w-full bg-purple-600 hover:bg-purple-700 text-white px-4 py-2.5 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center">
                        <i class="fa-solid fa-table-list mr-2"></i> Class Summary
                    </button>
                    <button id="openScoresModalBtn" class="w-full bg-teal-600 hover:bg-teal-700 text-white px-4 py-2.5 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center">
                        <i class="fa-solid fa-pen-to-square mr-2"></i> Record Scores
                    </button>
                    <button id="openAttendanceDatesBtn" class="w-full bg-sky-600 hover:bg-sky-700 text-white px-4 py-2.5 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center">
                        <i class="fa-solid fa-calendar-check mr-2"></i> Attendance Dates
                    </button>
                    <button id="openNoClassModalBtn" class="w-full bg-orange-600 hover:bg-orange-700 text-white px-4 py-2.5 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center">
                        <i class="fa-solid fa-calendar-xmark mr-2"></i> Manage No Class Days
                    </button>
                    <button id="openExamManagerBtn" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center">
                        <i class="fa-solid fa-file-contract mr-2"></i> Manage Exams
                    </button>
                </div>

                <div class="border-t border-gray-200 pt-5">
                    <h4 class="text-sm font-bold text-gray-800 mb-3"><i class="fa-regular fa-calendar-days text-purple-600 mr-2"></i>Term Period Settings</h4>
                    <div id="courseMenuAlert" class="hidden text-xs mb-3 p-2 rounded"></div>

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
                </div>
            </div>
        </div>
    `,

    renderAttendanceDatesModal: () => `
        <div id="attendanceDatesModal" class="hidden fixed inset-0 z-[75] flex items-center justify-center fade-in p-0 sm:p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeAttendanceDatesBg"></div>
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full max-w-3xl h-full sm:h-auto p-4 sm:p-6 relative z-10 sheet-panel max-h-full sm:max-h-[95vh] flex flex-col">
                <div class="flex justify-between items-center mb-4 border-b pb-3">
                    <div>
                        <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-calendar-check text-sky-600 mr-2"></i>Attendance Dates</h3>
                        <p class="text-xs text-gray-500">All dates with saved records. Change, delete, or merge two dates.</p>
                    </div>
                    <button id="closeAttendanceDatesBtn" class="text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-xmark text-xl"></i>
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
            <div class="bg-white rounded-none shadow-xl w-full h-full p-4 sm:p-6 relative z-10 fade-in flex flex-col">
                <div class="flex justify-between items-center mb-4 border-b pb-3">
                    <div>
                        <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-table-list text-purple-600 mr-2"></i>Class Summary</h3>
                        <div id="csCourseTitle" class="text-xs font-bold text-blue-700 mt-0.5"></div>
                    </div>
                    <button id="closeClassSummaryBtn" class="text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>

                <div class="mb-3 flex flex-col md:flex-row gap-2">
                    <input type="text" id="csSearchInput" placeholder="Search name, student no., email, contact, group, topic, status..." class="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-gray-50">
                    <select id="csTermSelect" class="w-full md:w-44 px-2 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 bg-gray-50 font-medium">
                        <option value="midterm">Mid Term</option>
                        <option value="finalterm">Final Term</option>
                        <option value="all">Mid + Final Term</option>
                    </select>
                    <button type="button" id="csExportCsvBtn" disabled class="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center">
                        <i class="fa-solid fa-file-csv mr-2"></i> Export CSV
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
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full max-w-3xl h-full sm:h-auto p-4 sm:p-6 relative z-10 sheet-panel max-h-full sm:max-h-[95vh] flex flex-col">
                <div class="flex justify-between items-center mb-4 border-b pb-3">
                    <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-pen-to-square text-teal-600 mr-2"></i>Record Scores</h3>
                    <button id="closeScoresModalBtn" class="text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-xmark text-xl"></i>
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

                <div id="scStudentCount" class="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2"></div>
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
                    <button type="button" id="scSaveBtn" class="flex-1 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2.5 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center">
                        <i class="fa-solid fa-floppy-disk mr-2"></i> Save Assessment & Scores
                    </button>
                </div>
            </div>
        </div>
    `,

    renderNoClassModal: () => `
        <div id="noClassModal" class="hidden fixed inset-0 z-[70] flex items-end sm:items-center justify-center fade-in p-0 sm:p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeNoClassModalBg"></div>
            <div class="bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full max-w-sm p-4 sm:p-6 relative z-10 sheet-panel max-h-[90vh] flex flex-col">
                <div class="sm:hidden mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300" aria-hidden="true"></div>
                <div class="flex justify-between items-center mb-4 border-b pb-3">
                    <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-calendar-xmark text-orange-600 mr-2"></i>No Class Days</h3>
                    <button id="closeNoClassModalBtn" class="text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-xmark text-xl"></i>
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

    renderManageStudentModal: () => `
        <div id="manageStudentModal" class="hidden fixed inset-0 z-[70] flex items-end sm:items-center justify-center fade-in p-0 sm:p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeManageStudentModalBg"></div>
            <div class="bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full max-w-md p-4 sm:p-6 relative z-10 sheet-panel max-h-[92vh] overflow-y-auto">
                <div class="sm:hidden mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300" aria-hidden="true"></div>
                <div class="flex justify-between items-center mb-4 border-b pb-3">
                    <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-user-gear text-blue-600 mr-2"></i>Manage Student</h3>
                    <button id="closeManageStudentModalBtn" class="text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>
                <div id="manageStudentName" class="font-black text-gray-800 text-center mb-4 text-base sm:text-lg"></div>
                <input type="hidden" id="manageStudentId">

                <div class="space-y-4">
                    <div class="grid grid-cols-3 gap-2">
                        <div>
                            <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Seat</label>
                            <input type="text" id="manageSeatInput" class="w-full px-2 py-2 text-xs border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition text-center">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Group</label>
                            <input type="text" id="manageGroupInput" class="w-full px-2 py-2 text-xs border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition text-center">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Topic</label>
                            <input type="text" id="manageTopicInput" class="w-full px-2 py-2 text-xs border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition text-center" placeholder="Assigned">
                        </div>
                    </div>

                    <div>
                        <div class="text-[10px] font-bold text-blue-700 uppercase tracking-wider mb-1"><i class="fa-solid fa-graduation-cap mr-1"></i>Program (assigned by lecturer)</div>
                        <div class="grid grid-cols-3 gap-2">
                        <div>
                            <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Course</label>
                            <input type="text" id="manageProgramCourseInput" class="w-full px-2 py-2 text-xs border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition text-center" placeholder="e.g. BSCS">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Year</label>
                            <input type="text" id="manageProgramYearInput" class="w-full px-2 py-2 text-xs border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition text-center" placeholder="e.g. 2">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Section</label>
                            <input type="text" id="manageProgramSectionInput" class="w-full px-2 py-2 text-xs border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition text-center" placeholder="e.g. A">
                        </div>
                        </div>
                    </div>

                    <div>
                        <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Eye Condition / Disability Tag</label>
                        <select id="manageEyeConditionSelect" class="w-full px-3 py-2 text-sm border border-gray-300 rounded outline-none font-bold bg-gray-50 cursor-pointer transition focus:ring-2 focus:ring-blue-500">
                            <option value="No Eye Condition">No Eye Condition</option>
                            <option value="Near Sighted">Near Sighted</option>
                            <option value="Far Sighted">Far Sighted</option>
                            <option value="Legally Blind">Legally Blind (Accessible Read-Aloud)</option>
                        </select>
                    </div>

                    <div>
                        <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Account Status</label>
                        <select id="manageStatusSelect" class="w-full px-3 py-2 text-sm border rounded outline-none font-medium cursor-pointer transition">
                            <option value="Active">Active</option>
                            <option value="Inactive">Inactive</option>
                            <option value="Suspended">Suspended</option>
                            <option value="UD">UD</option>
                            <option value="Dropped">Dropped</option>
                        </select>
                    </div>

                    <details class="border border-gray-200 rounded-lg p-3 bg-gray-50/50" id="manageDetailsBox">
                        <summary class="text-xs font-bold text-gray-700 cursor-pointer select-none"><i class="fa-solid fa-id-card text-blue-600 mr-1"></i>Edit Student Details</summary>
                        <div class="space-y-3 mt-3">
                        <div>
                            <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Full Name</label>
                            <input type="text" id="manageNameInput" class="w-full px-2 py-2 text-xs border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition" placeholder="">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Student Number</label>
                            <input type="text" id="manageStudentNumberInput" class="w-full px-2 py-2 text-xs border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition" placeholder="00-0000">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Email</label>
                            <input type="text" id="manageEmailInput" class="w-full px-2 py-2 text-xs border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition" placeholder="">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Contact Number</label>
                            <input type="text" id="manageContactInput" class="w-full px-2 py-2 text-xs border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition" placeholder="">
                        </div>

                            <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Class Course / Year / Section</div>
                            <div class="grid grid-cols-3 gap-2">
                        <div>
                            <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Course</label>
                            <input type="text" id="manageClassCourseInput" class="w-full px-2 py-2 text-xs border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition text-center" placeholder="">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Year</label>
                            <input type="text" id="manageClassYearInput" class="w-full px-2 py-2 text-xs border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition text-center" placeholder="">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Section</label>
                            <input type="text" id="manageClassSectionInput" class="w-full px-2 py-2 text-xs border border-gray-300 rounded focus:ring-blue-500 outline-none bg-gray-50 focus:bg-white transition text-center" placeholder="">
                        </div>
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

    renderSummaryModal: () => `
        <div id="summaryModal" class="hidden fixed inset-0 z-[80] flex items-center justify-center fade-in p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeSummaryModalBg"></div>
            <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-4 sm:p-6 relative z-10 scale-up max-h-[90vh] overflow-y-auto">
                <div class="flex justify-between items-center mb-4 border-b pb-3">
                    <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-chart-pie text-purple-600 mr-2"></i>Performance Summary</h3>
                    <button id="closeSummaryModalBtn" class="text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-xmark text-xl"></i>
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
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-scores-trigger hover:border-blue-400 transition" data-term="midterm" data-category="Written" title="Click to view quizzes/long exam scores"><div class="text-gray-400 text-[9px] uppercase font-bold">Quizzes/Long</div><span class="font-black text-blue-600 text-base block mt-0.5" id="midtermWrittenScore">...</span></div>
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-scores-trigger hover:border-blue-400 transition" data-term="midterm" data-category="Narrative" title="Click to view narrative grades"><div class="text-gray-400 text-[9px] uppercase font-bold">Narrative</div><span class="font-black text-blue-600 text-base block mt-0.5" id="midtermNarrativeScore">...</span></div>
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-scores-trigger hover:border-blue-400 transition" data-term="midterm" data-category="Individual" title="Click to view individual grades"><div class="text-gray-400 text-[9px] uppercase font-bold">Individual</div><span class="font-black text-blue-600 text-base block mt-0.5" id="midtermIndividualScore">...</span></div>
                                </div>
                            </div>

                            <div>
                                <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Performance Output</span>
                                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1 text-xs">
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-scores-trigger hover:border-blue-400 transition" data-term="midterm" data-category="Report" title="Click to view report grades"><div class="text-gray-400 text-[9px] uppercase font-bold">Report</div><span class="font-black text-blue-600 text-base block mt-0.5" id="midtermReportScore">...</span></div>
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-scores-trigger hover:border-blue-400 transition" data-term="midterm" data-category="Performance" title="Click to view performance task scores"><div class="text-gray-400 text-[9px] uppercase font-bold">Tasks</div><span class="font-black text-blue-600 text-base block mt-0.5" id="midtermPerformanceTaskScore">...</span></div>
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-details-trigger hover:border-blue-400 transition" data-term="midterm" data-metric="participation" title="Click to view participation details">
                                        <div class="text-gray-400 text-[9px] uppercase font-bold">Participation</div>
                                        <span class="font-black text-blue-600 text-base block mt-0.5" id="midtermParticipationScore">...</span>
                                    </div>
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-details-trigger hover:border-blue-400 transition" data-term="midterm" data-metric="attendance" title="Click to view attendance details">
                                        <div class="text-gray-400 text-[9px] uppercase font-bold">Attendance</div>
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
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-scores-trigger hover:border-yellow-400 transition" data-term="finalterm" data-category="Written" title="Click to view quizzes/long exam scores"><div class="text-gray-400 text-[9px] uppercase font-bold">Quizzes/Long</div><span class="font-black text-yellow-600 text-base block mt-0.5" id="finaltermWrittenScore">...</span></div>
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-scores-trigger hover:border-yellow-400 transition" data-term="finalterm" data-category="Narrative" title="Click to view narrative grades"><div class="text-gray-400 text-[9px] uppercase font-bold">Narrative</div><span class="font-black text-yellow-600 text-base block mt-0.5" id="finaltermNarrativeScore">...</span></div>
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-scores-trigger hover:border-yellow-400 transition" data-term="finalterm" data-category="Individual" title="Click to view individual grades"><div class="text-gray-400 text-[9px] uppercase font-bold">Individual</div><span class="font-black text-yellow-600 text-base block mt-0.5" id="finaltermIndividualScore">...</span></div>
                                </div>
                            </div>

                            <div>
                                <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Performance Output</span>
                                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1 text-xs">
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-scores-trigger hover:border-yellow-400 transition" data-term="finalterm" data-category="Report" title="Click to view report grades"><div class="text-gray-400 text-[9px] uppercase font-bold">Report</div><span class="font-black text-yellow-600 text-base block mt-0.5" id="finaltermReportScore">...</span></div>
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-scores-trigger hover:border-yellow-400 transition" data-term="finalterm" data-category="Performance" title="Click to view performance task scores"><div class="text-gray-400 text-[9px] uppercase font-bold">Tasks</div><span class="font-black text-yellow-600 text-base block mt-0.5" id="finaltermPerformanceTaskScore">...</span></div>
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-details-trigger hover:border-yellow-400 transition" data-term="finalterm" data-metric="participation" title="Click to view participation details">
                                        <div class="text-gray-400 text-[9px] uppercase font-bold">Participation</div>
                                        <span class="font-black text-yellow-600 text-base block mt-0.5" id="finaltermParticipationScore">...</span>
                                    </div>
                                    <div class="bg-white p-2 border rounded text-center cursor-pointer view-details-trigger hover:border-yellow-400 transition" data-term="finalterm" data-metric="attendance" title="Click to view attendance details">
                                        <div class="text-gray-400 text-[9px] uppercase font-bold">Attendance</div>
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
        <div id="detailsModal" class="hidden fixed inset-0 z-[90] flex items-end sm:items-center justify-center fade-in p-0 sm:p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeDetailsModalBg"></div>
            <div class="bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full max-w-sm p-4 sm:p-6 relative z-10 sheet-panel max-h-[85vh] flex flex-col">
                <div class="sm:hidden mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300" aria-hidden="true"></div>
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

    renderAddStudentModal: () => `
        <div id="addStudentModal" class="hidden fixed inset-0 z-[60] flex items-end sm:items-center justify-center fade-in p-0 sm:p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm modal-backdrop" id="closeAddStudentModalBg"></div>
            <div class="bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full max-w-3xl p-4 sm:p-6 relative z-10 sheet-panel max-h-[92vh] sm:max-h-[90vh] flex flex-col">
                <div class="sm:hidden mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300" aria-hidden="true"></div>
                <div class="flex justify-between items-center mb-5 border-b pb-3">
                    <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-user-plus text-green-600 mr-2"></i>Manually Enroll Student</h3>
                    <button id="closeAddStudentModalBtn" class="text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-xmark text-xl"></i>
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
                        </select>
                        <select id="filterCourse" class="w-full sm:w-32 px-2 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 bg-gray-50">
                            <option value="">Course (All)</option>
                        </select>
                        <div class="flex gap-2 w-full sm:w-auto">
                            <input type="text" id="filterYear" placeholder="Year" class="w-full sm:w-20 px-2 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 bg-gray-50">
                            <input type="text" id="filterSection" placeholder="Section" class="w-full sm:w-24 px-2 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-blue-500 bg-gray-50">
                        </div>
                    </div>
                </div>

                <div id="unenrolledStudentsList" class="flex-1 overflow-y-auto space-y-2 min-h-[300px] bg-gray-50 p-2 rounded border border-gray-200">
                    <div class="text-center py-10 text-gray-500 text-sm"><i class="fa-solid fa-spinner fa-spin text-2xl mb-2 text-blue-600"></i><br>Loading students...</div>
                </div>
            </div>
        </div>
    `,

    renderRecitationModal: () => `
        <div id="recitationModal" class="hidden fixed inset-0 z-[100] flex items-center justify-center fade-in p-4">
            <div id="recitationModalOverlay" class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm cursor-pointer"></div>
            <div class="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 relative z-10 scale-up flex flex-col items-center">
                <div class="w-full flex justify-between items-center mb-4 border-b pb-3">
                    <h3 class="text-lg font-black text-gray-800"><i class="fa-solid fa-bullhorn text-purple-600 mr-2"></i>Student Caller</h3>
                    <button id="closeRecitationModalBtn" class="text-gray-400 hover:text-gray-800 focus:outline-none transition-colors">
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
                        View Called List
                    </button>
                </div>

                <div id="calledListContainer" class="hidden w-full mb-4 bg-gray-50 p-3 rounded-xl border border-gray-200 max-h-48 overflow-y-auto">
                    <div class="flex justify-between items-center mb-2 pb-1 border-b border-gray-200">
                        <span class="text-xs font-bold text-gray-700">Called Today</span>
                        <button type="button" id="resetCalledListBtn" class="text-[10px] font-bold text-red-600 hover:text-red-800 uppercase">Reset All</button>
                    </div>
                    <div id="calledStudentsListContent" class="space-y-1.5">
                    </div>
                </div>

                <div id="wheelContainer" class="w-full flex flex-col items-center">
                    <div class="relative w-64 h-64 mb-6">
                        <div class="absolute top-[-15px] left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-[15px] border-l-transparent border-r-[15px] border-r-transparent border-t-[30px] border-t-red-600 z-20 filter drop-shadow-md"></div>
                        <div id="recitationWheel" class="w-full h-full rounded-full border-4 border-gray-700 shadow-inner overflow-hidden relative">
                        </div>
                    </div>
                </div>

                <button id="spinWheelBtn" class="w-full bg-purple-600 hover:bg-purple-700 text-white font-black py-3 rounded-lg shadow-md transition transform active:scale-95 focus:outline-none">
                    CALL STUDENT
                </button>

                <div id="recitationResult" class="hidden w-full text-center fade-in bg-purple-50 p-6 rounded-xl border border-purple-200">
                    <p class="text-xs font-bold text-purple-600 uppercase tracking-widest mb-4">Selected Student</p>
                    <div id="recitationResultAvatar" class="mb-4"></div>
                    <h4 id="recitationResultName" class="text-2xl font-black text-gray-900 mb-4"></h4>

                    <div class="flex flex-col items-center mb-6 w-full px-4">
                        <div class="bg-purple-100 text-purple-800 px-4 py-2 rounded-lg border border-purple-200">
                            <span class="text-xs font-bold uppercase tracking-wider">Seat Number: </span>
                            <span id="recitationResultSeat" class="text-lg font-black ml-1"></span>
                        </div>
                    </div>

                    <div class="flex flex-col items-center mb-6 w-full px-4">
                        <label for="recitationPointsInput" class="text-xs font-bold text-purple-700 uppercase tracking-wider mb-1">Participation Points</label>
                        <input id="recitationPointsInput" type="number" min="0" step="1" inputmode="numeric" placeholder="0" class="w-28 px-3 py-2 text-center text-lg font-black text-gray-900 border-2 border-purple-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 disabled:bg-gray-100 disabled:text-gray-400 transition">
                        <p id="recitationPointsHint" class="text-[11px] text-purple-700 mt-1.5 leading-snug"></p>
                    </div>

                    <button id="nextStudentBtn" class="w-full bg-white border-2 border-purple-600 text-purple-600 hover:bg-purple-50 font-black py-2 rounded-lg shadow-sm transition transform active:scale-95 focus:outline-none">
                        Next Student
                    </button>
                </div>
            </div>
        </div>
    `,

    renderGroupMembersModal: () => `
        <div id="groupMembersModal" class="hidden fixed inset-0 z-[110] flex items-end sm:items-center justify-center fade-in p-0 sm:p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeGroupMembersModalBg"></div>
            <div class="bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full max-w-sm p-4 sm:p-6 relative z-10 sheet-panel max-h-[85vh] flex flex-col">
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

        const studentList = students.map((s, index) => {
            const avatarSrc = getLoadableAvatarSrc(s.Avatar);
            const displayCourse = `${s.course || ''} ${s.year || ''} ${s.section ? '- ' + s.section : ''}`.trim();
            const displayProgram = `${s.Program_Course || ''} ${s.Program_Year || ''} ${s.Program_Section ? '- ' + s.Program_Section : ''}`.trim();

            const avatarImg = avatarSrc
                ? `<img src="${safeUrl(avatarSrc)}" class="w-10 h-10 sm:w-12 sm:h-12 rounded-full object-cover border border-gray-200 cursor-pointer view-avatar-btn hover:opacity-80 transition" data-src="${safeUrl(avatarSrc)}" data-name="${escapeHtml(s.Name)}" data-info="${displayCourse}" alt="${escapeHtml(s.Name)}">`
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
                <div class="flex flex-col lg:flex-row items-start lg:items-center justify-between p-4 bg-white border-b border-gray-100 hover:bg-gray-50 transition student-row gap-4 lg:gap-2" data-student-id="${s.User_ID}">

                    <div class="flex items-start justify-between w-full lg:w-1/2">
                        <div class="flex items-center space-x-3 p-1.5 -ml-1.5 rounded-lg transition">
                            <span class="text-xs font-bold text-gray-400 w-5 text-center">${index + 1}</span>
                            <div class="flex-shrink-0">
                                ${avatarImg}
                            </div>
                            <div>
                                <div class="font-bold text-blue-600 text-sm sm:text-base cursor-pointer view-summary-trigger hover:underline hover:text-blue-800 transition inline-block" data-name="${escapeHtml(s.Name)}" title="View Performance Summary">${escapeHtml(s.Name)}</div>
                                <div class="text-[11px] sm:text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-1">
                                    <span class="font-medium text-gray-700">${escapeHtml(s.Student_Number || 'N/A')}</span> &bull; ${escapeHtml(displayCourse || 'N/A')} ${eyeConditionBadge}
                                </div>
                                ${displayProgram ? `<div class="text-[11px] text-blue-700 font-medium mt-0.5"><i class="fa-solid fa-graduation-cap mr-1"></i>Program: ${escapeHtml(displayProgram)}</div>` : ''}
                                <div class="text-[10px] font-bold text-gray-400 mt-1 uppercase">
                                    Seat: <span class="text-gray-800">${escapeHtml(s.Seat_Number || '')}</span>
                                    &nbsp;|&nbsp; Group: ${groupDisplay}
                                    &nbsp;|&nbsp; Topic: <span class="text-gray-800">${escapeHtml(s.Assigned_Topic || '')}</span>
                                </div>
                            </div>
                        </div>

                        <div class="lg:hidden">
                            <button type="button" class="manage-student-btn px-2 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800 rounded text-xs font-bold border border-blue-200 transition shadow-sm"
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

                    <div class="hidden lg:flex items-center justify-center w-auto px-2">
                        <button type="button" class="manage-student-btn px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800 rounded text-xs font-bold border border-blue-200 transition flex items-center shadow-sm"
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

                    <div class="flex items-end justify-between lg:justify-end w-full lg:w-auto space-x-2 border-t lg:border-t-0 border-gray-100 pt-3 lg:pt-0 mt-1 lg:mt-0 overflow-x-auto">
                        <div class="flex items-center lg:items-start lg:flex-col gap-2 lg:gap-0">
                            <label class="block text-[9px] font-bold text-gray-400 uppercase tracking-wider lg:mb-0.5 text-center">Pts</label>
                            <input type="number" placeholder="0" class="points-input w-16 px-2 py-1.5 text-xs border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500 outline-none text-center bg-gray-50 focus:bg-white transition font-mono" value="0">
                        </div>
                        <div class="flex space-x-1 flex-1 lg:flex-initial justify-end items-center min-w-max">
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

        const emptyState = `<div class="p-8 text-center text-gray-500 bg-white rounded-b-xl border-dashed border-gray-300">No students enrolled yet.</div>`;

        const targetDisplay = [course.Target_Course, course.Target_Year, course.Target_Section].filter(Boolean).join(' ');
        const audienceBadge = targetDisplay
            ? `<span class="inline-block bg-blue-100 text-blue-800 text-[10px] sm:text-xs font-bold px-2 py-1 rounded-md border border-blue-200 uppercase align-middle ml-2 sm:ml-3">${escapeHtml(targetDisplay)} Only</span>`
            : `<span class="inline-block bg-gray-100 text-gray-600 text-[10px] sm:text-xs font-bold px-2 py-1 rounded-md border border-gray-200 uppercase align-middle ml-2 sm:ml-3">All Students</span>`;

        return `
            <header class="bg-blue-700 shadow-md fixed top-0 w-full z-40">
                <div class="w-full mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl">
                    <div class="flex items-center h-16">
                        <a href="#dashboard" class="text-white hover:text-blue-200 transition mr-2 sm:mr-4 p-2 -ml-2">
                            <i class="fa-solid fa-arrow-left text-xl"></i>
                        </a>
                        <div class="overflow-hidden">
                            <h1 class="text-base sm:text-lg font-bold text-white truncate">${escapeHtml(course.CourseCode)}</h1>
                            <p class="text-[11px] sm:text-xs text-blue-200 truncate">${escapeHtml(course.CourseTitle)}</p>
                        </div>
                    </div>
                </div>
            </header>

            <main class="pt-20 pb-12 px-2 sm:px-6 lg:px-8 max-w-6xl mx-auto w-full fade-in relative">
                <div class="mb-4 mt-2 sm:mt-4 px-2 sm:px-0">
                    <div>
                        <h2 class="text-xl sm:text-2xl font-black text-gray-800 tracking-tight flex items-center flex-wrap">
                            Class Roster & Attendance ${audienceBadge}
                        </h2>
                        <p class="text-xs sm:text-sm text-gray-500 mt-2"><i class="fa-regular fa-clock mr-1"></i> ${escapeHtml(course.ScheduleDay)} | ${escapeHtml(course.TimePeriod)}</p>
                    </div>
                </div>

                <div id="attendanceBar" data-dirty="false" class="sticky top-16 z-30 mb-4 px-2 sm:px-3 py-2 bg-gray-50/95 backdrop-blur border border-gray-200 rounded-lg shadow-sm">
                    <div class="flex items-center gap-2">
                        <input type="date" id="attendanceDate" data-schedule-day="${escapeHtml(course.ScheduleDay || '')}" class="flex-1 sm:flex-none min-w-0 px-3 py-2 border border-gray-300 rounded-md text-sm bg-white font-medium focus:ring-2 focus:ring-blue-500 outline-none" value="${getLocalDateString()}">
                        <span id="attendanceDirtyLabel" class="ml-auto text-xs font-bold text-orange-600 whitespace-nowrap"><i class="fa-solid fa-circle text-[6px] align-middle mr-1"></i>Unsaved changes</span>
                        <span id="attendanceDirtyStatus" class="sr-only" role="status"></span>
                        <div class="relative flex-shrink-0 sm:ml-0">
                            <button id="saveAttendanceBtn" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center whitespace-nowrap">
                                <i class="fa-solid fa-floppy-disk mr-2"></i> Save All
                            </button>
                            <span id="attendanceDirtyDot" title="Unsaved changes" aria-hidden="true" class="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-orange-400 border-2 border-white pointer-events-none"></span>
                        </div>
                        <button id="openCourseMenuBtn" aria-label="Menu" class="flex-shrink-0 bg-gray-800 hover:bg-gray-900 text-white px-3 sm:px-4 py-2 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center">
                            <i class="fa-solid fa-bars sm:mr-2"></i><span class="hidden sm:inline">Menu</span>
                        </button>
                    </div>
                </div>

                <div id="noClassBanner" class="hidden mb-4 mx-2 sm:mx-0 p-3 rounded-md text-sm font-bold bg-orange-100 text-orange-800 border border-orange-200 uppercase tracking-wider flex items-center justify-center">
                    <i class="fa-solid fa-triangle-exclamation mr-2 text-lg"></i> This date is marked as No Class
                </div>
                <div id="attendanceAlert" class="hidden mb-4 mx-2 sm:mx-0 p-3 rounded-md text-sm font-medium"></div>

                <div class="bg-white shadow-sm rounded-xl border border-gray-200 overflow-hidden mx-0 sm:mx-0">
                    <div class="bg-gray-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                        <span class="text-[10px] sm:text-xs font-bold text-gray-500 uppercase tracking-wider">
                            ${students.length} Enrolled Students
                        </span>
                        <div class="space-x-2">
                            <button type="button" id="markAllPresent" class="text-[10px] sm:text-xs font-bold text-green-600 hover:text-green-800 underline">Mark All Present</button>
                        </div>
                    </div>
                    <div id="rosterListContainer">
                        ${students.length > 0 ? studentList : emptyState}
                    </div>
                </div>

                <button id="openRecitationBtn" class="fixed bottom-6 right-6 w-14 h-14 bg-purple-600 text-white rounded-full shadow-lg hover:bg-purple-700 flex justify-center items-center z-50 focus:outline-none" title="Student Caller" style="transition: opacity 0.3s, background-color 0.15s, transform 0.15s;">
                    <i class="fa-solid fa-bullhorn text-2xl"></i>
                </button>
            </main>

            ${ClassUI.renderCourseMenuModal(course)}
            ${ClassUI.renderClassSummaryModal()}
            ${ClassUI.renderScoresModal()}
            ${ClassUI.renderAttendanceDatesModal()}
            ${ClassUI.renderNoClassModal()}
            ${ClassUI.renderManageStudentModal()}
            ${ClassUI.renderSummaryModal()}
            ${ClassUI.renderSubmissionHistoryModal()}
            ${ClassUI.renderDetailsModal()}
            ${ClassUI.renderAddStudentModal()}
            ${ClassUI.renderRecitationModal()}
            ${ClassUI.renderGroupMembersModal()}
            ${ExamUI.renderManagerModal()}
            ${ExamUI.renderPresentationOverlay()}
            ${ExamUI.renderAccessibleExamOverlay ? ExamUI.renderAccessibleExamOverlay() : ''}
        `;
    }
};
