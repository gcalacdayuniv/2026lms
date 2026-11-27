// js/class-mode.js
// Lecturer: mark the attendance date as an Onsite (default) or Online class. An online day can carry a proof picture
// (a screenshot of the video meeting); it is shrunk on the phone, kept in Google Drive and only the lecturer can open it.
import { apiFetch, apiPost, fileToBase64 } from './globals.js';
const post = apiPost;
import { UI } from './ui-feedback.js';
import { escapeHtml as esc } from './html-utils.js';

const $ = (id) => document.getElementById(id);

// Shrinks a picture to at most 1280 px on the long side (JPEG) so a phone screenshot of several MB becomes a few hundred KB.
const shrink = async (file) => {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob) throw new Error('Could not read the picture.');
    return await fileToBase64(blob);
};

export const ClassMode = {
    courseId: '',
    date: '',
    mode: 'onsite',
    hasProof: false,
    busy: false,
    token: 0,

    // Called whenever the attendance screen loads a date.
    load: async (courseId, date) => {
        ClassMode.courseId = courseId; ClassMode.date = date;
        const mine = ++ClassMode.token;
        try {
            const r = await apiFetch(`/api/class-modes?courseId=${encodeURIComponent(courseId)}&_t=${Date.now()}`);
            if (mine !== ClassMode.token) return;
            const row = (r.modes || []).find(m => m.date === date);
            ClassMode.mode = row ? 'online' : 'onsite';
            ClassMode.hasProof = !!(row && row.hasProof);
        } catch (err) {
            if (mine !== ClassMode.token) return;
            ClassMode.mode = 'onsite'; ClassMode.hasProof = false;
        }
        ClassMode.paint();
    },

    // One button per place (toolbar, floor plan header). A tap switches Onsite <-> Online; the button shows the current mode.
    // The proof picture buttons sit in the roster header and appear only on an online day.
    paint: () => {
        const on = ClassMode.mode === 'online';
        const label = on ? 'Online class. Tap to mark it onsite.' : 'Onsite class. Tap to mark it online.';
        const icon = on ? 'fa-video' : 'fa-school';
        const look = on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-700 border-gray-300';
        const tool = $('classModeBtn');
        if (tool) { tool.className = `cm-toggle flex-shrink-0 w-11 h-11 inline-flex items-center justify-center rounded-md border ${look}`; tool.setAttribute('aria-label', label); tool.title = label; tool.setAttribute('aria-pressed', String(on)); tool.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i>`; }
        const head = $('smClassMode');
        if (head) {
            head.innerHTML = `<button type="button" class="cm-toggle min-h-[44px] px-3 rounded-md border text-sm font-bold ${look}" aria-pressed="${on}" aria-label="${label}" title="${label}"><i class="fa-solid ${icon} mr-1" aria-hidden="true"></i>${on ? 'Online' : 'Onsite'}</button>`;
            head.classList.remove('hidden');
        }
        const slot = $('cmProofSlot');
        if (slot) {
            const cls = ClassMode.hasProof ? 'border-indigo-300 text-indigo-700' : 'border-amber-400 text-amber-700 bg-amber-50';
            slot.innerHTML = on ? `<button type="button" id="cmProofBtn" class="min-h-[32px] min-w-[32px] px-2 rounded-md border bg-white text-xs ${cls}" aria-label="${ClassMode.hasProof ? 'Replace proof picture' : 'Add proof picture (no screenshot of the meeting yet)'}"><i class="fa-solid fa-camera" aria-hidden="true"></i></button>${ClassMode.hasProof ? '<button type="button" id="cmViewProof" class="min-h-[32px] min-w-[32px] px-2 rounded-md border border-gray-300 bg-white text-gray-700 text-xs" aria-label="View proof picture"><i class="fa-regular fa-image" aria-hidden="true"></i></button>' : ''}<input type="file" id="cmProofFile" accept="image/*" class="hidden">` : '';
        }
    },

    setMode: async (mode) => {
        if (ClassMode.busy || mode === ClassMode.mode) return;
        if (mode === 'onsite' && ClassMode.hasProof) {
            const ok = await UI.confirm({ title: 'Mark as onsite?', message: 'The proof picture for this date will no longer be linked to it.', confirmText: 'Mark onsite' });
            if (!ok) return;
        }
        ClassMode.busy = true;
        try {
            await post('/api/class-mode', { courseId: ClassMode.courseId, date: ClassMode.date, mode });
            ClassMode.mode = mode;
            if (mode === 'onsite') ClassMode.hasProof = false;
        } catch (err) { UI.error(err.message || 'Could not change the class mode.'); }
        ClassMode.busy = false;
        ClassMode.paint();
    },

    sendProof: async (file) => {
        if (!file || ClassMode.busy) return;
        ClassMode.busy = true;
        const btn = $('cmProofBtn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>'; }
        try {
            const base64 = await shrink(file);
            await post('/api/class-mode-proof', { courseId: ClassMode.courseId, date: ClassMode.date, base64, mimeType: 'image/jpeg' });
            ClassMode.mode = 'online'; ClassMode.hasProof = true;
            UI.success('Proof saved.');
        } catch (err) { UI.error(err.message || 'Could not save the picture.'); }
        ClassMode.busy = false;
        ClassMode.paint();
    },

    viewProof: async () => {
        try {
            const r = await apiFetch(`/api/class-mode-proof?courseId=${encodeURIComponent(ClassMode.courseId)}&date=${encodeURIComponent(ClassMode.date)}&_t=${Date.now()}`);
            ClassMode.closeViewer();
            const mime = /^image\/(jpeg|png|webp)$/.test(r.mimeType) ? r.mimeType : 'image/jpeg';
            ClassMode.viewer = UI.overlay({
                id: 'cmViewer', label: `Online class proof for ${ClassMode.date}`, z: 160, padClass: 'p-0 sm:p-4',
                backdropClass: 'bg-black bg-opacity-90', panelClass: 'flex flex-col items-center justify-center',
                html: `<button type="button" data-overlay-close aria-label="Close" class="absolute top-3 right-3 w-11 h-11 rounded-full bg-white/90 text-gray-800"><i class="fa-solid fa-xmark text-xl" aria-hidden="true"></i></button>
                    <p class="text-white text-sm font-bold mb-2">Online class, ${esc(ClassMode.date)}</p>
                    <img alt="Screenshot of the online class on ${esc(ClassMode.date)}" class="max-w-full max-h-[85vh] object-contain rounded" src="data:${mime};base64,${r.base64}">`
            });
        } catch (err) { UI.error(err.message || 'Could not open the picture.'); }
    },

    closeViewer: () => { if (ClassMode.viewer) ClassMode.viewer.close(); ClassMode.viewer = null; },

    init: () => {
        if (ClassMode.bound) return;
        ClassMode.bound = true;
        document.addEventListener('click', (e) => {
            const t = e.target;
            if (!t.closest) return;
            if (t.closest('.cm-toggle')) { ClassMode.setMode(ClassMode.mode === 'online' ? 'onsite' : 'online'); return; }
            if (t.closest('#cmProofBtn')) { $('cmProofFile')?.click(); return; }
            if (t.closest('#cmViewProof')) { ClassMode.viewProof(); return; }
        });
        document.addEventListener('change', (e) => {
            if (e.target && e.target.id === 'cmProofFile') { const f = e.target.files && e.target.files[0]; e.target.value = ''; ClassMode.sendProof(f); }
        });
    }
};

ClassMode.init();
