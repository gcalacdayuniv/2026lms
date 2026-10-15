// js/components-exam.js

export const ExamUI = {
    renderManagerModal: () => `
        <div id="examManagerModal" class="hidden fixed inset-0 z-[70] flex items-center justify-center fade-in p-2 sm:p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeExamManagerBg"></div>
            <div class="bg-white rounded-lg shadow-xl w-full max-w-4xl p-4 sm:p-6 relative z-10 scale-up max-h-[92vh] flex flex-col">
                <div class="flex justify-between items-center mb-4 border-b pb-3">
                    <div>
                        <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-file-contract text-blue-600 mr-2"></i>Manage Exams & Accessible Class Assignments</h3>
                        <p class="text-xs text-gray-500">Upload exams, add bonus questions, link exams to this class with date schedules, and assign students.</p>
                    </div>
                    <button id="closeExamManagerBtn" class="text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>

                <!-- Main Exam List & Upload View -->
                <div id="examManagerMainView" class="flex-1 flex flex-col min-h-0 overflow-hidden">
                    <div class="mb-4 bg-blue-50 p-4 border border-blue-200 rounded-lg flex-shrink-0">
                        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                            <h4 class="text-sm font-bold text-blue-800">Upload New Exam (CSV Format)</h4>
                            <div class="flex flex-wrap items-center gap-2">
                                <button type="button" id="toggleExamCsvGuideBtn" class="px-3 py-1 bg-white hover:bg-blue-100 text-blue-700 border border-blue-300 rounded text-xs font-bold transition shadow-sm flex items-center">
                                    <i class="fa-solid fa-circle-question mr-1.5"></i> Spreadsheet Guide
                                </button>
                                <button type="button" id="downloadExamCsvTemplateBtn" class="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-bold transition shadow-sm flex items-center">
                                    <i class="fa-solid fa-file-csv mr-1.5"></i> Download CSV Template
                                </button>
                            </div>
                        </div>
                        <p class="text-xs text-blue-600 mb-3">Columns: Part Index (0=Part 1, 1=Part 2, 2=Part 3), Question, Choices (Pipe separated "|"), Answer, Explanation, Bonus (Optional: 1 or Bonus).</p>

                        <!-- Collapsible Spreadsheet Guide -->
                        <div id="examCsvGuidePanel" class="hidden mb-3 bg-white p-3 rounded-lg border border-blue-200 text-xs text-gray-700 space-y-2">
                            <div class="font-black text-blue-900 uppercase tracking-wider text-[11px]">How to Prepare Your Exam in Excel or Google Sheets:</div>
                            <div class="overflow-x-auto">
                                <table class="w-full text-left border-collapse border border-gray-200 text-[11px]">
                                    <thead class="bg-gray-100 text-gray-800 font-bold">
                                        <tr>
                                            <th class="border border-gray-200 px-2 py-1">Col</th>
                                            <th class="border border-gray-200 px-2 py-1">Header</th>
                                            <th class="border border-gray-200 px-2 py-1">Description & Rules</th>
                                            <th class="border border-gray-200 px-2 py-1">Sample Value</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td class="border border-gray-200 px-2 py-1 font-mono font-bold">A</td>
                                            <td class="border border-gray-200 px-2 py-1 font-bold">Part Index</td>
                                            <td class="border border-gray-200 px-2 py-1">Use <code class="bg-gray-100 px-1 rounded">0</code> for Part 1, <code class="bg-gray-100 px-1 rounded">1</code> for Part 2, <code class="bg-gray-100 px-1 rounded">2</code> for Part 3.</td>
                                            <td class="border border-gray-200 px-2 py-1 font-mono">0</td>
                                        </tr>
                                        <tr>
                                            <td class="border border-gray-200 px-2 py-1 font-mono font-bold">B</td>
                                            <td class="border border-gray-200 px-2 py-1 font-bold">Question</td>
                                            <td class="border border-gray-200 px-2 py-1">Full question text. Multi-line text inside a cell is supported.</td>
                                            <td class="border border-gray-200 px-2 py-1">What does HTML stand for?</td>
                                        </tr>
                                        <tr>
                                            <td class="border border-gray-200 px-2 py-1 font-mono font-bold">C</td>
                                            <td class="border border-gray-200 px-2 py-1 font-bold">Choices</td>
                                            <td class="border border-gray-200 px-2 py-1">Separate choices with a pipe <code class="bg-gray-100 px-1 rounded">|</code>. Leave blank for Identification.</td>
                                            <td class="border border-gray-200 px-2 py-1">HyperText Markup Language | HighText Machine Language | HyperLoop</td>
                                        </tr>
                                        <tr>
                                            <td class="border border-gray-200 px-2 py-1 font-mono font-bold">D</td>
                                            <td class="border border-gray-200 px-2 py-1 font-bold">Answer</td>
                                            <td class="border border-gray-200 px-2 py-1">Must match the exact text of the correct choice (case-insensitive when grading).</td>
                                            <td class="border border-gray-200 px-2 py-1">HyperText Markup Language</td>
                                        </tr>
                                        <tr>
                                            <td class="border border-gray-200 px-2 py-1 font-mono font-bold">E</td>
                                            <td class="border border-gray-200 px-2 py-1 font-bold">Explanation</td>
                                            <td class="border border-gray-200 px-2 py-1">Optional note shown when revealing the answer in Present mode.</td>
                                            <td class="border border-gray-200 px-2 py-1">HTML is the standard markup language for web pages.</td>
                                        </tr>
                                        <tr>
                                            <td class="border border-gray-200 px-2 py-1 font-mono font-bold">F</td>
                                            <td class="border border-gray-200 px-2 py-1 font-bold">Bonus</td>
                                            <td class="border border-gray-200 px-2 py-1">Optional: type <code class="bg-gray-100 px-1 rounded">1</code> or <code class="bg-gray-100 px-1 rounded">Bonus</code> for bonus credit (capped at Max Score).</td>
                                            <td class="border border-gray-200 px-2 py-1 font-mono">1</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <div class="text-[11px] text-gray-600">
                                <strong>Tip:</strong> Click <strong>Download CSV Template</strong>, open it in Excel or Google Sheets, replace the sample rows with your questions, keep Row 1 as the header, and save/export as <strong>CSV (Comma delimited) (*.csv)</strong>.
                            </div>
                        </div>

                        <div class="flex flex-col sm:flex-row gap-2">
                            <input type="text" id="newExamTitle" placeholder="Exam Title (links to Record Scores)" class="flex-1 px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white">
                            <input type="file" id="examCsvUpload" accept=".csv" class="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm bg-white">
                            <button type="button" id="uploadExamBtn" class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded text-sm font-bold transition shadow-sm">
                                Upload
                            </button>
                        </div>
                        <div id="examUploadMessage" class="hidden mt-2 text-xs font-bold p-2 rounded"></div>
                    </div>

                    <div id="examListContainer" class="flex-1 overflow-y-auto space-y-2 bg-gray-50 p-2 rounded border border-gray-200 min-h-[220px]">
                        <div class="text-center py-6 text-gray-500"><i class="fa-solid fa-spinner fa-spin text-2xl"></i></div>
                    </div>
                </div>

                <!-- Sub-View 1: Link Exam to Class, Date Window & Per-Student Checkboxes -->
                <div id="examClassAssignView" class="hidden flex-1 flex flex-col min-h-0 overflow-hidden">
                    <div class="flex items-center justify-between mb-3 pb-2 border-b border-gray-200">
                        <div>
                            <span class="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Class Assignment & Schedule</span>
                            <h4 id="ecaExamTitle" class="text-base font-black text-gray-800"></h4>
                        </div>
                        <button type="button" id="backFromExamAssignBtn" class="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-xs font-bold transition">
                            <i class="fa-solid fa-arrow-left mr-1"></i> Back to Exams
                        </button>
                    </div>

                    <div id="ecaAlert" class="hidden mb-3 p-2 rounded text-xs font-bold"></div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 bg-indigo-50 p-3 rounded-lg border border-indigo-200 mb-3 flex-shrink-0">
                        <div class="flex items-center">
                            <label class="flex items-center space-x-2 cursor-pointer text-xs font-black text-indigo-900">
                                <input type="checkbox" id="ecaIsActive" class="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500" checked>
                                <span>Link & Enable for Class</span>
                            </label>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-indigo-700 uppercase mb-1">Record Scores Term</label>
                            <select id="ecaTerm" class="w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-white font-bold">
                                <option value="MidTerm">Mid Term</option>
                                <option value="FinalTerm">Final Term</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-indigo-700 uppercase mb-1">Assessment Category</label>
                            <select id="ecaCategory" class="w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-white font-bold">
                                <option value="MajorExam">Major Exam</option>
                                <option value="Written">Written (Quiz/Long)</option>
                                <option value="Narrative">Written (Narrative)</option>
                                <option value="Individual">Written (Individual)</option>
                                <option value="Performance">Performance (Task)</option>
                                <option value="Report">Performance (Report)</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-indigo-700 uppercase mb-1">From Date (Open)</label>
                            <input type="date" id="ecaFromDate" class="w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-white">
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-indigo-700 uppercase mb-1">To Date (Auto-Close)</label>
                            <input type="date" id="ecaToDate" class="w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-white">
                        </div>
                    </div>

                    <div class="flex flex-wrap justify-between items-center gap-2 mb-2 flex-shrink-0">
                        <span class="text-xs font-bold text-gray-600">Assign Students Allowed to Take This Exam:</span>
                        <div class="flex flex-wrap gap-1.5">
                            <button type="button" id="ecaSelectBlindBtn" class="px-2.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 rounded text-[11px] font-bold transition">
                                <i class="fa-solid fa-universal-access mr-1"></i> Select Legally Blind Only
                            </button>
                            <button type="button" id="ecaSelectAllBtn" class="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded text-[11px] font-bold transition">
                                Check All
                            </button>
                            <button type="button" id="ecaUnselectAllBtn" class="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300 rounded text-[11px] font-bold transition">
                                Uncheck All
                            </button>
                        </div>
                    </div>

                    <div id="ecaStudentList" class="flex-1 overflow-y-auto border border-gray-200 rounded-lg bg-gray-50 p-2 space-y-1.5 min-h-[180px]"></div>

                    <div class="mt-3 pt-3 border-t border-gray-200 flex justify-end gap-2 flex-shrink-0">
                        <button type="button" id="saveExamClassAssignBtn" class="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-md text-sm font-bold shadow-sm transition flex items-center">
                            <i class="fa-solid fa-floppy-disk mr-2"></i> Save Class Link & Student Access
                        </button>
                    </div>
                </div>

                <!-- Sub-View 2: Bonus Questions Builder & Question List -->
                <div id="examBonusView" class="hidden flex-1 flex flex-col min-h-0 overflow-hidden">
                    <div class="flex items-center justify-between mb-3 pb-2 border-b border-gray-200">
                        <div>
                            <span class="text-[10px] font-bold uppercase tracking-wider text-amber-600">Bonus Question Manager (Score + Bonus Capped at Max Total Score)</span>
                            <h4 id="ebvExamTitle" class="text-base font-black text-gray-800"></h4>
                        </div>
                        <button type="button" id="backFromExamBonusBtn" class="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-xs font-bold transition">
                            <i class="fa-solid fa-arrow-left mr-1"></i> Back to Exams
                        </button>
                    </div>

                    <div id="ebvAlert" class="hidden mb-3 p-2 rounded text-xs font-bold"></div>

                    <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 flex-shrink-0">
                        <h5 class="text-xs font-black text-amber-900 uppercase mb-2"><i class="fa-solid fa-plus-circle mr-1"></i> Add New Bonus Question</h5>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                            <input type="text" id="ebvQuestion" placeholder="Bonus Question Text" class="sm:col-span-2 px-3 py-1.5 border border-gray-300 rounded text-xs bg-white">
                            <input type="text" id="ebvChoices" placeholder="Choices separated by | (e.g. Choice A | Choice B | Choice C)" class="px-3 py-1.5 border border-gray-300 rounded text-xs bg-white">
                            <input type="text" id="ebvAnswer" placeholder="Exact Correct Answer" class="px-3 py-1.5 border border-gray-300 rounded text-xs bg-white">
                        </div>
                        <div class="flex flex-col sm:flex-row gap-2 items-center">
                            <input type="text" id="ebvExplanation" placeholder="Explanation (Optional)" class="flex-1 w-full px-3 py-1.5 border border-gray-300 rounded text-xs bg-white">
                            <button type="button" id="addBonusQuestionBtn" class="w-full sm:w-auto px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-bold transition shadow-sm">
                                + Append Bonus Question
                            </button>
                        </div>
                    </div>

                    <div class="text-xs font-bold text-gray-600 mb-1.5 flex-shrink-0">
                        Existing Questions (Toggle "Bonus" checkbox on any question or delete):
                    </div>
                    <div id="ebvQuestionsList" class="flex-1 overflow-y-auto border border-gray-200 rounded-lg bg-gray-50 p-2 space-y-1.5 min-h-[180px]"></div>
                </div>
            </div>
        </div>
    `,

    renderPresentationOverlay: () => `
        <div id="examPresentationOverlay" class="hidden fixed inset-0 z-[120] bg-[#eef2f6] flex flex-col fade-in w-full h-full">
            <style>
                #examPresentationOverlay {
                    --bg: #eef2f6;
                    --card: #ffffff;
                    --ink: #1b2a3b;
                    --muted: #5d6b7a;
                    --line: #d5dde6;
                    --brand: #1f3a5f;
                    --accent: #c98a1b;
                    --ok: #1d7a4d;
                    --ok-bg: #e5f4ec;
                    --z: 1;
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    color: var(--ink);
                }
                .exam-slide {
                    background: var(--card);
                    width: 100%;
                    max-width: 1200px;
                    height: min(820px, calc(100vh - 80px));
                    min-height: 340px;
                    border-radius: 12px;
                    box-shadow: 0 10px 30px rgba(20, 40, 70, 0.14);
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                    margin: auto;
                }
                .exam-progress { height: 6px; background: var(--line); flex-shrink: 0; }
                .exam-progress-bar { height: 100%; width: 0; background: var(--accent); transition: width 0.25s ease; }
                .exam-tabs { display: flex; border-bottom: 1px solid var(--line); background: #f7f9fb; flex-shrink: 0; overflow-x: auto; }
                .exam-tab { flex: 1; min-width: max-content; padding: 12px 16px; font-size: 1rem; font-weight: 600; color: var(--muted); background: none; border: none; border-bottom: 3px solid transparent; cursor: pointer; }
                .exam-tab:hover { color: var(--brand); }
                .exam-tab.active { color: var(--brand); border-bottom-color: var(--brand); background: #fff; }
                .exam-body { flex: 1; min-height: 0; overflow-y: auto; padding: 28px 40px 12px; display: flex; flex-direction: column; }
                .exam-topline { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; }
                .exam-counter { display: flex; align-items: baseline; gap: 12px; color: var(--muted); font-size: 1.05rem; }
                .exam-counter .num { font-size: clamp(3rem, 8vw, 4.5rem); font-weight: 800; line-height: 1; color: var(--brand); }
                .exam-restart { padding: 10px 16px; font-size: 1rem; font-weight: 700; color: var(--brand); background: #fff; border: 2px solid var(--brand); border-radius: 8px; cursor: pointer; white-space: nowrap; }
                .exam-question { font-family: Georgia, 'Times New Roman', serif; font-size: calc(clamp(1.4rem, 3.2vw, 2.1rem) * var(--z)); line-height: 1.35; margin: 0 0 24px; max-width: 45em; white-space: pre-wrap; }
                .exam-choices { display: grid; gap: 10px; margin-bottom: 20px; }
                .exam-choices.two { grid-template-columns: repeat(2, minmax(0, 1fr)); max-width: calc(460px * var(--z)); }
                .exam-choices.many { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
                .exam-choices.many .exam-choice { padding: 8px 12px; font-size: calc(clamp(0.85rem, 1.5vw, 1rem) * var(--z)); }
                .exam-choice { padding: 12px 18px; font-size: calc(clamp(1.1rem, 2.4vw, 1.4rem) * var(--z)); background: #f1f4f8; border: 2px solid transparent; border-radius: 8px; transition: background 0.2s; }
                .exam-choice.correct { background: var(--ok-bg); border-color: var(--ok); color: var(--ok); font-weight: 700; }
                .exam-choice.dim { opacity: 0.45; }
                .exam-answer { display: none; background: var(--ok-bg); border-left: 6px solid var(--ok); border-radius: 6px; padding: 14px 20px; font-size: calc(clamp(1.15rem, 2.4vw, 1.45rem) * var(--z)); margin-bottom: 12px; }
                .exam-answer.open { display: block; }
                .exam-answer .label { display: block; font-size: 0.95rem; color: var(--muted); margin-bottom: 4px; }
                .exam-expl { margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--ok); font-size: calc(1.05rem * var(--z)); color: var(--brand); white-space: pre-wrap; }
                .exam-controls { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 16px 40px 12px; border-top: 1px solid var(--line); }
                .exam-controls button { width: 170px; padding: 13px 10px; font-size: 1.1rem; font-weight: 700; border: none; border-radius: 8px; cursor: pointer; color: #fff; }
                .exam-nav { background: var(--brand); }
                .exam-nav:disabled { background: #b8c2cd; cursor: not-allowed; }
                .exam-reveal { background: var(--accent); }
                @media (max-width: 600px) {
                    .exam-body { padding: 20px 20px 8px; }
                    .exam-controls { padding: 12px 20px; }
                    .exam-controls button { flex: 1; width: auto; min-width: 0; padding: 12px 8px; font-size: 1rem; }
                }
            </style>

            <div class="w-full bg-white shadow-sm p-3 flex justify-between items-center border-b border-gray-200">
                <h2 id="examPresentationTitle" class="text-xl font-bold text-gray-800 ml-4">Exam Presentation</h2>
                <button id="closeExamPresentationBtn" class="bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center">
                    <i class="fa-solid fa-arrow-right-from-bracket mr-2"></i> Return to Portal
                </button>
            </div>

            <main class="exam-slide relative mt-4">
                <div class="exam-progress"><div class="exam-progress-bar" id="examBar"></div></div>
                <div class="exam-tabs" id="examTabs"></div>
                <div class="exam-body" id="examBodyEl">
                    <div class="exam-topline">
                        <div class="exam-counter" id="examCounter"></div>
                        <button class="exam-restart" id="examRestartBtn">&#8634; Back to Question 1</button>
                    </div>
                    <h1 class="exam-question" id="examQuestion"></h1>
                    <div class="exam-choices" id="examChoices"></div>
                    <div class="exam-answer" id="examAnswer"></div>
                </div>
                <div class="exam-controls">
                    <button class="exam-nav" id="examPrevBtn">&#9664; Previous</button>
                    <button class="exam-reveal" id="examRevealBtn">Show answer</button>
                    <button class="exam-nav" id="examNextBtn">Next &#9654;</button>
                </div>
            </main>
        </div>
    `,

    renderAccessibleExamOverlay: () => `
        <div id="accessibleExamOverlay" class="hidden fixed inset-0 z-[150] bg-gray-950 text-white flex flex-col w-full h-full select-none" role="dialog" aria-modal="true" aria-labelledby="accExamHeaderTitle">
            <!-- Top Bar -->
            <header class="bg-gray-900 border-b-2 border-yellow-400 px-4 sm:px-8 py-3 flex flex-wrap justify-between items-center gap-3 flex-shrink-0">
                <div>
                    <div class="flex items-center gap-2">
                        <span class="px-2 py-0.5 bg-yellow-400 text-gray-950 font-black text-xs rounded uppercase">Accessible Exam Mode</span>
                        <span id="accExamCourseBadge" class="text-xs font-bold text-yellow-200"></span>
                    </div>
                    <h1 id="accExamHeaderTitle" class="text-lg sm:text-2xl font-black text-white mt-0.5">Exam</h1>
                </div>
                <div class="flex items-center gap-2 sm:gap-3">
                    <button type="button" id="accExamRepeatAudioBtn" class="px-4 py-2.5 bg-yellow-400 hover:bg-yellow-300 text-gray-950 font-black rounded-lg text-xs sm:text-sm transition focus:outline-none focus:ring-4 focus:ring-white">
                        <i class="fa-solid fa-volume-high mr-1.5"></i> Read Question Again (R)
                    </button>
                    <button type="button" id="accExamExitBtn" class="px-4 py-2.5 bg-gray-800 hover:bg-red-700 text-white border border-gray-600 font-bold rounded-lg text-xs sm:text-sm transition focus:outline-none focus:ring-4 focus:ring-white">
                        <i class="fa-solid fa-xmark mr-1"></i> Exit
                    </button>
                </div>
            </header>

            <!-- Progress Bar -->
            <div class="w-full h-3 bg-gray-800 flex-shrink-0">
                <div id="accExamProgressBar" class="h-full bg-yellow-400 transition-all duration-300" style="width: 0%;"></div>
            </div>

            <!-- Main Question & Choices Body -->
            <main id="accExamBody" class="flex-1 overflow-y-auto px-4 sm:px-10 py-6 max-w-5xl w-full mx-auto flex flex-col justify-between">
                <div>
                    <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
                        <div id="accExamQuestionCounter" class="text-xl sm:text-3xl font-black text-yellow-400" aria-live="polite"></div>
                        <div id="accExamAnsweredStatus" class="text-sm sm:text-base font-bold px-3 py-1 rounded-full bg-gray-800 text-gray-300 border border-gray-700"></div>
                    </div>

                    <div id="accExamQuestionText" class="text-2xl sm:text-4xl font-bold text-white leading-snug mb-8 bg-gray-900 p-5 sm:p-7 rounded-2xl border-2 border-gray-700 whitespace-pre-wrap" aria-live="polite"></div>

                    <div id="accExamChoicesContainer" class="grid grid-cols-1 gap-4 mb-6" role="listbox" aria-label="Answer Choices"></div>
                </div>

                <!-- Spoken Status Feedback Box -->
                <div id="accExamLiveFeedback" class="p-4 rounded-xl bg-indigo-950 border-2 border-indigo-400 text-yellow-300 font-bold text-base sm:text-xl text-center mb-4" aria-live="assertive">
                    Select an answer choice below or press number keys 1 to 4.
                </div>
            </main>

            <!-- Bottom Navigation Controls -->
            <footer class="bg-gray-900 border-t-2 border-gray-800 px-4 sm:px-10 py-4 flex-shrink-0">
                <div class="max-w-5xl mx-auto flex flex-wrap sm:flex-nowrap justify-between items-center gap-3">
                    <button type="button" id="accExamPrevBtn" class="flex-1 py-4 px-6 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black text-lg sm:text-xl rounded-xl border-2 border-gray-600 transition focus:outline-none focus:ring-4 focus:ring-yellow-400">
                        <i class="fa-solid fa-arrow-left mr-2"></i> Previous
                    </button>

                    <button type="button" id="accExamNextBtn" class="flex-1 py-4 px-6 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black text-lg sm:text-xl rounded-xl border-2 border-blue-400 transition focus:outline-none focus:ring-4 focus:ring-yellow-400">
                        Next <i class="fa-solid fa-arrow-right ml-2"></i>
                    </button>

                    <button type="button" id="accExamSubmitBtn" class="hidden flex-1 py-4 px-8 bg-green-600 hover:bg-green-500 text-white font-black text-lg sm:text-xl rounded-xl border-2 border-yellow-300 shadow-lg transition focus:outline-none focus:ring-4 focus:ring-yellow-400">
                        <i class="fa-solid fa-paper-plane mr-2"></i> Submit Exam
                    </button>
                </div>
            </footer>
        </div>
    `
};
