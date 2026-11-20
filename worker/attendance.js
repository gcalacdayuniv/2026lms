// worker/attendance.js
// Attendance routes: the day's attendance (read, save the whole day, save one student), participation points,
// no-class days, and the attendance-dates tools (list, change, delete, merge dates).
// worker.js calls handleAttendance() for every request after the permission check; it returns a Response when
// the path is one of these routes, or null so worker.js carries on with the other routes.

import { json } from './http.js';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Status priority when merging two records for the same student (higher wins).
const STATUS_PRIORITY = { Absent: 4, Late: 3, Excused: 2, Present: 1 };

const pickStatus = (a, b) =>
    (STATUS_PRIORITY[a] || 0) >= (STATUS_PRIORITY[b] || 0) ? a : b;

const insertStmt = (env, courseId, studentId, date, status, points) =>
    env.DB.prepare(
        "INSERT INTO Attendance (Attendance_ID, Course_ID, Student_ID, Date, Status, Performance_Points) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), courseId, studentId, date, status, points);

// One student's attendance for one date: update the saved row, or add it when there is none; an empty status clears it.
function upsertAttendance(env, courseId, studentId, date, status, points) {
    if (!status) {
        return [env.DB.prepare("DELETE FROM Attendance WHERE Course_ID = ? AND Student_ID = ? AND Date = ?").bind(courseId, studentId, date)];
    }
    const pts = Number(points) || 0;
    return [
        env.DB.prepare("UPDATE Attendance SET Status = ?, Performance_Points = ? WHERE Course_ID = ? AND Student_ID = ? AND Date = ?")
            .bind(status, pts, courseId, studentId, date),
        env.DB.prepare(
            `INSERT INTO Attendance (Attendance_ID, Course_ID, Student_ID, Date, Status, Performance_Points)
             SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM Attendance WHERE Course_ID = ? AND Student_ID = ? AND Date = ?)`
        ).bind(crypto.randomUUID(), courseId, studentId, date, status, pts, courseId, studentId, date)
    ];
}

// Returns a Response when the request is handled here, otherwise null.
async function handleAttendanceDates(request, env, path, url, corsHeaders) {
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

export async function handleAttendance(request, env, path, url, corsHeaders) {
    const attendanceDatesResponse = await handleAttendanceDates(request, env, path, url, corsHeaders);
    if (attendanceDatesResponse) return attendanceDatesResponse;

    if (request.method === "GET" && path === "/api/no-class") {
        const courseId = url.searchParams.get("courseId");
        const sessions = await env.DB.prepare(
            "SELECT Date FROM Course_Sessions WHERE Course_ID = ? AND Is_No_Class = 1 ORDER BY Date DESC"
        ).bind(courseId).all();
        return new Response(JSON.stringify({ success: true, dates: sessions.results }), { status: 200, headers: corsHeaders });
    }

    if (request.method === "POST" && path === "/api/no-class") {
        const body = await request.json();
        const { courseId, date } = body;

        if (!courseId || !date) {
            return new Response(JSON.stringify({ error: "Missing parameters" }), { status: 400, headers: corsHeaders });
        }

        const existing = await env.DB.prepare("SELECT Session_ID FROM Course_Sessions WHERE Course_ID = ? AND Date = ?").bind(courseId, date).first();
        if (!existing) {
            const sessionId = crypto.randomUUID();
            await env.DB.prepare("INSERT INTO Course_Sessions (Session_ID, Course_ID, Date, Is_No_Class) VALUES (?, ?, ?, 1)").bind(sessionId, courseId, date).run();

            await env.DB.prepare("DELETE FROM Attendance WHERE Course_ID = ? AND Date = ?").bind(courseId, date).run();
        }

        return new Response(JSON.stringify({ success: true }), { status: 201, headers: corsHeaders });
    }

    if (request.method === "DELETE" && path === "/api/no-class") {
        const body = await request.json();
        const { courseId, date } = body;

        await env.DB.prepare("DELETE FROM Course_Sessions WHERE Course_ID = ? AND Date = ? AND Is_No_Class = 1").bind(courseId, date).run();

        return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
    }

    if (request.method === "GET" && path === "/api/attendance") {
        const courseId = url.searchParams.get("courseId");
        const date = url.searchParams.get("date");

        if (!courseId || !date) {
            return new Response(JSON.stringify({ error: "Missing parameters" }), { status: 400, headers: corsHeaders });
        }

        const session = await env.DB.prepare(
            "SELECT Is_No_Class FROM Course_Sessions WHERE Course_ID = ? AND Date = ?"
        ).bind(courseId, date).first();

        const isNoClass = session ? session.Is_No_Class === 1 : false;

        const records = await env.DB.prepare(
            "SELECT Student_ID, Status, Performance_Points FROM Attendance WHERE Course_ID = ? AND Date = ?"
        ).bind(courseId, date).all();

        return new Response(JSON.stringify({ success: true, records: records.results, isNoClass: isNoClass }), { status: 200, headers: corsHeaders });
    }

    if (request.method === "POST" && path === "/api/attendance") {
        const body = await request.json();
        const { courseId, date, records } = body;

        if (!courseId || !date) {
            return new Response(JSON.stringify({ error: "Invalid payload" }), { status: 400, headers: corsHeaders });
        }

        if (records && Array.isArray(records)) {
            // Per-student update-or-insert in one transaction: a failure leaves the saved day as it was,
            // and students that are not in the list are removed (the list is the whole day).
            const rows = records.filter(r => r && r.studentId);
            const statements = [
                env.DB.prepare("DELETE FROM Attendance WHERE Course_ID = ? AND Date = ? AND Student_ID NOT IN (SELECT value FROM json_each(?))")
                    .bind(courseId, date, JSON.stringify(rows.map(r => String(r.studentId))))
            ];
            for (const r of rows) statements.push(...upsertAttendance(env, courseId, r.studentId, date, r.status, r.points));
            await env.DB.batch(statements);
        }

        return new Response(JSON.stringify({ success: true, message: "Attendance saved" }), { status: 201, headers: corsHeaders });
    }

    if (request.method === "POST" && path === "/api/attendance/single") {
        const body = await request.json();
        const { courseId, studentId, date, status, points } = body;

        if (!courseId || !studentId || !date) {
            return new Response(JSON.stringify({ error: "Missing parameters" }), { status: 400, headers: corsHeaders });
        }

        await env.DB.batch(upsertAttendance(env, courseId, studentId, date, status, points));

        return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
    }

    if (request.method === "POST" && path === "/api/add-participation-points") {
        const body = await request.json();
        const { courseId, studentId, date, points } = body;

        if (!courseId || !studentId || !date || typeof points !== 'number') {
            return new Response(JSON.stringify({ error: "Missing required parameters" }), { status: 400, headers: corsHeaders });
        }

        if (!Number.isFinite(points)) {
            return new Response(JSON.stringify({ error: "Invalid points" }), { status: 400, headers: corsHeaders });
        }

        // Add in one statement so two quick taps cannot overwrite each other.
        const updated = await env.DB.prepare(
            "UPDATE Attendance SET Performance_Points = COALESCE(Performance_Points, 0) + ? WHERE Course_ID = ? AND Student_ID = ? AND Date = ?"
        ).bind(points, courseId, studentId, date).run();

        if (!(updated.meta && updated.meta.changes > 0)) {
            const attId = crypto.randomUUID();
            await env.DB.prepare(
                "INSERT INTO Attendance (Attendance_ID, Course_ID, Student_ID, Date, Status, Performance_Points) VALUES (?, ?, ?, ?, 'Present', ?)"
            ).bind(attId, courseId, studentId, date, points).run();
        }

        return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
    }

    return null;
}
