// js/student-sheet-viewer.js
// Lets a student (or a lecturer looking at that student's summary) open the photo of the student's own scanned
// answer sheet, to check that it is their paper. Opened from the "View answer sheet" button in the score list of
// a scanned assessment. One photo at a time, downloaded only when asked and kept on the device for 7 days.
import { PhotoCache } from './course-scan-photos.js';
import { escapeHtml as esc } from './html-utils.js';

const $ = (id) => document.getElementById(id);

export const StudentSheetViewer = {
    url: '',
    keyHandler: null,

    // Small button for a score row, or '' when the assessment has no stored sheet photo.
    buttonHtml: (assessment, studentId) => {
        if (!assessment || !assessment.Sheet_ID || !studentId) return '';
        return `<div class="mt-1"><button type="button" class="sheet-view-btn inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 border border-blue-200 text-blue-700 text-[11px] font-bold"
            data-sheet-id="${esc(assessment.Sheet_ID)}" data-version="${esc(assessment.Sheet_Version || '')}" data-student-id="${esc(studentId)}" data-title="${esc(assessment.Title || 'Answer sheet')}">
            <i class="fa-regular fa-image" aria-hidden="true"></i> View answer sheet</button></div>`;
    },

    open: async (sheetId, studentId, title, version = '') => {
        StudentSheetViewer.close();
        const wrap = document.createElement('div');
        wrap.id = 'sheetViewer';
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'true');
        wrap.setAttribute('aria-label', 'Answer sheet');
        wrap.className = 'fixed inset-0 flex flex-col bg-black fade-in';
        wrap.style.cssText = 'z-index:260';
        wrap.innerHTML = `
            <div class="flex items-center gap-1 px-2 py-2 text-white" style="padding-top:calc(.5rem + env(safe-area-inset-top))">
                <button type="button" id="sheetViewerClose" aria-label="Close" class="app-page-close text-white"><i class="fa-solid fa-arrow-left text-xl" aria-hidden="true"></i></button>
                <div class="min-w-0 flex-1"><div class="font-black truncate">${esc(title || 'Answer sheet')}</div>
                <div class="text-[11px] text-gray-300">Check that this is your paper. Tap the photo to zoom.</div></div>
            </div>
            <div id="sheetViewerBody" class="flex-1 overflow-auto flex items-center justify-center" style="-webkit-overflow-scrolling:touch">
                <div id="sheetViewerStatus" class="text-gray-300 text-sm"><i class="fa-solid fa-spinner fa-spin mr-2" aria-hidden="true"></i>Loading photo...</div>
            </div>`;
        document.body.appendChild(wrap);
        wrap.querySelector('#sheetViewerClose').addEventListener('click', StudentSheetViewer.close);
        StudentSheetViewer.keyHandler = (e) => { if (e.key === 'Escape') StudentSheetViewer.close(); };
        document.addEventListener('keydown', StudentSheetViewer.keyHandler);
        wrap.querySelector('#sheetViewerClose').focus();

        try {
            const { blob } = await PhotoCache.get(
                { Sheet_ID: sheetId, Photo_File_ID: `sheet:${sheetId}:${version}` },
                { endpoint: '/api/student-sheet-photo', query: `&studentId=${encodeURIComponent(studentId)}` }
            );
            if (!$('sheetViewer')) return;
            StudentSheetViewer.url = URL.createObjectURL(blob);
            const body = $('sheetViewerBody');
            body.innerHTML = '';
            const img = document.createElement('img');
            img.alt = 'Your scanned answer sheet';
            img.src = StudentSheetViewer.url;
            img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;background:#fff;cursor:zoom-in';
            let zoomed = false;
            img.addEventListener('click', () => {
                zoomed = !zoomed;
                if (zoomed) { img.style.cssText = 'width:220%;max-width:none;max-height:none;background:#fff;cursor:zoom-out;margin:auto'; body.style.alignItems = 'flex-start'; body.style.justifyContent = 'flex-start'; }
                else { img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;background:#fff;cursor:zoom-in'; body.style.alignItems = ''; body.style.justifyContent = ''; }
            });
            body.appendChild(img);
        } catch (err) {
            const status = $('sheetViewerStatus');
            if (status) status.innerHTML = `The photo could not be loaded (${esc((err && err.message) || 'offline')}). <button type="button" id="sheetViewerRetry" class="underline font-bold ml-1">Try again</button>`;
            $('sheetViewerRetry')?.addEventListener('click', () => StudentSheetViewer.open(sheetId, studentId, title, version));
        }
    },

    close: () => {
        $('sheetViewer')?.remove();
        if (StudentSheetViewer.url) { URL.revokeObjectURL(StudentSheetViewer.url); StudentSheetViewer.url = ''; }
        if (StudentSheetViewer.keyHandler) { document.removeEventListener('keydown', StudentSheetViewer.keyHandler); StudentSheetViewer.keyHandler = null; }
    },

    init: () => {
        document.addEventListener('click', (e) => {
            const btn = e.target.closest && e.target.closest('.sheet-view-btn');
            if (btn) StudentSheetViewer.open(btn.dataset.sheetId, btn.dataset.studentId, btn.dataset.title, btn.dataset.version);
        });
    }
};
