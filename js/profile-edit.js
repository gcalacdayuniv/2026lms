// js/profile-edit.js
// Profile page details: read-only until "Edit" is pressed. Saving asks for the password, but only when something changed.
// The save itself is the existing #updateDetailsForm submit handler in auth.js.
import { AppState } from './globals.js';
import { UI } from './ui-feedback.js';

const $ = (id) => document.getElementById(id);
const fields = () => [...document.querySelectorAll('#updateDetailsForm .ud-field')];

let snapshot = null;   // field values when editing started

const setEditing = (on) => {
    fields().forEach(f => { if (on) f.removeAttribute('readonly'); else f.setAttribute('readonly', ''); });
    $('udActions')?.classList.toggle('hidden', !on);
    $('udEditBtn')?.classList.toggle('hidden', on);
    $('updateDetailsForm')?.classList.toggle('is-editing', on);
    if (!on) snapshot = null;
};

const isDirty = () => !!snapshot && fields().some(f => snapshot[f.id] !== f.value);

const restore = () => {
    if (snapshot) fields().forEach(f => { if (f.id in snapshot) f.value = snapshot[f.id]; });
    $('udError')?.classList.add('hidden');
    $('udSuccess')?.classList.add('hidden');
};

// Password prompt. Resolves with the password, or null when cancelled.
const askPassword = () => new Promise((resolve) => {
    let value = null;
    const dlg = UI.overlay({
        id: 'pwPrompt', label: 'Confirm with password', z: 330, onClose: () => resolve(value),
        panelClass: 'bg-white rounded-xl shadow-2xl max-w-sm p-5',
        html: `<form class="space-y-4" autocomplete="off">
            <div>
                <h3 class="text-base font-bold text-gray-800"><i class="fa-solid fa-shield-halved text-blue-600 mr-2" aria-hidden="true"></i>Confirm your changes</h3>
                <p class="text-xs text-gray-500 mt-1">Enter your current password to save.</p>
            </div>
            <label for="udPasswordPrompt" class="sr-only">Current password</label>
            <input type="password" id="udPasswordPrompt" required autocomplete="current-password" placeholder="Current password" class="block w-full px-3 py-2.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-base">
            <div class="grid grid-cols-2 gap-3">
                <button type="button" data-overlay-close class="min-h-[44px] rounded-md border border-gray-300 text-sm font-bold text-gray-700 bg-white">Cancel</button>
                <button type="submit" class="min-h-[44px] rounded-md text-sm font-bold text-white bg-blue-600">Save</button>
            </div>
        </form>`
    });
    dlg.panel.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const v = dlg.panel.querySelector('input').value;
        if (v) { value = v; dlg.close(); }
    });
});

export const ProfileEdit = {
    init: () => {
        document.addEventListener('click', (e) => {
            if (!e.target.closest) return;
            if (e.target.closest('#udEditBtn')) {
                snapshot = {};
                fields().forEach(f => { snapshot[f.id] = f.value; });
                setEditing(true);
                fields()[0]?.focus();
            } else if (e.target.closest('#udCancelBtn')) {
                restore();
                setEditing(false);
            }
        });

        // Runs before auth.js's submit handler (capture phase). The first submit only collects the password.
        document.addEventListener('submit', async (e) => {
            if (e.target.id !== 'updateDetailsForm') return;
            const pw = $('udPassword');
            if (pw && pw.value) return;   // password present: let auth.js save it
            e.preventDefault();
            e.stopImmediatePropagation();
            if (!isDirty()) {
                setEditing(false);
                UI.info('No changes to save');
                return;
            }
            const value = await askPassword();
            if (value === null) return;
            pw.value = value;
            e.target.requestSubmit();
        }, true);

        document.addEventListener('profile-saved', () => {
            setEditing(false);
            const u = AppState.user;
            if (!u) return;
            const name = $('profileNameText'); if (name) name.textContent = u.Name;
            const un = $('profileUsernameText'); if (un) un.textContent = u.Username || 'N/A';
            document.querySelectorAll('#profileToggleBtn span.sm\\:block').forEach(el => { el.textContent = u.Name; });
        });
    }
};
