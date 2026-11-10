// js/course-scan-photos.js
// Low-resolution photo of every captured answer sheet, kept so the sheet can be looked at again later or on
// another device. The photo is shrunk on the phone (about 100 to 200 KB), kept in IndexedDB until the sheet
// itself is confirmed saved, then sent to the Worker, which stores it in Google Drive. It is deleted from the
// phone only after the server confirms. A failed or offline upload never blocks saving the scores.
import { apiFetch } from './globals.js';

const DB_NAME = 'omr_photos_v1';
const STORE = 'photos';
const MAX_SIDE = 1100;          // longest side in pixels
const QUALITY = 0.5;            // JPEG quality
const ORPHAN_MS = 10 * 60 * 1000;

let dbPromise = null;
const open = () => {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            try {
                const req = indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'scanId' });
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            } catch (e) { reject(e); }
        }).catch(() => null);   // storage blocked: photos are skipped, scores still save
    }
    return dbPromise;
};

const tx = async (mode, fn) => {
    const db = await open();
    if (!db) return undefined;
    return new Promise((resolve) => {
        try {
            const t = db.transaction(STORE, mode);
            const out = fn(t.objectStore(STORE));
            t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
            t.onerror = t.onabort = () => resolve(undefined);
        } catch (e) { resolve(undefined); }
    });
};

const getEntry = (scanId) => tx('readonly', s => s.get(scanId));
const putEntry = (entry) => tx('readwrite', s => s.put(entry));
const delEntry = (scanId) => tx('readwrite', s => s.delete(scanId));
const allEntries = async () => (await tx('readonly', s => s.getAll())) || [];

const loadImage = (url) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('photo'));
    img.src = url;
});

// Shrinks a photo (blob/object URL) to a small JPEG.
export const makeLowRes = async (url) => {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', QUALITY));
    canvas.width = 0;
    return blob;
};

const toBase64 = (blob) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = () => reject(new Error('photo'));
    fr.readAsDataURL(blob);
});

export const driveImageUrl = (fileId, size = 1200) => `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${size}`;
export const driveViewUrl = (fileId) => `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;

export const ScanPhotos = {
    making: new Map(),     // scanId -> promise while the small copy is being made
    sending: false,

    // Makes and keeps the small copy of a captured sheet (once per capture).
    keep: (scanId, courseId, photoUrl) => {
        if (!scanId || !photoUrl || ScanPhotos.making.has(scanId)) return ScanPhotos.making.get(scanId);
        const job = (async () => {
            try {
                if (await getEntry(scanId)) return;
                const blob = await makeLowRes(photoUrl);
                if (blob) await putEntry({ scanId, courseId, blob, createdAt: Date.now(), ref: null });
            } catch (e) { /* the photo is optional */ }
        })().finally(() => setTimeout(() => ScanPhotos.making.delete(scanId), 0));
        ScanPhotos.making.set(scanId, job);
        return job;
    },

    // The sheets were confirmed saved: remember where each photo belongs and send them.
    saved: async (list) => {
        for (const item of list) {
            const job = ScanPhotos.making.get(item.scanId);
            if (job) await job;
            const entry = await getEntry(item.scanId);
            if (entry) await putEntry({ ...entry, ref: { assessmentId: item.assessmentId, studentId: item.studentId, courseId: item.courseId } });
        }
        return ScanPhotos.send();
    },

    // Sends every photo whose sheet is saved. Safe to call often.
    send: async () => {
        if (ScanPhotos.sending) return;
        ScanPhotos.sending = true;
        try {
            for (const entry of await allEntries()) {
                if (!entry.ref) continue;
                try {
                    const res = await apiFetch('/api/scan-sheets/photo', {
                        method: 'POST',
                        timeoutMs: 60000,
                        body: JSON.stringify({
                            courseId: entry.ref.courseId, assessmentId: entry.ref.assessmentId,
                            studentId: entry.ref.studentId, scanId: entry.scanId, base64: await toBase64(entry.blob)
                        })
                    });
                    // Confirmed in Drive, or the sheet was replaced and no longer needs this photo.
                    if (res.success || res.code === 'no-sheet') await delEntry(entry.scanId);
                } catch (err) {
                    // Offline or server problem: keep it and try again later.
                }
            }
        } finally {
            ScanPhotos.sending = false;
        }
    },

    // Photos of sheets that were never queued (discarded) are removed after a while.
    purge: async (isQueued) => {
        const now = Date.now();
        for (const entry of await allEntries()) {
            if (!entry.ref && !isQueued(entry.scanId) && now - entry.createdAt > ORPHAN_MS) await delEntry(entry.scanId);
        }
    },

    waiting: async () => (await allEntries()).length
};
