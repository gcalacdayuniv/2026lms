// Manage Users > Edit details: a lecturer corrects a student's details and eye condition tag.
import { apiFetch } from './globals.js';
import { UI } from './ui-feedback.js';
import { escapeHtml } from './html-utils.js';
import { AuthModule } from './auth.js';

const $ = (id) => document.getElementById(id);
const close = () => { const m = $('esModal'); if (m) m.remove(); };
const FIELD = 'w-full border border-gray-300 rounded-md p-2 text-base focus:ring-2 focus:ring-blue-500 outline-none';
const LABEL = 'block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1';
const EYE = ['No Eye Condition', 'Near Sighted', 'Far Sighted', 'Legally Blind'];

const input = (id, label, value, extra = '') => `<div><label for="${id}" class="${LABEL}">${label}</label><input id="${id}" type="text" value="${escapeHtml(value || '')}" class="${FIELD}" ${extra}></div>`;

const open = (userId) => {
    const u = (AuthModule.usersList || []).find(x => x.User_ID === userId);
    if (!u) return;
    close();
    const m = document.createElement('div');
    m.id = 'esModal';
    m.dataset.userId = userId;
    m.className = 'fixed inset-0 z-[70] flex items-center justify-center fade-in p-0 sm:p-4';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-label', 'Edit student details');
    m.innerHTML = `<div id="esBg" class="absolute inset-0 bg-gray-900 bg-opacity-60"></div>
        <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full sm:max-w-lg h-full sm:h-auto p-4 sm:p-6 relative z-10 max-h-full sm:max-h-[90vh] overflow-y-auto">
            <div class="flex items-center gap-3 mb-4 border-b pb-3">
                <h3 class="min-w-0 flex-1 truncate text-lg font-bold text-gray-800"><i class="fa-solid fa-user-pen text-blue-600 mr-2" aria-hidden="true"></i>Edit student</h3>
                <button id="esCloseBtn" type="button" aria-label="Close" class="text-gray-400 hover:text-gray-800 min-h-[44px] min-w-[44px]"><i class="fa-solid fa-xmark text-xl" aria-hidden="true"></i></button>
            </div>
            <div id="esError" role="alert" class="hidden bg-red-100 text-red-700 p-2 rounded text-sm font-medium mb-3"></div>
            <div class="space-y-3">
                ${input('esName', 'Name', u.Name)}
                <div class="grid grid-cols-2 gap-3">
                    ${input('esNo', 'Student number', u.Student_Number, 'placeholder="00-0000" inputmode="numeric" maxlength="7"')}
                    ${input('esContact', 'Contact number', u.Contact_Number, 'inputmode="tel"')}
                </div>
                ${input('esEmail', 'Email', u.Email, 'inputmode="email"')}
                <p class="text-xs font-bold text-gray-700 pt-1">Program</p>
                <div class="grid grid-cols-3 gap-3">${input('esPCourse', 'Course', u.Program_Course)}${input('esPYear', 'Year', u.Program_Year)}${input('esPSection', 'Section', u.Program_Section)}</div>
                <div><label for="esEye" class="${LABEL}">Eye condition / disability tag</label>
                    <select id="esEye" class="${FIELD}">${EYE.map(e => `<option value="${e}"${(u.eye_condition || 'No Eye Condition') === e ? ' selected' : ''}>${e === 'Legally Blind' ? 'Legally Blind (Accessible Read-Aloud)' : e}</option>`).join('')}</select></div>
            </div>
            <div class="flex justify-end gap-2 mt-5">
                <button type="button" id="esCancelBtn" class="px-4 min-h-[44px] text-sm font-bold text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">Cancel</button>
                <button type="button" id="esSaveBtn" class="px-5 min-h-[44px] text-sm font-bold text-white bg-blue-600 rounded-md hover:bg-blue-700">Save</button>
            </div>
        </div>`;
    document.body.appendChild(m);
    $('esName').focus();
};

const save = async () => {
    const m = $('esModal');
    const err = $('esError');
    err.classList.add('hidden');
    const b = $('esSaveBtn');
    b.disabled = true;
    try {
        const r = await apiFetch('/api/admin-update-student', {
            method: 'POST',
            body: JSON.stringify({
                studentId: m.dataset.userId, name: $('esName').value, studentNumber: $('esNo').value, contact: $('esContact').value, email: $('esEmail').value,
                
                programCourse: $('esPCourse').value, programYear: $('esPYear').value, programSection: $('esPSection').value, eyeCondition: $('esEye').value
            })
        });
        const u = AuthModule.usersList.find(x => x.User_ID === m.dataset.userId);
        if (u) Object.assign(u, r.student);
        AuthModule.renderManageUsers();
        close();
        UI.success('Student details saved');
    } catch (e) {
        err.textContent = (e && e.message) || 'Could not save.';
        err.classList.remove('hidden');
        b.disabled = false;
    }
};

document.addEventListener('click', (e) => {
    const edit = e.target.closest('.mu-edit-btn');
    if (edit) { open(edit.dataset.userId); return; }
    if (e.target.closest('#esCloseBtn') || e.target.closest('#esCancelBtn') || e.target.id === 'esBg') { close(); return; }
    if (e.target.closest('#esSaveBtn')) save();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('esModal')) close(); });
