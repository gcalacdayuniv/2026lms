// worker/seats.js
// Seat Plan: one seat number per student in a class (no duplicates), auto-assignment by eye-condition group then last name,
// and a lock so a seat is not touched by auto-assignment. Lecturer-only routes (courseId is ownership-checked in auth.js).
// worker.js calls handleSeats() after the permission check; it returns a Response for its own paths and null otherwise.

import { ensureSeatLock } from './schema.js';

const json = (data, status, corsHeaders) => new Response(JSON.stringify(data), { status, headers: corsHeaders });
export const seatKey = (v) => String(v == null ? '' : v).trim().toLowerCase();

// Front seats first: Legally Blind, Near Sighted, no condition, then Far Sighted.
export const eyeRank = (eye) => {
    const e = String(eye || '').toLowerCase();
    if (/blind/.test(e)) return 0;
    if (/near/.test(e)) return 1;
    if (/far/.test(e)) return 3;
    return 2;
};

// Order for auto-assignment: eye group, then name ("Last, Given" sorts by last name).
export const seatOrder = (a, b) =>
    eyeRank(a.eye_condition) - eyeRank(b.eye_condition) ||
    String(a.Name || '').localeCompare(String(b.Name || ''), undefined, { sensitivity: 'base' });

// Pure planner: returns [{ studentId, seat }] for the students that get a new seat.
//   mode 'all'      every active, unlocked student is seated again from 1
//   mode 'unseated' only active students without a seat get the lowest free number
// Seats of locked students (and of inactive students) are never reused.
export function planSeats(students, mode) {
    const taken = new Set();
    const movable = [];
    for (const s of students) {
        const active = String(s.account_status || 'Active') !== 'Inactive';
        const hasSeat = seatKey(s.Seat_Number) !== '';
        const locked = Number(s.Seat_Locked) === 1 && hasSeat;
        if (!active || locked) { if (hasSeat) taken.add(seatKey(s.Seat_Number)); continue; }
        if (mode === 'unseated' && hasSeat) { taken.add(seatKey(s.Seat_Number)); continue; }
        movable.push(s);
    }
    movable.sort(seatOrder);
    const out = [];
    let n = 1;
    for (const s of movable) {
        while (taken.has(String(n))) n++;
        out.push({ studentId: s.User_ID, seat: String(n) });
        taken.add(String(n));
    }
    return out;
}

async function roster(env, courseId) {
    const r = await env.DB.prepare(
        `SELECT u.User_ID, u.Name, u.eye_condition, u.account_status, e.Seat_Number, COALESCE(e.Seat_Locked, 0) AS Seat_Locked
         FROM Enrollments e JOIN Users u ON u.User_ID = e.Student_ID WHERE e.Course_ID = ?`
    ).bind(courseId).all();
    return r.results || [];
}

const seatsOf = (rows) => rows.map(s => ({ studentId: s.User_ID, seat: s.Seat_Number || '', locked: Number(s.Seat_Locked) === 1 && !!seatKey(s.Seat_Number) }));

export async function handleSeats(request, env, path, url, corsHeaders) {
    if (request.method !== 'POST' || (path !== '/api/set-seat' && path !== '/api/auto-seat')) return null;
    await ensureSeatLock(env);
    const body = await request.json().catch(() => ({}));
    const courseId = body.courseId;
    if (!courseId) return json({ error: 'Missing courseId' }, 400, corsHeaders);
    const rows = await roster(env, courseId);

    if (path === '/api/set-seat') {
        const me = rows.find(s => s.User_ID === body.studentId);
        if (!me) return json({ error: 'Student is not enrolled in this class.' }, 404, corsHeaders);
        const seat = String(body.seat == null ? '' : body.seat).trim().slice(0, 12);
        if (seat) {
            const other = rows.find(s => s.User_ID !== me.User_ID && seatKey(s.Seat_Number) === seatKey(seat));
            if (other) return json({ error: `Seat ${seat} is already taken by ${other.Name}.` }, 409, corsHeaders);
        }
        const locked = seat && body.locked ? 1 : 0;   // an empty seat cannot be locked
        await env.DB.prepare('UPDATE Enrollments SET Seat_Number = ?, Seat_Locked = ? WHERE Course_ID = ? AND Student_ID = ?')
            .bind(seat || null, locked, courseId, me.User_ID).run();
        me.Seat_Number = seat || null; me.Seat_Locked = locked;
        return json({ success: true, seats: seatsOf(rows) }, 200, corsHeaders);
    }

    const mode = body.mode === 'unseated' ? 'unseated' : 'all';
    const plan = planSeats(rows, mode);
    if (plan.length) {
        await env.DB.batch(plan.map(p => env.DB.prepare('UPDATE Enrollments SET Seat_Number = ? WHERE Course_ID = ? AND Student_ID = ?').bind(p.seat, courseId, p.studentId)));
    }
    const done = new Map(plan.map(p => [p.studentId, p.seat]));
    rows.forEach(s => { if (done.has(s.User_ID)) s.Seat_Number = done.get(s.User_ID); });
    return json({ success: true, assigned: plan.length, seats: seatsOf(rows) }, 200, corsHeaders);
}
