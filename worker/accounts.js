// worker/accounts.js
// Sign-up, sign-in, password changes, profile details, year-level advance and the user list.

import { isAdminRole, isLecturerRole } from './roles.js';
import { findClassByCode, ensureEnrolled } from './join.js';
import { signToken, authEnabled, markPasswordChanged } from './auth.js';
import { hashPassword, verifyPassword } from './password.js';
import { findUserByCredentials, loginKeys, loginLockedFor, loginFailed, loginCleared, tooManyTries, registerKeys, REGISTER_WINDOW_MS, CLEAR_REACTIVATION_SQL, getCurrentTerm, validTerm, getTermEnds, termKey } from './shared.js';
import { ensureYearAdvanceTables, ensureReactivationColumns, ensureUserPrefs, ensureAppSettings, ensurePasswordResetRequests, clearStudentClassFields } from './schema.js';
import { gasUrl } from './gas.js';
import { ensureExamSecurity } from './exam-photos.js';
import { ensureSessions, submitOpenAttempts, hasOpenAttempt, ONLINE_WINDOW_MS } from './exam-session.js';

const MAX_AVATAR_B64 = 8000000;   // about 6 MB of photo; the app shrinks pictures to about 150 KB before sending

// "1" -> "2", "3rd Year" -> "4th Year". At or above maxYear = graduating; no leading number = unrecognized.
function nextYearLevel(v, maxYear) {
    const m = /^(\d{1,2})(.*)$/.exec(String(v == null ? "" : v).trim());
    if (!m || Number(m[1]) < 1) return { skip: "unrecognized" };
    const n = Number(m[1]);
    if (n >= maxYear) return { skip: "graduating" };
    const nn = n + 1;
    let rest = m[2];
    if (/^(st|nd|rd|th)(?![a-z])/i.test(rest)) {
        const suf = nn % 100 >= 11 && nn % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[nn % 10] || "th");
        rest = suf + rest.replace(/^(st|nd|rd|th)/i, "");
    }
    return { value: String(nn) + rest };
}


// Returns a Response when the request is handled here, otherwise null.
export async function handleAccounts(request, env, path, url, corsHeaders) {
    if (request.method === "POST" && path === "/api/register") {
        const body = await request.json();

        // Sign-up is open to everyone, so it is limited: every attempt counts, whether or not it works.
        const regKeys = registerKeys(request, env, body && body.student_number);
        const regWait = await loginLockedFor(env, regKeys, REGISTER_WINDOW_MS);
        if (regWait) return tooManyTries(corsHeaders, regWait, "sign-up attempts");
        await loginFailed(env, regKeys, REGISTER_WINDOW_MS);

        // Sizes: keeps the database and the Drive folder from being filled with oversized text or pictures.
        const tooLong = (v, max) => v != null && String(v).length > max;
        if (!body || typeof body.password !== 'string' || body.password.length < 6 || body.password.length > 200
            || tooLong(body.username, 60) || tooLong(body.name, 120) || tooLong(body.email, 120) || tooLong(body.contact_number, 30)
            || tooLong(body.course, 80) || tooLong(body.year, 40) || tooLong(body.section, 40) || tooLong(body.eye_condition, 120) || tooLong(body.invite_code, 20)
            || tooLong(body.program_course, 80) || tooLong(body.program_year, 40) || tooLong(body.program_section, 40)) {
            return new Response(JSON.stringify({ error: "Some details are missing or too long. Passwords need 6 to 200 characters." }), { status: 400, headers: corsHeaders });
        }
        if (body.avatarBase64 != null && (typeof body.avatarBase64 !== 'string' || body.avatarBase64.length > MAX_AVATAR_B64)) {
            return new Response(JSON.stringify({ error: "The profile photo is too large. Choose a smaller photo." }), { status: 400, headers: corsHeaders });
        }

        // The student's own program is required; the class course/year/section below is for enrolling in classes.
        if (![body.program_course, body.program_year, body.program_section].every(v => typeof v === 'string' && v.trim())) {
            return new Response(JSON.stringify({ error: "Choose your program course, year and section." }), { status: 400, headers: corsHeaders });
        }

        const studentNoFormat = /^\d{2}-\d{4}$/;
        if (!studentNoFormat.test(body.student_number)) {
            return new Response(JSON.stringify({ error: "Invalid Student Number. Format must be 00-0000" }), { status: 400, headers: corsHeaders });
        }
        if (studentNoFormat.test(body.username)) {
            return new Response(JSON.stringify({ error: "Username cannot match the Student Number format (00-0000)" }), { status: 400, headers: corsHeaders });
        }

        const existing = await env.DB.prepare(
            `SELECT Username, Student_Number, Email, Contact_Number FROM Users
             WHERE Username COLLATE NOCASE = ?
             OR Student_Number COLLATE NOCASE = ?
             OR Email COLLATE NOCASE = ?
             OR Contact_Number = ?`
        ).bind(body.username, body.student_number, body.email, body.contact_number).first();

        if (existing) {
            const conflicts = [];
            if (existing.Username && body.username && existing.Username.toLowerCase() === body.username.toLowerCase()) conflicts.push("Username");
            if (existing.Student_Number && body.student_number && existing.Student_Number.toLowerCase() === body.student_number.toLowerCase()) conflicts.push("Student Number");
            if (existing.Email && body.email && existing.Email.toLowerCase() === body.email.toLowerCase()) conflicts.push("Email");
            if (existing.Contact_Number && body.contact_number && existing.Contact_Number === body.contact_number) conflicts.push("Contact Number");

            return new Response(JSON.stringify({ error: `The following is already registered to another account: ${conflicts.join(', ')}.` }), { status: 400, headers: corsHeaders });
        }

        // An optional class code activates the account and puts the student in that class.
        let joinClass = null;
        if (body.invite_code && String(body.invite_code).trim()) {
            const found = await findClassByCode(env, body.invite_code);
            if (found.error) return new Response(JSON.stringify({ error: found.error }), { status: found.status, headers: corsHeaders });
            joinClass = found.course;
        }

        let finalAvatarUrl = null;
        if (body.avatarBase64) {
            if (!env.GAS_WEBHOOK_URL) {
                return new Response(JSON.stringify({ error: "Server Configuration Error: GAS_WEBHOOK_URL is missing. Please redeploy the Cloudflare Worker." }), { status: 500, headers: corsHeaders });
            }

            const courseVal = body.program_course.trim();
            const yearVal = body.program_year.trim();
            const sectionVal = body.program_section.trim();
            const courseYearSection = [courseVal, yearVal, sectionVal].filter(Boolean).join(" ") || "General";
            const formattedFilename = `${body.student_number}_${body.name}.jpg`;

            const gasPayload = {
                filename: formattedFilename,
                mimeType: "image/jpeg",
                base64: body.avatarBase64,
                pathParts: [courseYearSection, "Profile Picture"]
            };

            let gasResponse = await fetch(gasUrl(env), {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(gasPayload),
                redirect: 'manual'
            });

            if (gasResponse.status === 302 || gasResponse.status === 303) {
                const redirectUrl = gasResponse.headers.get('Location');
                gasResponse = await fetch(redirectUrl);
            }

            const gasText = await gasResponse.text();
            let gasData;
            try {
                gasData = JSON.parse(gasText);
            } catch (parseError) {
                return new Response(JSON.stringify({
                    error: `Google created the file, but intercepted the JSON response. Raw Google Output: ${gasText.substring(0, 150)}...`
                }), { status: 500, headers: corsHeaders });
            }

            if (!gasData.success) {
                return new Response(JSON.stringify({ error: "Google Drive Error: " + gasData.error }), { status: 500, headers: corsHeaders });
            }
            finalAvatarUrl = gasData.fileUrl;
        }

        const userId = crypto.randomUUID();
        const hashedPassword = await hashPassword(body.password, env);

        await env.DB.prepare(
            `INSERT INTO Users (User_ID, Username, Password, Name, Avatar, Email, Contact_Number, Student_Number, account_status, course, year, section, eye_condition, role, Program_Course, Program_Year, Program_Section, registration_timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
        ).bind(
            userId, body.username, hashedPassword, body.name, finalAvatarUrl,
            body.email, body.contact_number, body.student_number,
            joinClass ? 'Active' : 'Inactive', null, null, null, body.eye_condition ? body.eye_condition.trim() : null, 'Student',
            body.program_course.trim(), body.program_year.trim(), body.program_section.trim()
        ).run();

        if (joinClass) await ensureEnrolled(env, joinClass.Course_ID, userId);
        return new Response(JSON.stringify({ success: true, message: "User registered", activated: !!joinClass, course: joinClass }), { status: 201, headers: corsHeaders });
    }

    if (request.method === "POST" && path === "/api/login") {
        const body = await request.json();
        const id = body.identifier;
        await clearStudentClassFields(env);
        const lk = loginKeys(request, id);
        const locked = await loginLockedFor(env, lk);
        if (locked) return tooManyTries(corsHeaders, locked);

        const user = (id && body.password)
            ? await findUserByCredentials(env, id, body.password,
                "User_ID, Username, Name, Avatar, Email, Contact_Number, Student_Number, account_status, role, course, year, section, Program_Course, Program_Year, Program_Section, eye_condition")
            : null;

        if (!user) {
            await loginFailed(env, lk);
            return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401, headers: corsHeaders });
        }
        await loginCleared(env, lk);

        // A deactivated (Inactive) account is activated by a valid class code, and the student joins that class.
        let joined = null;
        if (body.inviteCode && String(body.inviteCode).trim() && user.account_status.toLowerCase() === 'inactive') {
            const found = await findClassByCode(env, body.inviteCode);
            if (found.error) return new Response(JSON.stringify({ error: found.error, codeActivation: true }), { status: found.status, headers: corsHeaders });
            await ensureReactivationColumns(env);
            await ensureEnrolled(env, found.course.Course_ID, user.User_ID);
            await env.DB.prepare(`UPDATE Users SET account_status = 'Active', ${CLEAR_REACTIVATION_SQL} WHERE User_ID = ?`).bind(user.User_ID).run();
            user.account_status = 'Active';
            joined = found.course;
        }

        if (user.account_status.toLowerCase() !== 'active') {
            let errorMessage = "";
            const statusLower = user.account_status.toLowerCase();

            // Advanced to a new year level: inactive until reactivated. The student may ask for reactivation here
            // (only until the date the lecturer set, if any); the lecturer sees the request and sets the account Active.
            if (statusLower === 'inactive') {
                await ensureReactivationColumns(env);
                const re = await env.DB.prepare("SELECT Advanced_Term, Reactivation_Until, Reactivation_Requested FROM Users WHERE User_ID = ?").bind(user.User_ID).first();
                if (re && re.Advanced_Term) {
                    const today = new Date().toISOString().slice(0, 10);
                    const open = !re.Reactivation_Until || today <= re.Reactivation_Until;
                    if (body.requestReactivation && open) {
                        if (!re.Reactivation_Requested) {
                            await env.DB.prepare("UPDATE Users SET Reactivation_Requested = ? WHERE User_ID = ?").bind(new Date().toISOString(), user.User_ID).run();
                        }
                        return new Response(JSON.stringify({ error: "Reactivation requested. Your lecturer will review it, then you can sign in.", codeActivation: true, reactivation: { allowed: false, requested: true } }), { status: 403, headers: corsHeaders });
                    }
                    const msg = open
                        ? `Your account is inactive for the new year level (${re.Advanced_Term}). It is reactivated when a lecturer enrolls you in a class for the current term, or you can request reactivation.`
                        : `Your account is inactive and the reactivation period ended on ${re.Reactivation_Until}. Please ask your lecturer to reactivate it.`;
                    return new Response(JSON.stringify({ error: msg, codeActivation: true, reactivation: { allowed: open && !re.Reactivation_Requested, requested: !!re.Reactivation_Requested, until: re.Reactivation_Until || null } }), { status: 403, headers: corsHeaders });
                }
            }

            if (statusLower === 'inactive') {
                errorMessage = "Your account is not active yet (new, or deactivated because your class ended). Enter a class code from your lecturer to activate it, or wait for a lecturer to activate you.";
            } else if (statusLower === 'suspended') {
                errorMessage = "Account is Suspended";
            } else if (statusLower === 'ud') {
                errorMessage = "Account is Unofficially Dropped";
            } else if (statusLower === 'dropped') {
                errorMessage = "Account is Dropped";
            } else {
                errorMessage = `Account is ${user.account_status}`;
            }

            return new Response(JSON.stringify({
                error: errorMessage,
                codeActivation: statusLower === 'inactive'
            }), { status: 403, headers: corsHeaders });
        }

        // One device at a time for students: warn first, and on confirmation sign the other device out.
        let tokenNow = Date.now();
        const deviceId = typeof body.deviceId === 'string' ? body.deviceId.slice(0, 64) : '';
        if (authEnabled(env) && deviceId && !isLecturerRole(user.role)) {
            await ensureSessions(env);
            const s = await env.DB.prepare('SELECT Session_Device, Last_Seen_At FROM Users WHERE User_ID = ?').bind(user.User_ID).first();
            const otherDevice = !!(s && s.Session_Device && s.Session_Device !== deviceId);
            if (otherDevice) {
                const online = !!s.Last_Seen_At && Date.now() - s.Last_Seen_At < ONLINE_WINDOW_MS;
                if (online && !body.takeover) {
                    const exam = await hasOpenAttempt(env, user.User_ID);
                    return new Response(JSON.stringify({
                        error: 'This account is currently signed in on another device.',
                        code: 'already-logged-in', examInProgress: exam
                    }), { status: 409, headers: corsHeaders });
                }
                await submitOpenAttempts(env, user.User_ID, 'session-takeover');
                await env.DB.prepare('UPDATE Users SET Sessions_Valid_From = ? WHERE User_ID = ?').bind(Math.floor(Date.now() / 1000) + 1, user.User_ID).run();
                tokenNow = Date.now() + 1000;   // the new token is stamped one second ahead so every older token is rejected
            }
            await env.DB.prepare('UPDATE Users SET Session_Device = ?, Last_Seen_At = ? WHERE User_ID = ?').bind(deviceId, Date.now(), user.User_ID).run();
        }

        const token = authEnabled(env) ? await signToken(env, user.User_ID, tokenNow) : undefined;
        const shown = isAdminRole(user.role) ? { ...user, role: 'Lecturer', isAdmin: true } : user;   // an Admin is a lecturer with extra access
        return new Response(JSON.stringify({ success: true, user: shown, token, joined }), { status: 200, headers: corsHeaders });
    }

    // Signing out frees the account for another device without a warning.
    if (request.method === "POST" && path === "/api/logout") {
        const body = await request.json().catch(() => ({}));
        if (body.userId) {
            await ensureSessions(env);
            await env.DB.prepare('UPDATE Users SET Last_Seen_At = NULL WHERE User_ID = ?').bind(body.userId).run();
        }
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
    }

    if (request.method === "POST" && path === "/api/change-password") {
        const body = await request.json();
        const { userId, currentPassword, newPassword } = body;

        const user = await env.DB.prepare("SELECT Password FROM Users WHERE User_ID = ?").bind(userId).first();

        if (!user || !(await verifyPassword(currentPassword, user.Password, env)).ok) {
            return new Response(JSON.stringify({ error: "Incorrect current password" }), { status: 400, headers: corsHeaders });
        }

        const newHash = await hashPassword(newPassword, env);
        await env.DB.prepare("UPDATE Users SET Password = ? WHERE User_ID = ?").bind(newHash, userId).run();

        // Other devices are signed out; this device gets a fresh token and stays signed in.
        let token;
        if (authEnabled(env)) {
            await markPasswordChanged(env, userId);
            token = await signToken(env, userId);
        }

        return new Response(JSON.stringify({ success: true, message: "Password updated successfully", token }), { status: 200, headers: corsHeaders });
    }

    // Preferred paper size, kept on the server so it follows the lecturer to every device.
    if (path === "/api/my-prefs" && request.method === "GET") {
        await ensureUserPrefs(env);
        const row = await env.DB.prepare("SELECT Paper FROM User_Prefs WHERE User_ID = ?").bind(url.searchParams.get("userId") || "").first();
        return new Response(JSON.stringify({ success: true, paper: row && row.Paper ? row.Paper : null }), { status: 200, headers: corsHeaders });
    }

    if (path === "/api/my-prefs" && request.method === "POST") {
        const body = await request.json();
        const paper = String(body.paper || "").toLowerCase();
        if (!body.userId || !["a4", "letter", "legal"].includes(paper)) {
            return new Response(JSON.stringify({ error: "Choose A4, Letter or Legal." }), { status: 400, headers: corsHeaders });
        }
        await ensureUserPrefs(env);
        await env.DB.prepare("INSERT INTO User_Prefs (User_ID, Paper, Updated_At) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(User_ID) DO UPDATE SET Paper = excluded.Paper, Updated_At = CURRENT_TIMESTAMP").bind(body.userId, paper).run();
        return new Response(JSON.stringify({ success: true, paper }), { status: 200, headers: corsHeaders });
    }

    // Current academic term: set by hand by an admin lecturer, else the GMT+8 calendar.
    if (path === "/api/current-term" && request.method === "GET") {
        return new Response(JSON.stringify({ success: true, ...(await getCurrentTerm(env)) }), { status: 200, headers: corsHeaders });
    }

    if (path === "/api/current-term" && request.method === "POST") {
        const body = await request.json();
        await ensureAppSettings(env);
        if (body.reset) {
            await env.DB.prepare("DELETE FROM App_Settings WHERE Key = 'current_term'").run();
        } else {
            if (!validTerm(body.ay, body.sem)) {
                return new Response(JSON.stringify({ error: "Use an academic year like 2026-2027 and pick a semester." }), { status: 400, headers: corsHeaders });
            }
            await env.DB.prepare("INSERT INTO App_Settings (Key, Value, Updated_By, Updated_At) VALUES ('current_term', ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(Key) DO UPDATE SET Value = excluded.Value, Updated_By = excluded.Updated_By, Updated_At = CURRENT_TIMESTAMP").bind(JSON.stringify({ ay: body.ay, sem: body.sem }), String(body.userId || "")).run();
        }
        // Last day of the term (end of Finals), kept per term. Accounts of classes that ended 2 weeks after it are deactivated.
        if (!body.reset && body.endDate !== undefined) {
            const d = String(body.endDate || "").trim();
            if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)))) {
                return new Response(JSON.stringify({ error: "Enter the last day of the term as a date." }), { status: 400, headers: corsHeaders });
            }
            const cur = await getCurrentTerm(env);
            const ends = await getTermEnds(env);
            if (d) ends[termKey(cur.ay, cur.sem)] = d; else delete ends[termKey(cur.ay, cur.sem)];
            await env.DB.prepare("INSERT INTO App_Settings (Key, Value, Updated_By, Updated_At) VALUES ('term_ends', ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(Key) DO UPDATE SET Value = excluded.Value, Updated_By = excluded.Updated_By, Updated_At = CURRENT_TIMESTAMP").bind(JSON.stringify(ends), String(body.userId || "")).run();
        }
        return new Response(JSON.stringify({ success: true, ...(await getCurrentTerm(env)) }), { status: 200, headers: corsHeaders });
    }

    if (request.method === "POST" && path === "/api/update-details") {
        const body = await request.json();
        const { userId, password, name, username, email, contact, studentNumber, programCourse, programYear, programSection } = body;

        const studentNoFormat = /^\d{2}-\d{4}$/;
        if (!studentNoFormat.test(studentNumber)) {
            return new Response(JSON.stringify({ error: "Invalid Student Number. Format must be 00-0000" }), { status: 400, headers: corsHeaders });
        }

        const user = await env.DB.prepare("SELECT Password FROM Users WHERE User_ID = ?").bind(userId).first();

        if (!user || !(await verifyPassword(password, user.Password, env)).ok) {
            return new Response(JSON.stringify({ error: "Incorrect password" }), { status: 400, headers: corsHeaders });
        }

        const existing = await env.DB.prepare(
            `SELECT Username, Student_Number, Email, Contact_Number FROM Users
             WHERE (Username COLLATE NOCASE = ?
             OR Student_Number COLLATE NOCASE = ?
             OR Email COLLATE NOCASE = ?
             OR Contact_Number = ?)
             AND User_ID != ?`
        ).bind(username, studentNumber, email, contact, userId).first();

        if (existing) {
            const conflicts = [];
            if (existing.Username && username && existing.Username.toLowerCase() === username.toLowerCase()) conflicts.push("Username");
            if (existing.Student_Number && studentNumber && existing.Student_Number.toLowerCase() === studentNumber.toLowerCase()) conflicts.push("Student Number");
            if (existing.Email && email && existing.Email.toLowerCase() === email.toLowerCase()) conflicts.push("Email");
            if (existing.Contact_Number && contact && existing.Contact_Number === contact) conflicts.push("Contact Number");

            return new Response(JSON.stringify({ error: `The following information is already taken by another account: ${conflicts.join(', ')}.` }), { status: 400, headers: corsHeaders });
        }

        await env.DB.prepare(
            `UPDATE Users SET Name = ?, Username = ?, Email = ?, Contact_Number = ?, Student_Number = ? WHERE User_ID = ?`
        ).bind(name, username, email, contact, studentNumber, userId).run();

        // Optional: the student's own Program Course / Year / Section
        if (programCourse !== undefined || programYear !== undefined || programSection !== undefined) {
            const cleanProg = (v) => (v === undefined || v === null) ? null : (String(v).trim() || null);
            await env.DB.prepare(
                `UPDATE Users SET Program_Course = ?, Program_Year = ?, Program_Section = ? WHERE User_ID = ?`
            ).bind(cleanProg(programCourse), cleanProg(programYear), cleanProg(programSection), userId).run();
        }

        return new Response(JSON.stringify({ success: true, message: "Details updated successfully" }), { status: 200, headers: corsHeaders });
    }

    // A lecturer corrects a student's details (including the eye condition tag) from Manage Users.
    if (request.method === "POST" && path === "/api/admin-update-student") {
        const body = await request.json();
        const stu = await env.DB.prepare("SELECT User_ID, role FROM Users WHERE User_ID = ?").bind(body.studentId || "").first();
        if (!stu || String(stu.role).toLowerCase() !== "student") {
            return new Response(JSON.stringify({ error: "Student not found." }), { status: 404, headers: corsHeaders });
        }
        const clean = (v, max) => { const t = v == null ? "" : String(v).trim(); return t.length > max ? undefined : (t || null); };
        const f = {
            Name: clean(body.name, 120), Email: clean(body.email, 120), Contact_Number: clean(body.contact, 30), Student_Number: clean(body.studentNumber, 20),
            Program_Course: clean(body.programCourse, 80), Program_Year: clean(body.programYear, 40), Program_Section: clean(body.programSection, 40)
        };
        if (Object.values(f).includes(undefined)) {
            return new Response(JSON.stringify({ error: "Some details are too long." }), { status: 400, headers: corsHeaders });
        }
        if (!f.Name) return new Response(JSON.stringify({ error: "Name is required." }), { status: 400, headers: corsHeaders });
        if (!/^\d{2}-\d{4}$/.test(f.Student_Number || "")) {
            return new Response(JSON.stringify({ error: "Invalid Student Number. Format must be 00-0000" }), { status: 400, headers: corsHeaders });
        }
        const EYE = ["No Eye Condition", "Near Sighted", "Far Sighted", "Legally Blind"];
        const eye = body.eyeCondition === undefined || body.eyeCondition === null || body.eyeCondition === "" ? "No Eye Condition" : String(body.eyeCondition);
        if (!EYE.includes(eye)) {
            return new Response(JSON.stringify({ error: "Unknown eye condition." }), { status: 400, headers: corsHeaders });
        }
        const clash = await env.DB.prepare(
            `SELECT Student_Number, Email, Contact_Number FROM Users WHERE User_ID != ? AND (Student_Number COLLATE NOCASE = ? OR (? IS NOT NULL AND Email COLLATE NOCASE = ?) OR (? IS NOT NULL AND Contact_Number = ?))`
        ).bind(stu.User_ID, f.Student_Number, f.Email, f.Email, f.Contact_Number, f.Contact_Number).first();
        if (clash) {
            const c = [];
            if (clash.Student_Number && clash.Student_Number.toLowerCase() === f.Student_Number.toLowerCase()) c.push("Student Number");
            if (f.Email && clash.Email && clash.Email.toLowerCase() === f.Email.toLowerCase()) c.push("Email");
            if (f.Contact_Number && clash.Contact_Number === f.Contact_Number) c.push("Contact Number");
            return new Response(JSON.stringify({ error: `Already used by another account: ${c.join(", ")}.` }), { status: 400, headers: corsHeaders });
        }
        if (body.examSecure !== undefined) {
            if (!["", "on", "off"].includes(String(body.examSecure))) {
                return new Response(JSON.stringify({ error: "Unknown exam secure setting." }), { status: 400, headers: corsHeaders });
            }
            await ensureExamSecurity(env);
            await env.DB.prepare("UPDATE Users SET Exam_Secure = ? WHERE User_ID = ?").bind(body.examSecure === "" ? null : String(body.examSecure), stu.User_ID).run();
        }
        await env.DB.prepare(
            `UPDATE Users SET Name = ?, Email = ?, Contact_Number = ?, Student_Number = ?, Program_Course = ?, Program_Year = ?, Program_Section = ?, eye_condition = ? WHERE User_ID = ?`
        ).bind(f.Name, f.Email, f.Contact_Number, f.Student_Number, f.Program_Course, f.Program_Year, f.Program_Section, eye, stu.User_ID).run();
        return new Response(JSON.stringify({ success: true, student: { User_ID: stu.User_ID, ...f, eye_condition: eye } }), { status: 200, headers: corsHeaders });
    }

    // A student who forgot their password asks their lecturer. The answer is always the same so nobody
    // can use this to find out which accounts exist.
    if (request.method === "POST" && path === "/api/request-password-reset") {
        const body = await request.json();
        const id = String(body.identifier || "").trim();
        const same = new Response(JSON.stringify({ success: true, message: "If that account exists, your lecturer has been asked to reset your password." }), { status: 200, headers: corsHeaders });
        if (!id || id.length > 120) return same;
        await ensurePasswordResetRequests(env);
        const u = await env.DB.prepare(
            `SELECT User_ID, role FROM Users WHERE Username COLLATE NOCASE = ? OR Student_Number COLLATE NOCASE = ? OR Email COLLATE NOCASE = ? OR Contact_Number = ?`
        ).bind(id, id, id, id).first();
        if (u && String(u.role || "").toLowerCase() === "student") {
            const prev = await env.DB.prepare("SELECT Requested_At FROM Password_Reset_Requests WHERE User_ID = ?").bind(u.User_ID).first();
            if (!prev || Date.now() - Date.parse(prev.Requested_At) > 60000) {
                await env.DB.prepare("INSERT INTO Password_Reset_Requests (User_ID, Requested_At) VALUES (?, ?) ON CONFLICT(User_ID) DO UPDATE SET Requested_At = excluded.Requested_At").bind(u.User_ID, new Date().toISOString()).run();
            }
        }
        return same;
    }

    // Requests a lecturer can act on: students in their classes, and students who are in no class yet.
    if (request.method === "GET" && path === "/api/password-reset-requests") {
        await ensurePasswordResetRequests(env);
        const lecturerId = url.searchParams.get("lecturerId") || "";
        const rows = await env.DB.prepare(
            `SELECT r.User_ID, r.Requested_At, u.Name, u.Username, u.Student_Number, u.account_status,
                    (SELECT GROUP_CONCAT(c.CourseCode, ', ') FROM Enrollments e JOIN Courses c ON c.Course_ID = e.Course_ID WHERE e.Student_ID = r.User_ID) AS Classes
             FROM Password_Reset_Requests r JOIN Users u ON u.User_ID = r.User_ID
             WHERE NOT EXISTS (SELECT 1 FROM Enrollments e0 WHERE e0.Student_ID = r.User_ID)
                OR EXISTS (SELECT 1 FROM Enrollments e1 JOIN Courses c1 ON c1.Course_ID = e1.Course_ID WHERE e1.Student_ID = r.User_ID AND c1.Lecturer_ID = ?)
             ORDER BY r.Requested_At DESC LIMIT 100`
        ).bind(lecturerId).all();
        return new Response(JSON.stringify({ success: true, requests: rows.results }), { status: 200, headers: corsHeaders });
    }

    if (request.method === "POST" && path === "/api/dismiss-password-request") {
        const body = await request.json();
        await ensurePasswordResetRequests(env);
        await env.DB.prepare("DELETE FROM Password_Reset_Requests WHERE User_ID = ?").bind(body.studentId || "").run();
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
    }

    if (request.method === "POST" && path === "/api/reset-student-password") {
        const body = await request.json();
        const { studentId } = body;

        if (!studentId) {
            return new Response(JSON.stringify({ error: "Missing studentId" }), { status: 400, headers: corsHeaders });
        }

        // Only a student's password can be reset here (never another lecturer's), to a random temporary password
        // that is shown once to the lecturer.
        const target = await env.DB.prepare("SELECT role FROM Users WHERE User_ID = ?").bind(studentId).first();
        if (!target || String(target.role || '').toLowerCase() !== 'student') {
            return new Response(JSON.stringify({ error: "Only a student's password can be reset." }), { status: 403, headers: corsHeaders });
        }
        const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        const bytes = crypto.getRandomValues(new Uint8Array(10));
        const tempPassword = Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
        const newHash = await hashPassword(tempPassword, env);
        await env.DB.prepare("UPDATE Users SET Password = ? WHERE User_ID = ?").bind(newHash, studentId).run();
        if (authEnabled(env)) await markPasswordChanged(env, studentId);
        try { await ensurePasswordResetRequests(env); await env.DB.prepare("DELETE FROM Password_Reset_Requests WHERE User_ID = ?").bind(studentId).run(); } catch (e) { /* the request list is tidied later */ }

        return new Response(JSON.stringify({ success: true, message: "Password reset successfully", tempPassword }), { status: 200, headers: corsHeaders });
    }

    if (request.method === "POST" && path === "/api/advance-year-level") {
        const body = await request.json();
        const mode = body.mode;
        await ensureYearAdvanceTables(env);
        await ensureReactivationColumns(env);
        const last = await env.DB.prepare("SELECT Batch_ID, Academic_Year, Advanced, Applied_At FROM Year_Advance_Batches WHERE COALESCE(Undone, 0) = 0 ORDER BY Applied_At DESC LIMIT 1").first();
        const chunks = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

        if (mode === "undo") {
            if (!last) return new Response(JSON.stringify({ error: "There is no advance to undo." }), { status: 404, headers: corsHeaders });
            const rows = (await env.DB.prepare("SELECT * FROM Year_Advance_Log WHERE Batch_ID = ?").bind(last.Batch_ID).all()).results;
            // Only values still equal to what the advance wrote are put back, so later manual edits are kept.
            for (const part of chunks(rows, 50)) {
                await env.DB.batch(part.map(r => env.DB.prepare(
                    "UPDATE Users SET year = CASE WHEN year = ? THEN ? ELSE year END, Program_Year = CASE WHEN Program_Year = ? THEN ? ELSE Program_Year END, account_status = CASE WHEN account_status = ? THEN ? ELSE account_status END WHERE User_ID = ?"
                ).bind(r.New_Year, r.Old_Year, r.New_Program_Year, r.Old_Program_Year, r.New_Status, r.Old_Status, r.User_ID)));
            }
            await env.DB.prepare(`UPDATE Users SET ${CLEAR_REACTIVATION_SQL} WHERE Advanced_Term = ?`).bind(last.Academic_Year).run();
            await env.DB.prepare("UPDATE Year_Advance_Batches SET Undone = 1 WHERE Batch_ID = ?").bind(last.Batch_ID).run();
            return new Response(JSON.stringify({ success: true, restored: rows.length }), { status: 200, headers: corsHeaders });
        }

        if (mode !== "preview" && mode !== "apply") {
            return new Response(JSON.stringify({ error: "Unknown mode." }), { status: 400, headers: corsHeaders });
        }
        const maxYear = Math.min(10, Math.max(1, parseInt(body.maxYear, 10) || 4));
        const ay = body.academicYear ? String(body.academicYear).trim() : "";
        const m = /^(\d{4})-(\d{4})$/.exec(ay);
        if (mode === "apply" && (!m || Number(m[2]) !== Number(m[1]) + 1)) {
            return new Response(JSON.stringify({ error: "Enter the academic year the students are moving into, like 2027-2028." }), { status: 400, headers: corsHeaders });
        }
        const dup = ay ? await env.DB.prepare("SELECT Batch_ID FROM Year_Advance_Batches WHERE Academic_Year = ? AND COALESCE(Undone, 0) = 0").bind(ay).first() : null;
        if (mode === "apply" && dup) {
            return new Response(JSON.stringify({ error: `Year levels were already advanced for ${ay}. Undo that run first if it was a mistake.` }), { status: 409, headers: corsHeaders });
        }

        // Programs can have their own highest year (for example a 5-year program). Remembered between runs.
        await ensureAppSettings(env);
        const savedRow = await env.DB.prepare("SELECT Value FROM App_Settings WHERE Key = 'program_max_year'").first();
        let savedMax = {};
        try { savedMax = savedRow && savedRow.Value ? JSON.parse(savedRow.Value) : {}; } catch (e) { savedMax = {}; }
        const progKey = (v) => String(v || "").trim().toLowerCase();
        const programMax = {};
        const given = body.programMax && typeof body.programMax === "object" ? body.programMax : savedMax;
        for (const [k, v] of Object.entries(given)) {
            const n = parseInt(v, 10);
            if (progKey(k) && n >= 1 && n <= 10 && n !== maxYear) programMax[progKey(k)] = n;
        }

        const students = (await env.DB.prepare("SELECT User_ID, Name, year, Program_Year, Program_Course, course, account_status FROM Users WHERE role COLLATE NOCASE = 'student'").all()).results;
        const plan = [], grad = [], noYear = [];
        const programs = new Map();
        let graduating = 0, unrecognized = 0;
        for (const s of students) {
            const pname = String(s.Program_Course || s.course || "").trim();
            const pk = progKey(pname);
            if (pk) { const e = programs.get(pk) || { name: pname, count: 0 }; e.count++; programs.set(pk, e); }
            const myMax = programMax[pk] || maxYear;
            const ry = nextYearLevel(s.year, myMax);
            if (ry.skip === "graduating") { graduating++; grad.push({ id: s.User_ID, name: s.Name, year: s.year, status: s.account_status }); continue; }
            const rp = nextYearLevel(s.Program_Year, myMax);
            if (!ry.value && !rp.value) { unrecognized++; noYear.push(s.Name); continue; }
            plan.push({
                id: s.User_ID, name: s.Name, oy: s.year, opy: s.Program_Year,
                ny: ry.value || s.year, npy: rp.value || s.Program_Year,
                deactivate: String(s.account_status || "").toLowerCase() === "active"
            });
        }
        const programList = [...programs.entries()].map(([k, e]) => ({ name: e.name, count: e.count, maxYear: programMax[k] || maxYear })).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 200);
        const summary = { total: students.length, advance: plan.length, deactivate: plan.filter(p => p.deactivate).length, graduating, unrecognized, maxYear };

        if (mode === "preview") {
            return new Response(JSON.stringify({
                success: true, ...summary, alreadyDone: !!dup, programs: programList,
                sample: plan.slice(0, 5).map(p => ({ name: p.name, from: p.oy || p.opy, to: p.ny || p.npy })),
                advanceList: plan.slice(0, 300).map(p => ({ name: p.name, from: p.oy || p.opy, to: p.ny || p.npy })),
                graduatingList: grad.slice(0, 300).map(g => ({ name: g.name, year: g.year })),
                noYearList: noYear.slice(0, 300),
                last: last ? { academicYear: last.Academic_Year, advanced: last.Advanced, appliedAt: last.Applied_At } : null
            }), { status: 200, headers: corsHeaders });
        }

        // Optional: students at the highest level become "Graduated" (they can no longer sign in). Undo puts the status back.
        if (body.programMax && typeof body.programMax === "object") {
            await env.DB.prepare("INSERT INTO App_Settings (Key, Value, Updated_By, Updated_At) VALUES ('program_max_year', ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(Key) DO UPDATE SET Value = excluded.Value, Updated_By = excluded.Updated_By, Updated_At = CURRENT_TIMESTAMP").bind(JSON.stringify(programMax), String(body.lecturerId || "")).run();
        }
        const gradPlan = body.markGraduated ? grad.filter(g => String(g.status || "").toLowerCase() === "active") : [];
        const reactivationUntil = /^\d{4}-\d{2}-\d{2}$/.test(String(body.reactivationUntil || "")) ? body.reactivationUntil : null;
        const batchId = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO Year_Advance_Batches (Batch_ID, Academic_Year, Max_Year, Lecturer_ID, Advanced, Applied_At) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(batchId, ay, maxYear, body.lecturerId || null, plan.length, new Date().toISOString()).run();
        for (const part of chunks(plan, 40)) {
            const stmts = [];
            for (const p of part) {
                stmts.push(env.DB.prepare("INSERT INTO Year_Advance_Log (Log_ID, Batch_ID, User_ID, Old_Year, New_Year, Old_Program_Year, New_Program_Year, Old_Status, New_Status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
                    .bind(crypto.randomUUID(), batchId, p.id, p.oy ?? null, p.ny ?? null, p.opy ?? null, p.npy ?? null, p.deactivate ? "Active" : null, p.deactivate ? "Inactive" : null));
                // Moved-up students are Inactive until reactivated (they cannot sign in meanwhile).
                stmts.push(p.deactivate
                    ? env.DB.prepare("UPDATE Users SET year = ?, Program_Year = ?, account_status = 'Inactive', Advanced_Term = ?, Reactivation_Until = ?, Reactivation_Requested = NULL WHERE User_ID = ?").bind(p.ny ?? null, p.npy ?? null, ay, reactivationUntil, p.id)
                    : env.DB.prepare("UPDATE Users SET year = ?, Program_Year = ? WHERE User_ID = ?").bind(p.ny ?? null, p.npy ?? null, p.id));
            }
            await env.DB.batch(stmts);
        }
        for (const part of chunks(gradPlan, 40)) {
            const stmts = [];
            for (const g of part) {
                stmts.push(env.DB.prepare("INSERT INTO Year_Advance_Log (Log_ID, Batch_ID, User_ID, Old_Year, New_Year, Old_Program_Year, New_Program_Year, Old_Status, New_Status) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, 'Graduated')")
                    .bind(crypto.randomUUID(), batchId, g.id, g.year ?? null, g.year ?? null, g.status));
                stmts.push(env.DB.prepare("UPDATE Users SET account_status = 'Graduated' WHERE User_ID = ?").bind(g.id));
            }
            await env.DB.batch(stmts);
        }
        return new Response(JSON.stringify({ success: true, ...summary, graduated: gradPlan.length, batchId }), { status: 200, headers: corsHeaders });
    }

    if (request.method === "GET" && path === "/api/users") {
        await ensureReactivationColumns(env);
        await ensureExamSecurity(env);
        const users = await env.DB.prepare(
            `SELECT User_ID, Username, Name, Avatar, Email, Contact_Number, Student_Number, account_status, course, year, section, Program_Course, Program_Year, Program_Section, eye_condition, Exam_Secure, role, registration_timestamp, Reactivation_Requested
             FROM Users ORDER BY Name ASC`
        ).all();
        return new Response(JSON.stringify({ success: true, users: users.results }), { status: 200, headers: corsHeaders });
    }

    if (request.method === "POST" && path === "/api/update-user-status") {
        const body = await request.json();
        if (!body.studentId || !body.status) {
            return new Response(JSON.stringify({ error: "Missing required parameters." }), { status: 400, headers: corsHeaders });
        }
        await ensureReactivationColumns(env);
        // Setting a student Active (reactivating) closes the reactivation request.
        await env.DB.prepare(
            `UPDATE Users SET account_status = ?${String(body.status).toLowerCase() === "active" ? ", " + CLEAR_REACTIVATION_SQL : ""} WHERE User_ID = ?`
        ).bind(body.status, body.studentId).run();
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
    }

    return null;
}

