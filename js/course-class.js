// js/course-class.js
import { apiFetch, AppState } from './globals.js';
import { Components, getLoadableAvatarSrc } from './components.js'; 
import { CourseAttendance } from './course-attendance.js';

export const CourseClass = {
    currentSummaryData: null,
    currentStudents: [],
    fabIdleTimer: null,
    resetFabOpacity: null,

    updateManageStatusColor: (selectEl) => {
        const status = selectEl.value;
        selectEl.className = `w-full px-3 py-2 text-sm border rounded outline-none font-medium cursor-pointer transition ${
            status === 'Active' ? 'text-green-600 border-green-300 bg-green-50 focus:ring-green-500' : 
            status === 'Inactive' ? 'text-gray-600 border-gray-300 bg-gray-50 focus:ring-gray-500' :
            status === 'Suspended' ? 'text-orange-600 border-orange-300 bg-orange-50 focus:ring-orange-500' :
            status === 'UD' ? 'text-red-600 border-red-300 bg-red-50 focus:ring-red-500' :
            status === 'Dropped' ? 'text-red-800 border-red-400 bg-red-100 focus:ring-red-500' : 'text-gray-600 border-gray-300 bg-gray-50'
        }`;
    },

    copyStudentEmails: async () => {
        if (!CourseClass.currentStudents || CourseClass.currentStudents.length === 0) {
            alert("No students enrolled to copy emails.");
            return;
        }
        
        const emails = CourseClass.currentStudents
            .map(s => s.Email)
            .filter(email => email && email.trim() !== '');

        if (emails.length === 0) {
            alert("No valid email addresses found for the enrolled students.");
            return;
        }

        const emailString = emails.join(', ');
        
        try {
            await navigator.clipboard.writeText(emailString);
            alert(`Successfully copied ${emails.length} email address(es) to your clipboard! Ready to paste into Google Calendar.`);
        } catch (err) {
            alert("Failed to copy to clipboard. Please grant clipboard permissions or copy manually.");
            console.error("Clipboard Error:", err);
        }
    },

    renderSubmissionsHistory: (submissions, containerId) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        if (!submissions || submissions.length === 0) {
            container.innerHTML = '<div class="text-xs text-gray-500 italic text-center py-4 bg-white rounded border border-gray-200">No documents submitted yet.</div>';
            return;
        }

        const isLecturer = AppState.user && AppState.user.role.toLowerCase() === 'lecturer';

        container.innerHTML = submissions.map(sub => {
            let descHtml = sub.Description || '';
            descHtml = descHtml.replace(/\n/g, '<br>');
            descHtml = descHtml.replace(/\[Group Upload by: (.*?)\]/g, '<span class="block mt-1.5 text-[10px] text-purple-700 font-bold bg-purple-50 border border-purple-100 rounded px-1.5 py-0.5 inline-block"><i class="fa-solid fa-users mr-1"></i>Uploaded by: $1</span>');
            descHtml = descHtml.replace(/\[Included Members: (.*?)\]/g, '<span class="block text-gray-500 italic text-[9px] mt-0.5 leading-tight">Members: $1</span>');

            let gradingHtml = '';
            if (isLecturer) {
                gradingHtml = `
                <div class="mt-2 pt-2 border-t border-gray-100 flex flex-wrap items-center gap-2">
                    <select class="grade-cat-written px-2 py-1 text-[10px] border border-gray-300 rounded bg-gray-50 outline-none focus:ring-1 focus:ring-blue-500">
                        <option value="">Written: None</option>
                        <option value="Narrative" ${sub.Category_Written === 'Narrative' ? 'selected' : ''}>Narrative</option>
                        <option value="Individual" ${sub.Category_Written === 'Individual' ? 'selected' : ''}>Individual</option>
                    </select>
                    <select class="grade-cat-perf px-2 py-1 text-[10px] border border-gray-300 rounded bg-gray-50 outline-none focus:ring-1 focus:ring-blue-500">
                        <option value="">Performance: None</option>
                        <option value="Report" ${sub.Category_Performance === 'Report' ? 'selected' : ''}>Report</option>
                    </select>
                    <input type="number" step="0.1" class="grade-input px-2 py-1 text-[10px] w-20 border border-gray-300 rounded bg-gray-50 outline-none focus:ring-1 focus:ring-blue-500" placeholder="Grade" value="${sub.Grade !== null && sub.Grade !== undefined ? sub.Grade : ''}">
                    <button type="button" class="save-grade-btn px-3 py-1 bg-blue-50 text-blue-600 border border-blue-200 rounded text-[10px] font-bold hover:bg-blue-100 transition shadow-sm" data-sub-id="${sub.Submission_ID}" data-file-url="${sub.File_URL}">Save Grade</button>
                </div>
                `;
            } else {
                if (sub.Grade !== null && sub.Grade !== undefined) {
                    gradingHtml = `
                    <div class="mt-2 pt-2 border-t border-gray-100 flex flex-wrap items-center gap-2 text-[10px]">
                        <span class="font-bold text-gray-700">Grade:</span> <span class="font-black text-blue-600 text-xs">${sub.Grade}</span>
                        ${sub.Category_Written ? `<span class="bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded text-gray-600 font-bold">Written: ${sub.Category_Written}</span>` : ''}
                        ${sub.Category_Performance ? `<span class="bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded text-gray-600 font-bold">Perf: ${sub.Category_Performance}</span>` : ''}
                    </div>
                    `;
                } else {
                    gradingHtml = `
                    <div class="mt-2 pt-2 border-t border-gray-100 flex flex-wrap items-center gap-2 text-[10px] text-gray-400 italic">
                        Not yet graded by lecturer
                    </div>
                    `;
                }
            }

            return `
            <div class="flex flex-col p-3 bg-white border border-gray-200 rounded hover:border-blue-300 transition shadow-sm">
                <div class="flex justify-between items-start">
                    <div class="flex-1 pr-2">
                        <div class="text-xs font-bold text-blue-700 break-words">${sub.Title} <span class="text-[9px] font-black uppercase tracking-wider bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded ml-1">${sub.Term}</span></div>
                        <div class="text-[10px] text-gray-600 mt-1">${descHtml}</div>
                        <div class="text-[9px] text-gray-400 mt-1.5 font-medium uppercase"><i class="fa-regular fa-clock"></i> ${new Date(sub.Timestamp + 'Z').toLocaleString()}</div>
                    </div>
                    <a href="${sub.File_URL}" target="_blank" class="flex-shrink-0 px-3 py-1.5 bg-gray-50 border border-gray-300 rounded text-[10px] font-bold text-gray-700 hover:bg-gray-100 transition shadow-sm ml-2 text-center">
                        <i class="fa-solid ${sub.Type === 'url' ? 'fa-link' : 'fa-download'} block text-sm mb-0.5"></i> View
                    </a>
                </div>
                ${gradingHtml}
            </div>
            `;
        }).join('');
    },

    renderDetailsModal: (term, metric, data) => {
        const course = data.course || {};
        const records = data.records || [];
        
        let termStart = '';
        let termEnd = '';
        let titleTerm = '';
        
        if (term === 'midterm') {
            termStart = course.Midterm_Start || '';
            termEnd = course.Midterm_End || '';
            titleTerm = 'Mid Term';
        } else {
            termStart = course.Final_Start || '';
            termEnd = course.Final_End || '';
            titleTerm = 'Final Term';
        }

        const parseLocalDate = (dateStr) => {
            if (!dateStr) return null;
            if (dateStr.includes('-')) {
                const [y, m, d] = dateStr.split('-');
                return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
            }
            const d = new Date(dateStr);
            return isNaN(d.getTime()) ? null : d;
        };
        
        const titleMetric = metric === 'attendance' ? 'Attendance Breakdown' : 'Participation Breakdown';
        document.getElementById('detailsModalTitle').textContent = `${titleTerm} | ${titleMetric}`;
        
        const scoreHeader = document.getElementById('detailsScoreHeader');
        if (metric === 'attendance') {
            scoreHeader.textContent = "Attendance Score";
        } else {
            scoreHeader.textContent = "Points";
        }

        const tbody = document.getElementById('detailsTableBody');
        tbody.innerHTML = '';

        if (!termStart || !termEnd) {
            tbody.innerHTML = `<tr><td colspan="3" class="px-3 py-4 text-center text-gray-500 italic">Term dates are not set for this course.</td></tr>`;
            return;
        }

        const tStart = parseLocalDate(termStart);
        const tEnd = parseLocalDate(termEnd);
        
        const termRecords = records.filter(r => {
            const rDate = parseLocalDate(r.Date);
            if (!rDate || !tStart || !tEnd) return false;
            return rDate >= tStart && rDate <= tEnd;
        });

        if (termRecords.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" class="px-3 py-4 text-center text-gray-500 italic">No records found for this period.</td></tr>`;
            return;
        }

        const rowsHtml = termRecords.map(r => {
            let statusColor = 'text-gray-600';
            let attScore = 0;
            
            if (r.Status === 'Present') { statusColor = 'text-green-600 font-bold'; attScore = 1; }
            else if (r.Status === 'Late') { statusColor = 'text-yellow-600 font-bold'; attScore = 0.5; }
            else if (r.Status === 'Excused') { statusColor = 'text-purple-600 font-bold'; attScore = 0; }
            else if (r.Status === 'Absent') { statusColor = 'text-red-600 font-bold'; attScore = 0; }
            
            const displayScore = metric === 'attendance' ? attScore : (r.Performance_Points || 0);

            return `
                <tr class="hover:bg-gray-50 transition">
                    <td class="px-3 py-2 whitespace-nowrap font-medium text-gray-700">${r.Date}</td>
                    <td class="px-3 py-2 text-center ${statusColor}">${r.Status || 'N/A'}</td>
                    <td class="px-3 py-2 text-center font-mono font-bold text-gray-800">${displayScore}</td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = rowsHtml;
    },

    exportRoster: async (courseId) => {
        try {
            const ts = new Date().getTime();
            const data = await apiFetch(`/api/course-details?courseId=${courseId}&_t=${ts}`);
            const students = data.students;

            const eyeOrder = { 'Near Sighted': 1, 'No Eye Condition': 2, 'Far Sighted': 3 };
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
                const eyeA = eyeOrder[a.eye_condition] || 4;
                const eyeB = eyeOrder[b.eye_condition] || 4;
                if (eyeA !== eyeB) return eyeA - eyeB;
                const nameA = a.Name || '';
                const nameB = b.Name || '';
                return nameA.localeCompare(nameB);
            });

            const printWindow = window.open('', '_blank');
            if (!printWindow) {
                alert("Please allow pop-ups to print the roster.");
                return;
            }

            const html = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <title>Class Roster | ${data.course.CourseCode}</title>
                    <style>
                        @page { size: letter; margin: 0.5in; }
                        body { font-family: 'Arial', sans-serif; font-size: 10pt; color: #333; margin: 0; padding: 0; }
                        .header { text-align: center; margin-bottom: 20px; }
                        h1 { font-size: 18pt; margin: 0 0 5px 0; color: #000; }
                        h3 { font-size: 12pt; margin: 0; color: #555; font-weight: normal; }
                        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                        th, td { border: 1px solid #000; padding: 6px; text-align: left; vertical-align: middle; }
                        th { background-color: #f0f0f0; font-weight: bold; font-size: 10pt; }
                        td { font-size: 9.5pt; }
                        .photo-cell { width: 1in; text-align: center; }
                        .photo { width: 1in; height: 1in; object-fit: cover; border: 1px solid #ccc; display: block; margin: 0 auto; }
                        .center { text-align: center; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>${data.course.CourseCode} | ${data.course.CourseTitle}</h1>
                        <h3>Schedule: ${data.course.ScheduleDay} | ${data.course.TimePeriod}</h3>
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th>Photo</th>
                                <th class="center">Seat No.</th>
                                <th>Student No.</th>
                                <th>Name</th>
                                <th>Email Address</th>
                                <th>Group Name</th>
                                <th>Assigned Topic</th>
                                <th>Contact</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${students.map(s => {
                                const avatarSrc = getLoadableAvatarSrc(s.Avatar);
                                const imgTag = avatarSrc ? `<img src="${avatarSrc}" class="photo" alt="Photo">` : `<div style="width:1in; height:1in; line-height:1in; text-align:center; background:#eee; font-size:8pt; color:#999; margin:0 auto;">No Photo</div>`;
                                return `
                                <tr>
                                    <td class="photo-cell">${imgTag}</td>
                                    <td class="center"><strong>${s.Seat_Number || ''}</strong></td>
                                    <td>${s.Student_Number || ''}</td>
                                    <td><strong>${s.Name}</strong></td>
                                    <td><a href="mailto:${s.Email || ''}" style="color: #000; text-decoration: none;">${s.Email || ''}</a></td>
                                    <td>${s.Group_Name || ''}</td>
                                    <td>${s.Assigned_Topic || ''}</td>
                                    <td>${s.Contact_Number || ''}</td>
                                </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                    <script>
                        window.onload = function() {
                            setTimeout(function() {
                                window.print();
                            }, 500);
                        };
                    </script>
                </body>
                </html>
            `;

            printWindow.document.write(html);
            printWindow.document.close();

        } catch (err) {
            alert('Failed to generate export: ' + err.message);
        }
    },

    loadUnenrolledStudents: async (courseId) => {
        const listContainer = document.getElementById('unenrolledStudentsList');
        if (!listContainer) return;
        
        const filterStatus = document.getElementById('filterStatus')?.value ?? 'Active';
        const filterCourse = document.getElementById('filterCourse')?.value || '';
        const filterYear = document.getElementById('filterYear')?.value || '';
        const filterSection = document.getElementById('filterSection')?.value || '';

        listContainer.innerHTML = '<div class="text-center py-10 text-gray-500 text-sm"><i class="fa-solid fa-spinner fa-spin text-2xl mb-2 text-blue-600"></i><br>Loading students...</div>';
        
        try {
            let url = `/api/unenrolled-students?courseId=${courseId}`;
            if (filterStatus) url += `&statusFilter=${encodeURIComponent(filterStatus)}`;
            if (filterCourse) url += `&courseFilter=${encodeURIComponent(filterCourse)}`;
            if (filterYear) url += `&yearFilter=${encodeURIComponent(filterYear)}`;
            if (filterSection) url += `&sectionFilter=${encodeURIComponent(filterSection)}`;
            
            const ts = new Date().getTime();
            const data = await apiFetch(`${url}&_t=${ts}`);
            
            if (!data.students || data.students.length === 0) {
                listContainer.innerHTML = '<div class="p-8 text-center text-gray-500 bg-white border border-gray-200 rounded-md shadow-sm">No new students available to enroll matching criteria.</div>';
                return;
            }

            const html = data.students.map(s => {
                const displayCourse = `${s.course || ''} ${s.year || ''} ${s.section ? '- ' + s.section : ''}`.trim();
                const statusBadge = `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${
                    s.account_status === 'Active' ? 'text-green-600 border-green-200 bg-green-50' : 
                    s.account_status === 'Inactive' ? 'text-gray-500 border-gray-200 bg-gray-50' :
                    s.account_status === 'Suspended' ? 'text-orange-500 border-orange-200 bg-orange-50' :
                    s.account_status === 'UD' ? 'text-red-500 border-red-200 bg-red-50' :
                    s.account_status === 'Dropped' ? 'text-red-700 border-red-300 bg-red-100' : 'text-gray-500 border-gray-200 bg-gray-50'
                }">${s.account_status || 'Inactive'}</span>`;

                return `
                    <div class="student-enroll-item flex items-center justify-between p-3 bg-white border border-gray-200 rounded-md shadow-sm hover:border-blue-300 transition">
                        <div>
                            <div class="font-bold text-gray-800 text-sm flex items-center gap-2">
                                ${s.Name} ${statusBadge}
                            </div>
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
            
            const searchInput = document.getElementById('studentSearchInput');
            if (searchInput && searchInput.value) {
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            
        } catch (err) {
            listContainer.innerHTML = `<div class="p-4 bg-red-50 text-red-600 rounded text-sm font-medium border border-red-200 text-center">${err.message}</div>`;
        }
    },

    loadClassScreen: async (courseId, skipSpinner = false) => {
        const root = document.getElementById('app-root');
        if (!root || !AppState.user) return;
        
        let modalWasOpen = false;
        let searchVal = '';
        let statusVal = 'Active';
        let courseVal = '';
        let yearVal = '';
        let sectionVal = '';
        
        const modal = document.getElementById('addStudentModal');
        if (modal && !modal.classList.contains('hidden')) {
            modalWasOpen = true;
            searchVal = document.getElementById('studentSearchInput')?.value || '';
            statusVal = document.getElementById('filterStatus')?.value || 'Active';
            courseVal = document.getElementById('filterCourse')?.value || '';
            yearVal = document.getElementById('filterYear')?.value || '';
            sectionVal = document.getElementById('filterSection')?.value || '';
        }
        
        if (!skipSpinner) {
            root.innerHTML = '<div class="flex justify-center items-center h-screen"><i class="fa-solid fa-spinner fa-spin text-blue-600 text-4xl"></i></div>';
        }
        
        try {
            const ts = new Date().getTime();
            const data = await apiFetch(`/api/course-details?courseId=${courseId}&_t=${ts}`);
            
            CourseClass.currentStudents = data.students; 

            root.innerHTML = Components.renderClassScreen(data.course, data.students);
            
            const dateInput = document.getElementById('attendanceDate');
            if (dateInput) {
                await CourseAttendance.loadAttendanceData(courseId, dateInput.value);
            }
            
            if (modalWasOpen) {
                document.getElementById('addStudentModal').classList.remove('hidden');
                
                const filterCourseSelect = document.getElementById('filterCourse');
                if (filterCourseSelect) {
                    try {
                        const programsData = await apiFetch(`/api/programs?_t=${ts}`);
                        if (programsData.programs) {
                            filterCourseSelect.innerHTML = '<option value="">Course (All)</option>' + 
                                programsData.programs.map(p => `<option value="${p.ProgramCode}">${p.ProgramCode}</option>`).join('');
                        }
                    } catch(e) {}
                }
                
                if (document.getElementById('studentSearchInput')) document.getElementById('studentSearchInput').value = searchVal;
                if (document.getElementById('filterStatus')) document.getElementById('filterStatus').value = statusVal;
                if (document.getElementById('filterCourse')) document.getElementById('filterCourse').value = courseVal;
                if (document.getElementById('filterYear')) document.getElementById('filterYear').value = yearVal;
                if (document.getElementById('filterSection')) document.getElementById('filterSection').value = sectionVal;
                
                CourseClass.loadUnenrolledStudents(courseId);
            }

            const fab = document.getElementById('openRecitationBtn');
            if (fab) {
                if (CourseClass.fabIdleTimer) clearTimeout(CourseClass.fabIdleTimer);
                if (CourseClass.resetFabOpacity) {
                    document.removeEventListener('mousemove', CourseClass.resetFabOpacity);
                    document.removeEventListener('keydown', CourseClass.resetFabOpacity);
                    document.removeEventListener('touchstart', CourseClass.resetFabOpacity);
                }
                
                CourseClass.resetFabOpacity = () => {
                    const currentFab = document.getElementById('openRecitationBtn');
                    if (currentFab) {
                        currentFab.style.opacity = '1';
                        clearTimeout(CourseClass.fabIdleTimer);
                        CourseClass.fabIdleTimer = setTimeout(() => {
                            if (document.getElementById('openRecitationBtn')) {
                                document.getElementById('openRecitationBtn').style.opacity = '0.5';
                            }
                        }, 10000);
                    }
                };
                
                document.addEventListener('mousemove', CourseClass.resetFabOpacity);
                document.addEventListener('keydown', CourseClass.resetFabOpacity);
                document.addEventListener('touchstart', CourseClass.resetFabOpacity);
                CourseClass.resetFabOpacity();
            }

            document.querySelectorAll('.view-summary-trigger').forEach(trigger => {
                trigger.addEventListener('click', async (e) => {
                    const name = trigger.dataset.name;
                    
                    const confirmation = window.confirm(`Load performance summary for ${name}?`);
                    if (!confirmation) return;

                    const studentId = trigger.closest('.student-row').dataset.studentId;
                    
                    document.getElementById('summaryStudentName').textContent = name;
                    document.getElementById('summaryModal').classList.remove('hidden');
                    document.getElementById('summaryLoading').classList.remove('hidden');
                    document.getElementById('summaryContent').classList.add('hidden');
                    document.getElementById('summaryError').classList.add('hidden');
                    
                    CourseClass.currentSummaryData = null;

                    try {
                        const ts = new Date().getTime();
                        const summaryData = await apiFetch(`/api/student-summary?courseId=${courseId}&studentId=${studentId}&_t=${ts}`);
                        CourseClass.currentSummaryData = summaryData;
                        
                        CourseAttendance.renderTermMetrics('midterm', summaryData);
                        CourseAttendance.renderTermMetrics('finalterm', summaryData);
                        CourseClass.renderSubmissionsHistory(summaryData.submissions, 'historySubmissionsList');

                        document.getElementById('summaryLoading').classList.add('hidden');
                        document.getElementById('summaryContent').classList.remove('hidden');
                    } catch(err) {
                        console.error("Failed to load summary", err);
                        const errDiv = document.getElementById('summaryError');
                        errDiv.textContent = err.message || "Failed to load summary records.";
                        errDiv.classList.remove('hidden');
                        document.getElementById('summaryLoading').classList.add('hidden');
                    }
                });
            });

        } catch (err) {
            root.innerHTML = `<div class="p-8 text-center mt-20"><div class="text-red-500 mb-4 text-4xl"><i class="fa-solid fa-triangle-exclamation"></i></div><p class="text-gray-800 font-bold mb-4">${err.message}</p><a href="#dashboard" class="text-blue-600 underline font-bold">Back to Dashboard</a></div>`;
        }
    }
};
