// worker/upload-guard.js
// Cheap checks that run BEFORE any upload bytes are streamed to Google Drive.
// Uses a few small D1 queries and no heavy CPU work, so it fits the free Workers plan.

// A 25 MB file is about 33.4 MB of base64 text. Leave a little room for the wrapper.
export const MAX_SINGLE_BODY_BYTES = 36 * 1024 * 1024;
// One piece of a chunked upload (the browser sends about 3.6 MB pieces).
export const MAX_CHUNK_BODY_BYTES = 4 * 1024 * 1024;
// Largest total base64 size accepted across all pieces (25 MB file).
export const MAX_TOTAL_BASE64_CHARS = 36 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt']);
const TERMS = ['MidTerm', 'FinalTerm'];
const TYPES = ['file', 'url'];
const MIME_RE = /^[A-Za-z0-9][\w.+-]*\/[A-Za-z0-9][\w.+-]*$/;

export class UploadError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

// Rejects a request whose declared size is missing or too large.
export function checkContentLength(request, maxBytes) {
    const len = parseInt(request.headers.get('Content-Length') || '', 10);
    if (Number.isFinite(len) && len > maxBytes) {
        throw new UploadError(`File is too large. Maximum upload is ${Math.round(maxBytes / (1024 * 1024))} MB per request.`, 413);
    }
}

// Validates the submission details (the same fields recordSubmission() uses).
export function validateMeta(meta) {
    if (!meta || typeof meta !== 'object') throw new UploadError('Missing submission details.');

    const { courseId, studentId, term, title, description, type, filename, mimeType } = meta;

    if (!courseId || typeof courseId !== 'string' || !studentId || typeof studentId !== 'string') {
        throw new UploadError('Missing course or student.');
    }
    if (!TERMS.includes(term)) throw new UploadError('Invalid term.');
    if (!TYPES.includes(type)) throw new UploadError('Invalid submission type.');

    if (typeof title !== 'string' || !title.trim() || title.length > 150) {
        throw new UploadError('Title is required (150 characters maximum).');
    }
    if (description != null && (typeof description !== 'string' || description.length > 2000)) {
        throw new UploadError('Description is too long (2000 characters maximum).');
    }

    if (typeof filename !== 'string' || !filename.trim() || filename.length > 220 || /[\\/]/.test(filename)) {
        throw new UploadError('Invalid file name.');
    }
    const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
    if (!ALLOWED_EXTENSIONS.has(ext)) {
        throw new UploadError('File type not allowed. Use PDF, Word or PowerPoint files.');
    }
    if (type === 'url' && ext !== 'txt') throw new UploadError('Invalid link submission.');
    if (type === 'file' && ext === 'txt') throw new UploadError('File type not allowed. Use PDF, Word or PowerPoint files.');

    if (mimeType != null && mimeType !== '' && (typeof mimeType !== 'string' || mimeType.length > 100 || !MIME_RE.test(mimeType))) {
        throw new UploadError('Invalid file type.');
    }

    if (meta.pathParts != null) {
        if (!Array.isArray(meta.pathParts) || meta.pathParts.length > 5 ||
            meta.pathParts.some(p => typeof p !== 'string' || p.length > 100)) {
            throw new UploadError('Invalid folder path.');
        }
    }

    if (meta.includedMembers != null) {
        if (!Array.isArray(meta.includedMembers) || meta.includedMembers.length > 20 ||
            meta.includedMembers.some(m => typeof m !== 'string')) {
            throw new UploadError('Invalid group members.');
        }
    }
}

// The uploader must be an Active user enrolled in the course, and so must every group member.
export async function verifyUploader(env, meta) {
    const ids = [meta.studentId];
    if (meta.isGroup && Array.isArray(meta.includedMembers)) {
        for (const m of meta.includedMembers) if (!ids.includes(m)) ids.push(m);
    }

    const placeholders = ids.map(() => '?').join(',');
    const rows = await env.DB.prepare(
        `SELECT u.User_ID
         FROM Users u
         JOIN Enrollments e ON e.Student_ID = u.User_ID AND e.Course_ID = ?
         WHERE u.User_ID IN (${placeholders}) AND u.account_status COLLATE NOCASE = 'active'`
    ).bind(meta.courseId, ...ids).all();

    const ok = new Set((rows.results || []).map(r => r.User_ID));
    if (!ok.has(meta.studentId)) {
        throw new UploadError('You are not enrolled in this course, or your account is not active.', 403);
    }
    if (ids.some(id => !ok.has(id))) {
        throw new UploadError('A selected group member is not an active student of this course.', 403);
    }
}

// Validates the chunk details sent in the X-Chunk-Meta header.
export function validateChunkMeta(info, maxChunks) {
    const { uploadId, index, total } = info || {};
    if (!/^[A-Za-z0-9-]{8,64}$/.test(String(uploadId || '')) ||
        !Number.isInteger(index) || !Number.isInteger(total) ||
        total < 1 || total > maxChunks || index < 0 || index >= total) {
        throw new UploadError('Invalid chunk details.');
    }
    return { uploadId, index, total };
}
