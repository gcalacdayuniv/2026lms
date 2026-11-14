// js/sheet-print.js
// Printing helpers shared by Manage Exams (print dialog) and the scanner (typed key): the answer-sheet header
// question, the number of printed sets remembered per exam, and the bubble answer sheet of an exam.
import { escapeHtml as esc } from './html-utils.js';
import { buildSheetHtml, MAX_QUESTIONS, MAX_CHOICES } from './omr-sheet.js';
import { scannableItems } from './exam-sets.js';
import { showPrintPreview } from './print-preview.js';

// Number of sets of an exam (1-6). Saved on this device so the print dialog and the scanner always agree.
export const getSetCount = (examId, fallback = 4) => {
    try {
        const v = Number(localStorage.getItem(`lms_exam_sets:${examId}`));
        if (v >= 1 && v <= 6) return v;
    } catch (e) { /* storage unavailable */ }
    return fallback;
};
export const saveSetCount = (examId, count) => {
    try { localStorage.setItem(`lms_exam_sets:${examId}`, String(count)); } catch (e) { /* storage unavailable */ }
};

// Small dialog asking what to print at the top of the sheet. Resolves with the text ('' = no header)
// or null when cancelled. The last header used is remembered on this device.
export const askSheetHeader = () => new Promise((resolve) => {
    let remembered = '';
    try { remembered = localStorage.getItem('omr_sheet_header') || ''; } catch (e) { /* storage unavailable */ }
    const previousFocus = document.activeElement;

    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[310] flex items-center justify-center p-4 fade-in';
    overlay.style.zIndex = '310';   // inline: see UI.confirm
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Answer sheet header');
    overlay.innerHTML = `
        <div class="absolute inset-0 bg-gray-900 bg-opacity-60"></div>
        <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-5 relative z-10">
            <h4 class="text-base font-bold text-gray-800 mb-1">Answer sheet header</h4>
            <p class="text-xs text-gray-500 mb-3">What should be printed at the top of the sheet? Leave it blank for no header.</p>
            <input type="text" id="scnHeaderInput" maxlength="80" value="${esc(remembered)}" placeholder="e.g. Midterm Examination - Prof. Dela Cruz" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50" aria-label="Header text">
            <div class="mt-4 flex gap-2 justify-end">
                <button type="button" id="closeScnHeaderBtn" class="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm font-bold transition">Cancel</button>
                <button type="button" id="scnHeaderOkBtn" class="px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded-md text-sm font-bold transition"><i class="fa-solid fa-print mr-2"></i>Print</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#scnHeaderInput');
    let finished = false;
    const finish = (value) => {
        if (finished) return;
        finished = true;
        overlay.remove();
        if (previousFocus && previousFocus.focus) previousFocus.focus();
        resolve(value);
    };
    overlay.querySelector('#scnHeaderOkBtn').addEventListener('click', () => finish(input.value.trim()));
    overlay.querySelector('#closeScnHeaderBtn').addEventListener('click', () => finish(null));
    overlay.firstElementChild.addEventListener('click', () => finish(null));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(input.value.trim()); }
        if (e.key === 'Escape') { e.preventDefault(); finish(null); }
    });
    input.focus();
    input.select();
});

// Prints the bubble answer sheet that matches an exam saved in Manage Exams (its multiple-choice questions only).
// Returns an error text, or '' when the preview opened.
export const printExamAnswerSheet = async (exam, { sets = 1, paper = 'letter' } = {}) => {
    const items = scannableItems(exam.ExamData, MAX_CHOICES);
    if (!items.length) return 'This exam has no multiple-choice question that an answer sheet can hold.';
    if (items.length > MAX_QUESTIONS) return `The sheet holds up to ${MAX_QUESTIONS} questions; this exam has ${items.length}.`;
    const header = await askSheetHeader();
    if (header === null) return '';
    try { localStorage.setItem('omr_sheet_header', header); } catch (e) { /* storage unavailable */ }
    const html = buildSheetHtml({
        title: header,
        n: items.length,
        c: Math.max(2, ...items.map(i => i.choices.length)),
        paper,
        parts: items.map(i => i.part),
        sets: sets > 1 ? sets : 0
    });
    showPrintPreview(html.replace(/<script>[\s\S]*?<\/script>/g, ''), `Answer sheet - ${header || exam.Title || ''}`);
    return '';
};
