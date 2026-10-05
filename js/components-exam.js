// js/components-exam.js

export const ExamUI = {
    renderManagerModal: () => `
        <div id="examManagerModal" class="hidden fixed inset-0 z-[70] flex items-center justify-center fade-in p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeExamManagerBg"></div>
            <div class="bg-white rounded-lg shadow-xl w-full max-w-2xl p-4 sm:p-6 relative z-10 scale-up max-h-[90vh] flex flex-col">
                <div class="flex justify-between items-center mb-4 border-b pb-3">
                    <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-file-contract text-blue-600 mr-2"></i>Manage Exams</h3>
                    <button id="closeExamManagerBtn" class="text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>
                
                <div class="mb-4 bg-blue-50 p-4 border border-blue-200 rounded-lg">
                    <h4 class="text-sm font-bold text-blue-800 mb-2">Upload New Exam (CSV Format)</h4>
                    <p class="text-xs text-blue-600 mb-3">Format columns: Part Index (0=MCQ, 1=TF, 2=Enum), Question, Choices (Pipe separated "|"), Answer, Explanation.</p>
                    <div class="flex gap-2">
                        <input type="text" id="newExamTitle" placeholder="Exam Title" class="flex-1 px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                        <input type="file" id="examCsvUpload" accept=".csv" class="flex-1 px-3 py-2 border border-gray-300 rounded text-sm bg-white">
                        <button type="button" id="uploadExamBtn" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-bold transition shadow-sm">
                            Upload
                        </button>
                    </div>
                    <div id="examUploadMessage" class="hidden mt-2 text-xs font-bold p-2 rounded"></div>
                </div>

                <div id="examListContainer" class="flex-1 overflow-y-auto space-y-2 bg-gray-50 p-2 rounded border border-gray-200 min-h-[200px]">
                    <div class="text-center py-6 text-gray-500"><i class="fa-solid fa-spinner fa-spin text-2xl"></i></div>
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
    `
};
