// worker/seats.js
// Seat Plan: one seat number per student in a class (no duplicates), auto-assignment by eye-condition group then last name,
// drag/up/down reordering, insert of a new student, and a lock so a seat is not touched by automatic changes.
// Only UD, Dropped and Graduated students get no seat; everybody else (Active, Inactive, Suspended ...) is seated.
// Lecturer-only routes (courseId is ownership-checked in auth.js).
// worker.js calls handleSeats() after the permission check; it returns a Response for its own paths and null otherwise.

import { ensureSeatLock } from './schema.js';

const json = (data, status, corsHeaders) => new Response(JSON.stringify(data), { status, headers: corsHeaders });
export const seatKey = (v) => String(v == null ? '' : v).trim().toLowerCase();

const NO_SEAT = new Set(['ud', 'dropped', 'graduated']);
export const isSeatable = (s) => !NO_SEAT.has(String(s.account_status || 'Active').trim().toLowerCase());

// Front seats first: Legally Blind, Near Sighted, no condition, then Far Sighted.
export const eyeRank = (eye) => {
    const e = String(eye || '').toLowerCase();
    if (/blind/.test(e)) return 0;
    if (/near/.test(e)) return 1;
    if (/far/.test(e)) return 3;
    return 2;
};

const nameCmp = (a, b) => String(a.Name || '').localeCompare(String(b.Name || ''), undefined, { sensitivity: 'base' });

// Order for auto-assignment: eye group, then name ("Last, Given" sorts by last name).
export const seatOrder = (a, b) => eyeRank(a.eye_condition) - eyeRank(b.eye_condition) || nameCmp(a, b);

const isLocked = (s) => Number(s.Seat_Locked) === 1 && seatKey(s.Seat_Number) !== '';
const num = (s) => { const n = parseFloat(s.Seat_Number); return Number.isNaN(n) ? Infinity : n; };

// Seat numbers nobody may take: locked seats and the seats of students who are not seated by the plan.
function fixedSeats(students) {
    const taken = new Set();
    for (const s of students) if ((!isSeatable(s) || isLocked(s)) && seatKey(s.Seat_Number)) taken.add(seatKey(s.Seat_Number));
    return taken;
}

// Gives the students in `ids` (in that order) the lowest free numbers. Locked students keep their seat; students not listed
// keep theirs. Returns [{ studentId, seat }].
export function planOrder(students, ids) {
    const byId = new Map(students.map(s => [s.User_ID, s]));
    const listed = new Set(ids);
    const taken = fixedSeats(students);
    for (const s of students) if (isSeatable(s) && !isLocked(s) && !listed.has(s.User_ID) && seatKey(s.Seat_Number)) taken.add(seatKey(s.Seat_Number));
    const out = [];
    const seen = new Set();
    let n = 1;
    for (const id of ids) {
        const s = byId.get(id);
        if (!s || seen.has(id) || !isSeatable(s) || isLocked(s)) continue;
        seen.add(id);
        while (taken.has(String(n))) n++;
        out.push({ studentId: id, seat: String(n) });
        taken.add(String(n));
    }
    return out;
}

// Auto-assign: 'all' seats every seatable, unlocked student again; 'unseated' only those without a seat (lowest free number).
export function planSeats(students, mode) {
    const movable = students.filter(s => isSeatable(s) && !isLocked(s) && !(mode === 'unseated' && seatKey(s.Seat_Number)));
    movable.sort(seatOrder);
    return planOrder(students, movable.map(s => s.User_ID));
}

// Current seating order of the seated students (by number).
export const seatedOrder = (students) =>
    students.filter(s => isSeatable(s) && seatKey(s.Seat_Number)).sort((a, b) => num(a) - num(b) || seatOrder(a, b));

// Insert one student. 'group': after the last seated student of their eye group whose name sorts before theirs (or after the
// last earlier group), so the seats behind move down by one. 'end': next to the last given seat number.
export function planInsert(students, studentId, where) {
    const me = students.find(s => s.User_ID === studentId);
    const rest = seatedOrder(students).filter(s => s.User_ID !== studentId);
    if (where === 'end') {
        const taken = new Set(students.filter(s => s.User_ID !== studentId).map(s => seatKey(s.Seat_Number)).filter(Boolean));
        const top = students.filter(s => s.User_ID !== studentId).reduce((m, s) => Number.isFinite(num(s)) ? Math.max(m, num(s)) : m, 0);
        let n = Math.floor(top) + 1;
        while (taken.has(String(n))) n++;
        return [{ studentId, seat: String(n) }];
    }
    let last = -1;
    rest.forEach((x, i) => {
        const r = eyeRank(x.eye_condition) - eyeRank(me.eye_condition);
        if (r < 0 || (r === 0 && nameCmp(x, me) <= 0)) last = i;
    });
    const ids = rest.map(s => s.User_ID);
    ids.splice(last + 1, 0, studentId);
    return planOrder(students, ids);
}

async function roster(env, courseId) {
    const r = await env.DB.prepare(
        `SELECT u.User_ID, u.Name, u.eye_condition, u.account_status, e.Seat_Number, COALESCE(e.Seat_Locked, 0) AS Seat_Locked
         FROM Enrollments e JOIN Users u ON u.User_ID = e.Student_ID WHERE e.Course_ID = ?`
    ).bind(courseId).all();
    return r.results || [];
}

const seatsOf = (rows) => rows.map(s => ({ studentId: s.User_ID, seat: s.Seat_Number || '', locked: isLocked(s) }));

async function save(env, courseId, rows, plan) {
    const changed = plan.filter(p => seatKey(rows.find(s => s.User_ID === p.studentId)?.Seat_Number) !== seatKey(p.seat));
    if (changed.length) {
        await env.DB.batch(changed.map(p => env.DB.prepare('UPDATE Enrollments SET Seat_Number = ? WHERE Course_ID = ? AND Student_ID = ?').bind(p.seat, courseId, p.studentId)));
    }
    const done = new Map(plan.map(p => [p.studentId, p.seat]));
    rows.forEach(s => { if (done.has(s.User_ID)) s.Seat_Number = done.get(s.User_ID); });
    return changed.length;
}

const PATHS = new Set(['/api/set-seat', '/api/auto-seat', '/api/seat-order', '/api/seat-insert']);

export async function handleSeats(request, env, path, url, corsHeaders) {
    // Floor plan data for students: which seat numbers are taken and which one is theirs. No names, so classmates stay private.
    if (request.method === 'GET' && path === '/api/seat-map') {
        const courseId = url.searchParams.get('courseId');
        if (!courseId) return json({ error: 'Missing courseId' }, 400, corsHeaders);
        const me = url.searchParams.get('studentId') || '';
        const rows = (await roster(env, courseId)).filter(s => isSeatable(s) && seatKey(s.Seat_Number));
        return json({ success: true, seats: rows.map(s => ({ seat: String(s.Seat_Number).trim(), mine: s.User_ID === me })) }, 200, corsHeaders);
    }
    if (request.method !== 'POST' || !PATHS.has(path)) return null;
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

    if (path === '/api/seat-order') {
        const ids = Array.isArray(body.order) ? body.order.map(String) : [];
        if (!ids.length) return json({ error: 'Missing order.' }, 400, corsHeaders);
        const n = await save(env, courseId, rows, planOrder(rows, ids));
        return json({ success: true, assigned: n, seats: seatsOf(rows) }, 200, corsHeaders);
    }

    if (path === '/api/seat-insert') {
        const me = rows.find(s => s.User_ID === body.studentId);
        if (!me) return json({ error: 'Student is not enrolled in this class.' }, 404, corsHeaders);
        if (!isSeatable(me)) return json({ error: `${me.account_status} students are not given a seat.` }, 400, corsHeaders);
        if (isLocked(me)) return json({ error: 'Unlock this seat first.' }, 400, corsHeaders);
        const n = await save(env, courseId, rows, planInsert(rows, me.User_ID, body.where === 'end' ? 'end' : 'group'));
        return json({ success: true, assigned: n, seats: seatsOf(rows) }, 200, corsHeaders);
    }

    const n = await save(env, courseId, rows, planSeats(rows, body.mode === 'unseated' ? 'unseated' : 'all'));
    return json({ success: true, assigned: n, seats: seatsOf(rows) }, 200, corsHeaders);
}
