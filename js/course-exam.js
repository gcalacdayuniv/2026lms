// js/course-exam.js
import { apiFetch, AppState } from './globals.js';
import { CourseClass } from './course-class.js';
import { UI } from './ui-feedback.js';
import { ExamBuilder } from './exam-builder.js';
import { fromExamData, toCsv, typeKey, pointsOf } from './exam-builder-model.js';
import { buildExamPrintHtml } from './exam-print.js';
import { ExamReview } from './exam-review.js';
import { showPrintPreview } from './print-preview.js';
import { scannableItems, buildSets, buildSetsHtml } from './exam-sets.js';
import { buildScanSets } from './scan-items.js';
import { buildScanPaperHtml } from './scan-paper.js';
import { getSetCount, saveSetCount, printExamAnswerSheet } from './sheet-print.js';
import { MAX_CHOICES } from './omr-sheet.js';

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
        document.addEventListener('input', CourseExam.handleInput);
        document.addEventListener('keydown', CourseExam.handleKeydown);
        document.addEventListener('focusin', CourseExam.handleFocus);
    },

    // Read-aloud and the audio-driven keyboard flow are for Legally Blind students only.
    isVoiceUser: () => AppState.user?.eye_condition === 'Legally Blind',

    // Fields of the student exam that take typing or a drop-down choice: the answer box, essay box, enumeration boxes and the order / match selects.
    isTextField: (el) => Boolean(el && (el.id === 'accExamTextAnswerInput' || el.id === 'accExamEssayInput' || (el.classList && (el.classList.contains('acc-exam-enum-input') || el.classList.contains('acc-exam-sel'))))),

    // An answer is '' (none), a text, or for an enumeration an array of the items typed so far.
    isAnswered: (a) => (Array.isArray(a) ? a.some(x => String(x).trim() !== '') : a !== '' && a != null),
    answerText: (a) => (Array.isArray(a) ? a.map(x => String(x).trim()).filter(Boolean).join(', ') : String(a ?? '')),

    speak: (text) => {
        if (!CourseExam.isVoiceUser()) return;
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
        if (!CourseExam.isVoiceUser()) return;
        const accOverlay = document.getElementById('accessibleExamOverlay');
        if (accOverlay && !accOverlay.classList.contains('hidden') && CourseExam.accExam) {
            if (e.target.id === 'accExamQuestionText') {
                CourseExam.speak("Question: " + e.target.textContent);
            } else if (e.target.classList.contains('acc-exam-choice-btn')) {
                const idx = parseInt(e.target.dataset.choiceIndex, 10);
                const letter = String.fromCharCode(65 + idx);
                const q = CourseExam.accExam.questions[CourseExam.accIndex];
                if (q && q.choices && q.choices[idx]) {
                    CourseExam.speak(`You have selected Choice ${idx + 1}, ${letter}. ${q.choices[idx]}. Press Space or Enter to lock that answer.`);
                }
            } else if (e.target.id === 'accExamPrevBtn') {
                CourseExam.speak("Previous button. Double press the space or enter key to go to the previous question, or press the left arrow key.");
            } else if (e.target.id === 'accExamNextBtn') {
                CourseExam.speak("Next button. Double press the space or enter key to go to the next question, or press the right arrow key.");
            } else if (e.target.id === 'accExamSubmitBtn') {
                CourseExam.speak("Submit button. Double press the space or enter key to submit your answer.");
            } else if (e.target.id === 'accExamExitBtn') {
                CourseExam.speak("Exit Exam Button");
            } else if (e.target.id === 'accExamRepeatAudioBtn') {
                CourseExam.speak("Read Question Again Button");
            } else if (e.target.id === 'accExamTextAnswerInput') {
                CourseExam.speak("Text Answer Input. Type your answer here, then press Enter.");
            } else if (e.target.id === 'accExamEssayInput') {
                CourseExam.speak("Essay answer box. Type your answer. Press Tab when you are done.");
            } else if (e.target.classList.contains('acc-exam-sel')) {
                CourseExam.speak(`${e.target.getAttribute('aria-label') || 'Choice list'}. Use the up and down arrow keys to choose.`);
            } else if (e.target.classList.contains('acc-exam-enum-input')) {
                const total = CourseExam.accExam.questions[CourseExam.accIndex]?.itemCount || 0;
                CourseExam.speak(`Item ${parseInt(e.target.dataset.i, 10) + 1} of ${total}. Type it, then press Enter for the next item.`);
            }
        }
    },

    // The sample file has one example of every question type, in the same columns as the builder's spreadsheet view.
    downloadCsvTemplate: () => ExamBuilder.downloadTemplate(),

    announceDashboardExams: () => {
        if (!CourseExam.isVoiceUser()) return;
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
        if (e.target.closest('#readDashboardExamsBtn')) {
            CourseExam.announceDashboardExams();
        }

        if (e.target.closest('.exam-more-btn')) {
            const btn = e.target.closest('.exam-more-btn');
            const panel = btn.parentElement.querySelector('.exam-more-panel');
            if (panel) {
                const open = panel.classList.toggle('hidden') === false;
                btn.setAttribute('aria-expanded', open ? 'true' : 'false');
                const chev = btn.querySelector('.fa-chevron-down');
                if (chev) chev.style.transform = open ? 'rotate(180deg)' : '';
            }
            return;
        }

        if (e.target.closest('.review-exam-btn')) {
            ExamReview.open(e.target.closest('.review-exam-btn').dataset.assignmentId, AppState.user.User_ID);
            return;
        }
        if (e.target.closest('#closeExamReviewBtn') || e.target.id === 'closeExamReviewBg') ExamReview.close();

        if (e.target.closest('.er-adjust-btn')) {
            await CourseExam.adjustQuestion(e.target.closest('.er-adjust-btn'));
            return;
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

        if (e.target.closest('#openExamBuilderBtn')) {
            await ExamBuilder.open({ classLink: CourseExam.classLinkFor(null), onSaved: CourseExam.afterBuilderSave });
        }

        if (e.target.closest('.edit-exam-builder-btn')) {
            const btn = e.target.closest('.edit-exam-builder-btn');
            await ExamBuilder.open({ examId: btn.dataset.examId, title: btn.dataset.title, classLink: CourseExam.classLinkFor(btn.dataset.examId), onSaved: CourseExam.afterBuilderSave });
        }

        if (e.target.closest('.export-exam-csv-btn')) {
            CourseExam.exportExamCsv(e.target.closest('.export-exam-csv-btn').dataset.examId);
        }

        if (e.target.closest('.print-exam-btn')) {
            CourseExam.openPrintDialog(e.target.closest('.print-exam-btn').dataset.examId);
        }
        if (e.target.closest('#closePrintExamBtn') || e.target.id === 'closePrintExamBg') CourseExam.closePrintDialog();
        if (e.target.closest('#printExamPapersBtn')) CourseExam.printExam(CourseExam.printingId, false);
        if (e.target.closest('#printExamKeysBtn')) CourseExam.printExam(CourseExam.printingId, true);
        if (e.target.closest('#printExamSheetBtn')) await CourseExam.printSheet(CourseExam.printingId);

        if (e.target.closest('#toggleArchivedBtn')) {
            CourseExam.showArchived = !CourseExam.showArchived;
            CourseExam.renderExamList();
            return;
        }
        if (e.target.closest('.archive-exam-btn')) {
            const b = e.target.closest('.archive-exam-btn');
            await CourseExam.archiveExam(b.dataset.examId, b.dataset.archive === '1');
            return;
        }
        if (e.target.closest('.delete-exam-btn')) {
            await CourseExam.deleteExam(e.target.closest('.delete-exam-btn').dataset.examId);
            return;
        }

        if (e.target.closest('.duplicate-exam-btn')) {
            await CourseExam.duplicateExam(e.target.closest('.duplicate-exam-btn').dataset.examId);
        }

        if (e.target.closest('.present-exam-btn')) {
            const btn = e.target.closest('.present-exam-btn');
            await CourseExam.startPresentation(btn.dataset.examId, btn.dataset.title);
        }

        if (e.target.closest('.exam-results-btn')) {
            const btn = e.target.closest('.exam-results-btn');
            await CourseExam.openResultsView(btn.dataset.classExamId, btn.dataset.title);
            return;
        }
        if (e.target.closest('.er-sort-btn')) {
            CourseExam.resultsSort = e.target.closest('.er-sort-btn').dataset.sort;
            CourseExam.renderResults();
            return;
        }
        if (e.target.closest('#erExportBtn')) {
            CourseExam.exportResultsCsv();
            return;
        }

        if (e.target.closest('.grade-essays-btn')) {
            const btn = e.target.closest('.grade-essays-btn');
            await CourseExam.openEssayView(btn.dataset.classExamId, btn.dataset.title);
            return;
        }
        if (e.target.closest('.eev-save-btn')) {
            await CourseExam.saveEssayMarks(e.target.closest('.eev-save-btn'));
            return;
        }

        if (e.target.closest('.assign-class-exam-btn')) {
            const btn = e.target.closest('.assign-class-exam-btn');
            await CourseExam.openClassAssignView(btn.dataset.examId, btn.dataset.title);
        }

        if (e.target.closest('.manage-bonus-exam-btn')) {
            const btn = e.target.closest('.manage-bonus-exam-btn');
            await CourseExam.openBonusView(btn.dataset.examId, btn.dataset.title);
        }

        if (e.target.closest('#backFromExamAssignBtn') || e.target.closest('#backFromExamBonusBtn') || e.target.closest('#backFromExamEssayBtn') || e.target.closest('#backFromExamResultsBtn')) {
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

            // Single tap mouse/touch logic for locking the answer explicitly
            const choiceIndex = parseInt(btn.dataset.choiceIndex, 10);
            CourseExam.selectAccessibleChoice(choiceIndex);
        }

        if (e.target.closest('#accExamPrevBtn')) CourseExam.navigateAccessible(-1);
        if (e.target.closest('#accExamNextBtn')) CourseExam.navigateAccessible(1);
        if (e.target.closest('#accExamRepeatAudioBtn')) CourseExam.readCurrentAccessibleQuestion();
        if (e.target.closest('#accExamSubmitBtn')) await CourseExam.submitAccessibleExam();
        if (e.target.closest('#accExamExitBtn')) CourseExam.closeAccessibleExam();
    },

    // Stores the answer of the current question and keeps the draft on this device.
    saveAccAnswer: (value) => {
        if (!CourseExam.accExam) return;
        CourseExam.accAnswers[CourseExam.accIndex] = value;
        try { localStorage.setItem('acc_exam_draft_' + CourseExam.accExam.assignmentId, JSON.stringify(CourseExam.accAnswers)); } catch (err) { /* storage blocked */ }
        CourseExam.updateAccessibleAnsweredBadge();
    },

    // Essays are long: keep the draft while the student types.
    handleInput: (e) => {
        if (e.target.id === 'accExamEssayInput' && CourseExam.accExam) CourseExam.saveAccAnswer(e.target.value);
    },

    handleChanges: async (e) => {
        if (e.target.id === 'printExamSets') { CourseExam.fillPrintSets(); return; }
        if (e.target.id === 'erReleaseToggle' && CourseExam.resultsData) {
            const on = e.target.checked;
            try {
                const res = await apiFetch('/api/exam-release', { method: 'POST', body: JSON.stringify({ classExamId: CourseExam.resultsData.classExamId, release: on }) });
                if (!res.success) throw new Error(res.error || 'Could not change this.');
                CourseExam.resultsData.release = on;
                UI.success(on ? 'Students can now review their answers.' : 'Answers are hidden from students.');
            } catch (err) {
                e.target.checked = !on;
                UI.error(err.message || 'Could not change this.');
            }
            return;
        }

        if (e.target.classList.contains('toggle-question-bonus-cb')) {
            const idx = parseInt(e.target.dataset.index, 10);
            await CourseExam.toggleQuestionBonus(idx, e.target.checked);
        }

        if (e.target.classList.contains('acc-exam-enum-input') && CourseExam.accExam) {
            const q = CourseExam.accExam.questions[CourseExam.accIndex];
            const list = Array.isArray(CourseExam.accAnswers[CourseExam.accIndex])
                ? CourseExam.accAnswers[CourseExam.accIndex].slice()
                : new Array(q.itemCount).fill('');
            list[parseInt(e.target.dataset.i, 10)] = e.target.value.trim();
            CourseExam.accAnswers[CourseExam.accIndex] = list.some(Boolean) ? list : '';
            localStorage.setItem('acc_exam_draft_' + CourseExam.accExam.assignmentId, JSON.stringify(CourseExam.accAnswers));
            CourseExam.updateAccessibleAnsweredBadge();
            if (e.target.value.trim() && CourseExam.isVoiceUser()) {
                const msg = `Item ${parseInt(e.target.dataset.i, 10) + 1}: ${e.target.value.trim()}.`;
                document.getElementById('accExamLiveFeedback').textContent = msg;
                CourseExam.speak(msg);
            }
        }

        if (e.target.id === 'eevOnlyUnmarked') {
            CourseExam.renderEssayList();
            return;
        }

        if (e.target.classList.contains('acc-exam-sel') && CourseExam.accExam) {
            const q = CourseExam.accExam.questions[CourseExam.accIndex];
            const size = q.type === 'match' ? (q.lefts || []).length : q.itemCount;
            const prev = Array.isArray(CourseExam.accAnswers[CourseExam.accIndex]) ? CourseExam.accAnswers[CourseExam.accIndex].slice() : new Array(size).fill('');
            const at = parseInt(e.target.dataset.i, 10);
            prev[at] = e.target.value;
            CourseExam.saveAccAnswer(prev.some(Boolean) ? prev : '');
            if (e.target.value && CourseExam.isVoiceUser()) {
                const msg = q.type === 'match' ? `${q.lefts[at]} matched with ${e.target.value}.` : `Position ${at + 1}: ${e.target.value}.`;
                document.getElementById('accExamLiveFeedback').textContent = msg;
                CourseExam.speak(msg);
            }
        }

        if (e.target.id === 'accExamEssayInput' && CourseExam.accExam) {
            CourseExam.saveAccAnswer(e.target.value);
            return;
        }

        if (e.target.id === 'accExamTextAnswerInput') {
            const val = e.target.value.trim();
            CourseExam.accAnswers[CourseExam.accIndex] = val;
            if (CourseExam.accExam) {
                localStorage.setItem('acc_exam_draft_' + CourseExam.accExam.assignmentId, JSON.stringify(CourseExam.accAnswers));
            }
            CourseExam.updateAccessibleAnsweredBadge();
            if (val && CourseExam.isVoiceUser()) {
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

            // Sighted students use normal mouse/keyboard behavior: no audio-driven key handling.
            if (!CourseExam.isVoiceUser()) return;

            // Allow normal typing in text input, but let Enter register as a submit/blur
            if (CourseExam.isTextField(document.activeElement)) {
                if (e.key === ' ') return; // Let space type space normally inside text box
            } else {
                if (e.key === ' ') e.preventDefault(); // Prevent page scroll for space globally in exam
            }

            // Custom Tab Cycling (Trap focus strictly to Question, Choices, Nav Buttons)
            if (e.key === 'Tab') {
                e.preventDefault();
                const focusables = Array.from(document.querySelectorAll('#accExamQuestionText, .acc-exam-choice-btn, #accExamPrevBtn, #accExamNextBtn:not(.hidden), #accExamSubmitBtn:not(.hidden), #accExamTextAnswerInput, #accExamEssayInput, .acc-exam-enum-input, .acc-exam-sel'))
                    .filter(el => !el.disabled && el.offsetParent !== null);

                const currIdx = focusables.indexOf(document.activeElement);
                let nextIdx = e.shiftKey ? currIdx - 1 : currIdx + 1;

                if (nextIdx >= focusables.length) nextIdx = 0;
                if (nextIdx < 0) nextIdx = focusables.length - 1;

                focusables[nextIdx].focus();
                return;
            }

            // Enumeration: Enter moves to the next item box (the last one just saves). It never counts as a double press.
            if (e.key === 'Enter' && document.activeElement && document.activeElement.classList.contains('acc-exam-enum-input')) {
                e.preventDefault();
                CourseExam.lastEnterSpaceTime = 0;
                const inputs = Array.from(document.querySelectorAll('.acc-exam-enum-input'));
                const at = inputs.indexOf(document.activeElement);
                if (at >= 0 && at < inputs.length - 1) inputs[at + 1].focus();
                else document.activeElement.blur();
                return;
            }

            // Essay box: Enter makes a new line and the arrow keys move the cursor.
            if (document.activeElement && document.activeElement.id === 'accExamEssayInput') return;
            // Drop-downs keep their own arrow keys.
            if (document.activeElement && document.activeElement.classList.contains('acc-exam-sel') && /^Arrow/.test(e.key)) return;

            // Enter & Space Double Tap Logic
            if (e.key === 'Enter' || e.key === ' ') {
                const now = Date.now();
                if (now - (CourseExam.lastEnterSpaceTime || 0) < 600) {
                    // Double press detected - Trigger Navigation
                    e.preventDefault();
                    CourseExam.lastEnterSpaceTime = 0;
                    const isLast = CourseExam.accIndex === CourseExam.accExam.questions.length - 1;
                    if (isLast) {
                        CourseExam.submitAccessibleExam();
                    } else {
                        CourseExam.navigateAccessible(1);
                    }
                    return;
                } else {
                    CourseExam.lastEnterSpaceTime = now;
                    // Single Press Detected - Lock Answer if on a choice
                    const activeEl = document.activeElement;
                    const isChoice = activeEl && activeEl.classList.contains('acc-exam-choice-btn');

                    if ((e.key === ' ' || e.key === 'Enter') && isChoice) {
                        e.preventDefault();
                        const idx = parseInt(activeEl.dataset.choiceIndex, 10);
                        CourseExam.selectAccessibleChoice(idx);
                    } else if (e.key === 'Enter' && CourseExam.isTextField(activeEl)) {
                        activeEl.blur(); // Save text input on single enter
                    } else if (!isChoice && !CourseExam.isTextField(activeEl)) {
                        // General hint if pressing space randomly
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

            // While typing in a text box the remaining keys (R, Q, digits, A-D, Left/Right) belong to the text.
            if (CourseExam.isTextField(document.activeElement)) return;

            // Right/Left for Fast Question Navigation
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
        document.getElementById('examEssayView')?.classList.add('hidden');
        document.getElementById('examResultsView')?.classList.add('hidden');
    },

    // The list is kept on this device: it opens at once from the last copy, then refreshes from the server.
    // When the server cannot be reached the saved copy stays on screen.
    loadExams: async () => {
        const container = document.getElementById('examListContainer');
        if (!container) return;

        const courseId = window.location.hash.startsWith('#class-') ? window.location.hash.replace('#class-', '') : '';
        const lecturerId = AppState.user.User_ID;
        const cacheKey = `lms_exam_list:${lecturerId}:${courseId}`;
        const apply = (data) => {
            CourseExam.exams = data.exams || [];
            CourseExam.classExams = data.classExams || [];
            CourseExam.classAssignments = data.classAssignments || [];
        };

        let shownFromCache = false;
        try {
            const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
            if (cached && Array.isArray(cached.exams)) {
                apply(cached);
                CourseExam.renderExamList();
                shownFromCache = true;
            }
        } catch (err) { /* no usable saved copy */ }
        if (!shownFromCache) {
            container.innerHTML = '<div class="text-center py-6 text-gray-500"><i class="fa-solid fa-spinner fa-spin text-2xl"></i></div>';
        }

        try {
            const ts = new Date().getTime();
            const requests = [apiFetch(`/api/exams?lecturerId=${lecturerId}&_t=${ts}`)];
            if (courseId) {
                requests.push(apiFetch(`/api/class-exams?courseId=${courseId}&_t=${ts}`));
            }

            const [examRes, classExamRes] = await Promise.all(requests);
            const fresh = {
                exams: examRes.exams || [],
                classExams: classExamRes ? (classExamRes.classExams || []) : [],
                classAssignments: classExamRes ? (classExamRes.assignments || []) : []
            };
            apply(fresh);
            try { localStorage.setItem(cacheKey, JSON.stringify(fresh)); } catch (err) { /* storage full or blocked */ }
            CourseExam.renderExamList();
        } catch (err) {
            if (shownFromCache) {
                const countEl = document.getElementById('examCountLabel');
                if (countEl) countEl.textContent += ' - saved copy (offline)';
            } else {
                container.innerHTML = `<div class="text-red-500 font-bold text-sm text-center py-4">${esc(err.message)}</div>`;
            }
        }
    },

    renderExamList: () => {
        const container = document.getElementById('examListContainer');
        if (!container) return;
        const courseId = window.location.hash.startsWith('#class-') ? window.location.hash.replace('#class-', '') : '';
        const archivedCount = CourseExam.exams.filter(e => Number(e.Archived) === 1).length;
        const shown = CourseExam.exams.filter(e => CourseExam.showArchived || Number(e.Archived) !== 1);
        const countEl0 = document.getElementById('examCountLabel');
        if (CourseExam.exams.length === 0) {
            container.innerHTML = '<div class="text-center py-10 px-4"><i class="fa-regular fa-file-lines text-3xl text-gray-300"></i><p class="mt-2 text-sm font-bold text-gray-600">No exams yet</p><p class="text-xs text-gray-500">Use Create Exam or Import from Spreadsheet above.</p></div>';
            if (countEl0) countEl0.textContent = '';
            return;
        }
        const archiveBar = archivedCount ? `<div class="flex justify-end"><button type="button" id="toggleArchivedBtn" class="text-xs font-bold text-gray-600 hover:text-indigo-700 underline" aria-pressed="${CourseExam.showArchived ? 'true' : 'false'}"><i class="fa-solid fa-box-archive mr-1" aria-hidden="true"></i>${CourseExam.showArchived ? 'Hide' : 'Show'} archived (${archivedCount})</button></div>` : '';
        const emptyNote = shown.length ? '' : '<div class="text-center py-8 px-4 text-sm text-gray-500">All exams are archived. Use "Show archived" to see them.</div>';

        container.innerHTML = archiveBar + emptyNote + shown.map(ex => {
            const archived = Number(ex.Archived) === 1;
            let parsed = [];
            try { parsed = JSON.parse(ex.ExamData || '[]'); } catch (e) { parsed = []; }
            const rows = fromExamData(parsed);
            const regCount = rows.filter(q => !q.bonus).length;
            const bonusCount = rows.filter(q => q.bonus).length;
            const points = rows.filter(q => !q.bonus).reduce((sum, q) => sum + pointsOf(q), 0);
            const typeChip = (key, label, color) => {
                const n = rows.filter(q => q.type === key).length;
                return n ? `<span class="text-[10px] ${color} px-1.5 py-0.5 rounded font-bold">${label} ${n}</span>` : '';
            };
            const typeChips = typeChip('mc', 'Multiple choice', 'bg-blue-50 text-blue-700 border border-blue-100')
                + typeChip('multi', 'Multiple answer', 'bg-sky-50 text-sky-700 border border-sky-100')
                + typeChip('tf', 'True/False', 'bg-teal-50 text-teal-700 border border-teal-100')
                + typeChip('id', 'Identification', 'bg-orange-50 text-orange-700 border border-orange-100')
                + typeChip('num', 'Numeric', 'bg-lime-50 text-lime-800 border border-lime-200')
                + typeChip('enum', 'Enumeration', 'bg-indigo-50 text-indigo-700 border border-indigo-100')
                + typeChip('order', 'Ordering', 'bg-violet-50 text-violet-700 border border-violet-100')
                + typeChip('match', 'Matching', 'bg-pink-50 text-pink-700 border border-pink-100')
                + typeChip('essay', 'Essay', 'bg-rose-50 text-rose-700 border border-rose-100');
            const essayRows = rows.map((q, i) => (q.type === 'essay' ? i : -1)).filter(i => i >= 0);

            const linked = CourseExam.classExams.find(ce => ce.Exam_ID === ex.Exam_ID);
            const enabledStudentsCount = linked
                ? CourseExam.classAssignments.filter(a => a.Class_Exam_ID === linked.Class_Exam_ID && a.Is_Enabled === 1).length
                : 0;

            let essayPending = 0;
            if (linked && essayRows.length) {
                CourseExam.classAssignments.filter(a => a.Class_Exam_ID === linked.Class_Exam_ID && a.Status === 'Completed').forEach(a => {
                    let marks = {};
                    try { marks = JSON.parse(a.Manual_Marks || '{}') || {}; } catch (err) { marks = {}; }
                    if (essayRows.some(i => !Object.prototype.hasOwnProperty.call(marks, i))) essayPending++;
                });
            }

            const linkBadge = linked && linked.Is_Active
                ? `<span class="text-[10px] bg-green-100 text-green-800 border border-green-300 font-bold px-2 py-0.5 rounded">Linked (${enabledStudentsCount} student${enabledStudentsCount === 1 ? '' : 's'}) | ${linked.From_Date || 'Any'} to ${linked.To_Date || 'Any'}</span>`
                : `<span class="text-[10px] bg-gray-100 text-gray-600 border border-gray-200 font-medium px-2 py-0.5 rounded">Not linked to this class</span>`;

            return `
                <div class="bg-white p-3 border border-gray-200 rounded-xl shadow-sm hover:border-indigo-300 transition">
                    <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                        <div class="font-black text-gray-800 text-sm min-w-0 break-words">${esc(ex.Title)}${archived ? ' <span class="ml-1 text-[10px] bg-gray-200 text-gray-700 font-bold px-1.5 py-0.5 rounded align-middle">Archived</span>' : ''}</div>
                        <div class="text-[11px] font-bold text-gray-500 whitespace-nowrap">${regCount} question${regCount === 1 ? '' : 's'}${points !== regCount ? ` &bull; ${points} points` : ''}${bonusCount > 0 ? ` &bull; ${bonusCount} bonus` : ''}</div>
                    </div>
                    <div class="mt-1.5 flex flex-wrap items-center gap-1.5">${typeChips}</div>
                    <div class="mt-1.5">${linkBadge}</div>
                    <div class="mt-3 grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end gap-1.5">
                        ${courseId ? `
                            <button type="button" class="assign-class-exam-btn col-span-2 sm:col-span-1 bg-indigo-600 text-white hover:bg-indigo-700 px-3 py-2 rounded-md text-xs font-bold transition shadow-sm" data-exam-id="${esc(ex.Exam_ID)}" data-title="${esc(ex.Title)}">
                                <i class="fa-solid fa-universal-access mr-1" aria-hidden="true"></i> Link &amp; Assign Students
                            </button>
                        ` : ''}
                        ${linked && essayRows.length ? `
                            <button type="button" class="grade-essays-btn bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 px-3 py-2 rounded-md text-xs font-bold transition" data-class-exam-id="${esc(linked.Class_Exam_ID)}" data-title="${esc(ex.Title)}">
                                <i class="fa-solid fa-pen-ruler mr-1" aria-hidden="true"></i> Grade Essays${essayPending ? ` (${essayPending} to mark)` : ''}
                            </button>` : ''}
                        ${linked ? `
                            <button type="button" class="exam-results-btn bg-teal-50 text-teal-700 hover:bg-teal-100 border border-teal-200 px-3 py-2 rounded-md text-xs font-bold transition" data-class-exam-id="${esc(linked.Class_Exam_ID)}" data-title="${esc(ex.Title)}">
                                <i class="fa-solid fa-chart-column mr-1" aria-hidden="true"></i> Results
                            </button>` : ''}
                        <button type="button" class="edit-exam-builder-btn bg-white text-indigo-700 hover:bg-indigo-50 border border-indigo-200 px-3 py-2 rounded-md text-xs font-bold transition" data-exam-id="${esc(ex.Exam_ID)}" data-title="${esc(ex.Title)}">
                            <i class="fa-solid fa-pen-to-square mr-1" aria-hidden="true"></i> Edit
                        </button>
                        <button type="button" class="exam-more-btn bg-white text-gray-700 hover:bg-gray-50 border border-gray-300 px-3 py-2 rounded-md text-xs font-bold transition" aria-expanded="false" aria-label="More actions for ${esc(ex.Title)}">
                            <i class="fa-solid fa-ellipsis mr-1" aria-hidden="true"></i> More <i class="fa-solid fa-chevron-down text-[9px] ml-1 transition-transform" aria-hidden="true"></i>
                        </button>
                        <div class="exam-more-panel hidden col-span-2 sm:w-full flex flex-wrap sm:justify-end gap-1.5 pt-2 mt-0.5 border-t border-gray-100">
                        <button type="button" class="present-exam-btn bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 px-3 py-2 rounded-md text-xs font-bold transition" data-exam-id="${esc(ex.Exam_ID)}" data-title="${esc(ex.Title)}">
                            <i class="fa-solid fa-play mr-1" aria-hidden="true"></i> Present
                        </button>
                        <button type="button" class="manage-bonus-exam-btn bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-300 px-3 py-2 rounded-md text-xs font-bold transition" data-exam-id="${esc(ex.Exam_ID)}" data-title="${esc(ex.Title)}">
                            <i class="fa-solid fa-star mr-1" aria-hidden="true"></i> Bonus Qs
                        </button>
                        <button type="button" class="print-exam-btn bg-white text-gray-700 hover:bg-gray-50 border border-gray-300 px-3 py-2 rounded-md text-xs font-bold transition" data-exam-id="${esc(ex.Exam_ID)}" aria-label="Print ${esc(ex.Title)}">
                            <i class="fa-solid fa-print mr-1" aria-hidden="true"></i> Print
                        </button>
                        <button type="button" class="export-exam-csv-btn bg-white text-gray-700 hover:bg-gray-50 border border-gray-300 px-3 py-2 rounded-md text-xs font-bold transition" data-exam-id="${esc(ex.Exam_ID)}" aria-label="Export ${esc(ex.Title)} as CSV">
                            <i class="fa-solid fa-file-export mr-1" aria-hidden="true"></i> CSV
                        </button>
                        <button type="button" class="duplicate-exam-btn bg-white text-gray-700 hover:bg-gray-50 border border-gray-300 px-3 py-2 rounded-md text-xs font-bold transition" data-exam-id="${esc(ex.Exam_ID)}" aria-label="Duplicate ${esc(ex.Title)}">
                            <i class="fa-regular fa-copy mr-1" aria-hidden="true"></i> Copy
                        </button>
                        <button type="button" class="archive-exam-btn bg-white text-gray-700 hover:bg-gray-50 border border-gray-300 px-3 py-2 rounded-md text-xs font-bold transition" data-exam-id="${esc(ex.Exam_ID)}" data-archive="${archived ? '0' : '1'}" aria-label="${archived ? 'Restore' : 'Archive'} ${esc(ex.Title)}">
                            <i class="fa-solid ${archived ? 'fa-box-open' : 'fa-box-archive'} mr-1" aria-hidden="true"></i> ${archived ? 'Restore' : 'Archive'}
                        </button>
                        ${Number(ex.Uses) === 0 ? `<button type="button" class="delete-exam-btn bg-white text-red-600 hover:bg-red-50 border border-red-200 px-3 py-2 rounded-md text-xs font-bold transition" data-exam-id="${esc(ex.Exam_ID)}" aria-label="Delete ${esc(ex.Title)}">
                            <i class="fa-regular fa-trash-can mr-1" aria-hidden="true"></i> Delete
                        </button>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        const countEl = document.getElementById('examCountLabel');
        const active = CourseExam.exams.length - archivedCount;
        if (countEl) countEl.textContent = `${active} exam${active === 1 ? '' : 's'}${archivedCount ? ` (+${archivedCount} archived)` : ''}`;

    },

    openClassAssignView: async (examId, title) => {
        CourseExam.activeConfigExamId = examId;
        document.getElementById('examManagerMainView').classList.add('hidden');
        document.getElementById('examBonusView').classList.add('hidden');
        document.getElementById('examEssayView')?.classList.add('hidden');
        document.getElementById('examResultsView')?.classList.add('hidden');
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
        document.getElementById('ecaTimeLimit').value = linked?.Time_Limit || '';

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

    // Record Scores settings for the builder, or null when no class is open (the builder is then used on its own).
    classLinkFor: (examId) => {
        const courseId = window.location.hash.startsWith('#class-') ? window.location.hash.replace('#class-', '') : '';
        if (!courseId) return null;
        const linked = examId ? (CourseExam.classExams || []).find(ce => ce.Exam_ID === examId) : null;
        return {
            courseId,
            linked: Boolean(linked),
            enabled: linked ? Boolean(linked.Is_Active) : false,
            term: linked?.Term || 'MidTerm',
            category: linked?.Category || 'MajorExam',
            fromDate: linked?.From_Date || '',
            toDate: linked?.To_Date || '',
            timeLimit: linked?.Time_Limit || '',
            audience: linked ? 'keep' : 'blind'
        };
    },

    // Runs after the builder saved. When "Link & enable for this class" was ticked, it links the exam like Link & Assign Students does.
    afterBuilderSave: async (result) => {
        const link = result && result.link;
        if (link && result.examId) {
            try {
                const existing = (CourseExam.classExams || []).find(ce => ce.Exam_ID === result.examId);
                const have = {};
                if (existing) {
                    (CourseExam.classAssignments || []).filter(a => a.Class_Exam_ID === existing.Class_Exam_ID).forEach(a => { have[a.Student_ID] = a.Is_Enabled === 1; });
                }
                const assignments = (CourseClass.currentStudents || []).map(st => {
                    const blind = st.eye_condition === 'Legally Blind';
                    let on;
                    if (link.audience === 'all') on = true;
                    else if (link.audience === 'keep' && st.User_ID in have) on = have[st.User_ID];
                    else on = blind;
                    return { studentId: st.User_ID, isEnabled: on };
                });
                if (link.fromDate && link.toDate && link.fromDate > link.toDate) {
                    UI.error('Exam saved, but not linked: From date is later than To date.');
                } else {
                    await apiFetch('/api/class-exams', {
                        method: 'POST',
                        body: JSON.stringify({
                            courseId: link.courseId,
                            examId: result.examId,
                            term: link.term,
                            category: link.category,
                            isActive: true,
                            fromDate: link.fromDate || '',
                            toDate: link.toDate || '',
                            timeLimit: parseInt(link.timeLimit, 10) || null,
                            assignments
                        })
                    });
                    UI.success('Exam saved and linked to this class');
                }
            } catch (err) {
                UI.error('Exam saved, but linking failed: ' + err.message);
            }
        }
        await CourseExam.loadExams();
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
        const timeLimit = parseInt(document.getElementById('ecaTimeLimit').value, 10) || null;

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
                    timeLimit,
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
        const ok = await UI.confirm({ title: 'Reset exam attempt', message: `Reset and re-open the exam submission for ${studentName} so they can take it again?`, confirmText: 'Reset', danger: true });
        if (!ok) return;

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
            UI.error('Failed to reset attempt: ' + err.message);
        }
    },

    // ---------- Results ----------

    resultsData: null,
    resultsSort: 'hardest',

    openResultsView: async (classExamId, title) => {
        ['examManagerMainView', 'examClassAssignView', 'examBonusView', 'examEssayView'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
        document.getElementById('examResultsView').classList.remove('hidden');
        document.getElementById('erTitle').textContent = title;
        const body = document.getElementById('erBody');
        body.innerHTML = '<div class="text-center py-10 text-gray-500"><i class="fa-solid fa-spinner fa-spin text-2xl"></i></div>';
        try {
            const data = await apiFetch(`/api/exam-results?classExamId=${encodeURIComponent(classExamId)}&_t=${Date.now()}`);
            CourseExam.resultsData = { classExamId, title, ...data };
            CourseExam.resultsSort = 'hardest';
            CourseExam.renderResults();
        } catch (err) {
            body.innerHTML = `<div class="text-red-500 font-bold text-sm text-center py-4">${esc(err.message)}</div>`;
        }
    },

    adjustQuestion: async (btn) => {
        const d = CourseExam.resultsData;
        if (!d) return;
        const { index, action, no } = btn.dataset;
        if (action !== 'none') {
            const ok = await UI.confirm({
                title: action === 'credit' ? 'Give everyone credit' : 'Drop question',
                message: action === 'credit'
                    ? `Every student gets full points for question ${no}. All submitted scores are recalculated.`
                    : `Question ${no} is removed from scoring and the rest of the exam is scaled to the same maximum. All submitted scores are recalculated.`,
                confirmText: action === 'credit' ? 'Give credit' : 'Drop it',
                danger: action === 'drop'
            });
            if (!ok) return;
        }
        try {
            const res = await apiFetch('/api/exam-adjust', { method: 'POST', body: JSON.stringify({ classExamId: d.classExamId, index: Number(index), action }) });
            if (!res.success) throw new Error(res.error || 'Could not change the question.');
            UI.success(`Scores recalculated (${res.regraded}).`);
            await CourseExam.openResultsView(d.classExamId, d.title);
        } catch (err) {
            UI.error(err.message || 'Could not change the question.');
        }
    },

    renderResults: () => {
        const d = CourseExam.resultsData;
        const body = document.getElementById('erBody');
        if (!d || !body) return;
        const sm = d.summary || {};
        const fmt = (v, suffix = '') => (v === null || v === undefined ? '-' : `${v}${suffix}`);

        if (!d.submitted) {
            body.innerHTML = `<div class="text-center py-12 text-sm text-gray-500"><i class="fa-regular fa-hourglass-half text-3xl text-gray-300"></i><p class="mt-2 font-bold text-gray-600">No results yet</p><p class="text-xs">${d.assigned} student${d.assigned === 1 ? ' is' : 's are'} enabled and none has submitted.</p></div>`;
            return;
        }

        const tile = (label, value, sub = '') => `<div class="bg-white border border-gray-200 rounded-xl p-3 text-center"><div class="text-[10px] font-bold uppercase tracking-wider text-gray-500">${label}</div><div class="text-xl font-black text-gray-900 mt-0.5">${value}</div>${sub ? `<div class="text-[10px] text-gray-500">${sub}</div>` : ''}</div>`;
        const releaseRow = `<label class="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 cursor-pointer"><input type="checkbox" id="erReleaseToggle" class="w-4 h-4" ${d.release ? 'checked' : ''}> Let students review their answers and the right answers</label>`;
        const tiles = `
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                ${tile('Submitted', `${d.submitted}/${d.assigned}`)}
                ${tile('Average', fmt(sm.mean, '%'))}
                ${tile('Median', fmt(sm.median, '%'))}
                ${tile('Highest / Lowest', `${fmt(sm.high, '%')} / ${fmt(sm.low, '%')}`)}
                ${tile('Passed', fmt(sm.passRate, '%'), `${sm.passPercent}% or more`)}
                ${tile('Average time', d.avgMinutes === null ? '-' : `${d.avgMinutes} min`, d.timeLimit ? `limit ${d.timeLimit} min` : 'no limit')}
            </div>`;

        const top = Math.max(1, ...sm.buckets);
        const bars = sm.buckets.map((n, i) => `
            <div class="flex-1 flex flex-col items-center justify-end min-w-0" title="${i * 10}-${i === 9 ? 100 : i * 10 + 9}%: ${n} student${n === 1 ? '' : 's'}">
                <span class="text-[10px] font-bold text-gray-600">${n || ''}</span>
                <div class="w-full rounded-t ${i < 6 ? 'bg-rose-300' : 'bg-teal-400'}" style="height:${Math.max(n ? 6 : 2, (n / top) * 90)}px"></div>
                <span class="text-[9px] text-gray-500 mt-0.5">${i * 10}</span>
            </div>`).join('');
        const distribution = `
            <div class="bg-white border border-gray-200 rounded-xl p-3">
                <div class="text-xs font-black text-gray-700 uppercase tracking-wider mb-2">Score spread <span class="font-medium normal-case text-gray-500">(students per 10% band)</span></div>
                <div class="flex items-end gap-1 h-28" role="img" aria-label="Score spread. ${sm.buckets.map((n, i) => `${i * 10} to ${i * 10 + 10} percent: ${n}`).join('. ')}">${bars}</div>
            </div>`;

        const labelFor = (q) => {
            if (q.avgPct === null) return '';
            if (q.avgPct < 40) return '<span class="text-[10px] font-black px-1.5 py-0.5 rounded bg-red-100 text-red-800 border border-red-200">Hard</span>';
            if (q.avgPct >= 85) return '<span class="text-[10px] font-black px-1.5 py-0.5 rounded bg-green-100 text-green-800 border border-green-200">Easy</span>';
            return '';
        };
        const barColor = (p) => (p === null ? 'bg-gray-300' : p < 40 ? 'bg-red-400' : p < 70 ? 'bg-amber-400' : 'bg-teal-500');
        const typeName = { mc: 'Multiple choice', multi: 'Multiple answer', tf: 'True/False', id: 'Identification', num: 'Numeric', enum: 'Enumeration', order: 'Ordering', match: 'Matching', essay: 'Essay' };
        const pctBar = (p, color) => `<div class="h-2 bg-gray-100 rounded overflow-hidden"><div class="h-full ${color}" style="width:${p || 0}%"></div></div>`;

        const detail = (q) => {
            if (q.options) {
                return `<div class="mt-2 space-y-1">${q.options.map(o => `
                    <div class="flex items-center gap-2 text-[11px]">
                        <span class="w-40 sm:w-56 shrink-0 truncate ${o.correct ? 'font-black text-green-700' : 'text-gray-700'}" title="${esc(o.text)}">${o.correct ? '<i class="fa-solid fa-check mr-1" aria-hidden="true"></i>' : ''}${esc(o.text)}</span>
                        <div class="flex-1">${pctBar(o.pct, o.correct ? 'bg-green-500' : 'bg-gray-400')}</div>
                        <span class="w-16 text-right text-gray-600">${o.count} (${fmt(o.pct, '%')})</span>
                    </div>`).join('')}</div>`;
            }
            if (q.commonWrong && q.commonWrong.length) {
                return `<div class="mt-2 text-[11px] text-gray-700"><span class="font-bold">Common wrong answers:</span> ${q.commonWrong.map(w => `"${esc(w.text)}" (${w.count})`).join(', ')}</div>`;
            }
            if (q.parts) {
                return `<div class="mt-2 space-y-1">${q.parts.map(p => `
                    <div class="flex items-center gap-2 text-[11px]">
                        <span class="w-40 sm:w-56 shrink-0 truncate text-gray-700" title="${esc(p.label)}">${esc(p.label)}</span>
                        <div class="flex-1">${pctBar(p.pct, barColor(p.pct))}</div>
                        <span class="w-12 text-right text-gray-600">${fmt(p.pct, '%')}</span>
                    </div>`).join('')}</div>`;
            }
            if (q.type === 'essay') {
                return `<div class="mt-2 text-[11px] text-gray-700">${q.marked} of ${q.submitted} essay${q.submitted === 1 ? '' : 's'} marked${q.avgPct === null ? '' : `, average ${q.avgPct}% of ${q.points} points`}.</div>`;
            }
            return '';
        };

        const flagText = { hard: 'Very hard: check the key', easy: 'Very easy', negative: 'Top students did worse than weak ones: check the key', weak: 'Does not separate strong from weak students' };
        const analysisHtml = (q) => {
            if (q.type === 'essay') return '';
            const flags = (q.flags || []).map(f => `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${f === 'negative' || f === 'hard' ? 'bg-red-100 text-red-800 border border-red-200' : 'bg-amber-100 text-amber-800 border border-amber-200'}">${flagText[f]}</span>`).join(' ');
            const disc = q.discrimination === null || q.discrimination === undefined ? 'needs 8+ students' : q.discrimination;
            const state = q.adjustment === 'credit' ? '<span class="text-[11px] font-bold text-indigo-700">Everyone gets full credit</span>'
                : q.adjustment === 'drop' ? '<span class="text-[11px] font-bold text-indigo-700">Dropped: not counted</span>' : '';
            const btn = (action, label, cls) => `<button type="button" class="er-adjust-btn px-2 py-1 rounded text-[11px] font-bold border ${cls}" data-index="${q.index}" data-action="${action}" data-no="${q.no}">${label}</button>`;
            const buttons = q.adjustment
                ? btn('none', 'Undo', 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50')
                : btn('credit', 'Give everyone credit', 'bg-white text-indigo-700 border-indigo-300 hover:bg-indigo-50') + btn('drop', 'Drop question', 'bg-white text-red-700 border-red-300 hover:bg-red-50');
            return `<div class="mt-2 flex flex-wrap items-center gap-2">
                <span class="text-[11px] text-gray-600">Discrimination: <b>${disc}</b></span>${flags}${state}
                <span class="ml-auto flex gap-1.5">${buttons}</span></div>`;
        };

        const list = d.questions.map((q, i) => ({ ...q, no: i + 1 }));
        if (CourseExam.resultsSort === 'hardest') list.sort((a, b) => (a.avgPct ?? 101) - (b.avgPct ?? 101));
        const sortBtn = (key, label) => `<button type="button" data-sort="${key}" class="er-sort-btn px-2.5 py-1 text-[11px] font-bold rounded ${CourseExam.resultsSort === key ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}" aria-pressed="${CourseExam.resultsSort === key}">${label}</button>`;
        const questionCards = list.map(q => `
            <div class="bg-white border border-gray-200 rounded-xl p-3">
                <div class="flex flex-wrap items-start justify-between gap-2">
                    <div class="text-sm font-bold text-gray-800 min-w-0 break-words"><span class="text-gray-400">${q.no}.</span> ${esc(q.question)}${q.isBonus ? ' <span class="text-amber-700 text-[11px]">(bonus)</span>' : ''}</div>
                    <div class="flex items-center gap-1.5 shrink-0">${labelFor(q)}<span class="text-[10px] text-gray-500">${typeName[q.type] || q.type} &bull; ${q.points} pt${q.points === 1 ? '' : 's'}</span></div>
                </div>
                <div class="mt-2 flex items-center gap-2">
                    <div class="flex-1">${pctBar(q.avgPct, barColor(q.avgPct))}</div>
                    <span class="text-xs font-black text-gray-800 w-28 text-right">${fmt(q.avgPct, '%')} average</span>
                </div>
                <div class="mt-1 text-[11px] text-gray-500">${q.fullPct === null ? '' : `${q.fullPct}% got it fully right. `}${q.answered} of ${q.submitted} answered.</div>
                ${analysisHtml(q)}
                ${detail(q)}
            </div>`).join('');

        const rows = d.students.map(s => `
            <tr class="border-t border-gray-100">
                <td class="px-2 py-1.5 font-bold text-gray-800">${esc(s.name)} <span class="font-normal text-gray-500">${esc(s.studentNumber)}</span></td>
                <td class="px-2 py-1.5 ${s.status === 'Completed' ? 'text-green-700' : 'text-gray-500'}">${esc(s.status)}</td>
                <td class="px-2 py-1.5 text-right">${s.score === null ? '-' : `${s.score} / ${s.max}`}</td>
                <td class="px-2 py-1.5 text-right font-bold">${fmt(s.percent, '%')}</td>
                <td class="px-2 py-1.5 text-right">${s.minutes === null ? '-' : s.minutes + ' min'}</td>
            </tr>`).join('');

        body.innerHTML = `
            ${releaseRow}
            ${tiles}
            ${distribution}
            <div>
                <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <h5 class="text-xs font-black text-gray-700 uppercase tracking-wider">Question analysis</h5>
                    <div class="flex gap-1.5" role="group" aria-label="Sort questions">${sortBtn('hardest', 'Hardest first')}${sortBtn('order', 'Exam order')}</div>
                </div>
                <div class="space-y-2">${questionCards}</div>
            </div>
            <div>
                <div class="flex items-center justify-between mb-2">
                    <h5 class="text-xs font-black text-gray-700 uppercase tracking-wider">Students</h5>
                    <button type="button" id="erExportBtn" class="px-2.5 py-1.5 text-xs font-bold rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition"><i class="fa-solid fa-file-export mr-1" aria-hidden="true"></i>Export CSV</button>
                </div>
                <div class="bg-white border border-gray-200 rounded-xl overflow-x-auto">
                    <table class="w-full text-xs text-left">
                        <thead class="bg-gray-50 text-gray-600"><tr><th class="px-2 py-1.5">Student</th><th class="px-2 py-1.5">Status</th><th class="px-2 py-1.5 text-right">Score</th><th class="px-2 py-1.5 text-right">%</th><th class="px-2 py-1.5 text-right">Time</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>`;
    },

    exportResultsCsv: () => {
        const d = CourseExam.resultsData;
        if (!d) return;
        const cell = (v) => {
            let t = String(v ?? '');
            if (/^[=+@]/.test(t) || (/^-/.test(t) && !/^-?\d+(\.\d+)?$/.test(t))) t = "'" + t;
            return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
        };
        const lines = [['Student', 'Student number', 'Status', 'Score', 'Max', 'Percent', 'Minutes'].join(',')]
            .concat(d.students.map(s => [s.name, s.studentNumber, s.status, s.score ?? '', s.max ?? '', s.percent ?? '', s.minutes ?? ''].map(cell).join(',')));
        const name = (d.title || 'exam').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'exam';
        const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${name}_results.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },

    // ---------- Grade Essays ----------

    essayData: null,

    openEssayView: async (classExamId, title) => {
        document.getElementById('examManagerMainView').classList.add('hidden');
        document.getElementById('examClassAssignView').classList.add('hidden');
        document.getElementById('examBonusView').classList.add('hidden');
        document.getElementById('examResultsView')?.classList.add('hidden');
        document.getElementById('examEssayView').classList.remove('hidden');
        document.getElementById('eevExamTitle').textContent = title;
        document.getElementById('eevAlert').classList.add('hidden');
        const list = document.getElementById('eevList');
        list.innerHTML = '<div class="text-center py-8 text-gray-500"><i class="fa-solid fa-spinner fa-spin text-2xl"></i></div>';
        try {
            const data = await apiFetch(`/api/exam-essays?classExamId=${encodeURIComponent(classExamId)}&_t=${Date.now()}`);
            CourseExam.essayData = { classExamId, ...data };
            CourseExam.renderEssayList();
        } catch (err) {
            list.innerHTML = `<div class="text-red-500 font-bold text-sm text-center py-4">${esc(err.message)}</div>`;
        }
    },

    renderEssayList: () => {
        const d = CourseExam.essayData;
        const list = document.getElementById('eevList');
        if (!d || !list) return;
        const onlyUnmarked = document.getElementById('eevOnlyUnmarked')?.checked;
        const done = (st) => st.marks.every(m => m !== null && m !== undefined);
        const shown = d.students.filter(st => !onlyUnmarked || !done(st));
        const left = d.students.filter(st => !done(st)).length;
        const countEl = document.getElementById('eevCount');
        if (countEl) countEl.textContent = `${d.students.length} submitted, ${left} still to mark`;

        if (!d.students.length) {
            list.innerHTML = '<div class="text-center py-10 text-sm text-gray-500">No student has submitted this exam yet.</div>';
            return;
        }
        if (!shown.length) {
            list.innerHTML = '<div class="text-center py-10 text-sm font-bold text-green-700"><i class="fa-solid fa-circle-check mr-1"></i>Everything is marked.</div>';
            return;
        }
        list.innerHTML = shown.map(st => `
            <div class="bg-white border border-gray-200 rounded-xl p-3 shadow-sm" data-student-id="${esc(st.studentId)}">
                <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div class="font-black text-sm text-gray-800">${esc(st.name)} <span class="text-[11px] font-medium text-gray-500">${esc(st.studentNumber)}</span></div>
                    <div class="flex items-center gap-2">
                        <span class="eev-status text-[10px] font-black px-2 py-0.5 rounded ${done(st) ? 'bg-green-100 text-green-800 border border-green-300' : 'bg-amber-100 text-amber-900 border border-amber-300'}">${done(st) ? 'Marked' : 'To mark'}</span>
                        <span class="eev-score text-[11px] font-bold text-gray-600">Score ${st.finalScore ?? '-'} / ${st.maxScore ?? '-'}</span>
                    </div>
                </div>
                ${d.essays.map((e, k) => `
                    <div class="border-t border-gray-100 pt-2 mt-2">
                        <div class="text-xs font-bold text-gray-700">${esc(e.question)}${e.isBonus ? ' <span class="text-amber-700">(bonus)</span>' : ''}</div>
                        ${e.rubric ? `<details class="mt-1"><summary class="text-[11px] text-indigo-700 font-bold cursor-pointer">Model answer / rubric</summary><div class="text-[11px] text-gray-600 bg-indigo-50 rounded p-2 mt-1" style="white-space:pre-wrap">${esc(e.rubric)}</div></details>` : ''}
                        <div class="mt-1.5 text-sm text-gray-900 bg-gray-50 border border-gray-200 rounded p-2 min-h-[2.5rem]" style="white-space:pre-wrap">${st.answers[k].trim() ? esc(st.answers[k]) : '<span class="text-gray-400 italic">No answer written.</span>'}</div>
                        <label class="mt-1.5 flex items-center gap-2 text-xs font-bold text-gray-700">Points
                            <input type="number" min="0" max="${e.points}" step="0.5" class="eev-mark w-24 border border-gray-300 rounded px-2 py-1 text-sm bg-white" data-index="${e.index}" value="${st.marks[k] ?? ''}" placeholder="0 - ${e.points}" aria-label="Points for ${esc(st.name)}, out of ${e.points}">
                            <span class="font-medium text-gray-500">out of ${e.points}</span>
                        </label>
                    </div>`).join('')}
                <div class="mt-3 flex justify-end">
                    <button type="button" class="eev-save-btn px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-xs font-bold transition disabled:opacity-50" data-student-id="${esc(st.studentId)}"><i class="fa-solid fa-floppy-disk mr-1" aria-hidden="true"></i>Save marks</button>
                </div>
            </div>`).join('');
    },

    saveEssayMarks: async (btn) => {
        const d = CourseExam.essayData;
        if (!d) return;
        const studentId = btn.dataset.studentId;
        const card = btn.closest('[data-student-id]');
        const marks = {};
        card.querySelectorAll('.eev-mark').forEach(input => {
            const v = input.value.trim();
            if (v === '') return;
            const n = Number(v);
            const max = Number(input.max);
            if (!Number.isFinite(n) || n < 0 || n > max) {
                input.classList.add('border-red-500');
                marks.__bad = true;
            } else {
                input.classList.remove('border-red-500');
                marks[input.dataset.index] = n;
            }
        });
        if (marks.__bad) { UI.error('Points must be a number from 0 up to the maximum shown.'); return; }
        if (!Object.keys(marks).length) { UI.error('Type the points first.'); return; }

        btn.disabled = true;
        try {
            const res = await apiFetch('/api/grade-essay', {
                method: 'POST',
                body: JSON.stringify({ classExamId: d.classExamId, studentId, marks })
            });
            const st = d.students.find(x => x.studentId === studentId);
            if (st) {
                d.essays.forEach((e, k) => { if (marks[e.index] !== undefined) st.marks[k] = marks[e.index]; });
                st.finalScore = res.finalScore;
                st.maxScore = res.maxScore;
            }
            UI.success(`Saved. Score is now ${res.finalScore} / ${res.maxScore}`);
            const onlyUnmarked = document.getElementById('eevOnlyUnmarked')?.checked;
            if (onlyUnmarked) CourseExam.renderEssayList();
            else {
                const done = st && st.marks.every(m => m !== null && m !== undefined);
                const status = card.querySelector('.eev-status');
                status.textContent = done ? 'Marked' : 'To mark';
                status.className = `eev-status text-[10px] font-black px-2 py-0.5 rounded ${done ? 'bg-green-100 text-green-800 border border-green-300' : 'bg-amber-100 text-amber-900 border border-amber-300'}`;
                card.querySelector('.eev-score').textContent = `Score ${res.finalScore} / ${res.maxScore}`;
                const countEl = document.getElementById('eevCount');
                if (countEl) countEl.textContent = `${d.students.length} submitted, ${d.students.filter(x => !x.marks.every(m => m !== null && m !== undefined)).length} still to mark`;
            }
        } catch (err) {
            UI.error(err.message || 'Could not save the marks.');
        } finally {
            btn.disabled = false;
        }
    },

    openBonusView: async (examId, title) => {
        CourseExam.activeBonusExamId = examId;
        document.getElementById('examManagerMainView').classList.add('hidden');
        document.getElementById('examClassAssignView').classList.add('hidden');
        document.getElementById('examEssayView')?.classList.add('hidden');
        document.getElementById('examResultsView')?.classList.add('hidden');
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
            const isEnum = q[6] === 'enum' || Array.isArray(q[3]);
            const choicesText = isEnum ? `Enumeration (${(Array.isArray(q[3]) ? q[3].length : 0)} items${q[7] ? ', in order' : ''})` : (Array.isArray(q[2]) && q[2].length > 0 ? q[2].join(' | ') : 'Identification / No choices');
            const answerText = Array.isArray(q[3]) ? q[3].join(' | ') : String(q[3] ?? '');

            return `
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center p-2.5 bg-white border ${isBonus ? 'border-amber-400 bg-amber-50/40' : 'border-gray-200'} rounded-md gap-2">
                    <div class="flex-1 pr-2">
                        <div class="text-xs font-bold text-gray-800">
                            <span class="text-blue-600 font-black mr-1">#${idx + 1}</span>
                            ${isBonus ? '<span class="px-1.5 py-0.5 text-[9px] font-black uppercase bg-amber-200 text-amber-900 rounded mr-1">BONUS</span>' : ''}
                            ${esc(q[1])}
                        </div>
                        <div class="text-[10px] text-gray-500 mt-0.5">Choices: ${esc(choicesText)} &bull; <span class="font-bold text-green-700">Ans: ${esc(answerText)}</span></div>
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
            UI.error('Failed to update bonus status: ' + err.message);
        }
    },

    deleteExamQuestion: async (idx) => {
        const ok = await UI.confirm({ title: 'Delete question', message: `Delete Question #${idx + 1} from this exam?`, confirmText: 'Delete', danger: true });
        if (!ok) return;
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
            UI.error('Failed to delete question: ' + err.message);
        }
    },

    exportExamCsv: (examId) => {
        const ex = CourseExam.exams.find(e => e.Exam_ID === examId);
        if (!ex) return;
        let rows = [];
        try { rows = JSON.parse(ex.ExamData || '[]'); } catch (e) { rows = []; }
        const name = (ex.Title || 'exam').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'exam';
        ExamBuilder.download(`${name}.csv`, toCsv(fromExamData(rows)));
    },

    // Prints the exam as a paper test (all question types) or, with withKey, its answer key.
    openPrintDialog: (examId) => {
        CourseExam.printingId = examId;
        let m = document.getElementById('printExamModal');
        if (!m) {
            m = document.createElement('div');
            m.id = 'printExamModal';
            m.className = 'fixed inset-0 z-[80] flex items-center justify-center p-4';
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-modal', 'true');
            m.setAttribute('aria-label', 'Print exam');
            m.innerHTML = `<div id="closePrintExamBg" class="absolute inset-0 bg-gray-900 bg-opacity-50"></div>
                <div class="relative bg-white rounded-lg shadow-xl w-full max-w-sm p-4">
                    <div class="flex items-center justify-between mb-3"><h4 class="font-bold text-gray-800">Print exam</h4>
                        <button type="button" id="closePrintExamBtn" aria-label="Close" class="text-gray-400 hover:text-gray-800"><i class="fa-solid fa-xmark text-xl" aria-hidden="true"></i></button></div>
                    <label for="printExamSets" class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Sets</label>
                    <select id="printExamSets" class="w-full px-2 py-2 border border-gray-300 rounded-md text-sm bg-white mb-3">
                        <option value="1">1 set</option><option value="2">2 sets (A-B)</option><option value="3">3 sets (A-C)</option>
                        <option value="4">4 sets (A-D)</option><option value="5">5 sets (A-E)</option><option value="6">6 sets (A-F)</option>
                    </select>
                    <div id="printExamSetWrap" class="hidden"><label for="printExamSet" class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Print set</label>
                    <select id="printExamSet" class="w-full px-2 py-2 border border-gray-300 rounded-md text-sm bg-white mb-3"></select></div>
                    <div id="printExamScanWrap" class="hidden mb-3 p-2 bg-rose-50 border border-rose-100 rounded-md">
                        <label class="flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
                            <input type="checkbox" id="printExamScan" class="mt-0.5">
                            <span><b>For the answer-sheet scanner</b> (every type that can be shaded). The papers and keys then match the scanner exactly.</span>
                        </label>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <button type="button" id="printExamPapersBtn" class="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-md text-sm font-bold"><i class="fa-solid fa-print mr-1" aria-hidden="true"></i>Questions</button>
                        <button type="button" id="printExamKeysBtn" class="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-3 py-2 rounded-md text-sm font-bold"><i class="fa-solid fa-key mr-1" aria-hidden="true"></i>Answer keys</button>
                    </div>
                    <div id="printExamSheetWrap" class="hidden mt-3 pt-3 border-t border-gray-100">
                        <div class="flex items-end gap-2">
                            <div class="w-24"><label for="printExamPaper" class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Paper</label>
                            <select id="printExamPaper" class="w-full px-2 py-2 border border-gray-300 rounded-md text-sm bg-white"><option value="letter">Letter</option><option value="a4">A4</option></select></div>
                            <button type="button" id="printExamSheetBtn" class="flex-1 bg-gray-800 hover:bg-gray-900 text-white px-3 py-2 rounded-md text-sm font-bold"><i class="fa-solid fa-table-cells mr-1" aria-hidden="true"></i>Answer sheet (bubbles)</button>
                        </div>
                        <p class="text-[11px] text-gray-500 mt-2">Students shade this sheet; scan it from Scan Answer Sheets. It shows SET circles when there are 2 or more sets.</p>
                    </div>
                </div>`;
            document.body.appendChild(m);
        }
        const ex = CourseExam.exams.find(e => e.Exam_ID === examId);
        const probe = ex ? buildScanSets(ex.ExamData, { seed: ex.Exam_ID, count: 1 }) : { scannable: 0, manual: 0 };
        const items = new Array(probe.scannable).fill(0);
        let total = 0;
        try { total = JSON.parse((ex && ex.ExamData) || '[]').length; } catch (err) { total = 0; }
        CourseExam.printScannable = items.length > 0;
        document.getElementById('printExamSets').value = String(getSetCount(examId, 4));
        document.getElementById('printExamScanWrap').classList.toggle('hidden', !items.length);
        document.getElementById('printExamSheetWrap').classList.toggle('hidden', !items.length);
        document.getElementById('printExamScan').checked = items.length > 0;
        CourseExam.fillPrintSets();
        m.classList.remove('hidden');
    },

    closePrintDialog: () => {
        const m = document.getElementById('printExamModal');
        if (m) m.classList.add('hidden');
    },

    printExam: async (examId, withKey) => {
        const ex = CourseExam.exams.find(e => e.Exam_ID === examId);
        if (!ex) return;
        let rows = [];
        try { rows = JSON.parse(ex.ExamData || '[]'); } catch (e) { rows = []; }
        const questions = fromExamData(rows);
        if (!questions.length) { UI.warning('This exam has no questions to print.'); return; }
        const count = Number((document.getElementById('printExamSets') || {}).value) || 1;
        saveSetCount(examId, count);
        const set = Math.min(count - 1, Math.max(0, Number((document.getElementById('printExamSet') || {}).value) || 0));
        const title = String(ex.Title || '');
        CourseExam.closePrintDialog();
        // First title line = the course name (kept after the first time; the paper still prints without it).
        const courseId = window.location.hash.startsWith('#class-') ? window.location.hash.replace('#class-', '') : '';
        if (courseId && CourseExam.courseTitleFor !== courseId) {
            try {
                const d = await apiFetch(`/api/course-details?courseId=${encodeURIComponent(courseId)}&_t=${Date.now()}`);
                CourseExam.courseTitle = (d.course && d.course.CourseTitle) || '';
                CourseExam.courseTitleFor = courseId;
            } catch (err) { CourseExam.courseTitle = ''; }
        }
        const course = courseId && CourseExam.courseTitleFor === courseId ? CourseExam.courseTitle : '';
        if (CourseExam.printScannable && (document.getElementById('printExamScan') || {}).checked) {
            const built = buildScanSets(ex.ExamData, { seed: ex.Exam_ID, count });
            const label = `${title}${count > 1 ? ' - Set ' + 'ABCDEF'[set] : ''}${withKey ? ' (key)' : ''}`;
            if (built.sets[0] && built.sets[0].items.some(i => i.t !== 'mc')) {
                showPrintPreview(buildScanPaperHtml({ title, course, built, set: Math.min(built.sets.length - 1, set), mode: withKey ? 'keys' : 'papers' }), label);
                return;
            }
            const sets = buildSets(scannableItems(ex.ExamData, MAX_CHOICES), { seed: ex.Exam_ID, count });
            showPrintPreview(buildSetsHtml({ title, course, sets, set: Math.min(sets.length - 1, set), mode: withKey ? 'keys' : 'papers' }), `${title}${count > 1 ? ' - Set ' + 'ABCDEF'[set] : ''}${withKey ? ' (key)' : ''}`);
            return;
        }
        showPrintPreview(buildExamPrintHtml({ title, course, questions, withKey, set, sets: count, seed: ex.Exam_ID }), `${title}${count > 1 ? ' - Set ' + 'ABCDEF'[set] : ''}${withKey ? ' (key)' : ''}`);
    },

    printSheet: async (examId) => {
        const ex = CourseExam.exams.find(e => e.Exam_ID === examId);
        if (!ex) return;
        const count = Number((document.getElementById('printExamSets') || {}).value) || 1;
        saveSetCount(examId, count);
        const paper = (document.getElementById('printExamPaper') || {}).value || 'letter';
        CourseExam.closePrintDialog();
        const err = await printExamAnswerSheet(ex, { sets: count, paper });
        if (err) UI.warning(err);
    },

    // The "Print set" list follows the number of sets: 2 sets = A-B, 3 sets = A-C ...
    fillPrintSets: () => {
        const count = Number((document.getElementById('printExamSets') || {}).value) || 1;
        const sel = document.getElementById('printExamSet');
        const wrap = document.getElementById('printExamSetWrap');
        if (!sel || !wrap) return;
        const keep = sel.value;
        sel.innerHTML = Array.from({ length: count }, (_, k) => `<option value="${k}">Set ${'ABCDEF'[k]}</option>`).join('');
        if (Number(keep) < count) sel.value = keep;
        wrap.classList.toggle('hidden', count < 2);
    },

    archiveExam: async (examId, archived) => {
        try {
            await apiFetch('/api/exams/archive', { method: 'POST', body: JSON.stringify({ examId, lecturerId: AppState.user.User_ID, archived }) });
            UI.success(archived ? 'Exam archived' : 'Exam restored');
            await CourseExam.loadExams();
        } catch (err) {
            UI.error(err.message || 'Could not update the exam.');
        }
    },

    // Only an exam that was never assigned to a class can be deleted (the server checks this too).
    deleteExam: async (examId) => {
        const ex = CourseExam.exams.find(e => e.Exam_ID === examId);
        if (!ex) return;
        const ok = await UI.confirm({ title: 'Delete exam', message: `Delete "${ex.Title}" permanently? This exam has no class records. This cannot be undone.`, confirmText: 'Delete', danger: true });
        if (!ok) return;
        try {
            await apiFetch('/api/exams/delete', { method: 'POST', body: JSON.stringify({ examId, lecturerId: AppState.user.User_ID }) });
            UI.success('Exam deleted');
            await CourseExam.loadExams();
        } catch (err) {
            UI.error(err.message || 'Could not delete the exam.');
        }
    },

    duplicateExam: async (examId) => {
        const ex = CourseExam.exams.find(e => e.Exam_ID === examId);
        if (!ex) return;
        let rows = [];
        try { rows = JSON.parse(ex.ExamData || '[]'); } catch (e) { rows = []; }
        try {
            await apiFetch('/api/exams', {
                method: 'POST',
                body: JSON.stringify({ lecturerId: AppState.user.User_ID, title: `${ex.Title} (copy)`, examData: rows })
            });
            UI.success('Exam duplicated');
            await CourseExam.loadExams();
        } catch (err) {
            UI.error(err.message || 'Could not duplicate the exam.');
        }
    },

    // ---------- Lecturer Presentation Mode ----------

    // A saved row as a builder question (to reuse its type and points rules).
    builderRow: (row) => fromExamData([row])[0],
    pointsOfRow: (row) => pointsOf(fromExamData([row])[0]),

    // Shows the items of an ordering or matching question out of order. Fixed per question so it does not change on redraw.
    scramble: (items, seed) => {
        const a = items.map(String);
        if (a.length < 2) return a;
        const out = a.slice();
        for (let i = out.length - 1; i > 0; i--) {
            const j = (seed * 7 + i * 5 + 3) % (i + 1);
            [out[i], out[j]] = [out[j], out[i]];
        }
        return out.every((v, i) => v === a[i]) ? out.slice(1).concat(out[0]) : out;
    },


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
            UI.error("Failed to load exam data: " + err.message);
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
            const right = (c) => (Array.isArray(ans) ? ans.includes(c) : c === ans);
            [...choicesEl.children].forEach((el, i) => {
                el.classList.toggle("correct", show && right(choices[i]));
                el.classList.toggle("dim", show && !right(choices[i]));
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
        const kind = typeKey(CourseExam.builderRow(dataRow));
        const tagStyle = 'background:#e0e7ff;color:#3730a3;padding:2px 8px;border-radius:6px;font-weight:800;font-size:0.9rem;';
        const tagText = {
            multi: 'SELECT ALL THAT APPLY', multia: 'SELECT ALL (ALL OR NOTHING)', match: 'MATCHING', order: 'ORDERING', ordera: 'ORDERING (ALL OR NOTHING)',
            num: 'NUMERIC', essay: 'ESSAY'
        }[kind] || ((kind === 'enum' || kind === 'enumo') ? `LIST ${(Array.isArray(dataRow[3]) ? dataRow[3] : []).length} ITEMS${dataRow[7] ? ' IN ORDER' : ''}` : '');
        const pts = CourseExam.pointsOfRow(dataRow);
        const enumTag = (tagText ? ` &nbsp;<span style="${tagStyle}">${tagText}</span>` : '')
            + (pts !== 1 ? ` &nbsp;<span style="${tagStyle}">${pts} PTS</span>` : '');
        counterEl.innerHTML = `<span class="num">${CourseExam.current + 1}</span><span class="of">of ${total} &nbsp;|&nbsp; ${posInPart} of ${inPart.length} in this part${enumTag}${bonusTag}</span>`;

        document.getElementById('examQuestion').textContent = q;

        const choicesEl = document.getElementById('examChoices');
        choicesEl.innerHTML = "";

        let choicesClass = "exam-choices";
        const shownCount = (kind === 'match' || kind === 'order' || kind === 'ordera') ? (Array.isArray(ans) ? ans.length : 0) : choices.length;
        if (shownCount === 2) choicesClass += " two";
        else if (shownCount >= 6) choicesClass += " many";
        choicesEl.className = choicesClass;

        const shown = kind === 'match'
            ? (Array.isArray(ans) ? ans : []).map((p, i) => `${i + 1}. ${p[0]}`)
            : (kind === 'order' || kind === 'ordera')
                ? CourseExam.scramble(Array.isArray(ans) ? ans : [], CourseExam.current)
                : choices;
        shown.forEach(c => {
            const div = document.createElement("div");
            div.className = "exam-choice";
            div.textContent = c;
            choicesEl.appendChild(div);
        });
        if (kind === 'match') {
            const pool = (Array.isArray(ans) ? ans.map(p => p[1]) : []).concat((dataRow[8] && dataRow[8].extra) || []);
            const note = document.createElement("div");
            note.className = "exam-expl";
            note.style.gridColumn = "1 / -1";
            note.textContent = 'Partners: ' + CourseExam.scramble(pool, CourseExam.current).join('  |  ');
            choicesEl.appendChild(note);
        }

        const answerEl = document.getElementById('examAnswer');
        const explanationHTML = expl ? `<div class="exam-expl">${esc(expl)}</div>` : "";
        const list = (items, ordered) => `<ol style="margin:0.25rem 0 0 1.4rem;padding:0;list-style:${ordered ? 'decimal' : 'disc'};">${items.map(i => `<li>${i}</li>`).join('')}</ol>`;
        let label = 'Answer';
        let answerHtml;
        if (kind === 'enum' || kind === 'enumo') {
            const items = Array.isArray(ans) ? ans : String(ans ?? '').split('|');
            answerHtml = list(items.map(i => esc(String(i).trim())), dataRow[7]) + (dataRow[7] ? '' : '<div class="exam-expl" style="margin-top:0.4rem;">Any order</div>');
            if (dataRow[7]) label = 'Answer (in order)';
        } else if (kind === 'order' || kind === 'ordera') {
            answerHtml = list((Array.isArray(ans) ? ans : []).map(i => esc(String(i))), true);
            label = 'Correct order';
        } else if (kind === 'match') {
            answerHtml = list((Array.isArray(ans) ? ans : []).map(p => `${esc(p[0])} &rarr; <b>${esc(p[1])}</b>`), false);
            label = 'Pairs';
        } else if (kind === 'multi' || kind === 'multia') {
            answerHtml = list((Array.isArray(ans) ? ans : []).map(i => esc(String(i))), false);
            label = 'Correct answers';
        } else if (kind === 'num') {
            const tol = Number(dataRow[8] && dataRow[8].tol) || 0;
            answerHtml = esc(ans) + (tol > 0 ? ` <span style="font-weight:600;">&plusmn; ${esc(tol)}</span>` : '');
        } else if (kind === 'essay') {
            answerHtml = ans ? esc(ans) : 'Scored by the lecturer.';
            label = 'Model answer';
        } else {
            answerHtml = esc(ans);
        }
        answerEl.innerHTML = `<span class="label">${label}</span>${answerHtml}${explanationHTML}`;

        document.getElementById('examBar').style.width = ((CourseExam.current + 1) / total * 100) + "%";
        document.getElementById('examPrevBtn').disabled = CourseExam.current === 0;
        document.getElementById('examNextBtn').disabled = CourseExam.current === total - 1;

        CourseExam.setAnswer(false);
        document.getElementById('examBodyEl').scrollTop = 0;
    },

    // ---------- Student Full-Screen Accessible Exam Overlay ----------

    // ---- Time limit ----
    timer: null,

    formatClock: (secs) => {
        const t = Math.max(0, Math.round(secs));
        const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
        return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
    },

    spokenTime: (secs) => {
        const m = Math.floor(secs / 60), sec = secs % 60;
        if (m > 0 && sec === 0) return `${m} minute${m === 1 ? '' : 's'}`;
        if (m > 0) return `${m} minute${m === 1 ? '' : 's'} ${sec} seconds`;
        return `${sec} seconds`;
    },

    stopTimer: () => {
        if (CourseExam.timer && CourseExam.timer.id) clearInterval(CourseExam.timer.id);
        CourseExam.timer = null;
        document.getElementById('accExamTimer')?.classList.add('hidden');
    },

    startTimer: (remainingSeconds) => {
        CourseExam.stopTimer();
        const box = document.getElementById('accExamTimer');
        const text = document.getElementById('accExamTimerText');
        if (!box || !text) return;
        const endsAt = Date.now() + remainingSeconds * 1000;
        const told = new Set();
        const state = { endsAt, id: null };
        CourseExam.timer = state;
        box.classList.remove('hidden');

        const tick = () => {
            if (CourseExam.timer !== state) return;
            const left = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
            text.textContent = CourseExam.formatClock(left);
            const low = left <= 60, mid = left <= 300;
            box.className = `px-4 py-2 rounded-lg border-2 font-black text-lg sm:text-2xl tabular-nums ${low ? 'border-red-400 bg-red-900 text-red-100 animate-pulse' : mid ? 'border-amber-400 bg-amber-900 text-amber-100' : 'border-yellow-400 bg-gray-800 text-yellow-300'}`;
            box.setAttribute('aria-label', `Time left: ${CourseExam.spokenTime(left)}`);

            // spoken and screen reader warnings
            const marks = [600, 300, 60, 30, 10];
            const hit = marks.find(m => left <= m && !told.has(m) && (m === marks[0] || left > m - 20));
            if (hit !== undefined && left > 0) {
                marks.filter(m => m >= hit).forEach(m => told.add(m));
                const msg = `${CourseExam.spokenTime(left)} left.`;
                const live = document.getElementById('accExamTimerAnnounce');
                if (live) live.textContent = msg;
                CourseExam.speak(msg);
            }

            if (left <= 0) {
                CourseExam.stopTimer();
                CourseExam.speak('Time is up. Submitting your answers now.');
                CourseExam.submitAccessibleExam(true);
            }
        };
        tick();
        state.id = setInterval(tick, 1000);
    },

    startAccessibleExam: async (examObj, student, onComplete) => {
        let remaining = null;
        if (examObj.timeLimit) {
            if (!examObj.startedAt) {
                const msg = `This exam has a time limit of ${examObj.timeLimit} minute${examObj.timeLimit === 1 ? '' : 's'}. The clock starts now and keeps running even if you leave. Start the exam?`;
                CourseExam.speak(msg);
                if (!window.confirm(msg)) return;
            }
            try {
                const res = await apiFetch('/api/start-accessible-exam', {
                    method: 'POST',
                    body: JSON.stringify({ assignmentId: examObj.assignmentId, studentId: student.User_ID })
                });
                remaining = res.remainingSeconds;
                examObj.startedAt = res.startedAt;
            } catch (err) {
                UI.error('Could not start the exam: ' + err.message);
                return;
            }
        }
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

        const voice = CourseExam.isVoiceUser();

        document.getElementById('accExamHeaderTitle').textContent = examObj.examTitle;
        document.getElementById('accExamCourseBadge').textContent = `${examObj.courseCode} - ${student.Name}`;

        // Sighted students: no read-aloud controls.
        document.getElementById('accExamRepeatAudioBtn')?.classList.toggle('hidden', !voice);
        const feedback = document.getElementById('accExamLiveFeedback');
        if (feedback) {
            feedback.classList.toggle('hidden', !voice);
            if (voice) feedback.textContent = 'Select an answer choice below or press number keys 1 to 4.';
        }

        overlay.classList.remove('hidden');

        CourseExam.renderAccessibleQuestion(true);
        if (remaining !== null) CourseExam.startTimer(remaining);
        else CourseExam.stopTimer();
    },

    closeAccessibleExam: () => {
        if (CourseExam.accExam && !CourseExam.accSubmitting) {
            const timed = CourseExam.timer ? ' The clock keeps running while you are away.' : '';
            const confirmExit = window.confirm("Are you sure you want to exit the exam without submitting?" + timed);
            if (!confirmExit) return;
        }
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        CourseExam.stopTimer();
        document.getElementById('accessibleExamOverlay')?.classList.add('hidden');
        CourseExam.accExam = null;
    },

    updateAccessibleAnsweredBadge: () => {
        const statusEl = document.getElementById('accExamAnsweredStatus');
        if (!statusEl || !CourseExam.accExam) return;
        const currentAns = CourseExam.accAnswers[CourseExam.accIndex];
        const answeredCount = CourseExam.accAnswers.filter(a => CourseExam.isAnswered(a)).length;
        const total = CourseExam.accExam.questions.length;

        if (CourseExam.isAnswered(currentAns)) {
            const shown = CourseExam.answerText(currentAns);
            statusEl.textContent = `${shown.length > 60 ? 'Answered' : `Selected: ${shown}`} (${answeredCount}/${total} Answered)`;
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
        const pointsBadge = q.points ? ` <span class="ml-2 px-3 py-0.5 bg-gray-800 text-yellow-300 border border-yellow-400 rounded-full text-sm sm:text-lg font-black">${q.points} point${q.points === 1 ? '' : 's'}</span>` : '';
        document.getElementById('accExamQuestionCounter').innerHTML = `Question ${CourseExam.accIndex + 1} of ${total}${bonusBadge}${pointsBadge}`;

        // Add tabindex="0" so the question text itself can receive focus naturally.
        document.getElementById('accExamQuestionText').setAttribute('tabindex', '0');
        document.getElementById('accExamQuestionText').textContent = q.question;

        CourseExam.updateAccessibleAnsweredBadge();

        const choicesContainer = document.getElementById('accExamChoicesContainer');
        const currentAnswer = CourseExam.accAnswers[CourseExam.accIndex];

        const SEL = 'acc-exam-sel w-full min-w-0 px-4 py-3 text-lg sm:text-xl font-bold bg-gray-950 text-white border-2 border-gray-600 rounded-xl focus:outline-none focus:border-yellow-400';
        const options = (list, chosen) => `<option value="">- choose -</option>` + list.map(o => `<option value="${esc(o)}" ${o === chosen ? 'selected' : ''}>${esc(o)}</option>`).join('');
        const panel = (hint, inner) => `<div class="bg-gray-900 p-5 sm:p-6 rounded-2xl border-2 border-yellow-400 space-y-3"><p class="text-lg font-bold text-yellow-300">${hint}</p>${inner}</div>`;

        if (q.choices && q.choices.length > 0) {
            const multi = q.type === 'multi';
            const picked = multi && Array.isArray(currentAnswer) ? currentAnswer : [];
            const hint = multi
                ? `<p class="text-lg font-bold text-yellow-300 px-1">Select all the correct answers${q.mode === 'all' ? ' (all or nothing)' : ''}. Tap a choice again to remove it.</p>`
                : '';
            choicesContainer.innerHTML = hint + q.choices.map((choiceText, idx) => {
                const letter = String.fromCharCode(65 + idx);
                const isSelected = multi ? picked.includes(choiceText) : currentAnswer === choiceText;
                return `
                    <button type="button"
                        class="acc-exam-choice-btn w-full text-left p-5 sm:p-6 rounded-2xl border-4 transition flex items-center justify-between gap-4 focus:outline-none focus:ring-4 focus:ring-yellow-300 ${
                            isSelected
                                ? 'bg-yellow-400 text-gray-950 border-white font-black shadow-xl'
                                : 'bg-gray-900 hover:bg-gray-800 text-white border-gray-700 font-bold'
                        }"
                        data-choice-index="${idx}"
                        role="${multi ? 'checkbox' : 'option'}"
                        ${multi ? `aria-checked="${isSelected}"` : `aria-selected="${isSelected}"`}>
                        <span class="text-xl sm:text-2xl leading-snug">
                            <span class="inline-block w-10 font-black ${isSelected ? 'text-gray-950' : 'text-yellow-400'}">${idx + 1} (${letter}).</span>
                            ${esc(choiceText)}
                        </span>
                        ${isSelected ? '<i class="fa-solid fa-circle-check text-2xl sm:text-3xl text-gray-950 flex-shrink-0"></i>' : ''}
                    </button>
                `;
            }).join('');
        } else if (q.type === 'enum') {
            const saved = Array.isArray(currentAnswer) ? currentAnswer : [];
            const boxes = Array.from({ length: q.itemCount }, (_, i) => `
                <div class="flex items-center gap-3">
                    <label for="accExamEnumInput${i}" class="w-10 shrink-0 text-right text-xl font-black text-yellow-400">${i + 1}.</label>
                    <input type="text" id="accExamEnumInput${i}" data-i="${i}" value="${esc(saved[i] || '')}" autocomplete="off"
                        class="acc-exam-enum-input flex-1 min-w-0 px-4 py-3 text-xl sm:text-2xl font-bold bg-gray-950 text-white border-2 border-gray-600 rounded-xl focus:outline-none focus:border-yellow-400"
                        placeholder="Item ${i + 1}">
                </div>`).join('');
            choicesContainer.innerHTML = panel(`List ${q.itemCount} item${q.itemCount === 1 ? '' : 's'}${q.ordered ? ', in the correct order' : ', in any order'}. Press Enter to go to the next box.`, boxes);
        } else if (q.type === 'order') {
            const saved = Array.isArray(currentAnswer) ? currentAnswer : [];
            const items = (q.items || []).map(it => `<li class="text-lg sm:text-xl font-bold text-white">${esc(it)}</li>`).join('');
            const rows = Array.from({ length: (q.items || []).length }, (_, i) => `
                <div class="flex items-center gap-3">
                    <label for="accExamOrderSel${i}" class="w-24 shrink-0 text-right text-lg font-black text-yellow-400">Position ${i + 1}</label>
                    <select id="accExamOrderSel${i}" data-i="${i}" aria-label="Position ${i + 1} of ${q.items.length}" class="${SEL}">${options(q.items, saved[i] || '')}</select>
                </div>`).join('');
            choicesContainer.innerHTML = panel(`Put these in the correct order${q.mode === 'all' ? ' (all or nothing)' : ''}:`, `<ul class="list-disc pl-8 space-y-1">${items}</ul>${rows}`);
        } else if (q.type === 'match') {
            const saved = Array.isArray(currentAnswer) ? currentAnswer : [];
            const rows = (q.lefts || []).map((left, i) => `
                <div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                    <label for="accExamMatchSel${i}" class="sm:w-2/5 text-lg sm:text-xl font-black text-white">${i + 1}. ${esc(left)}</label>
                    <select id="accExamMatchSel${i}" data-i="${i}" aria-label="Match for ${esc(left)}" class="${SEL}">${options(q.rights || [], saved[i] || '')}</select>
                </div>`).join('');
            choicesContainer.innerHTML = panel('Match each item on the left with its partner.', rows);
        } else if (q.type === 'essay') {
            choicesContainer.innerHTML = `
                <div class="bg-gray-900 p-5 sm:p-6 rounded-2xl border-2 border-yellow-400">
                    <label for="accExamEssayInput" class="block text-lg font-bold text-yellow-300 mb-2">Write your answer. Your lecturer will score it.</label>
                    <textarea id="accExamEssayInput" rows="8" maxlength="10000" autocomplete="off"
                        class="w-full px-4 py-4 text-xl font-semibold bg-gray-950 text-white border-2 border-gray-600 rounded-xl focus:outline-none focus:border-yellow-400"
                        placeholder="Type your answer here...">${esc(currentAnswer)}</textarea>
                </div>`;
        } else {
            const isNum = q.type === 'num';
            choicesContainer.innerHTML = `
                <div class="bg-gray-900 p-6 rounded-2xl border-2 border-yellow-400">
                    <label for="accExamTextAnswerInput" class="block text-lg font-bold text-yellow-300 mb-2">${isNum ? 'Type the number and press Tab or Enter:' : 'Type your answer below and press Tab or Enter:'}</label>
                    <input type="text" id="accExamTextAnswerInput" ${isNum ? 'inputmode="decimal"' : ''} value="${esc(currentAnswer)}" autocomplete="off"
                        class="w-full px-4 py-4 text-2xl font-bold bg-gray-950 text-white border-2 border-gray-600 rounded-xl focus:outline-none focus:border-yellow-400"
                        placeholder="${isNum ? 'Type a number...' : 'Type your answer here...'}">
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
        if (!CourseExam.accExam || !CourseExam.isVoiceUser()) return;
        const questions = CourseExam.accExam.questions;
        const total = questions.length;
        const q = questions[CourseExam.accIndex];
        if (!q) return;

        const currentAns = CourseExam.accAnswers[CourseExam.accIndex];
        let speech = "";

        if (CourseExam.isAnswered(currentAns)) {
            speech += "Answered question. ";
        }

        speech += `Question ${CourseExam.accIndex + 1} of ${total}. `;
        if (q.isBonus) {
            speech += `This is a bonus question. `;
        }
        speech += `${q.question}. `;

        if (CourseExam.isAnswered(currentAns)) {
            speech += `Your answer so far is ${CourseExam.answerText(currentAns)}. `;
        }

        if (q.choices && q.choices.length > 0) {
            if (q.type === 'multi') speech += `This question has more than one correct answer${q.mode === 'all' ? ', all or nothing' : ''}. Select every correct choice; select a choice again to remove it. `;
            speech += `The choices are: `;
            q.choices.forEach((c, idx) => {
                const letter = String.fromCharCode(65 + idx);
                speech += `Choice ${idx + 1}, ${letter}: ${c}. `;
            });
            speech += `Press R to repeat the question. Press Enter or Space for the selected answer. `;
        } else if (q.type === 'enum') {
            speech += `This is an enumeration question. List ${q.itemCount} item${q.itemCount === 1 ? '' : 's'}${q.ordered ? ', in the correct order' : ', in any order'}. There are ${q.itemCount} text boxes. Type an item, then press Enter to go to the next box. Press R to repeat the question. `;
        } else if (q.type === 'order') {
            speech += `This is an ordering question. Put these items in the correct order: ${(q.items || []).map((it, i) => `${i + 1}, ${it}`).join('. ')}. There is a list box for each position. Choose the item for position 1, then Tab to the next position. Press R to repeat the question. `;
        } else if (q.type === 'match') {
            speech += `This is a matching question. There are ${(q.lefts || []).length} items. Each has a list box. The partners to choose from are: ${(q.rights || []).join('. ')}. The items are: ${(q.lefts || []).map((l, i) => `${i + 1}, ${l}`).join('. ')}. Press R to repeat the question. `;
        } else if (q.type === 'essay') {
            speech += `This is an essay question. Type your answer in the large text box. Your lecturer will score it. Press R to repeat the question. `;
        } else if (q.type === 'num') {
            speech += `This is a numeric question. Please type a number in the text box. Press R to repeat the question. `;
        } else {
            speech += `This is an identification question. Please type your answer in the text box. Press R to repeat the question. `;
        }

        const isLast = CourseExam.accIndex === total - 1;
        if (isLast) {
            speech += `You are on the final question. Double press Enter or Space to submit the exam.`;
        } else {
            speech += `Double press Enter or Space to go to the next question.`;
        }

        document.getElementById('accExamLiveFeedback').textContent = CourseExam.isAnswered(currentAns)
            ? `Current Answer: ${CourseExam.answerText(currentAns)}`
            : `Listening... Choose an option or press 1 to ${q.choices?.length || 4}.`;

        CourseExam.speak(speech);
    },

    selectAccessibleChoice: (choiceIndex) => {
        if (!CourseExam.accExam) return;
        const q = CourseExam.accExam.questions[CourseExam.accIndex];
        if (!q || !q.choices || choiceIndex < 0 || choiceIndex >= q.choices.length) return;

        const chosenText = q.choices[choiceIndex];
        let speechAnswer = chosenText;
        let removed = false;
        if (q.type === 'multi') {
            const had = Array.isArray(CourseExam.accAnswers[CourseExam.accIndex]) ? CourseExam.accAnswers[CourseExam.accIndex].slice() : [];
            removed = had.includes(chosenText);
            const next = removed ? had.filter(x => x !== chosenText) : had.concat(chosenText);
            CourseExam.accAnswers[CourseExam.accIndex] = next.length ? next : '';
            speechAnswer = chosenText;
        } else {
            CourseExam.accAnswers[CourseExam.accIndex] = chosenText;
        }

        localStorage.setItem('acc_exam_draft_' + CourseExam.accExam.assignmentId, JSON.stringify(CourseExam.accAnswers));
        CourseExam.renderAccessibleQuestion(false);
        // keep the keyboard on the choice that was just pressed
        document.querySelector(`.acc-exam-choice-btn[data-choice-index="${choiceIndex}"]`)?.focus({ preventScroll: true });

        if (!CourseExam.isVoiceUser()) return;

        const total = CourseExam.accExam.questions.length;
        const navHint = CourseExam.accIndex < total - 1
            ? "Double press Enter or Space to go to the next question."
            : "This is the last question. Double press Enter or Space to submit the exam.";

        const confirmSpeech = q.type === 'multi'
            ? `${removed ? 'Removed' : 'Selected'} ${speechAnswer}. ${CourseExam.answerText(CourseExam.accAnswers[CourseExam.accIndex]) ? `You have selected ${CourseExam.answerText(CourseExam.accAnswers[CourseExam.accIndex])}.` : 'Nothing is selected.'} ${navHint}`
            : `You have selected ${chosenText} as your answer. ${navHint}`;
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

    submitAccessibleExam: async (force = false) => {
        if (!CourseExam.accExam || !CourseExam.accStudent || CourseExam.accSubmitting) return;

        const unanswered = CourseExam.accAnswers
            .map((a, i) => (!CourseExam.isAnswered(a) ? i + 1 : null))
            .filter(Boolean);

        if (force) CourseExam.stopTimer();
        let promptMsg = `Are you sure you want to submit ${CourseExam.accExam.examTitle}?`;
        if (unanswered.length > 0) {
            promptMsg = `You have ${unanswered.length} unanswered question(s): Question ${unanswered.join(', ')}. Do you still want to submit your exam now?`;
        }

        if (!force) CourseExam.speak(promptMsg);
        const confirmed = force ? true : window.confirm(promptMsg);
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
            CourseExam.stopTimer();

            const essayNote = res.essayPending > 0 ? ` ${res.essayPending} essay answer${res.essayPending === 1 ? ' is' : 's are'} waiting for your lecturer to score, so your score can still go up.` : '';
            const resultSpeech = `Exam submitted successfully! Your regular score is ${res.rawScore}, plus ${res.bonusScore} bonus points. Your final recorded score is ${res.finalScore} out of ${res.maxScore}. This score has been automatically recorded in your class assessment.${essayNote}`;

            document.getElementById('accExamLiveFeedback').innerHTML = `
                <div class="text-green-300 font-black text-2xl mb-1">Exam Submitted! Final Score: ${res.finalScore} / ${res.maxScore}</div>
                <div class="text-sm text-white">Regular Score: ${res.rawScore} | Bonus Points: +${res.bonusScore} (Capped at ${res.maxScore})${essayNote ? `<br>${esc(essayNote.trim())}` : ''}</div>
            `;
            CourseExam.speak(resultSpeech);

            alert((force ? 'Time is up. Your answers were submitted automatically.\n\n' : '') + resultSpeech);

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
