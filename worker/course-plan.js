// worker/course-plan.js
// A class's syllabus file and its course learning plan (the table in the syllabus: time allotment, course contents, essential
// questions, intended learning outcomes, teaching-learning activities, assessment tasks, references), and the links from a
// calendar date to the plan topics taught that day. A day can have no topic (a quiz or exam day), one, or several; a topic can
// be taught over several days. Lecturer-only: every route sends the courseId, which the auth gate checks against the lecturer.
import { json } from './http.js';
import { callGas } from './gas.js';
import { ensureCoursePlan } from './schema.js';

const SYLLABUS_MAX_B64 = 6000000;       // about 4.5 MB of file
const SYLLABUS_TYPES = { 'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'image/jpeg': 'jpg', 'image/png': 'png' };
const FIELDS = [['time', 'Time_Allot', 120], ['contents', 'Contents', 4000], ['questions', 'Questions', 4000], ['outcomes', 'Outcomes', 4000], ['activities', 'Activities', 4000], ['assessments', 'Assessments', 2000], ['refs', 'Refs', 6000]];
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
const clean = (v, max) => String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, max);

const ROUTES = new Set(['/api/course-plan', '/api/plan-topic', '/api/plan-topic-delete', '/api/plan-topic-move', '/api/plan-quick-add', '/api/plan-day', '/api/course-syllabus', '/api/course-syllabus-delete']);

export async function handleCoursePlan(request, env, path, url, corsHeaders, user) {
    if (!ROUTES.has(path)) return null;
    await ensureCoursePlan(env);
    const q = url.searchParams;
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const courseId = String(body.courseId || q.get('courseId') || '');
    if (!courseId) return json(corsHeaders, { error: 'Missing parameters' }, 400);
    // The auth gate only reads bodies up to 2 MB, so the owner is checked here as well (the syllabus file can be larger).
    const course = await env.DB.prepare("SELECT Lecturer_ID FROM Courses WHERE Course_ID = ?").bind(courseId).first();
    if (!course) return json(corsHeaders, { error: 'Class not found.' }, 404);
    if (user && course.Lecturer_ID !== user.id) return json(corsHeaders, { error: 'This belongs to another lecturer.' }, 403);

    const topicOk = async (topicId) => !!(await env.DB.prepare("SELECT 1 AS ok FROM Plan_Topics WHERE Topic_ID = ? AND Course_ID = ?").bind(String(topicId || ''), courseId).first());

    if (request.method === 'GET' && path === '/api/course-plan') {
        const topics = await env.DB.prepare("SELECT * FROM Plan_Topics WHERE Course_ID = ? ORDER BY Sort_Order, Topic_ID").bind(courseId).all();
        const links = await env.DB.prepare("SELECT Topic_ID, Date FROM Plan_Day_Links WHERE Course_ID = ? ORDER BY Date").bind(courseId).all();
        const syl = await env.DB.prepare("SELECT File_Name, Mime_Type, Updated_At FROM Course_Syllabus WHERE Course_ID = ?").bind(courseId).first();
        const byTopic = new Map();
        (links.results || []).forEach(l => { if (!byTopic.has(l.Topic_ID)) byTopic.set(l.Topic_ID, []); byTopic.get(l.Topic_ID).push(l.Date); });
        return json(corsHeaders, {
            success: true,
            syllabus: syl ? { name: syl.File_Name, mimeType: syl.Mime_Type, updatedAt: syl.Updated_At } : null,
            topics: (topics.results || []).map(t => ({
                topicId: t.Topic_ID, time: t.Time_Allot || '', contents: t.Contents || '', questions: t.Questions || '', outcomes: t.Outcomes || '',
                activities: t.Activities || '', assessments: t.Assessments || '', refs: t.Refs || '', dates: byTopic.get(t.Topic_ID) || []
            }))
        });
    }

    if (request.method === 'POST' && path === '/api/plan-topic') {
        const values = FIELDS.map(([key, , max]) => clean(body[key], max));
        if (!values[0] && !values[1]) return json(corsHeaders, { error: 'Give the topic a time allotment or course contents.' }, 400);
        const now = new Date().toISOString();
        if (body.topicId) {
            if (!(await topicOk(body.topicId))) return json(corsHeaders, { error: 'Topic not found.' }, 404);
            await env.DB.prepare(`UPDATE Plan_Topics SET ${FIELDS.map(([, col]) => col + ' = ?').join(', ')}, Updated_At = ? WHERE Topic_ID = ? AND Course_ID = ?`)
                .bind(...values, now, String(body.topicId), courseId).run();
            return json(corsHeaders, { success: true, topicId: String(body.topicId) });
        }
        const next = await env.DB.prepare("SELECT COALESCE(MAX(Sort_Order), 0) + 1 AS n FROM Plan_Topics WHERE Course_ID = ?").bind(courseId).first();
        const topicId = crypto.randomUUID();
        await env.DB.prepare(`INSERT INTO Plan_Topics (Topic_ID, Course_ID, Sort_Order, ${FIELDS.map(([, col]) => col).join(', ')}, Updated_At) VALUES (?, ?, ?, ${FIELDS.map(() => '?').join(', ')}, ?)`)
            .bind(topicId, courseId, next.n, ...values, now).run();
        return json(corsHeaders, { success: true, topicId }, 201);
    }

    if (request.method === 'POST' && path === '/api/plan-quick-add') {
        // One topic per line: "Week 3 & 4 | Financial Intermediaries" (the part before | is the time allotment).
        const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, 80)
            .map(l => ({ time: clean(l && l.time, 120), contents: clean(l && l.contents, 4000) }))
            .filter(l => l.time || l.contents);
        if (!lines.length) return json(corsHeaders, { error: 'Nothing to add.' }, 400);
        const first = await env.DB.prepare("SELECT COALESCE(MAX(Sort_Order), 0) AS n FROM Plan_Topics WHERE Course_ID = ?").bind(courseId).first();
        const now = new Date().toISOString();
        await env.DB.batch(lines.map((l, i) => env.DB.prepare("INSERT INTO Plan_Topics (Topic_ID, Course_ID, Sort_Order, Time_Allot, Contents, Updated_At) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(crypto.randomUUID(), courseId, first.n + i + 1, l.time, l.contents, now)));
        return json(corsHeaders, { success: true, added: lines.length }, 201);
    }

    if (request.method === 'POST' && path === '/api/plan-topic-delete') {
        if (!(await topicOk(body.topicId))) return json(corsHeaders, { error: 'Topic not found.' }, 404);
        await env.DB.batch([
            env.DB.prepare("DELETE FROM Plan_Day_Links WHERE Course_ID = ? AND Topic_ID = ?").bind(courseId, String(body.topicId)),
            env.DB.prepare("DELETE FROM Plan_Topics WHERE Course_ID = ? AND Topic_ID = ?").bind(courseId, String(body.topicId))
        ]);
        return json(corsHeaders, { success: true });
    }

    if (request.method === 'POST' && path === '/api/plan-topic-move') {
        const dir = Number(body.dir) < 0 ? -1 : 1;
        const rows = (await env.DB.prepare("SELECT Topic_ID FROM Plan_Topics WHERE Course_ID = ? ORDER BY Sort_Order, Topic_ID").bind(courseId).all()).results || [];
        const i = rows.findIndex(r => r.Topic_ID === String(body.topicId));
        if (i < 0) return json(corsHeaders, { error: 'Topic not found.' }, 404);
        const j = i + dir;
        if (j >= 0 && j < rows.length) { const t = rows[i]; rows[i] = rows[j]; rows[j] = t; }
        await env.DB.batch(rows.map((r, n) => env.DB.prepare("UPDATE Plan_Topics SET Sort_Order = ? WHERE Topic_ID = ? AND Course_ID = ?").bind(n + 1, r.Topic_ID, courseId)));
        return json(corsHeaders, { success: true });
    }

    // Replaces the topics linked to one date (an empty list = a day with no plan topic, for example a quiz or exam day).
    if (request.method === 'POST' && path === '/api/plan-day') {
        if (!isDate(body.date)) return json(corsHeaders, { error: 'Missing or invalid date.' }, 400);
        const ids = [...new Set((Array.isArray(body.topicIds) ? body.topicIds : []).map(String))].slice(0, 20);
        for (const id of ids) if (!(await topicOk(id))) return json(corsHeaders, { error: 'Topic not found.' }, 404);
        await env.DB.batch([
            env.DB.prepare("DELETE FROM Plan_Day_Links WHERE Course_ID = ? AND Date = ?").bind(courseId, body.date),
            ...ids.map(id => env.DB.prepare("INSERT INTO Plan_Day_Links (Course_ID, Date, Topic_ID) VALUES (?, ?, ?)").bind(courseId, body.date, id))
        ]);
        return json(corsHeaders, { success: true, linked: ids.length });
    }

    if (request.method === 'POST' && path === '/api/course-syllabus') {
        const { base64, fileName, mimeType } = body;
        const ext = SYLLABUS_TYPES[String(mimeType || '')];
        if (!ext) return json(corsHeaders, { error: 'Attach a PDF, Word (.docx) or picture file.' }, 400);
        if (typeof base64 !== 'string' || base64.length < 100 || base64.length > SYLLABUS_MAX_B64) return json(corsHeaders, { error: 'The file is missing or larger than 4 MB.' }, 400);
        const name = clean(fileName, 120).replace(/[\\/:*?"<>|]/g, '_') || `syllabus.${ext}`;
        const gas = await callGas(env, JSON.stringify({ filename: `${Date.now()}_${name}`, mimeType, base64, pathParts: ['Syllabus', courseId] }));
        if (!gas.fileId) throw new Error('Google Drive did not return a file id.');
        await env.DB.prepare("INSERT INTO Course_Syllabus (Course_ID, File_ID, File_Name, Mime_Type, Updated_At) VALUES (?, ?, ?, ?, ?) ON CONFLICT(Course_ID) DO UPDATE SET File_ID = excluded.File_ID, File_Name = excluded.File_Name, Mime_Type = excluded.Mime_Type, Updated_At = excluded.Updated_At")
            .bind(courseId, gas.fileId, name, mimeType, new Date().toISOString()).run();
        return json(corsHeaders, { success: true }, 201);
    }

    if (request.method === 'GET' && path === '/api/course-syllabus') {
        const row = await env.DB.prepare("SELECT File_ID, File_Name, Mime_Type FROM Course_Syllabus WHERE Course_ID = ?").bind(courseId).first();
        if (!row) return json(corsHeaders, { error: 'No syllabus is attached to this class.' }, 404);
        const gas = await callGas(env, JSON.stringify({ action: 'read', fileId: row.File_ID }));
        if (!gas.base64) throw new Error('Google Drive did not return the file.');
        return json(corsHeaders, { success: true, name: row.File_Name, mimeType: row.Mime_Type, base64: gas.base64 });
    }

    if (request.method === 'POST' && path === '/api/course-syllabus-delete') {
        await env.DB.prepare("DELETE FROM Course_Syllabus WHERE Course_ID = ?").bind(courseId).run();
        return json(corsHeaders, { success: true });
    }

    return json(corsHeaders, { error: 'Not Found' }, 404);
}
