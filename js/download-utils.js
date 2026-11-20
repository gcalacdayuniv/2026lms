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
        try {
            const { UI } = await import('./ui-feedback.js');
            UI.toast(`${filename} is ready`, 'success', 20000, {
                label: 'Share / Save',
                onClick: async () => {
                    try { await navigator.share({ files: [file], title: filename }); }
                    catch (err) { if (err && err.name !== 'AbortError') saveAsDownload(blob, filename); }
                }
            });
            return;
        } catch (err) { /* fall through to a normal download */ }
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
