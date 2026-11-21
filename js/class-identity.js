// A class can carry a course, year and section (for example BSIT 3-A) to identify it. It does not limit who can join.
import { apiFetch } from './globals.js';
import { escapeHtml } from './html-utils.js';

// Fills a <select> with the program list ("Not set" first) and keeps `current` selected.
export const fillClassCourseOptions = async (selectId, current = '') => {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    let codes = [];
    try { codes = ((await apiFetch(`/api/programs?_t=${Date.now()}`)).programs || []).map(p => p.ProgramCode); } catch (e) { /* keep the current value only */ }
    if (current && !codes.includes(current)) codes.push(current);
    sel.innerHTML = '<option value="">Not set</option>' + codes.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    sel.value = current || '';
};

export const classIdentityBlock = (ids, v = {}, f = {}) => {
    const field = f.field || 'w-full border border-gray-300 p-2 rounded-md mt-1 focus:ring-2 focus:ring-blue-500 outline-none bg-gray-50 text-base';
    const label = f.label || 'block text-xs font-bold text-gray-500 uppercase tracking-wider';
    const esc = escapeHtml;
    return `<div class="border-t border-gray-200 pt-4 mt-4">
        <p class="text-xs font-bold text-gray-800 mb-1 uppercase mb-2">Class course, year and section</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label class="${label}" for="${ids.course}">Course</label>
                <select id="${ids.course}" class="${field}"><option value="">Not set</option>${v.course ? `<option value="${esc(v.course)}" selected>${esc(v.course)}</option>` : ''}</select></div>
            <div><label class="${label}" for="${ids.year}">Year</label>
                <input type="text" id="${ids.year}" maxlength="20" class="${field}" value="${esc(v.year || '')}" placeholder="e.g. 3"></div>
        </div>
        <div class="mt-4"><label class="${label}" for="${ids.section}">Section</label>
            <input type="text" id="${ids.section}" maxlength="20" class="${field}" value="${esc(v.section || '')}" placeholder="e.g. A"></div>
    </div>`;
};
