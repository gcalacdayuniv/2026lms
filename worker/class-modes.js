// worker/class-modes.js
// A class day is Onsite (the default, no row) or Online. An online day can carry one proof picture (a screenshot of the video meeting)
// kept in Google Drive; only the class's lecturer can see it. Students only see whether a day was online.
//   GET  /api/class-modes?courseId             -> { modes: [{ date, mode, hasProof }] }   (lecturer or enrolled student)
//   POST /api/class-mode        { courseId, date, mode }               (lecturer: 'online' | 'onsite')
//   POST /api/class-mode-proof  { courseId, date, base64, mimeType }   (lecturer: sets the day online and stores the picture)
//   GET  /api/class-mode-proof?courseId&date                           (lecturer: the picture)
import { json } from './http.js';
import { callGas } from './gas.js';
import { ensureClassModes } from './schema.js';

const PROOF_MAX_B64 = 1500000;     // about 1.1 MB, under the 2 MB the auth gate reads to check the course owner; the app sends a picture shrunk to 1280 px
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));

export async function handleClassModes(request, env, path, url, corsHeaders) {
    if (path !== '/api/class-modes' && path !== '/api/class-mode' && path !== '/api/class-mode-proof') return null;
    await ensureClassModes(env);

    if (request.method === 'GET' && path === '/api/class-modes') {
        const courseId = url.searchParams.get('courseId');
        if (!courseId) return json(corsHeaders, { error: 'Missing parameters' }, 400);
        const rows = await env.DB.prepare("SELECT Date, Mode, Proof_File_ID FROM Class_Modes WHERE Course_ID = ? AND Mode = 'online' ORDER BY Date DESC").bind(courseId).all();
        return json(corsHeaders, { success: true, modes: (rows.results || []).map(r => ({ date: r.Date, mode: r.Mode, hasProof: !!r.Proof_File_ID })) });
    }

    if (request.method === 'POST' && path === '/api/class-mode') {
        const { courseId, date, mode } = await request.json();
        if (!courseId || !isDate(date) || !['online', 'onsite'].includes(mode)) return json(corsHeaders, { error: 'Missing or invalid details.' }, 400);
        if (mode === 'onsite') await env.DB.prepare("DELETE FROM Class_Modes WHERE Course_ID = ? AND Date = ?").bind(courseId, date).run();
        else {
            await env.DB.prepare("INSERT INTO Class_Modes (Course_ID, Date, Mode, Updated_At) VALUES (?, ?, 'online', ?) ON CONFLICT(Course_ID, Date) DO UPDATE SET Mode = 'online', Updated_At = excluded.Updated_At")
                .bind(courseId, date, new Date().toISOString()).run();
        }
        return json(corsHeaders, { success: true });
    }

    if (request.method === 'POST' && path === '/api/class-mode-proof') {
        const { courseId, date, base64, mimeType } = await request.json();
        if (!courseId || !isDate(date)) return json(corsHeaders, { error: 'Missing or invalid details.' }, 400);
        if (typeof base64 !== 'string' || base64.length < 200 || base64.length > PROOF_MAX_B64) return json(corsHeaders, { error: 'The picture is missing or too large.' }, 400);
        const mime = /^image\/(jpeg|png|webp)$/.test(String(mimeType || '')) ? mimeType : 'image/jpeg';
        const gas = await callGas(env, JSON.stringify({
            filename: `${date}_online-class-${Date.now()}.${mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}`,
            mimeType: mime,
            base64,
            pathParts: ['Online Class Proof', courseId]
        }));
        if (!gas.fileId) throw new Error('Google Drive did not return a file id.');
        await env.DB.prepare("INSERT INTO Class_Modes (Course_ID, Date, Mode, Proof_File_ID, Updated_At) VALUES (?, ?, 'online', ?, ?) ON CONFLICT(Course_ID, Date) DO UPDATE SET Mode = 'online', Proof_File_ID = excluded.Proof_File_ID, Updated_At = excluded.Updated_At")
            .bind(courseId, date, gas.fileId, new Date().toISOString()).run();
        return json(corsHeaders, { success: true }, 201);
    }

    if (request.method === 'GET' && path === '/api/class-mode-proof') {
        const courseId = url.searchParams.get('courseId');
        const date = url.searchParams.get('date');
        if (!courseId || !isDate(date)) return json(corsHeaders, { error: 'Missing parameters' }, 400);
        const row = await env.DB.prepare("SELECT Proof_File_ID FROM Class_Modes WHERE Course_ID = ? AND Date = ?").bind(courseId, date).first();
        if (!row || !row.Proof_File_ID) return json(corsHeaders, { error: 'No proof picture for this day.' }, 404);
        const gas = await callGas(env, JSON.stringify({ action: 'read', fileId: row.Proof_File_ID }));
        if (!gas.base64) throw new Error('Google Drive did not return the picture.');
        return json(corsHeaders, { success: true, mimeType: gas.mimeType || 'image/jpeg', base64: gas.base64 });
    }

    return json(corsHeaders, { error: 'Not Found' }, 404);
}
