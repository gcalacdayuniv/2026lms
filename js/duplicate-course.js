// Copy a class to another term: same details, schedule, room and exams (switched off); no students or records.
import { apiFetch, AppState } from './globals.js';
import { UI } from './ui-feedback.js';
import { escapeHtml } from './html-utils.js';
import { CourseDashboard } from './course-dashboard.js';
import { getTerm } from './current-term.js';

const FIELD = 'w-full border border-gray-300 p-2 rounded-md mt-1 focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50 text-sm';
const LABEL = 'block text-xs font-bold text-gray-500 uppercase tracking-wider';
const SEMS = ['1st Semester', '2nd Semester', 'Summer'];

// The term after the one given: 1st -> 2nd (same year), 2nd or Summer -> 1st of the next year. No term = the current one.
export const nextTerm = (ay, sem) => {
    const m = /^(\d{4})-(\d{4})$/.exec(ay || '');
    if (!m) {
        const t = getTerm();
        return { ay: t.ay, sem: t.sem };
    }
    if (sem === '1st Semester') return { ay, sem: '2nd Semester' };
    const a = Number(m[1]) + 1;
    return { ay: `${a}-${a + 1}`, sem: '1st Semester' };
};

const $ = (id) => document.getElementById(id);
const close = () => { const m = $('dcModal'); if (m) m.remove(); };

const open = (courseId, term) => {
    close();
    const [ay, sem] = (term || '').split('|');
    const n = nextTerm(ay, sem);
    const m = document.createElement('div');
    m.id = 'dcModal';
    m.dataset.courseId = courseId;
    m.className = 'fixed inset-0 z-[70] flex items-center justify-center fade-in p-4';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-label', 'Copy class to another term');
    m.innerHTML = `<div id="dcBg" class="absolute inset-0 bg-gray-900 bg-opacity-60"></div>
        <div class="bg-white rounded-lg shadow-xl w-full max-w-sm p-5 relative z-10">
            <h3 class="text-lg font-bold text-gray-800 mb-1"><i class="fa-solid fa-copy text-blue-600 mr-2" aria-hidden="true"></i>Copy to another term</h3>
            <p class="text-xs text-gray-600 mb-4">Copies the details, schedule, room and exams (switched off, dates cleared). Students, attendance and scores are not copied.</p>
            <div id="dcError" class="hidden bg-red-100 text-red-700 p-2 rounded text-sm font-medium mb-3"></div>
            <div class="grid grid-cols-2 gap-3">
                <div><label class="${LABEL}" for="dcAY">Academic year</label><input id="dcAY" maxlength="9" inputmode="numeric" class="${FIELD}" value="${escapeHtml(n.ay)}"></div>
                <div><label class="${LABEL}" for="dcSem">Semester</label><select id="dcSem" class="${FIELD}">${SEMS.map(s => `<option${s === n.sem ? ' selected' : ''}>${s}</option>`).join('')}</select></div>
            </div>
            <div class="flex justify-end gap-2 mt-5">
                <button type="button" id="dcCancel" class="px-4 py-2 text-sm font-bold text-gray-600 hover:text-gray-800">Cancel</button>
                <button type="button" id="dcCopy" class="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold">Copy class</button>
            </div>
        </div>`;
    document.body.appendChild(m);
};

const copy = async () => {
    const m = $('dcModal');
    const btn = $('dcCopy');
    btn.disabled = true; btn.textContent = 'Copying...';
    const academicYear = $('dcAY').value.trim(), semester = $('dcSem').value;
    try {
        await apiFetch('/api/duplicate-course', {
            method: 'POST',
            body: JSON.stringify({ courseId: m.dataset.courseId, lecturerId: AppState.user.User_ID, academicYear, semester })
        });
        close();
        UI.success('Class copied');
        CourseDashboard.view = 'active';   // the copy is a new class: show My classes
        if (document.getElementById('classTabBar')) window.location.hash = 'dashboard';
        await CourseDashboard.loadDashboardData('fresh');
    } catch (e) {
        const box = $('dcError');
        box.textContent = e.message || 'Could not copy the class.';
        box.classList.remove('hidden');
        btn.disabled = false; btn.textContent = 'Copy class';
    }
};

document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('.duplicate-course-btn');
    if (t) { e.preventDefault(); open(t.dataset.courseId, t.dataset.term); return; }
    if (e.target.closest && (e.target.closest('#dcCancel') || e.target.id === 'dcBg')) { close(); return; }
    if (e.target.closest && e.target.closest('#dcCopy')) copy();
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && $('dcModal')) close(); });
