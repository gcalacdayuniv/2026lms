// worker/attendance-dates.js
// Attendance date management: list, change, delete and merge dates that have records.
// Also exports a timezone-aware "today" helper so the server never falls back to UTC.

const DEFAULT_TIMEZONE = 'Asia/Manila';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Status priority when merging two records for the same student (higher wins).
const STATUS_PRIORITY = { Absent: 4, Late: 3, Excused: 2, Present: 1 };

// Returns YYYY-MM-DD for "today" in the visitor's timezone (Cloudflare supplies it),
// falling back to Asia/Manila. Never uses the UTC date.
export function getRequestDate(request) {
    const requested = request && request.cf && request.cf.timezone;
    const zones = [requested, DEFAULT_TIMEZONE];
    for (const timeZone of zones) {
        if (!timeZone) continue;
        try {
            return new Intl.DateTimeFormat('en-CA', {
                timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
            }).format(new Date());
        } catch (e) {
            // Invalid timezone name: try the next one.
        }
    }
    return new Date().toISOString().split('T')[0];
}

const json = (corsHeaders, body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: corsHeaders });

const pickStatus = (a, b) =>
    (STATUS_PRIORITY[a] || 0) >= (STATUS_PRIORITY[b] || 0) ? a : b;

const insertStmt = (env, courseId, studentId, date, status, points) =>
    env.DB.prepare(
        "INSERT INTO Attendance (Attendance_ID, Course_ID, Student_ID, Date, Status, Performance_Points) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), courseId, studentId, date, status, points);

// Returns a Response when the request is handled here, otherwise null.
export async function handleAttendanceDates(request, env, path, url, corsHeaders) {
    if (!path.startsWith('/api/attendance-dates')) return null;
    const method = request.method;

    // List every date that has records for a course.
    if (method === 'GET' && path === '/api/attendance-dates') {
        const courseId = url.searchParams.get('courseId');
        if (!courseId) return json(corsHeaders, { error: 'Missing courseId' }, 400);

        const rows = await env.DB.prepare(
            `SELECT Date,
                    COUNT(*) AS Total,
                    SUM(CASE WHEN Status = 'Present' THEN 1 ELSE 0 END) AS Present,
                    SUM(CASE WHEN Status = 'Late' THEN 1 ELSE 0 END) AS Late,
                    SUM(CASE WHEN Status = 'Excused' THEN 1 ELSE 0 END) AS Excused,
                    SUM(CASE WHEN Status = 'Absent' THEN 1 ELSE 0 END) AS Absent,
                    SUM(COALESCE(Performance_Points, 0)) AS Points
             FROM Attendance WHERE Course_ID = ?
             GROUP BY Date ORDER BY Date DESC`
        ).bind(courseId).all();

        const noClass = await env.DB.prepare(
            "SELECT Date FROM Course_Sessions WHERE Course_ID = ? AND Is_No_Class = 1"
        ).bind(courseId).all();
        const noClassDates = new Set((noClass.results || []).map(r => r.Date));

        const dates = (rows.results || []).map(r => ({ ...r, Is_No_Class: noClassDates.has(r.Date) }));
        return json(corsHeaders, { success: true, dates });
    }

    // Change the date of all records on a date.
    if (method === 'POST' && path === '/api/attendance-dates/change') {
        const { courseId, oldDate, newDate } = await request.json();
        if (!courseId || !DATE_RE.test(oldDate || '') || !DATE_RE.test(newDate || '')) {
            return json(corsHeaders, { error: 'Invalid parameters' }, 400);
        }
        if (oldDate === newDate) return json(corsHeaders, { success: true, unchanged: true });

        const source = await env.DB.prepare(
            "SELECT COUNT(*) AS c FROM Attendance WHERE Course_ID = ? AND Date = ?"
        ).bind(courseId, oldDate).first();
        if (!source || !source.c) return json(corsHeaders, { error: 'No records found on that date.' }, 404);

        const target = await env.DB.prepare(
            "SELECT COUNT(*) AS c FROM Attendance WHERE Course_ID = ? AND Date = ?"
        ).bind(courseId, newDate).first();
        if (target && target.c > 0) {
            return json(corsHeaders, {
                error: 'The new date already has records. Use Merge instead.',
                code: 'DATE_HAS_RECORDS'
            }, 409);
        }

        const noClass = await env.DB.prepare(
            "SELECT Session_ID FROM Course_Sessions WHERE Course_ID = ? AND Date = ? AND Is_No_Class = 1"
        ).bind(courseId, newDate).first();
        if (noClass) {
            return json(corsHeaders, { error: 'The new date is marked as No Class.', code: 'NO_CLASS_DATE' }, 409);
        }

        await env.DB.prepare(
            "UPDATE Attendance SET Date = ? WHERE Course_ID = ? AND Date = ?"
        ).bind(newDate, courseId, oldDate).run();

        return json(corsHeaders, { success: true });
    }

    // Delete all records on a date.
    if (method === 'DELETE' && path === '/api/attendance-dates') {
        const { courseId, date } = await request.json();
        if (!courseId || !DATE_RE.test(date || '')) {
            return json(corsHeaders, { error: 'Invalid parameters' }, 400);
        }
        await env.DB.prepare(
            "DELETE FROM Attendance WHERE Course_ID = ? AND Date = ?"
        ).bind(courseId, date).run();
        return json(corsHeaders, { success: true });
    }

    // Merge two dates into one. Points are added; status priority is Absent > Late > Excused > Present.
    if (method === 'POST' && path === '/api/attendance-dates/merge') {
        const { courseId, dateA, dateB, keepDate } = await request.json();
        if (!courseId || !DATE_RE.test(dateA || '') || !DATE_RE.test(dateB || '') || dateA === dateB) {
            return json(corsHeaders, { error: 'Two different dates are required.' }, 400);
        }
        if (keepDate !== dateA && keepDate !== dateB) {
            return json(corsHeaders, { error: 'keepDate must be one of the two dates.' }, 400);
        }

        const rows = await env.DB.prepare(
            `SELECT Student_ID, Date, Status, Performance_Points
             FROM Attendance WHERE Course_ID = ? AND Date IN (?, ?)`
        ).bind(courseId, dateA, dateB).all();

        const merged = new Map();
        for (const r of (rows.results || [])) {
            const points = parseInt(r.Performance_Points, 10) || 0;
            const existing = merged.get(r.Student_ID);
            if (!existing) {
                merged.set(r.Student_ID, { status: r.Status, points });
            } else {
                existing.status = pickStatus(existing.status, r.Status);
                existing.points += points;
            }
        }
        if (merged.size === 0) return json(corsHeaders, { error: 'No records to merge.' }, 404);

        const statements = [
            env.DB.prepare("DELETE FROM Attendance WHERE Course_ID = ? AND Date IN (?, ?)")
                .bind(courseId, dateA, dateB)
        ];
        for (const [studentId, v] of merged) {
            statements.push(insertStmt(env, courseId, studentId, keepDate, v.status, v.points));
        }
        await env.DB.batch(statements);

        return json(corsHeaders, { success: true, merged: merged.size, keepDate });
    }

    return null;
}
