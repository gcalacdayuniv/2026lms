// js/components-scanner.js
// HTML templates for the Scan Answer Sheets dialog (full screen on phones, see README "Dialog Layout Conventions").
// Logic lives in course-scanner.js. Element IDs here are used by that file, so keep them in sync.

const LABEL = 'block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1';
const FIELD = 'w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50';

export const ScannerUI = {
    renderScannerModal: () => `
        <div id="scannerModal" class="hidden fixed inset-0 z-[76] flex items-center justify-center fade-in p-0 sm:p-4">
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="closeScannerBg"></div>
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full max-w-4xl h-full sm:h-auto p-4 sm:p-6 relative z-10 sheet-panel app-page max-h-full sm:max-h-[95vh] flex flex-col">
                <div class="flex items-center gap-3 mb-4 border-b pb-3 app-page-header">
                    <div class="flex-1 min-w-0">
                        <h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-camera text-rose-600 mr-2"></i>Scan Answer Sheets</h3>
                        <p class="text-xs text-gray-500">Print the answer sheet, let students shade it, then photograph the sheets to record scores.</p>
                    </div>
                    <button id="closeScannerBtn" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-500 sm:text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden" aria-hidden="true"></i><i class="fa-solid fa-xmark text-xl hidden sm:inline" aria-hidden="true"></i>
                    </button>
                </div>

                <div class="flex gap-1 mb-3 border-b border-gray-200" role="tablist" aria-label="Scanner sections">
                    <button type="button" id="scnTabScan" role="tab" aria-selected="true" class="px-4 py-2 text-sm font-bold border-b-2 border-rose-600 text-rose-700 -mb-px">
                        <i class="fa-solid fa-camera mr-1"></i> Scan
                    </button>
                    <button type="button" id="scnTabSaved" role="tab" aria-selected="false" class="px-4 py-2 text-sm font-bold border-b-2 border-transparent text-gray-500 hover:text-gray-800 -mb-px">
                        <i class="fa-solid fa-clipboard-check mr-1"></i> Saved Scans
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
                        <div class="mt-3 border-t pt-3">
                            <div class="flex flex-wrap items-end gap-2">
                                <div>
                                    <label class="${LABEL}" for="scnSetCount">Exam sets</label>
                                    <select id="scnSetCount" class="${FIELD}">
                                        <option value="1">1 set (no SET circles)</option>
                                        <option value="2">2 sets (A-B)</option>
                                        <option value="3">3 sets (A-C)</option>
                                        <option value="4" selected>4 sets (A-D)</option>
                                        <option value="5">5 sets (A-E)</option>
                                        <option value="6">6 sets (A-F)</option>
                                    </select>
                                </div>
                            </div>
                            <p class="mt-2 text-[11px] text-gray-500">Printing the questions, answer keys and answer sheet is done in <b>Manage Exams &rarr; More &rarr; Print</b>. Use the same number of sets there.</p>
                        </div>
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

                    <div class="flex flex-nowrap gap-2 mb-2">
                        <button type="button" id="scnLiveBtn" class="flex-1 whitespace-nowrap bg-rose-600 hover:bg-rose-700 text-white px-2 py-1.5 rounded-md text-xs font-bold shadow-sm transition flex items-center justify-center">
                            <i class="fa-solid fa-video mr-1.5"></i> Live Scan
                        </button>
                        <button type="button" id="scnCameraBtn" class="flex-1 whitespace-nowrap bg-white hover:bg-gray-50 text-gray-800 border border-gray-300 px-2 py-1.5 rounded-md text-xs font-bold shadow-sm transition flex items-center justify-center">
                            <i class="fa-solid fa-camera mr-1.5"></i> Take Photo
                        </button>
                        <button type="button" id="scnUploadBtn" class="flex-1 whitespace-nowrap bg-white hover:bg-gray-50 text-gray-800 border border-gray-300 px-2 py-1.5 rounded-md text-xs font-bold shadow-sm transition flex items-center justify-center">
                            <i class="fa-solid fa-images mr-1.5"></i> Choose Photos
                        </button>
                        <input type="file" id="scnCameraInput" accept="image/*" capture="environment" class="hidden">
                        <input type="file" id="scnFileInput" accept="image/*" multiple class="hidden">
                    </div>
                    <p class="text-[11px] text-gray-500 mb-2">Tip: lay the sheet flat in good light, keep all 4 black corner squares in view, and shoot from directly above.</p>

                    <!-- Live camera: full screen. Checks every frame and captures once the sheet has been still for 2 seconds -->
                    <div id="scnLivePanel" class="hidden fixed inset-0 z-[80] flex flex-col bg-gray-900 text-white" role="dialog" aria-modal="true" aria-label="Live scan">
                        <div class="flex items-center justify-between gap-2 px-3 py-2 shrink-0" style="padding-top:max(0.5rem,env(safe-area-inset-top))">
                            <div id="scnLiveTitle" class="text-sm font-black"><i class="fa-solid fa-video mr-1"></i> Live Scan</div>
                            <button type="button" id="scnLiveStopBtn" class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded-md text-xs font-bold transition"><i class="fa-solid fa-xmark mr-1"></i> Close camera</button>
                        </div>
                        <div id="scnLiveStage" class="flex-1 min-h-0 flex items-center justify-center px-2">
                            <div id="scnLiveBox" class="relative overflow-hidden rounded bg-black" style="width:100%;aspect-ratio:3/4">
                                <video id="scnLiveVideo" class="absolute inset-0 w-full h-full" style="object-fit:fill" playsinline muted autoplay></video>
                                <canvas id="scnLiveOverlay" class="absolute inset-0 w-full h-full pointer-events-none"></canvas>
                                <div id="scnLiveFlash" class="absolute inset-0 bg-white opacity-0 pointer-events-none" style="transition:opacity .25s"></div>
                            </div>
                        </div>
                        <div id="scnLiveReview" class="hidden flex-1 min-h-0 overflow-y-auto bg-gray-100 text-gray-800 px-3 py-2"></div>
                        <div class="shrink-0 px-3 pt-2" style="padding-bottom:max(0.75rem,env(safe-area-inset-bottom))">
                            <div id="scnLiveLiveControls">
                                <div id="scnLiveStatus" role="status" aria-live="polite" class="text-center text-sm font-bold rounded px-3 py-2 bg-gray-700 text-white">Starting camera...</div>
                                <div class="mt-2 h-1.5 rounded bg-gray-700 overflow-hidden"><div id="scnLiveBar" class="h-full bg-green-500" style="width:0;transition:width .2s"></div></div>
                                <div class="mt-2">
                                    <button type="button" id="scnLiveCaptureBtn" class="w-full bg-white hover:bg-gray-100 text-gray-800 px-3 py-2 rounded-md text-xs font-bold transition">Capture now</button>
                                </div>
                            </div>
                            <div id="scnLiveDone" class="hidden">
                                <div class="flex gap-2">
                                    <button type="button" id="scnCaptureAgainBtn" class="flex-1 whitespace-nowrap bg-rose-600 hover:bg-rose-700 text-white px-2 py-2 rounded-md text-xs font-bold transition"><i class="fa-solid fa-rotate-right mr-1"></i> Recapture (replace)</button>
                                    <button type="button" id="scnAfterDoneBtn" class="flex-1 whitespace-nowrap bg-white hover:bg-gray-100 text-gray-800 px-2 py-2 rounded-md text-xs font-bold transition">Back to scan menu</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div id="scnProgress" class="hidden mb-2 text-xs font-bold text-blue-700"></div>
                    <div id="scnRows" class="flex-1 overflow-y-auto min-h-[160px] space-y-2 bg-gray-50 p-2 rounded border border-gray-200"></div>

                    <div id="scnSyncActions" class="hidden flex flex-wrap gap-2 mt-3"></div>
                    <div class="mt-3 flex flex-col sm:flex-row gap-2">
                        <div id="scnSaveInfo" class="flex-1 text-xs text-gray-600 self-center"></div>
                        <button type="button" id="scnSaveBtn" class="sm:w-72 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2.5 rounded-md text-sm font-bold shadow-sm transition flex items-center justify-center disabled:opacity-50">
                            <i class="fa-solid fa-cloud-arrow-up mr-2"></i> Upload now
                        </button>
                    </div>
                </div>

                <!-- Saved scans: review, statistics and later corrections (see course-scan-records.js) -->
                <div id="scnSavedView" class="hidden flex-1 flex flex-col min-h-0">
                    <div id="scnSavedBody" class="flex-1 overflow-y-auto min-h-[200px] pr-1"></div>
                </div>
            </div>
        </div>
    `
};
