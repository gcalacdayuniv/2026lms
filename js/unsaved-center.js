// js/unsaved-center.js
// "Unsaved on this device": one list, across all classes, of everything this phone still keeps a local copy of
// because the server has not been confirmed to hold it: attendance dates (drafts), scanned sheets waiting to
// upload, and exam answers that were not submitted. Each item can be checked against the server (a copy the
// server already has is removed automatically), opened in its class, or discarded.
import { apiFetch } from './globals.js';
import { CourseAttendance } from './course-attendance.js';
import { ScanQueue } from './course-scan-queue.js';
import { countChanges } from './course-pending.js';
import { UI } from './ui-feedback.js';
import { escapeHtml as esc } from './html-utils.js';

const DRAFT_RE = /^attendance_draft_(.+?)_(\d{4}-\d{2}-\d{2})$/;
const EXAM_PREFIX = 'acc_exam_draft_';
const $ = (id) => document.getElementById(id);

const lsKeys = () => {
    const keys = [];
    try { for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); } catch (e) { /* blocked */ }
    return keys.filter(Boolean);
};
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };

// Course names come from the copies the dashboard keeps (dash_cache: / class_cache:), whatever shape they have.
const courseNames = () => {
    const names = {};
    const walk = (node, depth) => {
        if (!node || typeof node !== 'object' || depth > 5) return;
        if (Array.isArray(node)) { node.forEach(n => walk(n, depth + 1)); return; }
        const id = node.Course_ID || node.courseId;
        const nm = node.Course_Name || node.Course_Title || node.Title || node.Name;
        if (id && typeof nm === 'string' && !names[id]) names[id] = nm;
        Object.values(node).forEach(v => walk(v, depth + 1));
    };
    lsKeys().filter(k => k.startsWith('dash_cache:') || k.startsWith('class_cache:')).forEach(k => walk(lsGet(k), 0));
    return names;
};

export const UnsavedCenter = {
    results: {},   // 'courseId|date' -> 'checking' | 'differs' | 'offline'

    collect: () => {
        const names = courseNames();
        const nameOf = (id) => names[id] || `Class ${String(id).slice(0, 8)}`;
        const attendance = [];
        lsKeys().forEach(k => {
            const m = DRAFT_RE.exec(k);
            if (!m) return;
            const draft = lsGet(k) || {};
            attendance.push({ key: k, courseId: m[1], course: nameOf(m[1]), date: m[2], students: Object.keys(draft).length });
        });
        attendance.sort((a, b) => a.course.localeCompare(b.course) || b.date.localeCompare(a.date));

        const byCourse = {};
        ScanQueue.all().forEach(e => { (byCourse[e.courseId] = byCourse[e.courseId] || []).push(e); });
        const scans = Object.entries(byCourse).map(([courseId, list]) => ({ courseId, course: nameOf(courseId), ids: list.map(e => e.scanId), count: list.length }));

        const exams = lsKeys().filter(k => k.startsWith(EXAM_PREFIX)).map(k => {
            const v = lsGet(k);
            return { key: k, answered: v && typeof v === 'object' ? Object.keys(v).length : 0 };
        });
        return { attendance, scans, exams, total: attendance.length + scans.length + exams.length };
    },

    count: () => { try { return UnsavedCenter.collect().total; } catch (e) { return 0; } },

    // Count on the "Unsaved on this device" button of the profile panel.
    updateBadge: () => {
        const n = UnsavedCenter.count();
        document.querySelectorAll('.unsaved-badge').forEach(badge => {
            badge.textContent = String(n);
            badge.classList.toggle('hidden', n === 0);
        });
    },

    // ---------- Drawing ----------

    html: () => {
        const { attendance, scans, exams, total } = UnsavedCenter.collect();
        if (total === 0) {
            return `<div class="text-center py-16 px-6"><i class="fa-solid fa-circle-check text-4xl text-green-500" aria-hidden="true"></i>
                <div class="mt-3 font-black text-gray-800">Nothing unsaved</div>
                <div class="text-sm text-gray-500 mt-1">Everything on this device is already recorded on the server.</div></div>`;
        }
        const block = (title, body) => `<section class="mb-4"><h3 class="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-gray-500">${title}</h3><ul class="bg-white border-y border-gray-200 divide-y divide-gray-100">${body}</ul></section>`;
        const btn = (cls, text, data) => `<button type="button" class="${cls} px-2.5 py-1.5 rounded-md text-xs font-bold ${cls.startsWith('uc-discard') ? 'bg-white border border-gray-300 text-gray-700' : cls === 'uc-open' ? 'bg-blue-600 text-white' : 'bg-green-50 border border-green-300 text-green-800'}" ${data}>${text}</button>`;
        let out = '';
        if (attendance.length) {
            out += block('Attendance dates', attendance.map(a => {
                const st = UnsavedCenter.results[`${a.courseId}|${a.date}`];
                const note = st === 'checking' ? 'checking...' : st === 'differs' ? 'differs from the server' : st === 'offline' ? 'could not reach the server' : 'not checked yet';
                const data = `data-course="${esc(a.courseId)}" data-date="${esc(a.date)}"`;
                return `<li class="px-4 py-3 flex items-center gap-2">
                    <span class="min-w-0 flex-1"><span class="block font-bold text-gray-800 truncate">${esc(a.course)}</span>
                    <span class="block text-sm text-gray-700">${esc(CourseAttendance.describeDate(a.date))} <span class="text-xs text-gray-400">&middot; ${a.students} student${a.students === 1 ? '' : 's'}</span></span>
                    <span class="block text-[11px] ${st === 'differs' ? 'text-amber-700 font-bold' : 'text-gray-400'}">${note}</span></span>
                    <span class="flex flex-col gap-1 shrink-0">${btn('uc-check', 'Check', data)}${btn('uc-open', 'Open class', data)}${btn('uc-discard', 'Discard', data)}</span></li>`;
            }).join(''));
        }
        if (scans.length) {
            out += block('Scanned sheets waiting to upload', scans.map(s => {
                const data = `data-course="${esc(s.courseId)}"`;
                return `<li class="px-4 py-3 flex items-center gap-2"><span class="min-w-0 flex-1"><span class="block font-bold text-gray-800 truncate">${esc(s.course)}</span>
                    <span class="block text-sm text-gray-700">${s.count} scanned sheet${s.count === 1 ? '' : 's'}</span></span>
                    <span class="flex flex-col gap-1 shrink-0">${btn('uc-open', 'Open class', data)}${btn('uc-discard uc-scans', 'Discard', data)}</span></li>`;
            }).join(''));
        }
        if (exams.length) {
            out += block('Exam answers not submitted', exams.map(x => `<li class="px-4 py-3 flex items-center gap-2"><span class="min-w-0 flex-1"><span class="block font-bold text-gray-800">Exam in progress</span>
                    <span class="block text-sm text-gray-700">${x.answered} answer${x.answered === 1 ? '' : 's'} kept on this device</span></span>
                    <span class="shrink-0">${btn('uc-discard uc-exam', 'Discard', `data-key="${esc(x.key)}"`)}</span></li>`).join(''));
        }
        return out;
    },

    render: () => {
        const body = $('ucBody');
        if (!body) return;
        body.innerHTML = UnsavedCenter.html();
        const hasAtt = UnsavedCenter.collect().attendance.length > 0;
        $('ucCheckAll')?.classList.toggle('hidden', !hasAtt);
        UnsavedCenter.updateBadge();
    },

    // ---------- Actions ----------

    open: () => {
        UnsavedCenter.close();
        const wrap = document.createElement('div');
        wrap.id = 'unsavedCenter';
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'true');
        wrap.setAttribute('aria-label', 'Unsaved on this device');
        wrap.className = 'fixed inset-0 flex flex-col bg-gray-50 fade-in';
        wrap.style.cssText = 'z-index:250';
        wrap.innerHTML = `
            <div class="scrv-top"><div class="max-w-4xl mx-auto w-full px-2 sm:px-6 py-2 flex items-center gap-1">
                <button type="button" id="ucClose" aria-label="Close" class="app-page-close text-white/90 hover:text-white"><i class="fa-solid fa-arrow-left text-xl" aria-hidden="true"></i></button>
                <div class="min-w-0 flex-1"><div class="font-black text-white text-base leading-tight">Unsaved on this device</div>
                <div class="text-[11px] text-blue-100">Copies kept here until the server is confirmed to have them</div></div>
                <button type="button" id="ucCheckAll" class="px-3 py-1.5 rounded-lg bg-white/20 text-white text-xs font-bold">Check all</button>
            </div></div>
            <div id="ucBody" class="flex-1 overflow-y-auto" style="padding-bottom:env(safe-area-inset-bottom)"></div>`;
        document.body.appendChild(wrap);
        wrap.addEventListener('click', UnsavedCenter.onClick);
        UnsavedCenter.render();
        $('ucClose').focus();
    },

    close: () => { $('unsavedCenter')?.remove(); UnsavedCenter.updateBadge(); },

    // Compares one date's draft with the server; a draft the server already holds is removed.
    checkOne: async (courseId, date) => {
        const id = `${courseId}|${date}`;
        UnsavedCenter.results[id] = 'checking';
        UnsavedCenter.render();
        try {
            const data = await apiFetch(`/api/attendance?courseId=${courseId}&date=${date}&_t=${Date.now()}`);
            const draft = lsGet(CourseAttendance.getDraftKey(courseId, date)) || {};
            if (data.isNoClass === true || (countChanges(draft, data.records) === 0 && data.records && data.records.length > 0)) {
                CourseAttendance.clearDraft(courseId, date);
                delete UnsavedCenter.results[id];
                return true;
            }
            UnsavedCenter.results[id] = 'differs';
        } catch (e) {
            UnsavedCenter.results[id] = 'offline';
        }
        return false;
    },

    checkAll: async () => {
        const list = UnsavedCenter.collect().attendance;
        let cleared = 0;
        for (const a of list) { if (await UnsavedCenter.checkOne(a.courseId, a.date)) cleared++; }
        UnsavedCenter.render();
        UI.success(cleared ? `${cleared} date${cleared === 1 ? '' : 's'} confirmed saved and cleared` : 'Nothing could be cleared automatically');
    },

    onClick: async (e) => {
        const t = e.target.closest ? e.target : null;
        if (!t) return;
        if (t.closest('#ucClose')) { UnsavedCenter.close(); return; }
        if (t.closest('#ucCheckAll')) { UnsavedCenter.checkAll(); return; }
        const check = t.closest('.uc-check');
        if (check) {
            const ok = await UnsavedCenter.checkOne(check.dataset.course, check.dataset.date);
            UnsavedCenter.render();
            if (ok) UI.success('Confirmed saved on the server and cleared');
            return;
        }
        const open = t.closest('.uc-open');
        if (open) { UnsavedCenter.close(); window.location.hash = `#class-${open.dataset.course}`; return; }
        const dis = t.closest('.uc-discard');
        if (!dis) return;
        let message = 'The copy kept on this device will be deleted. The server keeps what it already has.';
        if (dis.classList.contains('uc-scans')) message = 'The scanned sheets waiting on this device will be deleted and never uploaded.';
        if (dis.classList.contains('uc-exam')) message = 'The exam answers kept on this device will be deleted.';
        const ok = await UI.confirm({ title: 'Discard unsaved copy?', message, confirmText: 'Discard', danger: true });
        if (!ok) return;
        if (dis.classList.contains('uc-scans')) {
            const ids = ScanQueue.forCourse(dis.dataset.course).map(x => x.scanId);
            ScanQueue.remove(ids);
        } else if (dis.classList.contains('uc-exam')) {
            try { localStorage.removeItem(dis.dataset.key); } catch (err) { /* ignore */ }
        } else {
            CourseAttendance.clearDraft(dis.dataset.course, dis.dataset.date);
            delete UnsavedCenter.results[`${dis.dataset.course}|${dis.dataset.date}`];
        }
        UnsavedCenter.render();
    },

    init: () => {
        document.addEventListener('click', (e) => {
            if (!e.target.closest) return;
            if (e.target.closest('.open-unsaved')) UnsavedCenter.open();
            if (e.target.closest('#profileToggleBtn, [data-dash-tab], .class-tab, #openCourseMenuBtn')) setTimeout(UnsavedCenter.updateBadge, 80);
        });
        window.addEventListener('storage', UnsavedCenter.updateBadge);
        window.addEventListener('profile-saved', UnsavedCenter.updateBadge);
        setTimeout(UnsavedCenter.updateBadge, 800);
    }
};
