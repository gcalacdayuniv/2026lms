// js/course-exam.js
import { apiFetch, AppState } from './globals.js';
import { CourseClass } from './course-class.js';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const CourseExam = {
    exams: [],
    classExams: [],
    classAssignments: [],
    activeConfigExamId: null,
    activeBonusExamId: null,
    activeBonusData: [],

    // Lecturer Presentation State
    quizData: [],
    current: 0,
    revealed: false,
    zoom: 1,

    // Student Dashboard & Accessible Exam State
    studentAssignedExams: [],
    accExam: null,
    accStudent: null,
    accAnswers: [],
    accIndex: 0,
    accSubmitting: false,
    accOnComplete: null,
    lastEnterSpaceTime: 0,

    init: () => {
        document.addEventListener('click', CourseExam.handleClicks);
        document.addEventListener('change', CourseExam.handleChanges);
        document.addEventListener('keydown', CourseExam.handleKeydown);
        document.addEventListener('focusin', CourseExam.handleFocus);
    },

    speak: (text) => {
        if (!('speechSynthesis' in window)) return;
        try {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 0.98;
            utterance.pitch = 1;
            window.speechSynthesis.speak(utterance);
        } catch (e) {
            console.error('Speech synthesis error:', e);
        }
    },

    handleFocus: (e) => {
        const accOverlay = document.getElementById('accessibleExamOverlay');
        if (accOverlay && !accOverlay.classList.contains('hidden') && CourseExam.accExam) {
            if (e.target.id === 'accExamQuestionText') {
                CourseExam.speak("Question: " + e.target.textContent);
            } else if (e.target.classList.contains('acc-exam-choice-btn')) {
                const idx = parseInt(e.target.dataset.choiceIndex, 10);
                const letter = String.fromCharCode(65 + idx);
                const q = CourseExam.accExam.questions[CourseExam.accIndex];
                if (q && q.choices && q.choices[idx]) {
                    CourseExam.speak(`Choice ${idx + 1}, ${letter}: ${q.choices[idx]}`);
                }
            } else if (e.target.id === 'accExamPrevBtn') {
                CourseExam.speak("Previous Button");
            } else if (e.target.id === 'accExamNextBtn') {
                CourseExam.speak("Next Button");
            } else if (e.target.id === 'accExamSubmitBtn') {
                CourseExam.speak("Submit Exam Button");
            } else if (e.target.id === 'accExamExitBtn') {
                CourseExam.speak("Exit Exam Button");
            } else if (e.target.id === 'accExamRepeatAudioBtn') {
                CourseExam.speak("Read Question Again Button");
            } else if (e.target.id === 'accExamTextAnswerInput') {
                CourseExam.speak("Text Answer Input. Type your answer here.");
            }
        }
    },

    downloadCsvTemplate: () => {
        const rows = [
            ['Part Index', 'Question', 'Choices', 'Answer', 'Explanation', 'Bonus'],
            ['0', 'What does CPU stand for?', 'Central Processing Unit | Control Processing Unit | Computer Personal Unit | Central Power Unit', 'Central Processing Unit', 'The CPU is the primary component of a computer that processes instructions.', ''],
            ['0', 'Statement I: HTML is used to structure web pages.\nStatement II: CSS is used to style web pages.', 'Both statements are true | Both statements are false | Only Statement I is true | Only Statement II is true', 'Both statements are true', 'HTML provides structure while CSS handles presentation.', ''],
            ['1', 'The binary number system uses only 0 and 1.', 'True | False', 'True', 'Binary is a base-2 numeral system.', ''],
            ['2', 'Identify the protocol used for secure communication over a computer network (abbreviation).', '', 'HTTPS', 'Hypertext Transfer Protocol Secure encrypts data between browser and server.', ''],
            ['0', 'BONUS: Which company developed the JavaScript programming language originally named Mocha?', 'Netscape | Microsoft | Sun Microsystems | IBM', 'Netscape', 'Brendan Eich created JavaScript at Netscape in 1995.', '1']
        ];

        const csvCell = (val) => {
            const str = String(val ?? '');
            return `"${str.replace(/"/g, '""')}"`;
        };

        const csvContent = '\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'exam_upload_template.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },

    announceDashboardExams: () => {
        const exams = CourseExam.studentAssignedExams || [];
        const userName = AppState.user?.Name || 'Student';
        if (exams.length === 0) {
            CourseExam.speak(`Hello ${userName}. You currently have no active exams assigned to you.`);
            return;
        }

        const pending = exams.filter(e => e.status !== 'Completed');
        let msg = `Hello ${userName}. You have ${exams.length} assigned exam${exams.length > 1 ? 's' : ''} on your dashboard. `;
        if (pending.length > 0) {
            pending.forEach((ex, i) => {
                msg += `Exam ${i + 1}: ${ex.examTitle} for ${ex.courseCode}, with ${ex.regularCount} regular questions${ex.bonusCount > 0 ? ` and ${ex.bonusCount} bonus questions` : ''}. Press the Enter Exam button for ${ex.examTitle} to begin. `;
            });
        } else {
            msg += `All of your assigned exams have already been submitted.`;
        }
        CourseExam.speak(msg);
    },

    handleClicks: async (e) => {
        if (e.target.closest('#downloadExamCsvTemplateBtn')) {
            CourseExam.downloadCsvTemplate();
        }

        if (e.target.closest('#toggleExamCsvGuideBtn')) {
            const panel = document.getElementById('examCsvGuidePanel');
            if (panel) panel.classList.toggle('hidden');
        }

        if (e.target.closest('#readDashboardExamsBtn')) {
            CourseExam.announceDashboardExams();
        }

        if (e.target.closest('.start-accessible-exam-btn')) {
            const btn = e.target.closest('.start-accessible-exam-btn');
            const assignmentId = btn.dataset.assignmentId;
            const examObj = (CourseExam.studentAssignedExams || []).find(ex => ex.assignmentId === assignmentId);
            if (examObj && AppState.user) {
                CourseExam.startAccessibleExam(examObj, AppState.user, () => {
                    window.dispatchEvent(new Event('hashchange'));
                });
            }
        }

        if (e.target.closest('#openExamManagerBtn')) {
            document.getElementById('courseMenuModal')?.classList.add('hidden');
            document.getElementById('examManagerModal').classList.remove('hidden');
            CourseExam.showMainManagerView();
            await CourseExam.loadExams();
        }

        if (e.target.closest('#closeExamManagerBtn') || e.target.id === 'closeExamManagerBg') {
            document.getElementById('examManagerModal').classList.add('hidden');
        }

        if (e.target.closest('#uploadExamBtn')) {
            await CourseExam.uploadCsv();
        }

        if (e.target.closest('.present-exam-btn')) {
            const btn = e.target.closest('.present-exam-btn');
            await CourseExam.startPresentation(btn.dataset.examId, btn.dataset.title);
        }

        if (e.target.closest('.assign-class-exam-btn')) {
            const btn = e.target.closest('.assign-class-exam-btn');
            await CourseExam.openClassAssignView(btn.dataset.examId, btn.dataset.title);
        }

        if (e.target.closest('.manage-bonus-exam-btn')) {
            const btn = e.target.closest('.manage-bonus-exam-btn');
            await CourseExam.openBonusView(btn.dataset.examId, btn.dataset.title);
        }

        if (e.target.closest('#backFromExamAssignBtn') || e.target.closest('#backFromExamBonusBtn')) {
            CourseExam.showMainManagerView();
            await CourseExam.loadExams();
        }

        if (e.target.closest('#ecaSelectBlindBtn')) {
            document.querySelectorAll('.eca-student-checkbox').forEach(cb => {
                cb.checked = cb.dataset.eye === 'Legally Blind';
            });
        }

        if (e.target.closest('#ecaSelectAllBtn')) {
            document.querySelectorAll('.eca-student-checkbox').forEach(cb => {
                cb.checked = true;
            });
        }

        if (e.target.closest('#ecaUnselectAllBtn')) {
            document.querySelectorAll('.eca-student-checkbox').forEach(cb => {
                cb.checked = false;
            });
        }

        if (e.target.closest('#saveExamClassAssignBtn')) {
            await CourseExam.saveClassExamAssignment();
        }

        if (e.target.closest('.reset-student-exam-btn')) {
            const btn = e.target.closest('.reset-student-exam-btn');
            await CourseExam.resetStudentAttempt(btn.dataset.classExamId, btn.dataset.studentId, btn.dataset.name);
        }

        if (e.target.closest('#addBonusQuestionBtn')) {
            await CourseExam.addBonusQuestion();
        }

        if (e.target.closest('.delete-exam-question-btn')) {
            const btn = e.target.closest('.delete-exam-question-btn');
            const idx = parseInt(btn.dataset.index, 10);
            await CourseExam.deleteExamQuestion(idx);
        }

        if (e.target.closest('#closeExamPresentationBtn')) {
            document.getElementById('examPresentationOverlay').classList.add('hidden');
        }

        if (e.target.closest('#examPrevBtn')) CourseExam.navigate(-1);
        if (e.target.closest('#examNextBtn')) CourseExam.navigate(1);
        if (e.target.closest('#examRevealBtn')) CourseExam.toggleAnswer();
        if (e.target.closest('#examRestartBtn')) CourseExam.restart();

        if (e.target.closest('.acc-exam-choice-btn')) {
            const btn = e.target.closest('.acc-exam-choice-btn');
            const choiceIndex = parseInt(btn.dataset.choiceIndex, 10);
            CourseExam.selectAccessibleChoice(choiceIndex);
        }

        if (e.target.closest('#accExamPrevBtn')) CourseExam.navigateAccessible(-1);
        if (e.target.closest('#accExamNextBtn')) CourseExam.navigateAccessible(1);
        if (e.target.closest('#accExamRepeatAudioBtn')) CourseExam.readCurrentAccessibleQuestion();
        if (e.target.closest('#accExamSubmitBtn')) await CourseExam.submitAccessibleExam();
        if (e.target.closest('#accExamExitBtn')) CourseExam.closeAccessibleExam();
    },

    handleChanges: async (e) => {
        if (e.target.classList.contains('toggle-question-bonus-cb')) {
            const idx = parseInt(e.target.dataset.index, 10);
            await CourseExam.toggleQuestionBonus(idx, e.target.checked);
        }

        if (e.target.id === 'accExamTextAnswerInput') {
            const val = e.target.value.trim();
            CourseExam.accAnswers[CourseExam.accIndex] = val;
            if (CourseExam.accExam) {
                localStorage.setItem('acc_exam_draft_' + CourseExam.accExam.assignmentId, JSON.stringify(CourseExam.accAnswers));
            }
            CourseExam.updateAccessibleAnsweredBadge();
            if (val) {
                const msg = `You typed ${val} as your answer for Question ${CourseExam.accIndex + 1}.`;
                document.getElementById('accExamLiveFeedback').textContent = msg;
                CourseExam.speak(msg);
            }
        }
    },

    handleKeydown: (e) => {
        const accOverlay = document.getElementById('accessibleExamOverlay');
        
        // 1. Accessible Exam Overlay Logic
        if (accOverlay && !accOverlay.classList.contains('hidden') && CourseExam.accExam) {
            
            // Allow normal typing in text input, but let Enter register as a submit/blur
            if (document.activeElement && document.activeElement.id === 'accExamTextAnswerInput') {
                if (e.key === ' ') return; // Let space type space
            } else {
                if (e.key === ' ') e.preventDefault(); // Prevent page scroll for space globally in exam
            }

            // Enter & Space Double Tap Logic
            if (e.key === 'Enter' || e.key === ' ') {
                const now = Date.now();
                if (now - (CourseExam.lastEnterSpaceTime || 0) < 600) { 
                    // Double press detected
                    e.preventDefault(); 
                    CourseExam.lastEnterSpaceTime = 0; // Reset
                    const isLast = CourseExam.accIndex === CourseExam.accExam.questions.length - 1;
                    if (isLast) {
                        CourseExam.submitAccessibleExam();
                    } else {
                        CourseExam.navigateAccessible(1);
                    }
                    return;
                } else {
                    CourseExam.lastEnterSpaceTime = now;
                    // Single Press
                    const activeEl = document.activeElement;
                    const isChoice = activeEl && activeEl.classList.contains('acc-exam-choice-btn');
                    
                    if (e.key === ' ' && isChoice) {
                        activeEl.click();
                    } else if (!isChoice && (!activeEl || activeEl.id !== 'accExamTextAnswerInput')) {
                        const isLast = CourseExam.accIndex === CourseExam.accExam.questions.length - 1;
                        const action = isLast ? "submit the exam" : "go to the next question";
                        CourseExam.speak(`Double press Enter or Space to ${action}.`);
                    }
                }
            }

            // Arrow Up/Down for Focus Navigation
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const focusables = Array.from(document.querySelectorAll('#accessibleExamOverlay [tabindex="0"], #accessibleExamOverlay button, #accessibleExamOverlay input')).filter(el => !el.disabled && el.offsetParent !== null);
                const currIdx = focusables.indexOf(document.activeElement);
                if (currIdx > -1) {
                    e.preventDefault();
                    const nextIdx = e.key === 'ArrowDown' ? currIdx + 1 : currIdx - 1;
                    if (nextIdx >= 0 && nextIdx < focusables.length) {
                        focusables[nextIdx].focus();
                    }
                }
            }

            // Right/Left for Question Navigation
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                CourseExam.navigateAccessible(1);
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                CourseExam.navigateAccessible(-1);
            }

            // Hotkeys for Audio and Direct Focus
            if (e.key === 'r' || e.key === 'R') {
                e.preventDefault();
                CourseExam.readCurrentAccessibleQuestion();
            } else if (e.key === 'q' || e.key === 'Q') {
                e.preventDefault();
                document.getElementById('accExamQuestionText')?.focus();
            } else if (/^[1-9]$/.test(e.key)) { e.preventDefault(); const idx = parseInt(e.key, 10) - 1; const choices = document.querySelectorAll('.acc-exam-choice-btn'); if (choices[idx]) { choices[idx].focus(); } } else if (/^[a-dA-D]$/.test(e.key)) {
                e.preventDefault();
                const idx = e.key.toUpperCase().charCodeAt(0) - 65;
                const choices = document.querySelectorAll('.acc-exam-choice-btn');
                if (choices[idx]) {
                    choices[idx].focus();
                }
            }
            return;
        }

        // 2. Lecturer Presentation Keyboard Shortcuts
        const overlay = document.getElementById('examPresentationOverlay');
        if (!overlay || overlay.classList.contains('hidden')) return;

        if (e.key === "Home") CourseExam.restart();
        else if (e.key === "ArrowRight") CourseExam.navigate(1);
        else if (e.key === "ArrowLeft") CourseExam.navigate(-1);
        else if (e.key === " " && document.activeElement.tagName !== "BUTTON") {
            e.preventDefault();
            CourseExam.toggleAnswer();
        }
    },

    showMainManagerView: () => {
        document.getElementById('examManagerMainView')?.classList.remove('hidden');
        document.getElementById('examClassAssignView')?.classList.add('hidden');
        document.getElementById('examBonusView')?.classList.add('hidden');
    },

    loadExams: async () => {
        const container = document.getElementById('examListContainer');
        if (!container) return;
        container.innerHTML = '<div class="text-center py-6 text-gray-500"><i class="fa-solid fa-spinner fa-spin text-2xl"></i></div>';

        const courseId = window.location.hash.startsWith('#class-') ? window.location.hash.replace('#class-', '') : '';

        try {
            const ts = new Date().getTime();
            const lecturerId = AppState.user.User_ID;
            const requests = [apiFetch(`/api/exams?lecturerId=${lecturerId}&_t=${ts}`)];
            if (courseId) {
                requests.push(apiFetch(`/api/class-exams?courseId=${courseId}&_t=${ts}`));
            }

            const [examRes, classExamRes] = await Promise.all(requests);
            CourseExam.exams = examRes.exams || [];
            CourseExam.classExams = classExamRes ? (classExamRes.classExams || []) : [];
            CourseExam.classAssignments = classExamRes ? (classExamRes.assignments || []) : [];

            if (CourseExam.exams.length === 0) {
                container.innerHTML = '<div class="text-sm text-gray-500 italic text-center py-6">No exams uploaded yet.</div>';
                return;
            }

            container.innerHTML = CourseExam.exams.map(ex => {
                let parsed = [];
                try { parsed = JSON.parse(ex.ExamData || '[]'); } catch (e) { parsed = []; }
                const regCount = parsed.filter(q => !q[5]).length;
                const bonusCount = parsed.filter(q => Boolean(q[5])).length;

                const linked = CourseExam.classExams.find(ce => ce.Exam_ID === ex.Exam_ID);
                const enabledStudentsCount = linked
                    ? CourseExam.classAssignments.filter(a => a.Class_Exam_ID === linked.Class_Exam_ID && a.Is_Enabled === 1).length
                    : 0;

                const linkBadge = linked && linked.Is_Active
                    ? `<span class="text-[10px] bg-green-100 text-green-800 border border-green-300 font-bold px-2 py-0.5 rounded">Linked (${enabledStudentsCount} student${enabledStudentsCount === 1 ? '' : 's'}) | ${linked.From_Date || 'Any'} to ${linked.To_Date || 'Any'}</span>`
                    : `<span class="text-[10px] bg-gray-100 text-gray-600 border border-gray-200 font-medium px-2 py-0.5 rounded">Not linked to this class</span>`;

                return `
                    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-3 border border-gray-200 rounded-lg shadow-sm hover:border-blue-300 transition gap-3">
                        <div>
                            <div class="font-black text-gray-800 text-sm flex flex-wrap items-center gap-2">
                                <span>${esc(ex.Title)}</span>
                                <span class="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded font-bold">${regCount} Qs${bonusCount > 0 ? ` + ${bonusCount} Bonus` : ''}</span>
                            </div>
                            <div class="mt-1 flex flex-wrap items-center gap-2">
                                ${linkBadge}
                            </div>
                        </div>
                        <div class="flex flex-wrap items-center gap-1.5 w-full sm:w-auto justify-end">
                            <button type="button" class="manage-bonus-exam-btn bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-300 px-3 py-1.5 rounded text-xs font-bold transition shadow-sm" data-exam-id="${esc(ex.Exam_ID)}" data-title="${esc(ex.Title)}">
                                <i class="fa-solid fa-star mr-1"></i> Bonus Qs
                            </button>
                            ${courseId ? `
                                <button type="button" class="assign-class-exam-btn bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 px-3 py-1.5 rounded text-xs font-bold transition shadow-sm" data-exam-id="${esc(ex.Exam_ID)}" data-title="${esc(ex.Title)}">
                                    <i class="fa-solid fa-universal-access mr-1"></i> Link & Assign Students
                                </button>
                            ` : ''}
                            <button type="button" class="present-exam-btn bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 px-3 py-1.5 rounded text-xs font-bold transition shadow-sm" data-exam-id="${esc(ex.Exam_ID)}" data-title="${esc(ex.Title)}">
                                <i class="fa-solid fa-play mr-1"></i> Present
                            </button>
                        </div>
                    </div>
                `;
            }).join('');

        } catch (err) {
            container.innerHTML = `<div class="text-red-500 font-bold text-sm text-center py-4">${esc(err.message)}</div>`;
        }
    },

    openClassAssignView: async (examId, title) => {
        CourseExam.activeConfigExamId = examId;
        document.getElementById('examManagerMainView').classList.add('hidden');
        document.getElementById('examBonusView').classList.add('hidden');
        document.getElementById('examClassAssignView').classList.remove('hidden');

        document.getElementById('ecaExamTitle').textContent = title;
        const alertBox = document.getElementById('ecaAlert');
        alertBox.classList.add('hidden');

        const linked = CourseExam.classExams.find(ce => ce.Exam_ID === examId);
        document.getElementById('ecaIsActive').checked = linked ? Boolean(linked.Is_Active) : true;
        document.getElementById('ecaTerm').value = linked?.Term || 'MidTerm';
        document.getElementById('ecaCategory').value = linked?.Category || 'MajorExam';
        document.getElementById('ecaFromDate').value = linked?.From_Date || '';
        document.getElementById('ecaToDate').value = linked?.To_Date || '';

        const listEl = document.getElementById('ecaStudentList');
        const students = CourseClass.currentStudents || [];

        if (students.length === 0) {
            listEl.innerHTML = '<div class="text-center py-8 text-xs text-gray-500 italic">No students enrolled in this class yet.</div>';
            return;
        }

        const assignMap = {};
        if (linked) {
            CourseExam.classAssignments
                .filter(a => a.Class_Exam_ID === linked.Class_Exam_ID)
                .forEach(a => { assignMap[a.Student_ID] = a; });
        }

        listEl.innerHTML = students.map(s => {
            const record = assignMap[s.User_ID];
            const isBlind = s.eye_condition === 'Legally Blind';
            const isChecked = record ? record.Is_Enabled === 1 : isBlind;

            const eyeBadge = isBlind
                ? `<span class="px-2 py-0.5 text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300 rounded"><i class="fa-solid fa-universal-access mr-1"></i>Legally Blind</span>`
                : (s.eye_condition ? `<span class="px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-600 border border-gray-200 rounded">${esc(s.eye_condition)}</span>` : '');

            let statusHtml = `<span class="text-[10px] text-gray-400 font-medium">Not Taken</span>`;
            if (record && record.Status === 'Completed') {
                statusHtml = `
                    <span class="text-[10px] bg-green-100 text-green-800 border border-green-300 px-2 py-0.5 rounded font-black">
                        Score: ${record.Final_Score} / ${record.Max_Score || '-'}
                    </span>
                    <button type="button" class="reset-student-exam-btn text-[10px] bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-2 py-0.5 rounded font-bold transition"
                        data-class-exam-id="${esc(linked.Class_Exam_ID)}"
                        data-student-id="${esc(s.User_ID)}"
                        data-name="${esc(s.Name)}">
                        <i class="fa-solid fa-folder-open mr-1"></i> Re-open Exam (Reset)
                    </button>
                `;
            }

            return `
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center p-2.5 bg-white border ${isBlind ? 'border-amber-300 bg-amber-50/30' : 'border-gray-200'} rounded-md gap-2">
                    <label class="flex items-center space-x-3 cursor-pointer flex-1">
                        <input type="checkbox" class="eca-student-checkbox w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                            value="${esc(s.User_ID)}"
                            data-eye="${esc(s.eye_condition || '')}"
                            ${isChecked ? 'checked' : ''}>
                        <div>
                            <div class="text-xs font-bold text-gray-800 flex flex-wrap items-center gap-1.5">
                                <span>${esc(s.Name)}</span>
                                <span class="text-[10px] text-gray-500 font-mono">(${esc(s.Student_Number || 'N/A')})</span>
                                ${eyeBadge}
                            </div>
                        </div>
                    </label>
                    <div class="flex items-center gap-2 self-end sm:self-center">
                        ${statusHtml}
                    </div>
                </div>
            `;
        }).join('');
    },

    saveClassExamAssignment: async () => {
        const courseId = window.location.hash.replace('#class-', '');
        const examId = CourseExam.activeConfigExamId;
        const btn = document.getElementById('saveExamClassAssignBtn');
        const alertBox = document.getElementById('ecaAlert');

        if (!courseId || !examId) return;

        const isActive = document.getElementById('ecaIsActive').checked;
        const term = document.getElementById('ecaTerm').value;
        const category = document.getElementById('ecaCategory').value;
        const fromDate = document.getElementById('ecaFromDate').value;
        const toDate = document.getElementById('ecaToDate').value;

        if (fromDate && toDate && fromDate > toDate) {
            alertBox.textContent = "From Date cannot be later than To Date.";
            alertBox.className = "mb-3 p-2 rounded text-xs font-bold bg-red-100 text-red-700 block";
            return;
        }

        const assignments = Array.from(document.querySelectorAll('.eca-student-checkbox')).map(cb => ({
            studentId: cb.value,
            isEnabled: cb.checked
        }));

        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Saving...';

        try {
            await apiFetch('/api/class-exams', {
                method: 'POST',
                body: JSON.stringify({
                    courseId,
                    examId,
                    term,
                    category,
                    isActive,
                    fromDate,
                    toDate,
                    assignments
                })
            });

            alertBox.textContent = "Class link, schedule dates, assessment link, and student permissions saved!";
            alertBox.className = "mb-3 p-2 rounded text-xs font-bold bg-green-100 text-green-800 block";

            const ts = new Date().getTime();
            const classExamRes = await apiFetch(`/api/class-exams?courseId=${courseId}&_t=${ts}`);
            CourseExam.classExams = classExamRes.classExams || [];
            CourseExam.classAssignments = classExamRes.assignments || [];
        } catch (err) {
            alertBox.textContent = err.message;
            alertBox.className = "mb-3 p-2 rounded text-xs font-bold bg-red-100 text-red-700 block";
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    },

    resetStudentAttempt: async (classExamId, studentId, studentName) => {
        if (!window.confirm(`Reset and explicitly re-open the exam submission for ${studentName} so they can take it again?`)) return;

        try {
            await apiFetch('/api/reset-exam-attempt', {
                method: 'POST',
                body: JSON.stringify({ classExamId, studentId })
            });
            const courseId = window.location.hash.replace('#class-', '');
            const ts = new Date().getTime();
            const classExamRes = await apiFetch(`/api/class-exams?courseId=${courseId}&_t=${ts}`);
            CourseExam.classExams = classExamRes.classExams || [];
            CourseExam.classAssignments = classExamRes.assignments || [];
            const title = document.getElementById('ecaExamTitle').textContent;
            await CourseExam.openClassAssignView(CourseExam.activeConfigExamId, title);
        } catch (err) {
            alert('Failed to reset attempt: ' + err.message);
        }
    },

    openBonusView: async (examId, title) => {
        CourseExam.activeBonusExamId = examId;
        document.getElementById('examManagerMainView').classList.add('hidden');
        document.getElementById('examClassAssignView').classList.add('hidden');
        document.getElementById('examBonusView').classList.remove('hidden');

        document.getElementById('ebvExamTitle').textContent = title;
        document.getElementById('ebvAlert').classList.add('hidden');

        const listEl = document.getElementById('ebvQuestionsList');
        listEl.innerHTML = '<div class="text-center py-6 text-gray-500"><i class="fa-solid fa-spinner fa-spin"></i></div>';

        try {
            const data = await apiFetch(`/api/exam-data?examId=${examId}&_t=${Date.now()}`);
            CourseExam.activeBonusData = JSON.parse(data.exam.ExamData || '[]');
            CourseExam.renderBonusQuestionsList();
        } catch (err) {
            listEl.innerHTML = `<div class="text-red-500 text-xs font-bold p-4 text-center">${esc(err.message)}</div>`;
        }
    },

    renderBonusQuestionsList: () => {
        const listEl = document.getElementById('ebvQuestionsList');
        if (!listEl) return;

        if (CourseExam.activeBonusData.length === 0) {
            listEl.innerHTML = '<div class="text-center py-6 text-xs text-gray-500 italic">No questions in this exam.</div>';
            return;
        }

        listEl.innerHTML = CourseExam.activeBonusData.map((q, idx) => {
            const isBonus = Boolean(q[5]);
            const choicesText = Array.isArray(q[2]) && q[2].length > 0 ? q[2].join(' | ') : 'Identification / No choices';

            return `
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center p-2.5 bg-white border ${isBonus ? 'border-amber-400 bg-amber-50/40' : 'border-gray-200'} rounded-md gap-2">
                    <div class="flex-1 pr-2">
                        <div class="text-xs font-bold text-gray-800">
                            <span class="text-blue-600 font-black mr-1">#${idx + 1}</span>
                            ${isBonus ? '<span class="px-1.5 py-0.5 text-[9px] font-black uppercase bg-amber-200 text-amber-900 rounded mr-1">BONUS</span>' : ''}
                            ${esc(q[1])}
                        </div>
                        <div class="text-[10px] text-gray-500 mt-0.5">Choices: ${esc(choicesText)} &bull; <span class="font-bold text-green-700">Ans: ${esc(q[3])}</span></div>
                    </div>
                    <div class="flex items-center gap-3 self-end sm:self-center flex-shrink-0">
                        <label class="flex items-center space-x-1.5 text-xs font-bold ${isBonus ? 'text-amber-800' : 'text-gray-600'} cursor-pointer">
                            <input type="checkbox" class="toggle-question-bonus-cb rounded text-amber-600 focus:ring-amber-500" data-index="${idx}" ${isBonus ? 'checked' : ''}>
                            <span>Bonus</span>
                        </label>
                        <button type="button" class="delete-exam-question-btn text-red-500 hover:text-red-700 px-2 py-1 bg-red-50 hover:bg-red-100 rounded text-xs font-bold transition" data-index="${idx}" title="Delete Question">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    },

    addBonusQuestion: async () => {
        const qText = document.getElementById('ebvQuestion').value.trim();
        const choicesStr = document.getElementById('ebvChoices').value.trim();
        const ans = document.getElementById('ebvAnswer').value.trim();
        const expl = document.getElementById('ebvExplanation').value.trim();
        const alertBox = document.getElementById('ebvAlert');

        if (!qText || !ans) {
            alertBox.textContent = "Bonus Question text and Exact Correct Answer are required.";
            alertBox.className = "mb-3 p-2 rounded text-xs font-bold bg-red-100 text-red-700 block";
            return;
        }

        const choices = choicesStr ? choicesStr.split('|').map(c => c.trim()).filter(Boolean) : [];
        const maxPart = CourseExam.activeBonusData.reduce((m, r) => Math.max(m, parseInt(r[0], 10) || 0), 0);

        CourseExam.activeBonusData.push([maxPart, qText, choices, ans, expl, true]);

        try {
            await apiFetch('/api/exams/update', {
                method: 'POST',
                body: JSON.stringify({
                    examId: CourseExam.activeBonusExamId,
                    examData: CourseExam.activeBonusData
                })
            });

            document.getElementById('ebvQuestion').value = '';
            document.getElementById('ebvChoices').value = '';
            document.getElementById('ebvAnswer').value = '';
            document.getElementById('ebvExplanation').value = '';

            alertBox.textContent = "Bonus question appended and saved!";
            alertBox.className = "mb-3 p-2 rounded text-xs font-bold bg-green-100 text-green-800 block";
            CourseExam.renderBonusQuestionsList();
        } catch (err) {
            alertBox.textContent = err.message;
            alertBox.className = "mb-3 p-2 rounded text-xs font-bold bg-red-100 text-red-700 block";
        }
    },

    toggleQuestionBonus: async (idx, isBonus) => {
        if (!CourseExam.activeBonusData[idx]) return;
        CourseExam.activeBonusData[idx][5] = Boolean(isBonus);

        try {
            await apiFetch('/api/exams/update', {
                method: 'POST',
                body: JSON.stringify({
                    examId: CourseExam.activeBonusExamId,
                    examData: CourseExam.activeBonusData
                })
            });
            CourseExam.renderBonusQuestionsList();
        } catch (err) {
            alert('Failed to update bonus status: ' + err.message);
        }
    },

    deleteExamQuestion: async (idx) => {
        if (!window.confirm(`Delete Question #${idx + 1} from this exam?`)) return;
        CourseExam.activeBonusData.splice(idx, 1);

        try {
            await apiFetch('/api/exams/update', {
                method: 'POST',
                body: JSON.stringify({
                    examId: CourseExam.activeBonusExamId,
                    examData: CourseExam.activeBonusData
                })
            });
            CourseExam.renderBonusQuestionsList();
        } catch (err) {
            alert('Failed to delete question: ' + err.message);
        }
    },

    parseCSV: (str) => {
        const arr = [];
        let quote = false;
        let row = 0, col = 0;
        for (let c = 0; c < str.length; c++) {
            let cc = str[c], nc = str[c + 1];
            arr[row] = arr[row] || [];
            arr[row][col] = arr[row][col] || '';

            if (cc === '"' && quote && nc === '"') { arr[row][col] += cc; ++c; continue; }
            if (cc === '"') { quote = !quote; continue; }
            if (cc === ',' && !quote) { ++col; continue; }
            if (cc === '\r' && nc === '\n' && !quote) { ++row; col = 0; ++c; continue; }
            if (cc === '\n' && !quote) { ++row; col = 0; continue; }
            if (cc === '\r' && !quote) { ++row; col = 0; continue; }
            arr[row][col] += cc;
        }
        return arr.map(r => r.map(c => c.trim()));
    },

    uploadCsv: async () => {
        const titleInput = document.getElementById('newExamTitle');
        const fileInput = document.getElementById('examCsvUpload');
        const msgDiv = document.getElementById('examUploadMessage');
        const btn = document.getElementById('uploadExamBtn');

        if (!titleInput.value.trim() || !fileInput.files.length) {
            msgDiv.textContent = "Please provide a title and select a CSV file.";
            msgDiv.className = "mt-2 text-xs font-bold p-2 rounded bg-red-100 text-red-700 block";
            return;
        }

        const file = fileInput.files[0];
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const text = e.target.result;
                const rows = CourseExam.parseCSV(text);
                const examData = [];

                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    if (row.length < 4 || row.every(col => col === "")) continue;

                    const part = parseInt(row[0], 10) || 0;
                    const question = row[1];
                    const choicesStr = row[2] ? row[2].trim() : "";
                    const choices = choicesStr ? choicesStr.split('|').map(c => c.trim()) : [];
                    const answer = row[3];
                    const expl = row[4] || "";
                    const bonusRaw = (row[5] || "").toString().trim().toLowerCase();
                    const isBonus = bonusRaw === '1' || bonusRaw === 'true' || bonusRaw === 'yes' || bonusRaw === 'bonus';

                    examData.push([part, question, choices, answer, expl, isBonus]);
                }

                if (examData.length === 0) throw new Error("No valid questions found in CSV.");

                await apiFetch('/api/exams', {
                    method: 'POST',
                    body: JSON.stringify({
                        lecturerId: AppState.user.User_ID,
                        title: titleInput.value.trim(),
                        examData: examData
                    })
                });

                msgDiv.textContent = "Exam uploaded successfully.";
                msgDiv.className = "mt-2 text-xs font-bold p-2 rounded bg-green-100 text-green-700 block";
                titleInput.value = '';
                fileInput.value = '';
                await CourseExam.loadExams();
            } catch (err) {
                msgDiv.textContent = err.message;
                msgDiv.className = "mt-2 text-xs font-bold p-2 rounded bg-red-100 text-red-700 block";
            } finally {
                btn.disabled = false;
                btn.innerHTML = 'Upload';
                setTimeout(() => msgDiv.classList.add('hidden'), 3000);
            }
        };
        reader.readAsText(file);
    },

    // ---------- Lecturer Presentation Mode ----------

    startPresentation: async (examId, title) => {
        document.getElementById('examManagerModal').classList.add('hidden');
        const overlay = document.getElementById('examPresentationOverlay');
        document.getElementById('examPresentationTitle').textContent = title;
        overlay.classList.remove('hidden');

        try {
            const data = await apiFetch(`/api/exam-data?examId=${examId}`);
            CourseExam.quizData = JSON.parse(data.exam.ExamData);
            CourseExam.current = 0;
            CourseExam.revealed = false;
            CourseExam.buildTabs();
            CourseExam.render();
        } catch (err) {
            alert("Failed to load exam data: " + err.message);
            overlay.classList.add('hidden');
        }
    },

    buildTabs: () => {
        const tabsEl = document.getElementById('examTabs');
        tabsEl.innerHTML = '';

        const uniqueParts = [...new Set(CourseExam.quizData.map(d => d[0]))].sort((a, b) => a - b);

        uniqueParts.forEach((p) => {
            const b = document.createElement("button");
            b.className = "exam-tab";
            b.textContent = `Part ${p + 1}`;
            b.onclick = () => {
                const idx = CourseExam.quizData.findIndex(d => d[0] === p);
                if (idx !== -1) {
                    CourseExam.current = idx;
                    CourseExam.revealed = false;
                    CourseExam.render();
                }
            };
            tabsEl.appendChild(b);
        });
    },

    setAnswer: (show) => {
        CourseExam.revealed = show;
        if (!CourseExam.quizData[CourseExam.current]) return;
        const [, , choices, ans] = CourseExam.quizData[CourseExam.current];

        const answerEl = document.getElementById('examAnswer');
        const revealBtn = document.getElementById('examRevealBtn');
        const choicesEl = document.getElementById('examChoices');

        answerEl.classList.toggle("open", show);
        revealBtn.textContent = show ? "Hide answer" : "Show answer";

        if (choices && choices.length > 0) {
            [...choicesEl.children].forEach((el, i) => {
                el.classList.toggle("correct", show && choices[i] === ans);
                el.classList.toggle("dim", show && choices[i] !== ans);
            });
        }

        if (show) answerEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },

    toggleAnswer: () => {
        CourseExam.setAnswer(!CourseExam.revealed);
    },

    navigate: (dir) => {
        const total = CourseExam.quizData.length;
        CourseExam.current = Math.min(total - 1, Math.max(0, CourseExam.current + dir));
        CourseExam.render();
    },

    restart: () => {
        CourseExam.current = 0;
        CourseExam.render();
    },

    render: () => {
        if (!CourseExam.quizData || CourseExam.quizData.length === 0) return;

        const dataRow = CourseExam.quizData[CourseExam.current];
        const part = dataRow[0];
        const q = dataRow[1];
        const choices = dataRow[2] || [];
        const ans = dataRow[3];
        const expl = dataRow[4];
        const isBonus = Boolean(dataRow[5]);

        const total = CourseExam.quizData.length;
        const inPart = CourseExam.quizData.filter(d => d[0] === part);
        const posInPart = CourseExam.quizData.slice(0, CourseExam.current + 1).filter(d => d[0] === part).length;

        const tabsEl = document.getElementById('examTabs');
        [...tabsEl.children].forEach((t) => {
            const targetPart = parseInt(t.textContent.replace('Part ', ''), 10) - 1;
            t.classList.toggle("active", targetPart === part);
        });

        const counterEl = document.getElementById('examCounter');
        const bonusTag = isBonus ? ` &nbsp;<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:6px;font-weight:800;font-size:0.9rem;">BONUS</span>` : '';
        counterEl.innerHTML = `<span class="num">${CourseExam.current + 1}</span><span class="of">of ${total} &nbsp;|&nbsp; ${posInPart} of ${inPart.length} in this part${bonusTag}</span>`;

        document.getElementById('examQuestion').textContent = q;

        const choicesEl = document.getElementById('examChoices');
        choicesEl.innerHTML = "";

        let choicesClass = "exam-choices";
        if (choices.length === 2) choicesClass += " two";
        else if (choices.length >= 6) choicesClass += " many";
        choicesEl.className = choicesClass;

        choices.forEach(c => {
            const div = document.createElement("div");
            div.className = "exam-choice";
            div.textContent = c;
            choicesEl.appendChild(div);
        });

        const answerEl = document.getElementById('examAnswer');
        const explanationHTML = expl ? `<div class="exam-expl">${expl}</div>` : "";
        answerEl.innerHTML = `<span class="label">Answer</span>${ans}${explanationHTML}`;

        document.getElementById('examBar').style.width = ((CourseExam.current + 1) / total * 100) + "%";
        document.getElementById('examPrevBtn').disabled = CourseExam.current === 0;
        document.getElementById('examNextBtn').disabled = CourseExam.current === total - 1;

        CourseExam.setAnswer(false);
        document.getElementById('examBodyEl').scrollTop = 0;
    },

    // ---------- Student Full-Screen Accessible Exam Overlay ----------

    startAccessibleExam: (examObj, student, onComplete) => {
        CourseExam.accExam = examObj;
        CourseExam.accStudent = student;
        CourseExam.accIndex = 0;
        CourseExam.accSubmitting = false;
        CourseExam.accOnComplete = onComplete || null;
        
        const cachedDraft = localStorage.getItem('acc_exam_draft_' + examObj.assignmentId);
        if (cachedDraft) {
            try { 
                CourseExam.accAnswers = JSON.parse(cachedDraft); 
            } catch(e) { 
                CourseExam.accAnswers = new Array(examObj.questions.length).fill(''); 
            }
        } else {
            CourseExam.accAnswers = new Array(examObj.questions.length).fill('');
        }

        const overlay = document.getElementById('accessibleExamOverlay');
        if (!overlay) return;

        document.getElementById('accExamHeaderTitle').textContent = examObj.examTitle;
        document.getElementById('accExamCourseBadge').textContent = `${examObj.courseCode} - ${student.Name}`;
        overlay.classList.remove('hidden');

        CourseExam.renderAccessibleQuestion(true);
    },

    closeAccessibleExam: () => {
        if (CourseExam.accExam && !CourseExam.accSubmitting) {
            const confirmExit = window.confirm("Are you sure you want to exit the exam without submitting?");
            if (!confirmExit) return;
        }
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        document.getElementById('accessibleExamOverlay')?.classList.add('hidden');
        CourseExam.accExam = null;
    },

    updateAccessibleAnsweredBadge: () => {
        const statusEl = document.getElementById('accExamAnsweredStatus');
        if (!statusEl || !CourseExam.accExam) return;
        const currentAns = CourseExam.accAnswers[CourseExam.accIndex];
        const answeredCount = CourseExam.accAnswers.filter(a => a !== '').length;
        const total = CourseExam.accExam.questions.length;

        if (currentAns) {
            statusEl.textContent = `Selected: ${currentAns} (${answeredCount}/${total} Answered)`;
            statusEl.className = "text-sm sm:text-base font-black px-4 py-1 rounded-full bg-green-900 text-green-200 border-2 border-green-400";
        } else {
            statusEl.textContent = `Not Answered Yet (${answeredCount}/${total} Answered)`;
            statusEl.className = "text-sm sm:text-base font-bold px-4 py-1 rounded-full bg-gray-800 text-gray-300 border border-gray-700";
        }
    },

    renderAccessibleQuestion: (autoSpeak = true) => {
        if (!CourseExam.accExam) return;
        const questions = CourseExam.accExam.questions;
        const total = questions.length;
        const q = questions[CourseExam.accIndex];
        if (!q) return;

        const pct = ((CourseExam.accIndex + 1) / total) * 100;
        document.getElementById('accExamProgressBar').style.width = `${pct}%`;

        const bonusBadge = q.isBonus
            ? ` <span class="ml-2 px-3 py-0.5 bg-amber-400 text-gray-950 rounded-full text-sm sm:text-lg font-black uppercase">Bonus Question</span>`
            : '';
        document.getElementById('accExamQuestionCounter').innerHTML = `Question ${CourseExam.accIndex + 1} of ${total}${bonusBadge}`;
        
        // Add tabindex="0" so the question text itself can receive focus naturally.
        document.getElementById('accExamQuestionText').setAttribute('tabindex', '0');
        document.getElementById('accExamQuestionText').textContent = q.question;

        CourseExam.updateAccessibleAnsweredBadge();

        const choicesContainer = document.getElementById('accExamChoicesContainer');
        const currentAnswer = CourseExam.accAnswers[CourseExam.accIndex];

        if (q.choices && q.choices.length > 0) {
            choicesContainer.innerHTML = q.choices.map((choiceText, idx) => {
                const letter = String.fromCharCode(65 + idx);
                const isSelected = currentAnswer === choiceText;
                return `
                    <button type="button"
                        class="acc-exam-choice-btn w-full text-left p-5 sm:p-6 rounded-2xl border-4 transition flex items-center justify-between gap-4 focus:outline-none focus:ring-4 focus:ring-yellow-300 ${
                            isSelected
                                ? 'bg-yellow-400 text-gray-950 border-white font-black shadow-xl'
                                : 'bg-gray-900 hover:bg-gray-800 text-white border-gray-700 font-bold'
                        }"
                        data-choice-index="${idx}"
                        role="option"
                        aria-selected="${isSelected}">
                        <span class="text-xl sm:text-2xl leading-snug">
                            <span class="inline-block w-10 font-black ${isSelected ? 'text-gray-950' : 'text-yellow-400'}">${idx + 1} (${letter}).</span>
                            ${esc(choiceText)}
                        </span>
                        ${isSelected ? '<i class="fa-solid fa-circle-check text-2xl sm:text-3xl text-gray-950 flex-shrink-0"></i>' : ''}
                    </button>
                `;
            }).join('');
        } else {
            choicesContainer.innerHTML = `
                <div class="bg-gray-900 p-6 rounded-2xl border-2 border-yellow-400">
                    <label for="accExamTextAnswerInput" class="block text-lg font-bold text-yellow-300 mb-2">Type your answer below and press Tab or Enter:</label>
                    <input type="text" id="accExamTextAnswerInput" value="${esc(currentAnswer)}"
                        class="w-full px-4 py-4 text-2xl font-bold bg-gray-950 text-white border-2 border-gray-600 rounded-xl focus:outline-none focus:border-yellow-400"
                        placeholder="Type your answer here...">
                </div>
            `;
        }
        
        const isLastQuestion = CourseExam.accIndex === total - 1;
        document.getElementById('accExamPrevBtn').disabled = CourseExam.accIndex === 0;
        document.getElementById('accExamNextBtn').classList.toggle('hidden', isLastQuestion);
        document.getElementById('accExamSubmitBtn').classList.toggle('hidden', !isLastQuestion);

        document.getElementById('accExamBody').scrollTop = 0;

        if (autoSpeak) {
            CourseExam.readCurrentAccessibleQuestion();
        }
    },

    readCurrentAccessibleQuestion: () => {
        if (!CourseExam.accExam) return;
        const questions = CourseExam.accExam.questions;
        const total = questions.length;
        const q = questions[CourseExam.accIndex];
        if (!q) return;

        const currentAns = CourseExam.accAnswers[CourseExam.accIndex];
        let speech = "";

        if (currentAns) {
            speech += "Answered question. ";
        }

        speech += `Question ${CourseExam.accIndex + 1} of ${total}. `;
        if (q.isBonus) {
            speech += `This is a bonus question. `;
        }
        speech += `${q.question}. `;

        if (currentAns) {
            speech += `Your selected answer is ${currentAns}. `;
        }

        if (q.choices && q.choices.length > 0) {
            speech += `The choices are: `;
            q.choices.forEach((c, idx) => {
                const letter = String.fromCharCode(65 + idx);
                speech += `Choice ${idx + 1}, ${letter}: ${c}. `;
            });
        } else {
            speech += `This is an identification question. Please type your answer in the text box. `;
        }

        const isLast = CourseExam.accIndex === total - 1;
        if (isLast) {
            speech += `You are on the final question. Double press Enter or Space to submit the exam.`;
        } else {
            speech += `Double press Enter or Space to go to the next question.`;
        }

        document.getElementById('accExamLiveFeedback').textContent = currentAns
            ? `Current Answer: ${currentAns}`
            : `Listening... Choose an option or press 1 to ${q.choices?.length || 4}.`;

        CourseExam.speak(speech);
    },

    selectAccessibleChoice: (choiceIndex) => {
        if (!CourseExam.accExam) return;
        const q = CourseExam.accExam.questions[CourseExam.accIndex];
        if (!q || !q.choices || choiceIndex < 0 || choiceIndex >= q.choices.length) return;

        const chosenText = q.choices[choiceIndex];
        const letter = String.fromCharCode(65 + choiceIndex);
        CourseExam.accAnswers[CourseExam.accIndex] = chosenText;
        
        localStorage.setItem('acc_exam_draft_' + CourseExam.accExam.assignmentId, JSON.stringify(CourseExam.accAnswers));
        CourseExam.renderAccessibleQuestion(false);

        const total = CourseExam.accExam.questions.length;
        const navHint = CourseExam.accIndex < total - 1
            ? "Double press Enter or Space to go to the next question."
            : "This is the last question. Double press Enter or Space to submit the exam.";

        const confirmSpeech = `Choice ${choiceIndex + 1}, ${letter}: ${chosenText}. You selected ${chosenText} as your answer for Question ${CourseExam.accIndex + 1}. ${navHint}`;
        document.getElementById('accExamLiveFeedback').textContent = confirmSpeech;
        CourseExam.speak(confirmSpeech);
    },

    navigateAccessible: (dir) => {
        if (!CourseExam.accExam) return;
        const total = CourseExam.accExam.questions.length;
        const nextIdx = CourseExam.accIndex + dir;

        if (nextIdx < 0) {
            CourseExam.speak("You are already on Question 1.");
            return;
        }
        if (nextIdx >= total) {
            CourseExam.speak("You have reached the last question. Press the Submit Exam button to finish and record your score.");
            return;
        }

        CourseExam.accIndex = nextIdx;
        CourseExam.renderAccessibleQuestion(true);
    },

    submitAccessibleExam: async () => {
        if (!CourseExam.accExam || !CourseExam.accStudent || CourseExam.accSubmitting) return;

        const unanswered = CourseExam.accAnswers
            .map((a, i) => (a === '' ? i + 1 : null))
            .filter(Boolean);

        let promptMsg = `Are you sure you want to submit ${CourseExam.accExam.examTitle}?`;
        if (unanswered.length > 0) {
            promptMsg = `You have ${unanswered.length} unanswered question(s): Question ${unanswered.join(', ')}. Do you still want to submit your exam now?`;
        }

        CourseExam.speak(promptMsg);
        const confirmed = window.confirm(promptMsg);
        if (!confirmed) {
            CourseExam.speak("Submission cancelled. You may continue reviewing your answers.");
            return;
        }

        CourseExam.accSubmitting = true;
        const submitBtn = document.getElementById('accExamSubmitBtn');
        const originalHtml = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Submitting...';
        CourseExam.speak("Submitting your exam and recording your score. Please wait.");

        try {
            const res = await apiFetch('/api/submit-accessible-exam', {
                method: 'POST',
                body: JSON.stringify({
                    assignmentId: CourseExam.accExam.assignmentId,
                    studentId: CourseExam.accStudent.User_ID,
                    answers: CourseExam.accAnswers
                })
            });

            localStorage.removeItem('acc_exam_draft_' + CourseExam.accExam.assignmentId);

            const resultSpeech = `Exam submitted successfully! Your regular score is ${res.rawScore}, plus ${res.bonusScore} bonus points. Your final recorded score is ${res.finalScore} out of ${res.maxScore}. This score has been automatically recorded in your class assessment.`;

            document.getElementById('accExamLiveFeedback').innerHTML = `
                <div class="text-green-300 font-black text-2xl mb-1">Exam Submitted! Final Score: ${res.finalScore} / ${res.maxScore}</div>
                <div class="text-sm text-white">Regular Score: ${res.rawScore} | Bonus Points: +${res.bonusScore} (Capped at ${res.maxScore})</div>
            `;
            CourseExam.speak(resultSpeech);

            alert(resultSpeech);

            document.getElementById('accessibleExamOverlay').classList.add('hidden');
            const callback = CourseExam.accOnComplete;
            CourseExam.accExam = null;
            CourseExam.accSubmitting = false;

            if (typeof callback === 'function') {
                callback();
            }
        } catch (err) {
            CourseExam.accSubmitting = false;
            const errMsg = "Failed to submit exam: " + err.message;
            document.getElementById('accExamLiveFeedback').textContent = errMsg;
            CourseExam.speak(errMsg);
            alert(errMsg);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalHtml;
            }
        }
    }
};
