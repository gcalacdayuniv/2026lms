// worker/uploads.js
// Submission uploads (small files, chunked large files, grading a submission) and the cheap checks that run
// BEFORE any upload bytes are streamed to Google Drive. Uses a few small D1 queries and no heavy CPU work, so it fits the free plan.

import { callGas } from './gas.js';
import { groupNameIn, REPORTING } from './groups.js';

// A 25 MB file is about 33.4 MB of base64 text. Leave a little room for the wrapper.
const MAX_SINGLE_BODY_BYTES = 36 * 1024 * 1024;
// One piece of a chunked upload (the browser sends about 3.6 MB pieces).
const MAX_CHUNK_BODY_BYTES = 4 * 1024 * 1024;
// Largest total base64 size accepted across all pieces (25 MB file).
const MAX_TOTAL_BASE64_CHARS = 36 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt']);
const TERMS = ['MidTerm', 'FinalTerm'];
const TYPES = ['file', 'url'];
const MIME_RE = /^[A-Za-z0-9][\w.+-]*\/[A-Za-z0-9][\w.+-]*$/;

class UploadError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

// Rejects a request whose declared size is missing or too large.
function checkContentLength(request, maxBytes) {
    const len = parseInt(request.headers.get('Content-Length') || '', 10);
    if (Number.isFinite(len) && len > maxBytes) {
        throw new UploadError(`File is too large. Maximum upload is ${Math.round(maxBytes / (1024 * 1024))} MB per request.`, 413);
    }
}

// Validates the submission details (the same fields recordSubmission() uses).
function validateMeta(meta) {
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

    if (meta.groupSetId != null && (typeof meta.groupSetId !== 'string' || meta.groupSetId.length > 64)) {
        throw new UploadError('Invalid group set.', 400);
    }
    if (meta.includedMembers != null) {
        if (!Array.isArray(meta.includedMembers) || meta.includedMembers.length > 20 ||
            meta.includedMembers.some(m => typeof m !== 'string')) {
            throw new UploadError('Invalid group members.');
        }
    }
}

// The submission is saved for meta.studentId. A student can only upload for themselves; a lecturer can upload on
// behalf of a student of their own class. The student must be an Active user enrolled in the course, and so must
// every group member, who must also be in the student's group. `user` is null when the sign-in gate is off.
async function verifyUploader(env, meta, user = null) {
    if (user) {
        if (user.role === 'lecturer') {
            const own = await env.DB.prepare('SELECT 1 AS ok FROM Courses WHERE Course_ID = ? AND Lecturer_ID = ?')
                .bind(meta.courseId, user.id).first();
            if (!own) throw new UploadError('You can only upload for students in your own classes.', 403);
        } else if (meta.studentId !== user.id) {
            throw new UploadError('You can only upload your own submissions.', 403);
        }
    }

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

    if (ids.length > 1) {
        const byId = await groupNameIn(env, meta.courseId, meta.groupSetId || REPORTING, ids);
        const groupName = byId.get(meta.studentId);
        if (!groupName || ids.some(id => byId.get(id) !== groupName)) {
            throw new UploadError('Group members must be in the same group as the student.', 403);
        }
    }
}

// Validates the chunk details sent in the X-Chunk-Meta header.
function validateChunkMeta(info, maxChunks) {
    const { uploadId, index, total } = info || {};
    if (!/^[A-Za-z0-9-]{8,64}$/.test(String(uploadId || '')) ||
        !Number.isInteger(index) || !Number.isInteger(total) ||
        total < 1 || total > maxChunks || index < 0 || index >= total) {
        throw new UploadError('Invalid chunk details.');
    }
    return { uploadId, index, total };
}

const MAX_UPLOAD_CHUNKS = 10; // keep in sync with gas/Code.gs
const MAX_LEGACY_JSON_BYTES = 8 * 1024 * 1024; // old whole-JSON upload path (small files only)

// ---- Submission upload helpers -------------------------------------------------
// Streams  prefix + <client request body, untouched> + suffix  to Google Apps Script.
// The (large) base64 body is never decoded or parsed in the Worker, which keeps CPU
// and memory use tiny and fits the free plan.
async function streamToGas(env, request, prefix, suffix, maxBytes) {
    if (!request.body) {
        throw new Error("Upload body is missing.");
    }

    // Browsers send Content-Length, so the body can be piped straight through.
    // If it is missing, fall back to buffering the bytes (still no decoding/parsing).
    let contentLength = parseInt(request.headers.get('Content-Length') || '', 10);
    let buffered = null;
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
        buffered = new Uint8Array(await request.arrayBuffer());
        contentLength = buffered.byteLength;
    }
    if (contentLength <= 0) {
        throw new Error("Upload body is empty.");
    }
    if (maxBytes && contentLength > maxBytes) {
        throw new UploadError(`File is too large. Maximum upload is ${Math.round(maxBytes / (1024 * 1024))} MB per request.`, 413);
    }

    const encoder = new TextEncoder();
    const pre = encoder.encode(prefix);
    const suf = encoder.encode(suffix);

    const { readable, writable } = new FixedLengthStream(pre.length + contentLength + suf.length);
    const writer = writable.getWriter();
    const pump = (async () => {
        await writer.write(pre);
        if (buffered) {
            await writer.write(buffered);
        } else {
            const reader = request.body.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                await writer.write(value);
            }
        }
        await writer.write(suf);
        await writer.close();
    })();
    pump.catch(() => {});

    return callGas(env, readable);
}

// Saves the Submissions row(s) after the file reached Drive.
async function recordSubmission(env, body, fileUrl, user = null) {
    const isGroup = body.isGroup;
    const includedMembers = body.includedMembers || [];

    const uploader = await env.DB.prepare("SELECT Name FROM Users WHERE User_ID = ?").bind(body.studentId).first();
    const uploaderName = uploader ? uploader.Name : "Student";

    let memberNames = [];
    if (isGroup && includedMembers.length > 0) {
        const placeholders = includedMembers.map(() => '?').join(',');
        const mems = await env.DB.prepare(`SELECT Name FROM Users WHERE User_ID IN (${placeholders})`).bind(...includedMembers).all();
        memberNames = mems.results.map(m => m.Name);
    }

    let finalDescription = body.description;
    if (isGroup) {
        const allGroupText = memberNames.length > 0 ? memberNames.join(', ') : 'None';
        finalDescription = `${body.description}\n\n[Group Upload by: ${uploaderName}]\n[Included Members: ${allGroupText}]`;
    }

    // A lecturer uploading for a student is recorded in the description, so the student can see who uploaded it.
    if (user && user.role === 'lecturer') {
        const lec = await env.DB.prepare("SELECT Name FROM Users WHERE User_ID = ?").bind(user.id).first();
        finalDescription = `${finalDescription}\n\n[Uploaded by lecturer: ${lec ? lec.Name : 'Lecturer'}]`;
    }

    const subId = crypto.randomUUID();
    await env.DB.prepare(
        `INSERT INTO Submissions (Submission_ID, Course_ID, Student_ID, Term, Title, Description, Type, File_URL, Timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(subId, body.courseId, body.studentId, body.term, body.title, finalDescription, body.type, fileUrl).run();

    if (isGroup && includedMembers.length > 0) {
        const statements = [];
        for (const memberId of includedMembers) {
            const mSubId = crypto.randomUUID();
            statements.push(
                env.DB.prepare(
                    `INSERT INTO Submissions (Submission_ID, Course_ID, Student_ID, Term, Title, Description, Type, File_URL, Timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
                ).bind(mSubId, body.courseId, memberId, body.term, body.title, finalDescription, body.type, fileUrl)
            );
        }
        await env.DB.batch(statements);
    }
}

// Returns a Response when the request is handled here, otherwise null.
export async function handleUploads(request, env, path, url, corsHeaders, user = null) {
    if (request.method === "POST" && path === "/api/upload-submission") {
        try {
            const metaHeader = request.headers.get("X-Submission-Meta");
            let body, gasData;

            if (metaHeader) {
                // New path: metadata in a header, raw base64 file in the body (streamed, never parsed here).
                checkContentLength(request, MAX_SINGLE_BODY_BYTES);
                body = JSON.parse(decodeURIComponent(metaHeader));
                validateMeta(body);
                await verifyUploader(env, body, user);

                const gasMeta = JSON.stringify({
                    filename: body.filename,
                    mimeType: body.mimeType,
                    pathParts: body.pathParts || []
                });
                const prefix = gasMeta.slice(0, -1) + ',"base64":"';
                gasData = await streamToGas(env, request, prefix, '"}', MAX_SINGLE_BODY_BYTES);
            } else {
                // Legacy path: whole payload as JSON (small files only).
                checkContentLength(request, MAX_LEGACY_JSON_BYTES);
                body = await request.json();
                validateMeta(body);
                await verifyUploader(env, body, user);
                gasData = await callGas(env, JSON.stringify(body));
            }

            await recordSubmission(env, body, gasData.fileUrl, user);
            return new Response(JSON.stringify({ success: true, fileUrl: gasData.fileUrl }), { status: 201, headers: corsHeaders });
        } catch (err) {
            const msg = err && err.message ? err.message : "Upload failed.";
            const status = err instanceof UploadError ? err.status : 500;
            return new Response(JSON.stringify({ error: msg }), { status, headers: corsHeaders });
        }
    }

    // Large files: the browser sends the base64 text in pieces (each piece is streamed to
    // Google Drive untouched), then asks the Worker to join them and record the submission.
    if (request.method === "POST" && path === "/api/upload-chunk") {
        try {
            const metaHeader = request.headers.get("X-Chunk-Meta");
            if (!metaHeader) {
                return new Response(JSON.stringify({ error: "Missing X-Chunk-Meta header." }), { status: 400, headers: corsHeaders });
            }
            checkContentLength(request, MAX_CHUNK_BODY_BYTES);
            const info = JSON.parse(decodeURIComponent(metaHeader));
            const { uploadId, index, total } = validateChunkMeta(info, MAX_UPLOAD_CHUNKS);

            if (!info.courseId || !info.studentId) {
                throw new UploadError("Missing course or student.");
            }
            await verifyUploader(env, { courseId: info.courseId, studentId: info.studentId }, user);

            const prefix = JSON.stringify({ action: "chunk", uploadId, index, total }).slice(0, -1) + ',"data":"';
            await streamToGas(env, request, prefix, '"}', MAX_CHUNK_BODY_BYTES);
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
        } catch (err) {
            const status = err instanceof UploadError ? err.status : 500;
            return new Response(JSON.stringify({ error: err && err.message ? err.message : "Chunk upload failed." }), { status, headers: corsHeaders });
        }
    }

    if (request.method === "POST" && path === "/api/finish-chunked-upload") {
        try {
            const body = await request.json();
            const total = body.total;
            if (!/^[A-Za-z0-9-]{8,64}$/.test(String(body.uploadId || "")) ||
                !Number.isInteger(total) || total < 1 || total > MAX_UPLOAD_CHUNKS) {
                return new Response(JSON.stringify({ error: "Invalid upload details." }), { status: 400, headers: corsHeaders });
            }
            validateMeta(body);
            await verifyUploader(env, body, user);

            const gasData = await callGas(env, JSON.stringify({
                action: "finish",
                uploadId: body.uploadId,
                total,
                filename: body.filename,
                mimeType: body.mimeType,
                pathParts: body.pathParts || []
            }));
            await recordSubmission(env, body, gasData.fileUrl, user);
            return new Response(JSON.stringify({ success: true, fileUrl: gasData.fileUrl }), { status: 201, headers: corsHeaders });
        } catch (err) {
            const status = err instanceof UploadError ? err.status : 500;
            return new Response(JSON.stringify({ error: err && err.message ? err.message : "Upload failed." }), { status, headers: corsHeaders });
        }
    }

    if (request.method === "POST" && path === "/api/grade-submission") {
        const body = await request.json();
        const { submissionId, fileUrl, gradeNarrative, gradeIndividual, gradeReport } = body;

        if (!submissionId) {
            return new Response(JSON.stringify({ error: "Missing submissionId" }), { status: 400, headers: corsHeaders });
        }

        if (fileUrl) {
            await env.DB.prepare(
                `UPDATE Submissions SET Grade_Narrative = ?, Grade_Individual = ?, Grade_Report = ? WHERE File_URL = ?`
            ).bind(gradeNarrative, gradeIndividual, gradeReport, fileUrl).run();
        } else {
            await env.DB.prepare(
                `UPDATE Submissions SET Grade_Narrative = ?, Grade_Individual = ?, Grade_Report = ? WHERE Submission_ID = ?`
            ).bind(gradeNarrative, gradeIndividual, gradeReport, submissionId).run();
        }

        return new Response(JSON.stringify({ success: true, message: "Grade saved successfully" }), { status: 200, headers: corsHeaders });
    }

    return null;
}

