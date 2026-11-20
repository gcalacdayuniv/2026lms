// js/exam-share.js
// Share dialog: the owner of an exam picks which lecturers (who teach the same course code) may use it.
import { apiFetch, AppState } from './globals.js';
import { UI } from './ui-feedback.js';
import { escapeHtml as esc } from './html-utils.js';

export const ExamShare = {
    open: async (examId, title, onDone) => {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4';
        overlay.style.zIndex = '300';   // a11y.js ranks dialogs by inline z-index
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'examShareTitle');
        overlay.innerHTML = `
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60"></div>
            <div class="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-xl shadow-xl flex flex-col max-h-[85vh]">
                <div class="flex items-start gap-2 p-4 border-b border-gray-200">
                    <div class="min-w-0 flex-1">
                        <h3 id="examShareTitle" class="text-base font-black text-gray-800">Share this exam</h3>
                        <p class="text-xs text-gray-600 break-words">${esc(title || '')}</p>
                    </div>
                    <button type="button" id="examShareClose" aria-label="Close" class="w-10 h-10 rounded text-gray-500 hover:bg-gray-100"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
                </div>
                <div id="examShareBody" class="p-4 overflow-y-auto text-sm text-gray-600">Loading...</div>
                <div class="p-3 border-t border-gray-200 flex gap-2 justify-end">
                    <button type="button" id="examShareCancel" class="px-4 py-2 rounded-md border border-gray-300 text-sm font-bold text-gray-700">Cancel</button>
                    <button type="button" id="examShareSave" class="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm font-bold disabled:opacity-50" disabled>Save</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const previous = document.activeElement;
        const close = () => { overlay.remove(); try { previous && previous.focus(); } catch (e) { /* gone */ } };
        overlay.querySelector('.bg-opacity-60').addEventListener('click', close);
        overlay.querySelector('#examShareClose').addEventListener('click', close);
        overlay.querySelector('#examShareCancel').addEventListener('click', close);
        const body = overlay.querySelector('#examShareBody');
        const save = overlay.querySelector('#examShareSave');
        overlay.querySelector('#examShareClose').focus();

        let data;
        try {
            data = await apiFetch(`/api/exams/shares?examId=${encodeURIComponent(examId)}&lecturerId=${encodeURIComponent(AppState.user.User_ID)}&_t=${Date.now()}`);
        } catch (err) {
            body.innerHTML = `<p class="text-red-600 font-bold">${esc(err.message || 'Could not load the lecturers.')}</p>`;
            return;
        }
        if (!data.eligible.length) {
            body.innerHTML = '<p>No other lecturer teaches a class with the same course code yet. Once one does, you can share this exam with them here.</p>';
            return;
        }
        const chosen = new Set(data.shared);
        body.innerHTML = `
            <p class="mb-3 text-xs">Lecturers who teach a class with the same course code. They can open, print, copy and assign this exam to their own classes. They cannot edit, archive, delete or share it.</p>
            <div class="space-y-2">${data.eligible.map(l => `
                <label class="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer">
                    <input type="checkbox" class="w-5 h-5 accent-indigo-600" value="${esc(l.id)}" ${chosen.has(l.id) ? 'checked' : ''}>
                    <span class="min-w-0"><span class="block font-bold text-gray-800">${esc(l.name)}</span><span class="block text-xs text-gray-500">${esc(l.courses || '')}</span></span>
                </label>`).join('')}</div>`;
        save.disabled = false;
        save.addEventListener('click', async () => {
            const ids = [...body.querySelectorAll('input[type="checkbox"]:checked')].map(i => i.value);
            save.disabled = true;
            try {
                await apiFetch('/api/exams/share', { method: 'POST', body: JSON.stringify({ examId, lecturerId: AppState.user.User_ID, lecturerIds: ids }) });
                UI.success(ids.length ? `Shared with ${ids.length} lecturer${ids.length === 1 ? '' : 's'}` : 'Sharing turned off');
                close();
                if (onDone) await onDone();
            } catch (err) {
                save.disabled = false;
                UI.error(err.message || 'Could not save sharing.');
            }
        });
    }
};
