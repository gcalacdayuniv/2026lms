// Invite codes: a lecturer shows a class's code; a student joins a class by typing it.
import { apiFetch, AppState } from './globals.js';
import { UI } from './ui-feedback.js';
import { escapeHtml } from './html-utils.js';
import { CourseDashboard } from './course-dashboard.js';

const $ = (id) => document.getElementById(id);
const closeDlg = () => { const m = $('invModal'); if (m) m.remove(); };
const BTN = 'px-4 min-h-[44px] text-sm font-bold rounded-md';

const showCode = (code) => {
    const el = $('invCode');
    if (el) el.textContent = code;
};

const openDialog = async (courseId) => {
    closeDlg();
    const menu = $('courseMenuModal');
    if (menu) menu.classList.add('hidden');
    const m = document.createElement('div');
    m.id = 'invModal';
    m.dataset.courseId = courseId;
    m.className = 'fixed inset-0 z-[70] flex items-center justify-center fade-in p-4';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-label', 'Class invite code');
    m.innerHTML = `<div id="invBg" class="absolute inset-0 bg-gray-900 bg-opacity-60"></div>
        <div class="bg-white rounded-lg shadow-xl w-full max-w-sm p-5 relative z-10 text-center">
            <h3 class="text-lg font-bold text-gray-800 mb-1"><i class="fa-solid fa-key text-amber-600 mr-2" aria-hidden="true"></i>Class invite code</h3>
            <p class="text-xs text-gray-600 mb-4">Give this code to your students. They enter it on their dashboard to join this class.</p>
            <div id="invError" role="alert" class="hidden bg-red-100 text-red-700 p-2 rounded text-sm font-medium mb-3"></div>
            <div id="invCode" aria-live="polite" class="text-4xl font-black tracking-[0.3em] text-gray-900 bg-gray-50 border border-gray-200 rounded-lg py-4 mb-4 select-all">······</div>
            <div class="flex flex-wrap justify-center gap-2">
                <button type="button" id="invCopyBtn" class="${BTN} text-white bg-blue-600 hover:bg-blue-700"><i class="fa-regular fa-copy mr-1.5" aria-hidden="true"></i>Copy</button>
                <button type="button" id="invRenewBtn" class="${BTN} text-gray-700 bg-gray-100 hover:bg-gray-200">New code</button>
                <button type="button" id="invCloseBtn" class="${BTN} text-gray-700 bg-gray-100 hover:bg-gray-200">Close</button>
            </div>
            <p class="text-[11px] text-gray-500 mt-3">A new code stops the old one from working. Students already enrolled stay enrolled.</p>
        </div>`;
    document.body.appendChild(m);
    try {
        const r = await apiFetch(`/api/class-invite?courseId=${encodeURIComponent(courseId)}&_t=${Date.now()}`);
        showCode(r.code);
    } catch (e) {
        const err = $('invError');
        err.textContent = e.message || 'Could not load the code.';
        err.classList.remove('hidden');
    }
};

const renew = async () => {
    const m = $('invModal');
    if (!m) return;
    const ok = await UI.confirm({ title: 'Make a new code?', message: 'The old code will stop working. Students already enrolled stay enrolled.', confirmText: 'New code' });
    if (!ok) return;
    try {
        const r = await apiFetch('/api/class-invite', { method: 'POST', body: JSON.stringify({ courseId: m.dataset.courseId, renew: true }) });
        showCode(r.code);
        UI.success('New code ready');
    } catch (e) { UI.error(e.message || 'Could not make a new code'); }
};

const copy = async () => {
    const code = ($('invCode') || {}).textContent || '';
    try { await navigator.clipboard.writeText(code); UI.success('Code copied'); }
    catch (e) { UI.warning('Select the code and copy it by hand.'); }
};

// Student: join a class by code. The form is drawn by the student dashboard.
export const joinFormHtml = () => `
    <section aria-label="Join a class with a code" class="bg-white border border-gray-200 rounded-xl shadow-sm p-4 sm:p-5">
        <h2 class="text-base font-black text-gray-800 mb-1"><i class="fa-solid fa-key text-amber-600 mr-2" aria-hidden="true"></i>Join a class with a code</h2>
        <p class="text-xs text-gray-500 mb-3">Your lecturer gives you the class code.</p>
        <form id="joinClassForm" class="flex flex-col sm:flex-row gap-2" autocomplete="off">
            <label for="joinCode" class="sr-only">Class code</label>
            <input id="joinCode" type="text" maxlength="10" required autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="Enter code" class="flex-1 border border-gray-300 rounded-md px-3 py-2 text-base uppercase tracking-widest font-bold focus:ring-2 focus:ring-blue-500 outline-none">
            <button type="submit" id="joinBtn" class="${BTN} text-white bg-blue-600 hover:bg-blue-700">Join class</button>
        </form>
        <div id="joinError" role="alert" class="hidden mt-2 text-sm font-medium text-red-700"></div>
    </section>`;

document.addEventListener('click', (e) => {
    const open = e.target.closest('#openInviteBtn');
    if (open) { openDialog(window.location.hash.replace('#class-', '')); return; }
    if (e.target.closest('#invCloseBtn') || e.target.id === 'invBg') { closeDlg(); return; }
    if (e.target.closest('#invCopyBtn')) { copy(); return; }
    if (e.target.closest('#invRenewBtn')) renew();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('invModal')) closeDlg(); });

document.addEventListener('submit', async (e) => {
    if (e.target.id !== 'joinClassForm') return;
    e.preventDefault();
    const err = $('joinError'), btn = $('joinBtn');
    err.classList.add('hidden');
    btn.disabled = true;
    try {
        const r = await apiFetch('/api/join-class', { method: 'POST', body: JSON.stringify({ code: $('joinCode').value, studentId: AppState.user.User_ID }) });
        UI.success(`Joined ${r.course ? r.course.CourseCode : 'the class'}`);
        await CourseDashboard.loadDashboardData('fresh');
    } catch (ex) {
        err.textContent = ex.message || 'Could not join the class.';
        err.classList.remove('hidden');
        btn.disabled = false;
    }
});
