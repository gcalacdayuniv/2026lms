// worker/groups.js
// Group sets. A class can hold several named sets of groups (Reporting, Lab 1, Quiz teams ...). A student is in one group
// per set. The "reporting" set is the original Enrollments.Group_Name / Assigned_Topic; other sets live in Group_Members.
// worker.js calls handleGroups() after the permission check; it returns a Response for its own paths and null otherwise.

import { ensureGroupTables } from './schema.js';
import { runInChunks } from './shared.js';

export const REPORTING = 'reporting';
const MAX_NAME = 80;

const json = (data, status, corsHeaders) => new Response(JSON.stringify(data), { status, headers: corsHeaders });
const clean = (v) => String(v == null ? '' : v).trim().slice(0, MAX_NAME);

// Rows { Student_ID, Group_Name, Topic } for a set (only students currently enrolled).
async function setRows(env, courseId, setId) {
    if (setId === REPORTING) {
        const r = await env.DB.prepare(
            `SELECT Student_ID, Group_Name, Assigned_Topic AS Topic FROM Enrollments
             WHERE Course_ID = ? AND Group_Name IS NOT NULL AND Group_Name != ''`
        ).bind(courseId).all();
        return r.results || [];
    }
    const r = await env.DB.prepare(
        `SELECT g.Student_ID, g.Group_Name, g.Topic FROM Group_Members g
         JOIN Enrollments e ON e.Course_ID = ? AND e.Student_ID = g.Student_ID
         WHERE g.Set_ID = ?`
    ).bind(courseId, setId).all();
    return r.results || [];
}

async function setBelongs(env, courseId, setId) {
    if (setId === REPORTING) return true;
    const row = await env.DB.prepare('SELECT 1 AS ok FROM Group_Sets WHERE Set_ID = ? AND Course_ID = ?').bind(setId, courseId).first();
    return !!row;
}

// Group name of one student inside a set (null when none). Used by the upload check.
export async function groupNameIn(env, courseId, setId, studentIds) {
    await ensureGroupTables(env);
    setId = setId || REPORTING;
    if (!await setBelongs(env, courseId, setId)) return new Map();
    const rows = await setRows(env, courseId, setId);
    const want = new Set(studentIds);
    return new Map(rows.filter(r => want.has(r.Student_ID)).map(r => [r.Student_ID, r.Group_Name]));
}

export async function handleGroups(request, env, path, url, corsHeaders) {
    if (!path.startsWith('/api/group-set') && path !== '/api/student-groups' && path !== '/api/group-members') return null;
    await ensureGroupTables(env);

    // The sets of a class (Reporting first).
    if (request.method === 'GET' && path === '/api/group-sets') {
        const courseId = url.searchParams.get('courseId');
        if (!courseId) return json({ error: 'Missing courseId' }, 400, corsHeaders);
        const r = await env.DB.prepare('SELECT Set_ID, Name FROM Group_Sets WHERE Course_ID = ? ORDER BY Created_At, Name').bind(courseId).all();
        return json({ success: true, sets: [{ Set_ID: REPORTING, Name: 'Reporting' }, ...(r.results || [])] }, 200, corsHeaders);
    }

    // One set: its groups (with members and topic) and the students not placed in any group.
    if (request.method === 'GET' && path === '/api/group-set') {
        const courseId = url.searchParams.get('courseId');
        const setId = url.searchParams.get('setId') || REPORTING;
        if (!courseId) return json({ error: 'Missing courseId' }, 400, corsHeaders);
        if (!await setBelongs(env, courseId, setId)) return json({ error: 'Set not found' }, 404, corsHeaders);

        const roster = await env.DB.prepare(
            `SELECT u.User_ID, u.Name, u.Student_Number, e.Seat_Number FROM Enrollments e JOIN Users u ON u.User_ID = e.Student_ID
             WHERE e.Course_ID = ? ORDER BY u.Name`
        ).bind(courseId).all();
        const rows = await setRows(env, courseId, setId);
        const placed = new Map(rows.map(r => [r.Student_ID, r]));
        const groups = new Map();
        const unassigned = [];
        for (const s of roster.results || []) {
            const p = placed.get(s.User_ID);
            if (!p) { unassigned.push(s); continue; }
            if (!groups.has(p.Group_Name)) groups.set(p.Group_Name, { name: p.Group_Name, topic: '', members: [] });
            const g = groups.get(p.Group_Name);
            if (p.Topic && !g.topic) g.topic = p.Topic;
            g.members.push(s);
        }
        const list = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        return json({ success: true, groups: list, unassigned }, 200, corsHeaders);
    }

    if (request.method === 'POST' && path === '/api/group-set-create') {
        const body = await request.json();
        const name = clean(body.name);
        if (!body.courseId || !name) return json({ error: 'Enter a name for the set.' }, 400, corsHeaders);
        if (name.toLowerCase() === 'reporting') return json({ error: 'That name is already used.' }, 400, corsHeaders);
        const dup = await env.DB.prepare('SELECT 1 AS ok FROM Group_Sets WHERE Course_ID = ? AND Name = ? COLLATE NOCASE').bind(body.courseId, name).first();
        if (dup) return json({ error: 'That name is already used.' }, 400, corsHeaders);
        const id = crypto.randomUUID();
        await env.DB.prepare('INSERT INTO Group_Sets (Set_ID, Course_ID, Name) VALUES (?, ?, ?)').bind(id, body.courseId, name).run();
        return json({ success: true, setId: id }, 201, corsHeaders);
    }

    if (request.method === 'POST' && path === '/api/group-set-rename') {
        const body = await request.json();
        const name = clean(body.name);
        if (!body.courseId || !body.setId || body.setId === REPORTING || !name) return json({ error: 'Enter a name for the set.' }, 400, corsHeaders);
        if (name.toLowerCase() === 'reporting') return json({ error: 'That name is already used.' }, 400, corsHeaders);
        const dup = await env.DB.prepare('SELECT 1 AS ok FROM Group_Sets WHERE Course_ID = ? AND Name = ? COLLATE NOCASE AND Set_ID != ?').bind(body.courseId, name, body.setId).first();
        if (dup) return json({ error: 'That name is already used.' }, 400, corsHeaders);
        const res = await env.DB.prepare('UPDATE Group_Sets SET Name = ? WHERE Set_ID = ? AND Course_ID = ?').bind(name, body.setId, body.courseId).run();
        if (!res.meta || !res.meta.changes) return json({ error: 'Set not found' }, 404, corsHeaders);
        return json({ success: true }, 200, corsHeaders);
    }

    if (request.method === 'POST' && path === '/api/group-set-delete') {
        const body = await request.json();
        if (!body.courseId || !body.setId || body.setId === REPORTING) return json({ error: 'The Reporting set cannot be deleted.' }, 400, corsHeaders);
        if (!await setBelongs(env, body.courseId, body.setId)) return json({ error: 'Set not found' }, 404, corsHeaders);
        await env.DB.batch([
            env.DB.prepare('DELETE FROM Group_Members WHERE Set_ID = ?').bind(body.setId),
            env.DB.prepare('DELETE FROM Group_Sets WHERE Set_ID = ? AND Course_ID = ?').bind(body.setId, body.courseId)
        ]);
        return json({ success: true }, 200, corsHeaders);
    }

    // Replace a whole set: groups = [{ name, topic, memberIds }]. A student can be in one group only.
    if (request.method === 'POST' && path === '/api/group-set-save') {
        const body = await request.json();
        const setId = body.setId || REPORTING;
        if (!body.courseId || !Array.isArray(body.groups)) return json({ error: 'Missing parameters' }, 400, corsHeaders);
        if (!await setBelongs(env, body.courseId, setId)) return json({ error: 'Set not found' }, 404, corsHeaders);

        const roster = await env.DB.prepare('SELECT Student_ID FROM Enrollments WHERE Course_ID = ?').bind(body.courseId).all();
        const enrolled = new Set((roster.results || []).map(r => r.Student_ID));
        const seenStudents = new Set();
        const seenNames = new Set();
        const placement = [];
        for (const g of body.groups) {
            const name = clean(g.name);
            if (!name) return json({ error: 'Every group needs a name.' }, 400, corsHeaders);
            if (seenNames.has(name.toLowerCase())) return json({ error: `Two groups are named "${name}".` }, 400, corsHeaders);
            seenNames.add(name.toLowerCase());
            const topic = clean(g.topic);
            for (const id of Array.isArray(g.memberIds) ? g.memberIds : []) {
                if (!enrolled.has(id)) return json({ error: 'A selected student is not enrolled in this class.' }, 400, corsHeaders);
                if (seenStudents.has(id)) return json({ error: 'A student can be in only one group of a set.' }, 400, corsHeaders);
                seenStudents.add(id);
                placement.push({ id, name, topic });
            }
        }

        if (setId === REPORTING) {
            const stmts = [env.DB.prepare("UPDATE Enrollments SET Group_Name = NULL, Assigned_Topic = NULL WHERE Course_ID = ?").bind(body.courseId)];
            for (const p of placement) {
                stmts.push(env.DB.prepare('UPDATE Enrollments SET Group_Name = ?, Assigned_Topic = ? WHERE Course_ID = ? AND Student_ID = ?').bind(p.name, p.topic || null, body.courseId, p.id));
            }
            await runInChunks(env, stmts);
        } else {
            const stmts = [env.DB.prepare('DELETE FROM Group_Members WHERE Set_ID = ?').bind(setId)];
            for (const p of placement) {
                stmts.push(env.DB.prepare('INSERT INTO Group_Members (Set_ID, Student_ID, Group_Name, Topic) VALUES (?, ?, ?, ?)').bind(setId, p.id, p.name, p.topic || null));
            }
            await runInChunks(env, stmts);
        }
        return json({ success: true, placed: placement.length }, 200, corsHeaders);
    }

    // Every group a student belongs to in a class, across all sets, with the other members.
    if (request.method === 'GET' && path === '/api/student-groups') {
        const courseId = url.searchParams.get('courseId');
        const studentId = url.searchParams.get('studentId');
        if (!courseId || !studentId) return json({ error: 'Missing parameters' }, 400, corsHeaders);
        const sets = await env.DB.prepare('SELECT Set_ID, Name FROM Group_Sets WHERE Course_ID = ? ORDER BY Created_At, Name').bind(courseId).all();
        const out = [];
        for (const s of [{ Set_ID: REPORTING, Name: 'Reporting' }, ...(sets.results || [])]) {
            const rows = await setRows(env, courseId, s.Set_ID);
            const mine = rows.find(r => r.Student_ID === studentId);
            if (!mine) continue;
            const ids = rows.filter(r => r.Group_Name === mine.Group_Name && r.Student_ID !== studentId).map(r => r.Student_ID);
            let mates = [];
            if (ids.length) {
                const u = await env.DB.prepare(`SELECT Name FROM Users WHERE User_ID IN (${ids.map(() => '?').join(',')}) ORDER BY Name`).bind(...ids).all();
                mates = (u.results || []).map(x => x.Name);
            }
            out.push({ setId: s.Set_ID, setName: s.Name, groupName: mine.Group_Name, topic: mine.Topic || '', mates });
        }
        return json({ success: true, groups: out }, 200, corsHeaders);
    }

    return null;
}
