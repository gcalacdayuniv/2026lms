// js/course-dashboard.js
import { apiFetch, AppState, CONFIG, handleSessionExpired } from './globals.js';
import { CourseExam } from './course-exam.js';
import { UI } from './ui-feedback.js';
import { Skeleton } from './skeletons.js';
import { escapeHtml } from './html-utils.js';

// Maximum size of an uploaded submission file.
const MAX_UPLOAD_MB = 25;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

// Large files are sent in pieces. Keep in sync with MAX_UPLOAD_CHUNKS (worker.js) and MAX_CHUNKS (Code.gs).
// A 25 MB file is about 35 million base64 characters, which fits in 10 pieces of 3.6 million.
const CHUNK_CHARS = 3600000;            // must be a multiple of 4 so every piece is valid base64
const MAX_CHUNKS = 10;
const PARALLEL_CHUNKS = 3;
const CHUNK_RETRIES = 3;                // attempts per piece
const CHUNK_TIMEOUT_MS = 120000;        // per piece
const SINGLE_TIMEOUT_MS = 90000;        // small files sent in one request
const FINISH_TIMEOUT_MS = 180000;       // Google joins the pieces and saves the file

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// One XMLHttpRequest with a timeout. Errors carry `retryable` so callers know whether to try again.
const xhrPost = (path, { headers = {}, body, timeoutMs, onProgress }) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${CONFIG.API_URL}${path}`, true);
    Object.keys(headers).forEach(k => xhr.setRequestHeader(k, headers[k]));
    if (AppState.token) xhr.setRequestHeader('Authorization', `Bearer ${AppState.token}`);
    xhr.timeout = timeoutMs;

    const fail = (message, retryable) => {
        const err = new Error(message);
        err.retryable = retryable;
        reject(err);
    };

    if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };

    xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }

        if (xhr.status >= 200 && xhr.status < 300) {
            if (data) resolve(data);
            else fail("Failed to parse server response", true);
            return;
        }
        if (xhr.status === 401) handleSessionExpired();
        const message = (data && data.error) || `Upload failed with status ${xhr.status}`;
        // Client errors (bad file, not enrolled, too large) will not succeed on a retry.
        const retryable = xhr.status >= 500 || xhr.status === 408 || xhr.status === 429 || xhr.status === 0;
        fail(message, retryable);
    };
    xhr.onerror = () => fail("Network error occurred during upload. Please check your connection.", true);
    xhr.ontimeout = () => fail("The upload timed out. Please check your connection and try again.", true);
    xhr.send(body);
});

// Sends one piece, retrying with a short pause between attempts.
const sendChunk = async (info, body, onProgress) => {
    let lastErr;
    for (let attempt = 1; attempt <= CHUNK_RETRIES; attempt++) {
        try {
            onProgress(0);
            return await xhrPost('/api/upload-chunk', {
                headers: {
                    'Content-Type': 'text/plain',
                    'X-Chunk-Meta': encodeURIComponent(JSON.stringify(info))
                },
                body,
                timeoutMs: CHUNK_TIMEOUT_MS,
                onProgress
            });
        } catch (err) {
            lastErr = err;
            if (!err.retryable || attempt === CHUNK_RETRIES) break;
            await sleep(attempt * 1000);
        }
    }
    throw lastErr;
};

// Sends all pieces (a few at a time), then asks the Worker to join them and record the submission.
const uploadChunked = async (meta, base64Data, setStatus) => {
    const total = Math.ceil(base64Data.length / CHUNK_CHARS);
    if (total > MAX_CHUNKS) {
        throw new Error(`File is too large. Maximum size is ${MAX_UPLOAD_MB}MB.`);
    }

    const uploadId = crypto.randomUUID();
    const sentChars = new Array(total).fill(0);   // progress per piece
    const sizes = [];
    for (let i = 0; i < total; i++) {
        sizes.push(Math.min(CHUNK_CHARS, base64Data.length - i * CHUNK_CHARS));
    }
    let doneParts = 0;
    let failed = null;
    let next = 0;

    const report = () => {
        const sent = sentChars.reduce((a, b) => a + b, 0);
        const pct = Math.min(99, Math.floor((sent / base64Data.length) * 100));
        setStatus(`Uploading to Portal... ${pct}%`);
    };

    const worker = async () => {
        while (!failed && next < total) {
            const i = next++;
            const piece = base64Data.slice(i * CHUNK_CHARS, i * CHUNK_CHARS + CHUNK_CHARS);
            try {
                await sendChunk(
                    { uploadId, index: i, total, courseId: meta.courseId, studentId: meta.studentId },
                    piece,
                    (loaded) => { sentChars[i] = Math.min(sizes[i], loaded); report(); }
                );
                sentChars[i] = sizes[i];
                doneParts++;
                report();
            } catch (err) {
                failed = failed || err;
            }
        }
    };

    report();
    await Promise.all(Array.from({ length: Math.min(PARALLEL_CHUNKS, total) }, worker));
    if (failed) throw failed;

    setStatus('Finishing upload... please wait.');
    try {
        return await xhrPost('/api/finish-chunked-upload', {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...meta, uploadId, total }),
            timeoutMs: FINISH_TIMEOUT_MS
        });
    } catch (err) {
        // The final step is not retried automatically: it may already have been saved.
        if (err.retryable) {
            throw new Error(err.message + " Your file may already have been saved, so check View History before uploading again.");
        }
        throw err;
    }
};


// ---- Dashboard templates (pure functions: data in, HTML out) ----
// Reloads the program list into the "target course" dropdown of the Create Course form.
const refreshProgramOptions = async () => {
    const programsData = await apiFetch(`/api/programs?_t=${new Date().getTime()}`);
    const targetCourseSelect = document.getElementById('targetCourse');
    if (targetCourseSelect && programsData.programs) {
        targetCourseSelect.innerHTML = '<option value="">All Courses</option>' +
            programsData.programs.map(p => `<option value="${escapeHtml(p.ProgramCode)}">${escapeHtml(p.ProgramCode)}</option>`).join('');
    }
};

const DAY_ORDER = { 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 'Thursday': 4, 'Friday': 5, 'Saturday': 6, 'Sunday': 7 };

const parseTimeToMinutes = (timeStr) => {
    if (!timeStr) return 0;
    const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) return 0;
    let [ , h, m, period ] = match;
    h = parseInt(h);
    if (period.toUpperCase() === 'PM' && h !== 12) h += 12;
    if (period.toUpperCase() === 'AM' && h === 12) h = 0;
    return h * 60 + parseInt(m);
};

// Sorts in place by weekday, then start time.
const sortCoursesBySchedule = (courses) => courses.sort((a, b) => {
    const dayDiff = (DAY_ORDER[a.ScheduleDay] || 8) - (DAY_ORDER[b.ScheduleDay] || 8);
    if (dayDiff !== 0) return dayDiff;
    return parseTimeToMinutes(a.TimePeriod) - parseTimeToMinutes(b.TimePeriod);
});

const loadErrorHtml = (err) =>
    `<div class="p-4 bg-red-50 text-red-600 rounded font-medium border border-red-200">Failed to load data: ${escapeHtml(err && err.message)}</div>`;

const lecturerCourseCardHtml = (c) => `
                <a href="#class-${c.Course_ID}" class="block p-5 border rounded-xl shadow-sm bg-white transition hover:shadow-md hover:border-blue-300">
                    <div class="flex justify-between items-start mb-1">
                        <div class="font-bold text-xl text-blue-700">${escapeHtml(c.CourseCode)}</div>
                        ${(c.Target_Course || c.Target_Year || c.Target_Section) ?
                            `<span class="bg-gray-100 text-gray-600 text-[10px] font-bold px-2 py-1 rounded border uppercase">
                                ${[c.Target_Course, c.Target_Year, c.Target_Section].filter(Boolean).join(' ')} Only
                            </span>` :
                            `<span class="bg-blue-50 text-blue-500 text-[10px] font-bold px-2 py-1 rounded border uppercase">All Students</span>`
                        }
                    </div>
                    <div class="text-gray-800 font-bold mb-2">${escapeHtml(c.CourseTitle)}</div>
                    <div class="text-sm text-gray-500 bg-gray-50 inline-block px-3 py-1 rounded-md border">
                        <i class="fa-regular fa-calendar mr-1"></i> ${escapeHtml(c.ScheduleDay)} &nbsp;|&nbsp; <i class="fa-regular fa-clock mr-1"></i> ${escapeHtml(c.TimePeriod)}
                    </div>
                </a>
            `;

const enrolledCourseCardHtml = (c) => `
                <div class="cursor-pointer student-active-course p-5 border-2 border-green-200 rounded-xl shadow-sm bg-green-50 relative overflow-hidden transition hover:shadow-md hover:border-green-400 transform hover:-translate-y-1" data-course-id="${c.Course_ID}" data-course-title="${escapeHtml(c.CourseCode)} | ${escapeHtml(c.CourseTitle)}">
                    <div class="absolute top-0 right-0 bg-green-500 text-white text-[10px] px-3 py-1 rounded-bl-xl font-bold shadow-sm tracking-widest uppercase">Enrolled</div>
                    <div class="font-black text-xl text-green-800 pr-16">${escapeHtml(c.CourseCode)}</div>
                    <div class="text-gray-800 font-bold mb-2">${escapeHtml(c.CourseTitle)}</div>
                    <div class="text-sm text-gray-700 font-medium"><i class="fa-solid fa-chalkboard-user w-5 text-gray-400"></i> ${escapeHtml(c.LecturerName)}</div>
                    <div class="text-sm text-gray-700 mt-1"><i class="fa-regular fa-calendar w-5 text-gray-400"></i> ${escapeHtml(c.ScheduleDay)} &nbsp;|&nbsp; <i class="fa-regular fa-clock text-gray-400"></i> ${escapeHtml(c.TimePeriod)}</div>
                    <div class="text-sm text-gray-700 mt-1"><i class="fa-solid fa-chair w-5 text-gray-400"></i> Seat: <span class="font-bold">${escapeHtml(c.Seat_Number || 'Unassigned')}</span></div>
                </div>
            `;

const availableCourseCardHtml = (c) => `
                <div class="p-5 border rounded-xl shadow-sm bg-white flex flex-col md:flex-row justify-between items-start md:items-center transition hover:border-blue-300 gap-4">
                    <div>
                        <div class="font-black text-xl text-blue-700">${escapeHtml(c.CourseCode)}</div>
                        <div class="text-gray-800 font-bold mb-2">${escapeHtml(c.CourseTitle)}</div>
                        <div class="text-sm text-gray-600 font-medium"><i class="fa-solid fa-chalkboard-user w-5 text-gray-400"></i> ${escapeHtml(c.LecturerName)}</div>
                        <div class="text-sm text-gray-600 mt-1"><i class="fa-regular fa-calendar w-5 text-gray-400"></i> ${escapeHtml(c.ScheduleDay)} &nbsp;|&nbsp; <i class="fa-regular fa-clock text-gray-400"></i> ${escapeHtml(c.TimePeriod)}</div>
                    </div>
                    <button data-id="${c.Course_ID}" class="enroll-btn w-full md:w-auto px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm font-bold transition-colors">
                        Enroll Now
                    </button>
                </div>
            `;

const buildAssignedExamsSection = (assignedExams, isBlind) => {
    if (!(assignedExams.length > 0 || isBlind)) return '';
    let assignedExamsSectionHtml = '';
                const examCardsHtml = assignedExams.length > 0
                    ? assignedExams.map(ex => {
                        const isDone = ex.status === 'Completed';
                        return `
                            <div class="dash-exam-card p-5 rounded-xl border-2 ${isDone ? 'bg-indigo-900/70 border-indigo-700' : 'bg-indigo-900 border-yellow-400'} flex flex-col justify-between gap-4 shadow-md transition hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-yellow-400 cursor-pointer" tabindex="0">
                                <div>
                                    <div class="flex justify-between items-start gap-2">
                                        <span class="px-2.5 py-0.5 bg-yellow-400 text-gray-950 font-black text-[10px] rounded uppercase tracking-wider">${escapeHtml(ex.courseCode)} &bull; ${ex.term}</span>
                                        ${ex.toDate ? `<span class="text-[10px] text-indigo-200 font-mono">Open until: ${ex.toDate}</span>` : ''}
                                    </div>
                                    <h3 class="text-lg sm:text-xl font-black text-white mt-2">${escapeHtml(ex.examTitle)}</h3>
                                    <p class="text-xs text-indigo-200 font-medium mt-0.5">${escapeHtml(ex.courseTitle)}</p>
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
                                        <i class="fa-solid ${isBlind ? 'fa-headphones' : 'fa-pen-to-square'} mr-2 text-lg"></i> Enter Exam: ${escapeHtml(ex.examTitle)}
                                    </button>
                                `}
                            </div>
                        `;
                    }).join('')
                    : `<div class="col-span-full p-6 text-center text-indigo-200 border-2 border-dashed border-indigo-700 rounded-xl font-bold text-sm">You have no active assigned exams at this moment.</div>`;

                const readAloudBtnHtml = isBlind ? `
                            <button type="button" id="readDashboardExamsBtn" class="w-full sm:w-auto px-4 py-2.5 bg-yellow-400 hover:bg-yellow-300 text-gray-950 font-black text-xs sm:text-sm rounded-lg shadow transition flex items-center justify-center focus:outline-none focus:ring-4 focus:ring-white">
                                <i class="fa-solid fa-volume-high mr-2"></i> Read Aloud Assigned Exams
                            </button>` : '';

                assignedExamsSectionHtml = `
                    <section class="bg-indigo-950 text-white p-5 sm:p-6 rounded-2xl shadow-lg border-2 border-yellow-400">
                        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-5 pb-3 border-b border-indigo-800">
                            <div class="flex items-center">
                                <div class="bg-yellow-400 text-gray-950 p-2.5 rounded-xl mr-3">
                                    <i class="fa-solid ${isBlind ? 'fa-universal-access' : 'fa-file-pen'} text-xl"></i>
                                </div>
                                <div>
                                    <h2 class="text-xl sm:text-2xl font-black text-white">${isBlind ? 'Assigned Accessible Exams' : 'Assigned Exams'}</h2>
                                    <p class="text-xs text-indigo-200">${isBlind ? 'Full-screen exam mode with voice read-aloud and automatic score recording' : 'Full-screen exam mode with automatic score recording'}</p>
                                </div>
                            </div>
                            ${readAloudBtnHtml}
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            ${examCardsHtml}
                        </div>
                    </section>
                `;
    return assignedExamsSectionHtml;
};

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
                        <span>${escapeHtml(m.Name)} (${escapeHtml(m.Student_Number || 'N/A')})</span>
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

                if (file.size > MAX_UPLOAD_BYTES) {
                    throw new Error(`File size exceeds ${MAX_UPLOAD_MB}MB. Please upload your document to Google Drive, set the sharing access to 'Anyone with the link', and submit it here as a URL Link instead.`);
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

            // Details travel in a header; the raw base64 file is the request body.
            // The Worker streams the body straight to Google Drive without parsing it,
            // which is what allows large files.
            const meta = {
                courseId: courseId,
                studentId: user.User_ID,
                term: term,
                title: title,
                description: desc,
                type: type,
                filename: finalFilename,
                mimeType: mimeType,
                pathParts: [courseYearSection, "Submitted"],
                isGroup: isGroup,
                includedMembers: includedMembers
            };

            progressText.textContent = 'Starting upload...';

            let dbData;
            if (base64Data.length <= CHUNK_CHARS) {
                // Small file or link: one request.
                dbData = await xhrPost('/api/upload-submission', {
                    headers: {
                        'Content-Type': 'text/plain',
                        'X-Submission-Meta': encodeURIComponent(JSON.stringify(meta))
                    },
                    body: base64Data,
                    timeoutMs: SINGLE_TIMEOUT_MS,
                    onProgress: (loaded) => {
                        const pct = Math.min(99, Math.floor((loaded / base64Data.length) * 100));
                        progressText.textContent = `Uploading to Portal... ${pct}%`;
                    }
                });
            } else {
                // Large file: pieces with retries.
                dbData = await uploadChunked(meta, base64Data, (text) => { progressText.textContent = text; });
            }

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

            await refreshProgramOptions();

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
            UI.error(err.message);
            await CourseDashboard.loadDashboardData();
        }
    },

    renderLecturerDashboard: async (container) => {
        try {
            const ts = new Date().getTime();
            await refreshProgramOptions();

            const data = await apiFetch(`/api/my-courses?userId=${AppState.user.User_ID}&role=lecturer&_t=${ts}`);

            sortCoursesBySchedule(data.courses);

            let coursesHtml = data.courses.map(lecturerCourseCardHtml).join('');

            if (!coursesHtml) {
                coursesHtml = `<div class="col-span-full p-8 text-center text-gray-500 border-2 border-dashed rounded-xl bg-gray-50 font-medium"><p class="mb-4">No courses created yet.</p><button type="button" id="emptyNewCourseBtn" class="open-create-course-btn flex-shrink-0 inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-bold shadow-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"><i class="fa-solid fa-plus mr-2"></i> New Course</button></div>`;
            }

            container.innerHTML = `
                <div class="fade-in max-w-5xl mx-auto">
                    <div class="flex items-center justify-between gap-3 mb-6">
                        <h2 class="text-xl font-bold text-gray-800 flex items-center"><div class="bg-gray-200 p-2 rounded-lg mr-3"><i class="fa-solid fa-chalkboard-user text-gray-600"></i></div>My Created Courses</h2>
                        <button type="button" id="headerNewCourseBtn" class="open-create-course-btn flex-shrink-0 inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-bold shadow-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"><i class="fa-solid fa-plus mr-2"></i> New Course</button>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        ${coursesHtml}
                    </div>
                </div>
            `;
        } catch (err) {
            container.innerHTML = loadErrorHtml(err);
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
                AppState.user.Program_Course = examsRes.student.Program_Course;
                AppState.user.Program_Year = examsRes.student.Program_Year;
                AppState.user.Program_Section = examsRes.student.Program_Section;
                const progEl = document.getElementById('profileProgramText');
                if (progEl) progEl.textContent = [examsRes.student.Program_Course, examsRes.student.Program_Year, examsRes.student.Program_Section].filter(Boolean).join(' ') || 'Not assigned';
            }

            const isBlind = AppState.user.eye_condition === 'Legally Blind';

            const assignedExamsSectionHtml = buildAssignedExamsSection(assignedExams, isBlind);

            const enrolledIds = myCoursesRes.courses.map(c => c.Course_ID);

            let enrolledHtml = myCoursesRes.courses.map(enrolledCourseCardHtml).join('');

            if (!enrolledHtml) {
                enrolledHtml = '<div class="col-span-full p-8 text-center text-gray-500 border-2 border-dashed rounded-xl bg-gray-50 font-medium">You are not enrolled in any courses yet.</div>';
            }

            const availableCourses = allCoursesRes.courses.filter(c => !enrolledIds.includes(c.Course_ID));
            let availableHtml = availableCourses.map(availableCourseCardHtml).join('');

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
            container.innerHTML = loadErrorHtml(err);
        }
    },

    loadDashboardData: async () => {
        const container = document.getElementById('courseContainer');
        if (!container || !AppState.user) return;

        container.innerHTML = Skeleton.dashboard(AppState.user.role);

        if (AppState.user.role.toLowerCase() === 'lecturer') {
            await CourseDashboard.renderLecturerDashboard(container);
        } else {
            await CourseDashboard.renderStudentDashboard(container);
        }
    }
};
