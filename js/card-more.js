// "More" on a dashboard class card: a sheet of that class's actions, opened without loading the class.
// Actions that need the class screen open it with data-intent (handled in dash-nav.js); Copy and
// Archive use the same buttons as the class menu (duplicate-course.js, course-dashboard.js).
import { escapeHtml } from './html-utils.js';
import { UI } from './ui-feedback.js';

const $ = (id) => document.getElementById(id);

const tile = (icon, tone, label, attrs) =>
    `<${attrs.href ? 'a' : 'button type="button"'} class="menu-tile ${attrs.cls || ''}" ${attrs.href ? `href="${attrs.href}"` : ''} ${attrs.data || ''}>
        <span class="menu-tile-icon ${tone}"><i class="${icon}" aria-hidden="true"></i></span><span class="menu-tile-label">${label}</span></${attrs.href ? 'a' : 'button'}>`;

const section = (title, tiles) => `<section><h4 class="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">${title}</h4><div class="grid grid-cols-3 gap-2">${tiles.join('')}</div></section>`;

const close = () => UI.closeOverlay('cardMoreSheet');

const open = (d) => {
    close();
    const href = `#class-${d.courseId}`;
    const go = (icon, tone, label, intent) => tile(icon, tone, label, { href, data: `data-intent="${intent}"` });
    const archived = d.archived === '1';
    UI.overlay({ id: 'cardMoreSheet', label: `Actions for ${d.code}`, z: 70, padClass: 'p-0', alignClass: 'items-end sm:items-center', panelClass: 'bg-white sm:max-w-sm rounded-t-2xl sm:rounded-lg shadow-xl p-4 max-h-[85vh] overflow-y-auto', html: `<div class="flex items-center gap-3 mb-4 border-b pb-3">
                <div class="min-w-0 flex-1"><h3 class="text-lg font-bold text-gray-800 truncate"><i class="fa-solid fa-layer-group text-blue-600 mr-2" aria-hidden="true"></i>Course Actions</h3><p class="text-xs text-gray-500 truncate">${escapeHtml(d.code)}</p></div>
                <button type="button" id="cardMoreClose" data-overlay-close class="p-2 text-gray-500 hover:text-gray-800" aria-label="Close"><i class="fa-solid fa-xmark text-xl" aria-hidden="true"></i></button>
            </div>
            <div class="space-y-4">
                ${section('Students', [
                    go('fa-solid fa-user-plus', 'bg-green-100 text-green-700', 'Enroll Student', 'openAddStudentModalBtn'),
                    tile('fa-solid fa-key', 'bg-amber-100 text-amber-700', 'Invite Code', { cls: 'open-invite-btn', data: `data-course-id="${escapeHtml(d.courseId)}"` }),
                    go('fa-regular fa-copy', 'bg-blue-100 text-blue-700', 'Copy Emails', 'copyEmailsBtn'),
                    go('fa-solid fa-chair', 'bg-sky-100 text-sky-700', 'Seat Plan', 'openSeatPlanBtn'),
                    go('fa-solid fa-people-group', 'bg-violet-100 text-violet-700', 'Groups', 'openGroupsBtn'),
                    go('fa-solid fa-print', 'bg-gray-200 text-gray-800', 'Print Roster', 'exportRosterBtn')])}
                ${section('Grades & Exams', [
                    go('fa-solid fa-pen-to-square', 'bg-teal-100 text-teal-700', 'Record Scores', 'openScoresModalBtn'),
                    go('fa-solid fa-file-contract', 'bg-indigo-100 text-indigo-700', 'Manage Exams', 'openExamManagerBtn')])}
                ${section('Calendar', [
                    go('fa-solid fa-calendar-check', 'bg-sky-100 text-sky-700', 'Attendance Dates', 'openAttendanceDatesBtn'),
                    go('fa-solid fa-calendar-xmark', 'bg-orange-100 text-orange-700', 'No Class Days', 'openNoClassModalBtn'),
                    go('fa-solid fa-book-open', 'bg-emerald-100 text-emerald-700', 'Course Plan', 'openCoursePlanBtn')])}
                ${section('This class', [
                    tile('fa-solid fa-copy', 'bg-indigo-100 text-indigo-700', 'Copy to another term', { cls: 'duplicate-course-btn', data: `data-course-id="${escapeHtml(d.courseId)}" data-term="${escapeHtml(d.term)}"` }),
                    tile(archived ? 'fa-solid fa-box-open' : 'fa-solid fa-box-archive', 'bg-gray-200 text-gray-800', archived ? 'Restore class' : 'Archive class', { cls: 'archive-course-btn', data: `data-course-id="${escapeHtml(d.courseId)}" data-archive="${archived ? '0' : '1'}"` })])}
            </div>` });
};

document.addEventListener('click', (e) => {
    const more = e.target.closest && e.target.closest('.card-more');
    if (more) { e.preventDefault(); open(more.dataset); return; }
    if (!$('cardMoreSheet')) return;
    if (e.target.closest('#cardMoreSheet .menu-tile')) setTimeout(close, 0);
});
window.addEventListener('hashchange', close);
