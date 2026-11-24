// worker/worker.js
import { authorize } from './auth.js';
import { handleAttendance } from './attendance.js';
import { handleScores } from './scores.js';
import { handleGroups } from './groups.js';
import { handleExams } from './exams.js';
import { handleExamPhotos } from './exam-photos.js';
import { handleRoles } from './roles.js';
import { handleSiteSettings } from './site-settings.js';
import { handleExamSession } from './exam-session.js';
import { ensureCoreIndexes, ensureCourseRoom } from './schema.js';
import { handleUploads } from './uploads.js';
import { handleAccounts } from './accounts.js';
import { handleCourses } from './courses.js';
import { handleScanSheets } from './scan-sheets.js';
import { purgeOldAttempts } from './shared.js';
import { maybeSweep } from './term-sweep.js';

// Origins allowed to call this API. ALLOWED_ORIGIN may hold several origins separated by commas.
// Never falls back to "*": an unknown origin simply receives the primary allowed origin,
// which the browser then rejects.
function resolveAllowedOrigin(env, requestOrigin) {
    const configured = String(env.ALLOWED_ORIGIN || '')
        .split(',')
        .map(o => o.trim())
        .filter(Boolean);
    const list = [...configured, "https://plv.workers.dev", "https://www.plv.workers.dev"];
    if (requestOrigin && list.includes(requestOrigin)) return requestOrigin;
    return list[0];
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname.replace(/\/$/, '');
        const requestOrigin = request.headers.get("Origin");

        const allowedOrigin = resolveAllowedOrigin(env, requestOrigin);

        const corsHeaders = {
            "Access-Control-Allow-Origin": allowedOrigin,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Submission-Meta, X-Chunk-Meta",
            "Access-Control-Max-Age": "86400",
            "Vary": "Origin",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "Cache-Control": "no-store"
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            ctx.waitUntil(ensureCoreIndexes(env).catch(() => {}));
            // About 1 request in 100 tidies old sign-in attempt rows in the background.
            if (Math.random() < 0.01) ctx.waitUntil(purgeOldAttempts(env).catch(() => {}));
            // About 1 request in 20 checks (at most every 6 hours) for accounts whose classes have all ended.
            if (Math.random() < 0.05) ctx.waitUntil(maybeSweep(env).catch(() => {}));

            // Who is calling, and may they do this? (Off until the SESSION_SECRET secret is set.)
            const gate = await authorize(request, env, path, url);
            if (!gate.ok) {
                return new Response(JSON.stringify({ error: gate.error }), { status: gate.status, headers: corsHeaders });
            }

            if (path === "/api/courses" || path === "/api/my-courses" || path === "/api/course-details" || path === "/api/update-course-room" || path === "/api/update-course" || path === "/api/archive-course" || path === "/api/duplicate-course") {
                await ensureCourseRoom(env);
            }

            const photosResponse = await handleExamPhotos(request, env, path, url, corsHeaders, gate.user);
            if (photosResponse) return photosResponse;

            const siteResponse = await handleSiteSettings(request, env, path, url, corsHeaders, gate.user);
            if (siteResponse) return siteResponse;

            const rolesResponse = await handleRoles(request, env, path, url, corsHeaders, gate.user);
            if (rolesResponse) return rolesResponse;

            const sessionResponse = await handleExamSession(request, env, path, url, corsHeaders);
            if (sessionResponse) return sessionResponse;

            const examsResponse = await handleExams(request, env, path, url, corsHeaders);
            if (examsResponse) return examsResponse;

            const uploadsResponse = await handleUploads(request, env, path, url, corsHeaders, gate.user);
            if (uploadsResponse) return uploadsResponse;

            const accountsResponse = await handleAccounts(request, env, path, url, corsHeaders);
            if (accountsResponse) return accountsResponse;

            const groupsResponse = await handleGroups(request, env, path, url, corsHeaders);
            if (groupsResponse) return groupsResponse;

            const coursesResponse = await handleCourses(request, env, path, url, corsHeaders);
            if (coursesResponse) return coursesResponse;

            const attendanceResponse = await handleAttendance(request, env, path, url, corsHeaders);
            if (attendanceResponse) return attendanceResponse;

            const scanSheetsResponse = await handleScanSheets(request, env, path, url, corsHeaders);
            if (scanSheetsResponse) return scanSheetsResponse;

            const scoresResponse = await handleScores(request, env, path, url, corsHeaders);
            if (scoresResponse) return scoresResponse;

            return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers: corsHeaders });

        } catch (err) {
            // The details go to the Worker log; the browser only gets a general message (database errors name tables and columns).
            console.error('Unhandled error on', request.method, path, err && err.stack ? err.stack : err);
            return new Response(JSON.stringify({ error: "Something went wrong on the server. Please try again." }), { status: 500, headers: corsHeaders });
        }
    }
};
