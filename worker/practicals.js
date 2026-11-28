// worker/practicals.js
// Practical / major-term activity grading (Student Caller > Grade). Lecturer-only: not listed in auth.js RULES, so
// courseId and assessmentId in the body must belong to the signed-in lecturer. Notes never leave these routes (README privacy rules).
//   GET  /api/practical-grades?courseId=&activity=   saved grades of a class (one activity, or all)
//   POST /api/practical-grade-save                   one student or a whole group, each with a score and a note; optionally copied to an assessment
import { ensurePracticals } from './schema.js';

const MAX_SCORE_ENTRY = 100000;
const reply = (corsHeaders, status, body) => new Response(JSON.stringify(body), { status, headers: corsHeaders });
const clean = (v, max) => (v == null ? '' : String(v)).trim().slice(0, max);
const secs = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 && n <= 86400 ? n : null; };

export async function handlePracticals(request, env, path, url, corsHeaders) {
    if (path !== '/api/practical-grades' && path !== '/api/practical-grade-save') return null;
    await ensurePracticals(env);

    if (request.method === 'GET' && path === '/api/practical-grades') {
        const courseId = url.searchParams.get('courseId');
        if (!courseId) return reply(corsHeaders, 400, { error: 'Missing courseId' });
        const activity = clean(url.searchParams.get('activity'), 80);
        const rows = await env.DB.prepare(
            `SELECT p.Activity, p.Student_ID, u.Name, p.Score, p.Max_Score, p.Notes, p.Set_ID, p.Group_Name, p.Timer_Seconds, p.Elapsed_Seconds, p.Assessment_ID, p.Updated_At
             FROM Practical_Grades p LEFT JOIN Users u ON u.User_ID = p.Student_ID
             WHERE p.Course_ID = ? ${activity ? 'AND p.Activity = ?' : ''} ORDER BY p.Updated_At DESC LIMIT 500`
        ).bind(...(activity ? [courseId, activity] : [courseId])).all();
        return reply(corsHeaders, 200, { success: true, grades: rows.results || [] });
    }

    if (request.method === 'POST' && path === '/api/practical-grade-save') {
        const b = await request.json();
        const courseId = clean(b.courseId, 80), activity = clean(b.activity, 80);
        const entries = Array.isArray(b.entries) ? b.entries : [];
        if (!courseId || !activity) return reply(corsHeaders, 400, { error: 'Give the activity a name.' });
        if (!entries.length || entries.length > 200) return reply(corsHeaders, 400, { error: 'Choose at least one student to grade.' });

        const max = b.maxScore === '' || b.maxScore == null ? null : Number(b.maxScore);
        if (max !== null && (!Number.isFinite(max) || max < 0 || max > MAX_SCORE_ENTRY)) return reply(corsHeaders, 400, { error: 'Invalid maximum score.' });

        // Students must be enrolled in this class.
        const ids = [...new Set(entries.map(e => String(e.studentId || '')))];
        const enrolled = new Set(((await env.DB.prepare(`SELECT Student_ID FROM Enrollments WHERE Course_ID = ? AND Student_ID IN (${ids.map(() => '?').join(',')})`).bind(courseId, ...ids).all()).results || []).map(r => r.Student_ID));
        const rows = [];
        for (const e of entries) {
            const score = e.score === '' || e.score == null ? null : Number(e.score);
            if (!enrolled.has(String(e.studentId))) return reply(corsHeaders, 400, { error: 'A student is not in this class.' });
            if (score !== null && (!Number.isFinite(score) || score < 0 || score > MAX_SCORE_ENTRY)) return reply(corsHeaders, 400, { error: `Invalid score. Scores must be 0 or more (up to ${MAX_SCORE_ENTRY}).` });
            rows.push({ id: String(e.studentId), score, notes: clean(e.notes, 2000) });
        }

        const setId = clean(b.setId, 80) || null;
        if (setId && setId !== 'reporting') {
            const ok = await env.DB.prepare('SELECT 1 AS ok FROM Group_Sets WHERE Set_ID = ? AND Course_ID = ?').bind(setId, courseId).first();
            if (!ok) return reply(corsHeaders, 400, { error: 'That group set is not in this class.' });
        }
        const assessmentId = clean(b.assessmentId, 80) || null;
        if (assessmentId) {
            const ok = await env.DB.prepare('SELECT 1 AS ok FROM Assessments WHERE Assessment_ID = ? AND Course_ID = ?').bind(assessmentId, courseId).first();
            if (!ok) return reply(corsHeaders, 400, { error: 'That assessment is not in this class.' });
        }

        const groupName = clean(b.groupName, 80) || null, timer = secs(b.timerSeconds), elapsed = secs(b.elapsedSeconds);
        const st = [];
        for (const r of rows) {
            st.push(env.DB.prepare(
                `INSERT INTO Practical_Grades (Grade_ID, Course_ID, Activity, Student_ID, Score, Max_Score, Notes, Set_ID, Group_Name, Timer_Seconds, Elapsed_Seconds, Assessment_ID, Updated_At)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT (Course_ID, Activity, Student_ID) DO UPDATE SET Score = excluded.Score, Max_Score = excluded.Max_Score, Notes = excluded.Notes, Set_ID = excluded.Set_ID,
                   Group_Name = excluded.Group_Name, Timer_Seconds = excluded.Timer_Seconds, Elapsed_Seconds = excluded.Elapsed_Seconds, Assessment_ID = excluded.Assessment_ID, Updated_At = CURRENT_TIMESTAMP`
            ).bind(crypto.randomUUID(), courseId, activity, r.id, r.score, max, r.notes, setId, groupName, timer, elapsed, assessmentId));
            // Copy to the chosen assessment: only these students change, like Record Scores with "partial".
            if (assessmentId && r.score !== null) {
                st.push(env.DB.prepare('DELETE FROM Assessment_Scores WHERE Assessment_ID = ? AND Student_ID = ?').bind(assessmentId, r.id));
                st.push(env.DB.prepare('INSERT INTO Assessment_Scores (Score_ID, Assessment_ID, Student_ID, Score) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), assessmentId, r.id, r.score));
            }
        }
        await env.DB.batch(st);
        return reply(corsHeaders, 200, { success: true, saved: rows.length, copied: assessmentId ? rows.filter(r => r.score !== null).length : 0 });
    }
    return null;
}
