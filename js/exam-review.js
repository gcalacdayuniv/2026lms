// js/exam-review.js
// Student review of a submitted exam: their answer, the right answer and the points of every question.
// Only available after the lecturer released the answers.
import { apiFetch } from './globals.js';
import { escapeHtml as esc } from './html-utils.js';

const show = (v) => {
    if (Array.isArray(v)) return v.filter(x => String(x).trim()).map(esc).join(', ');
    return String(v ?? '').trim() ? esc(v) : '';
};

const card = (q, no) => {
    const full = q.earned >= q.points - 1e-9;
    const none = q.earned <= 0;
    const pending = q.type === 'essay' && !q.marked && !q.adjustment;
    const tone = pending ? 'border-gray-300' : full ? 'border-green-400 bg-green-50' : none ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50';
    const icon = pending ? 'fa-hourglass-half text-gray-500' : full ? 'fa-circle-check text-green-600' : none ? 'fa-circle-xmark text-red-600' : 'fa-circle-half-stroke text-amber-600';
    const mine = show(q.answer);
    const note = q.adjustment === 'credit' ? '<div class="text-[11px] font-bold text-indigo-700 mt-1">Your lecturer gave everyone full credit for this question.</div>'
        : q.adjustment === 'drop' ? '<div class="text-[11px] font-bold text-indigo-700 mt-1">This question was not counted in your score.</div>' : '';
    return `<div class="border ${tone} rounded-lg p-3 bg-white">
        <div class="flex items-start justify-between gap-2">
            <div class="text-sm font-bold text-gray-800 break-words"><span class="text-gray-400">${no}.</span> ${esc(q.question)}${q.isBonus ? ' <span class="text-amber-700 text-[11px]">(bonus)</span>' : ''}</div>
            <div class="shrink-0 text-xs font-black text-gray-700"><i class="fa-solid ${icon} mr-1" aria-hidden="true"></i>${pending ? 'Waiting' : `${q.earned} / ${q.points}`}</div>
        </div>
        <div class="mt-1.5 text-xs text-gray-700"><span class="font-bold">Your answer:</span> ${mine || '<i class="text-gray-400">no answer</i>'}</div>
        ${q.correct === null ? '' : `<div class="mt-0.5 text-xs text-green-800"><span class="font-bold">Correct answer:</span> ${show(q.correct)}</div>`}
        ${q.explanation ? `<div class="mt-1 text-[11px] text-gray-600"><span class="font-bold">Why:</span> ${esc(q.explanation)}</div>` : ''}
        ${note}
    </div>`;
};

export const ExamReview = {
    close: () => { const m = document.getElementById('examReviewModal'); if (m) m.remove(); },

    open: async (assignmentId, studentId) => {
        ExamReview.close();
        const m = document.createElement('div');
        m.id = 'examReviewModal';
        m.className = 'fixed inset-0 z-[80] flex items-center justify-center p-0 sm:p-4';
        m.setAttribute('role', 'dialog');
        m.setAttribute('aria-modal', 'true');
        m.setAttribute('aria-label', 'Review your answers');
        m.innerHTML = `<div id="closeExamReviewBg" class="absolute inset-0 bg-gray-900 bg-opacity-60"></div>
            <div class="relative bg-gray-50 w-full sm:max-w-2xl h-full sm:h-[90vh] sm:rounded-lg shadow-xl flex flex-col">
                <div class="flex items-center justify-between px-4 py-3 border-b bg-white sm:rounded-t-lg">
                    <div><div class="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Review</div><h4 id="examReviewTitle" class="font-black text-gray-800"></h4></div>
                    <button type="button" id="closeExamReviewBtn" aria-label="Close" class="text-gray-400 hover:text-gray-800"><i class="fa-solid fa-xmark text-xl" aria-hidden="true"></i></button>
                </div>
                <div id="examReviewBody" class="flex-1 overflow-y-auto p-3 space-y-2"><div class="text-center py-10 text-gray-500"><i class="fa-solid fa-spinner fa-spin text-2xl"></i></div></div>
            </div>`;
        document.body.appendChild(m);
        const body = m.querySelector('#examReviewBody');
        try {
            const d = await apiFetch(`/api/student-exam-review?assignmentId=${encodeURIComponent(assignmentId)}&studentId=${encodeURIComponent(studentId)}&_t=${Date.now()}`);
            m.querySelector('#examReviewTitle').textContent = `${d.examTitle} - ${d.finalScore} / ${d.maxScore}`;
            body.innerHTML = d.questions.map((q, i) => card(q, i + 1)).join('');
        } catch (err) {
            body.innerHTML = `<div class="text-red-600 font-bold text-sm text-center py-6">${esc(err.message || 'Could not load the review.')}</div>`;
        }
    }
};
