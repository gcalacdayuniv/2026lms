// js/course-scan-photos.js
// Low-resolution photo of every captured answer sheet, kept so the sheet can be looked at again later or on
// another device. The photo is shrunk on the phone (about 100 to 200 KB), kept in IndexedDB until the sheet
// itself is confirmed saved, then sent to the Worker, which stores it in Google Drive. It is deleted from the
// phone only after the server confirms. A failed or offline upload never blocks saving the scores.
import { apiFetch } from './globals.js';
import { rectify, RECT_LAYOUT } from './omr-crop.js';

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
    keep: (scanId, courseId, photoUrl, H) => {
        if (!scanId || !photoUrl || ScanPhotos.making.has(scanId)) return ScanPhotos.making.get(scanId);
        const job = (async () => {
            try {
                if (await getEntry(scanId)) return;
                // Straightened to the sheet frame when the corner markers are known, so single questions can be cut out later.
                let blob = null, layout = null;
                if (H) {
                    try { blob = await rectify(photoUrl, H); layout = RECT_LAYOUT; } catch (e) { blob = null; }
                }
                if (!blob) blob = await makeLowRes(photoUrl);
                if (blob) await putEntry({ scanId, courseId, blob, layout, createdAt: Date.now(), ref: null });
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
                            studentId: entry.ref.studentId, scanId: entry.scanId, layout: entry.layout || undefined, base64: await toBase64(entry.blob)
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


// ---- Photos read back for review: one sheet at a time, kept on the device for 7 days ----
const CACHE_DB = 'omr_photo_cache_v1';
const CACHE_STORE = 'photos';
export const CACHE_DAYS = 7;
const CACHE_MS = CACHE_DAYS * 24 * 60 * 60 * 1000;

let cacheDb = null;
const openCache = () => {
    if (!cacheDb) {
        cacheDb = new Promise((resolve) => {
            try {
                const req = indexedDB.open(CACHE_DB, 1);
                req.onupgradeneeded = () => req.result.createObjectStore(CACHE_STORE, { keyPath: 'fileId' });
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            } catch (e) { resolve(null); }
        });
    }
    return cacheDb;
};
const cacheTx = async (mode, fn) => {
    const db = await openCache();
    if (!db) return undefined;
    return new Promise((resolve) => {
        try {
            const t = db.transaction(CACHE_STORE, mode);
            const out = fn(t.objectStore(CACHE_STORE));
            t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
            t.onerror = t.onabort = () => resolve(undefined);
        } catch (e) { resolve(undefined); }
    });
};

const fromBase64 = (b64, type) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type || 'image/jpeg' });
};

export const PhotoCache = {
    // Removes every downloaded photo older than 7 days.
    purge: async () => {
        const all = (await cacheTx('readonly', s => s.getAll())) || [];
        const now = Date.now();
        for (const e of all) {
            if (!e.savedAt || now - e.savedAt > CACHE_MS) await cacheTx('readwrite', s => s.delete(e.fileId));
        }
    },

    // The photo of one saved sheet: from the device when it was downloaded before (and is not 7 days old),
    // otherwise downloaded now (only this one) and kept. Returns { blob, layout, cached } or throws.
    get: async (sheet) => {
        const fileId = sheet.Photo_File_ID;
        if (!fileId) throw new Error('No photo is stored for this sheet.');
        const hit = await cacheTx('readonly', s => s.get(fileId));
        if (hit && hit.blob && Date.now() - hit.savedAt <= CACHE_MS) return { blob: hit.blob, layout: hit.layout || null, cached: true };
        const res = await apiFetch(`/api/scan-sheets/photo?sheetId=${encodeURIComponent(sheet.Sheet_ID)}`, { timeoutMs: 45000 });
        const blob = fromBase64(res.base64, res.mimeType);
        const layout = res.layout || null;
        await cacheTx('readwrite', s => s.put({ fileId, blob, layout, savedAt: Date.now() }));
        return { blob, layout, cached: false };
    },

    forget: (fileId) => cacheTx('readwrite', s => s.delete(fileId))
};
