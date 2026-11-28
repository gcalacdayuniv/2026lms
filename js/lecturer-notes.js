// js/lecturer-notes.js
// Lecturer's private notes per student per class (behaviour, participation, other written observations).
// Opened in their own dialog from the class roster (note button beside the gear); the notes are never part of any student-facing response.
import { apiFetch, apiPost } from './globals.js';
import { UI } from './ui-feedback.js';
import { escapeHtml } from './html-utils.js';

const $ = (id) => document.getElementById(id);
const fmtDate = (v) => {
    if (!v) return '';
    const d = new Date(String(v).replace(' ', 'T') + 'Z');
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export const LecturerNotes = {
    courseId: '',
    studentId: '',
    notes: [],
    editingId: null,
    token: 0,

    init: () => {
        if (LecturerNotes.bound) return;
        LecturerNotes.bound = true;
        document.addEventListener('click', LecturerNotes.onClick);
        // The box is normal size until it is tapped; then it grows to two thirds of the visible screen (the keyboard is excluded).
        document.addEventListener('focusin', (e) => {
            if (e.target && e.target.id === 'lnText') {
                const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
                e.target.style.minHeight = `${Math.round(Math.max(120, Math.min(h * 2 / 3, h - 260)))}px`;
            }
        });
        document.addEventListener('focusout', (e) => { if (e.target && e.target.id === 'lnText') e.target.style.minHeight = ''; });
        document.addEventListener('input', (e) => { if (e.target && e.target.id === 'lnText') LecturerNotes.syncCount(); });
    },

    // Own dialog (separate from the performance summary), opened from the note button beside a student's gear.
    openModal: (courseId, studentId, name) => {
        LecturerNotes.closeModal();
        const dlg = UI.overlay({ id: 'lnModal', label: `Lecturer notes for ${name || 'student'}`, z: 140, padClass: 'p-0', alignClass: 'items-start sm:items-center', panelClass: 'bg-white sm:max-w-lg h-full sm:h-auto sm:max-h-[90vh] rounded-none sm:rounded-lg shadow-xl p-4 flex flex-col', html: `<div class="shrink-0 flex items-center gap-3 mb-3 border-b pb-3">
                    <div class="min-w-0 flex-1"><h3 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-note-sticky text-amber-600 mr-2" aria-hidden="true"></i>Lecturer's notes</h3><p class="text-xs text-gray-500 truncate">${escapeHtml(name || '')} &middot; private, never shown to the student</p></div>
                    <button type="button" id="lnClose" data-overlay-close class="p-2 text-gray-500 hover:text-gray-800" aria-label="Close"><i class="fa-solid fa-xmark text-xl" aria-hidden="true"></i></button>
                </div>
                <div id="lnPanel"></div>` });
        dlg.panel.style.paddingTop = 'max(1rem, env(safe-area-inset-top))';
        LecturerNotes.open(courseId, studentId);
        dlg.panel.querySelector('#lnClose').focus();
    },

    closeModal: () => UI.closeOverlay('lnModal'),

    open: async (courseId, studentId) => {
        LecturerNotes.init();
        LecturerNotes.courseId = courseId;
        LecturerNotes.studentId = studentId;
        LecturerNotes.notes = [];
        LecturerNotes.editingId = null;
        const mine = ++LecturerNotes.token;
        LecturerNotes.paint('<div class="text-xs text-gray-400 italic py-2">Loading notes...</div>');
        try {
            const res = await apiFetch(`/api/lecturer-notes?courseId=${encodeURIComponent(courseId)}&studentId=${encodeURIComponent(studentId)}&_t=${Date.now()}`);
            if (mine !== LecturerNotes.token) return;
            LecturerNotes.notes = res.notes || [];
            LecturerNotes.paint();
        } catch (err) {
            if (mine !== LecturerNotes.token) return;
            LecturerNotes.paint(`<div class="text-xs text-red-600 font-bold py-2">${escapeHtml(err.message || 'Failed to load notes.')}</div>`);
        }
    },

    syncCount: () => {
        const t = $('lnText'), c = $('lnCount'), b = $('lnSave');
        if (!t) return;
        if (c) c.textContent = `${t.value.length}/4000`;
        if (b) b.disabled = !t.value.trim();
    },

    paint: (message) => {
        const panel = $('lnPanel');
        if (!panel) return;
        const editing = LecturerNotes.notes.find(n => n.Note_ID === LecturerNotes.editingId);
        const list = LecturerNotes.notes.map(n => `
            <div class="bg-white border border-gray-200 rounded-lg p-2.5" data-note="${escapeHtml(n.Note_ID)}">
                <div class="text-sm text-gray-800 whitespace-pre-wrap break-words">${escapeHtml(n.Body)}</div>
                <div class="flex items-center justify-between mt-1.5 gap-2">
                    <span class="text-[10px] text-gray-400">${escapeHtml(fmtDate(n.Created_At))}${n.Updated_At && n.Updated_At !== n.Created_At ? ' · edited' : ''}</span>
                    <span class="flex gap-3 text-xs font-bold">
                        <button type="button" class="ln-edit text-blue-600 hover:underline" data-id="${escapeHtml(n.Note_ID)}">Edit</button>
                        <button type="button" class="ln-del text-red-600 hover:underline" data-id="${escapeHtml(n.Note_ID)}">Delete</button>
                    </span>
                </div>
            </div>`).join('');
        const compose = `<textarea id="lnText" rows="3" maxlength="4000" style="font-size:16px" class="w-full px-3 py-2 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 focus:outline-none" placeholder="Write a note about this student...">${editing ? escapeHtml(editing.Body) : ''}</textarea>
                <div class="flex items-center justify-between mt-1">
                    <span id="lnCount" class="text-[10px] text-gray-400">${editing ? editing.Body.length : 0}/4000</span>
                    <span class="flex gap-2">
                        ${editing ? '<button type="button" id="lnCancel" class="px-3 py-1.5 text-xs font-bold text-gray-600 bg-white border border-gray-300 rounded-lg">Cancel</button>' : ''}
                        <button type="button" id="lnSave" ${editing ? '' : 'disabled'} class="px-3 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg">${editing ? 'Update note' : 'Add note'}</button>
                    </span>
                </div>`;
        // The note box stays at the top; only the earlier notes scroll underneath it.
        panel.className = 'flex flex-col flex-1 min-h-0';
        panel.innerHTML = `
            <div class="shrink-0 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p class="text-[11px] text-gray-500 mb-2">Only you can see these. Use them for behaviour, participation and other observations that help you give a score.</p>
                ${message || compose}
            </div>
            ${message ? '' : `<h4 class="shrink-0 mt-3 mb-1 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Previous notes (${LecturerNotes.notes.length})</h4>
            <div class="flex-1 min-h-0 overflow-y-auto space-y-2 pb-2">${list || '<div class="text-xs text-gray-400 italic">No notes yet.</div>'}</div>`}`;
    },

    save: async () => {
        const t = $('lnText'), btn = $('lnSave');
        if (!t || !btn || !t.value.trim()) return;
        btn.disabled = true;
        try {
            await apiPost('/api/lecturer-notes', { courseId: LecturerNotes.courseId, studentId: LecturerNotes.studentId, noteId: LecturerNotes.editingId || undefined, body: t.value });
            UI.success(LecturerNotes.editingId ? 'Note updated.' : 'Note added.');
            await LecturerNotes.open(LecturerNotes.courseId, LecturerNotes.studentId);
        } catch (err) {
            UI.error(err.message || 'Failed to save the note.');
            btn.disabled = false;
        }
    },

    remove: (id) => {
        const at = LecturerNotes.notes.findIndex(n => n.Note_ID === id);
        if (at < 0) return;
        const [note] = LecturerNotes.notes.splice(at, 1);
        if (LecturerNotes.editingId === id) LecturerNotes.editingId = null;
        LecturerNotes.paint();
        const courseId = LecturerNotes.courseId;
        UI.deferred('Note deleted.', {
            restore: () => { LecturerNotes.notes.splice(Math.min(at, LecturerNotes.notes.length), 0, note); LecturerNotes.paint(); },
            commit: () => apiFetch('/api/lecturer-notes', { method: 'DELETE', body: JSON.stringify({ courseId, noteId: id }) })
        });
    },

    onClick: (e) => {
        const t = e.target.closest ? e.target : null;
        if (!t) return;
        const nb = t.closest('.student-notes-btn');
        if (nb) { LecturerNotes.openModal(window.location.hash.replace('#class-', ''), nb.dataset.studentId, nb.dataset.name); return; }
        if (t.closest('#lnSave')) { LecturerNotes.save(); return; }
        if (t.closest('#lnCancel')) { LecturerNotes.editingId = null; LecturerNotes.paint(); return; }
        const ed = t.closest('.ln-edit');
        if (ed) { LecturerNotes.editingId = ed.dataset.id; LecturerNotes.paint(); const x = $('lnText'); if (x) x.focus(); return; }
        const del = t.closest('.ln-del');
        if (del) LecturerNotes.remove(del.dataset.id);
    }
};

LecturerNotes.init();
