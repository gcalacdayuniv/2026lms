// js/download-utils.js
// One place for CSV cells and file downloads (they used to be copied into several files).

// A cell that starts with = + - @ would run as a formula in Excel. A leading ' keeps it text.
// Plain negative numbers stay numbers. Every cell is quoted.
export const csvCell = (value) => {
    let s = String(value ?? '');
    if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s))) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
};

// Saves a Blob as a file download. On a phone or tablet that can share files, it offers the share sheet instead
// (Save to Files, Drive, Messenger...), which is far easier than a plain download on iPhones. The share button is a
// fresh tap, because browsers only allow sharing right after a tap and a big export can take longer than that.
const canShareFile = (file) => {
    try {
        return window.matchMedia('(pointer: coarse)').matches && typeof navigator.share === 'function'
            && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
    } catch (err) { return false; }
};

export const downloadBlob = async (blob, filename) => {
    const file = typeof File === 'function' ? new File([blob], filename, { type: blob.type || 'application/octet-stream' }) : null;
    if (file && canShareFile(file)) {
        // A centered, hard-to-miss prompt: the file only shares / saves after this tap.
        document.getElementById('shareFileDlg')?.remove();
        const esc = (v) => String(v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
        const dlg = document.createElement('div');
        dlg.id = 'shareFileDlg';
        dlg.className = 'fixed inset-0 z-[120] flex items-center justify-center p-4 fade-in';
        dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-label', 'File ready');
        dlg.innerHTML = `<div class="absolute inset-0 bg-gray-900 bg-opacity-60" data-share-close></div>
            <div class="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
                <div class="mx-auto mb-3 w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-3xl"><i class="fa-solid fa-file-excel" aria-hidden="true"></i></div>
                <h3 class="text-xl font-black text-gray-900 mb-1">Your file is ready</h3>
                <p class="text-sm text-gray-600 break-words mb-1">${esc(filename)}</p>
                <p class="text-sm font-bold text-gray-800 mb-5">Tap the button to save or share it.</p>
                <button type="button" id="shareFileBtn" class="w-full min-h-[3.5rem] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-lg font-black shadow-lg flex items-center justify-center gap-2"><i class="fa-solid fa-share-from-square" aria-hidden="true"></i> Share / Save</button>
                <button type="button" data-share-close class="mt-3 w-full py-2 text-sm font-bold text-gray-500 hover:text-gray-800">Close</button>
            </div>`;
        document.body.appendChild(dlg);
        const close = () => dlg.remove();
        dlg.addEventListener('click', async (e) => {
            if (e.target.closest('[data-share-close]')) { close(); return; }
            if (!e.target.closest('#shareFileBtn')) return;
            try { await navigator.share({ files: [file], title: filename }); close(); }
            catch (err) { if (err && err.name !== 'AbortError') { close(); saveAsDownload(blob, filename); } }
        });
        dlg.querySelector('#shareFileBtn').focus();
        return;
    }
    saveAsDownload(blob, filename);
};

const saveAsDownload = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
};

// Saves CSV text (with a byte-order mark so Excel reads accents and Filipino names correctly).
export const downloadCsv = (filename, text) => {
    downloadBlob(new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8;' }), filename);
};
