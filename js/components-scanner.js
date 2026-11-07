// js/components-scanner.js
// HTML templates for the Scan Answer Sheets dialog (full screen on phones, see README "Dialog Layout Conventions").
// Logic lives in course-scanner.js. Element IDs here are used by that file, so keep them in sync.

const LABEL = 'block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1';
const FIELD = 'w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50';

export const ScannerUI = {
    renderScannerModal: () => `
        <div id="scannerModal" class="hidden fixed inset-0 z-[76] flex items-center justify-center fade-in p-0 sm:p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeScannerBg"></div>
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full max-w-4xl h-full sm:h-auto p-4 sm:p-6 relative z-10 sheet-panel max-h-full sm:max-h-[95vh] flex flex-col">
                <div class="flex justify-between items-center mb-4 border-b pb-3">
                    <div>
                        <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-camera text-rose-600 mr-2"></i>Scan Answer Sheets</h3>
                        <p class="text-xs text-gray-500">Print the answer sheet, let students shade it, then photograph the sheets to record scores.</p>
                    </div>
                    <button id="closeScannerBtn" class="text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>

                <div id="scnAlert" class="hidden mb-3 p-2 rounded text-xs font-bold"></div>

                <!-- Step 1: Setup -->
                <div id="scnSetupView" class="flex-1 overflow-y-auto min-h-0 space-y-4 pr-1">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Answer key source">
                        <label class="flex items-start gap-2 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 has-[:checked]:border-rose-500 has-[:checked]:bg-rose-50">
                            <input type="radio" name="scnMode" value="exam" class="mt-1" checked>
                            <span><span class="block text-sm font-bold text-gray-800">Use an exam from Manage Exams</span>
                            <span class="block text-xs text-gray-500">The answer key comes from the exam's CSV.</span></span>
                        </label>
                        <label class="flex items-start gap-2 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 has-[:checked]:border-rose-500 has-[:checked]:bg-rose-50">
                            <input type="radio" name="scnMode" value="typed" class="mt-1">
                            <span><span class="block text-sm font-bold text-gray-800">Type the answer key</span>
                            <span class="block text-xs text-gray-500">Creates a new assessment and saves the exam in Manage Exams.</span></span>
                        </label>
                    </div>

                    <div id="scnExamPanel">
                        <label class="${LABEL}" for="scnExamSelect">Exam</label>
                        <select id="scnExamSelect" class="${FIELD} font-medium"></select>
                        <div id="scnExamInfo" class="mt-2 text-xs text-gray-600"></div>
                    </div>

                    <div id="scnTypedPanel" class="hidden space-y-3">
                        <div class="grid grid-cols-2 gap-2">
                            <div class="col-span-2">
                                <label class="${LABEL}" for="scnTypedTitle">Exam / Assessment Title</label>
                                <input type="text" id="scnTypedTitle" class="${FIELD}" placeholder="e.g. Quiz 1" maxlength="120">
                            </div>
                            <div>
                                <label class="${LABEL}" for="scnTypedN">Number of Questions (1-100)</label>
                                <input type="number" id="scnTypedN" min="1" max="100" value="20" class="${FIELD} text-center font-mono">
                            </div>
                            <div>
                                <label class="${LABEL}" for="scnTypedC">Choices per Question</label>
                                <select id="scnTypedC" class="${FIELD}">
                                    <option value="2">2 (A-B)</option>
                                    <option value="3">3 (A-C)</option>
                                    <option value="4" selected>4 (A-D)</option>
                                    <option value="5">5 (A-E)</option>
                                </select>
                            </div>
                        </div>
                        <div class="flex flex-col sm:flex-row gap-2">
                            <input type="text" id="scnKeyQuick" class="${FIELD} font-mono flex-1" placeholder="Quick fill: type the key letters, e.g. ABCDDACB" aria-label="Quick fill answer key">
                            <button type="button" id="scnKeyQuickBtn" class="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-xs font-bold transition">Apply</button>
                        </div>
                        <div id="scnKeyGrid" class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 border border-gray-200 rounded-lg p-2 bg-gray-50 max-h-72 overflow-y-auto"></div>
                    </div>

                    <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <div>
                            <label class="${LABEL}" for="scnTerm">Term</label>
                            <select id="scnTerm" class="${FIELD}">
                                <option value="MidTerm">Mid Term</option>
                                <option value="FinalTerm">Final Term</option>
                            </select>
                        </div>
                        <div>
                            <label class="${LABEL}" for="scnCategory">Category</label>
                            <select id="scnCategory" class="${FIELD}">
                                <option value="Written">Written (Quiz/Long)</option>
                                <option value="Narrative">Written (Narrative)</option>
                                <option value="Individual">Written (Individual)</option>
                                <option value="Performance">Performance (Task)</option>
                                <option value="Report">Performance (Report)</option>
                                <option value="MajorExam">Major Exam</option>
                            </select>
                        </div>
                        <div>
                            <label class="${LABEL}" for="scnDate">Date</label>
                            <input type="date" id="scnDate" class="${FIELD}">
                        </div>
                        <div>
                            <label class="${LABEL}" for="scnPaper">Paper</label>
                            <select id="scnPaper" class="${FIELD}">
                                <option value="letter">Letter</option>
                                <option value="a4">A4</option>
                            </select>
                        </div>
                    </div>

                    <div id="scnSetupSummary" class="text-xs text-gray-600 bg-blue-50 border border-blue-200 rounded p-2"></div>

                    <div class="flex flex-col sm:flex-row gap-2">
                        <button type="button" id="scnPrintBtn" class="flex-1 bg-gray-800 hover:bg-gray-900 text-white px-4 py-2.5 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center">
                            <i class="fa-solid fa-print mr-2"></i> Print Answer Sheet
                        </button>
                        <button type="button" id="scnStartBtn" class="flex-1 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2.5 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center">
                            <i class="fa-solid fa-camera mr-2"></i> Start Scanning
                        </button>
                    </div>
                </div>

                <!-- Step 2: Scan and review -->
                <div id="scnScanView" class="hidden flex-1 flex flex-col min-h-0">
                    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <div>
                            <div id="scnScanTitle" class="text-sm font-black text-gray-800"></div>
                            <div id="scnScanMeta" class="text-xs text-gray-500"></div>
                        </div>
                        <button type="button" id="scnBackBtn" class="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-xs font-bold transition">
                            <i class="fa-solid fa-arrow-left mr-1"></i> Back to Setup
                        </button>
                    </div>

                    <div class="flex flex-col sm:flex-row gap-2 mb-3">
                        <button type="button" id="scnCameraBtn" class="flex-1 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2.5 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center">
                            <i class="fa-solid fa-camera mr-2"></i> Take Photo
                        </button>
                        <button type="button" id="scnUploadBtn" class="flex-1 bg-white hover:bg-gray-50 text-gray-800 border border-gray-300 px-4 py-2.5 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center">
                            <i class="fa-solid fa-images mr-2"></i> Choose Photos
                        </button>
                        <input type="file" id="scnCameraInput" accept="image/*" capture="environment" class="hidden">
                        <input type="file" id="scnFileInput" accept="image/*" multiple class="hidden">
                    </div>
                    <p class="text-[11px] text-gray-500 mb-2">Tip: lay the sheet flat in good light, keep all 4 black corner squares in view, and shoot from directly above.</p>

                    <div id="scnProgress" class="hidden mb-2 text-xs font-bold text-blue-700"></div>
                    <div id="scnRows" class="flex-1 overflow-y-auto min-h-[160px] space-y-2 bg-gray-50 p-2 rounded border border-gray-200"></div>

                    <div class="mt-3 flex flex-col sm:flex-row gap-2">
                        <div id="scnSaveInfo" class="flex-1 text-xs text-gray-600 self-center"></div>
                        <button type="button" id="scnSaveBtn" class="sm:w-72 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2.5 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center disabled:opacity-50">
                            <i class="fa-solid fa-floppy-disk mr-2"></i> Save Scores
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `
};
