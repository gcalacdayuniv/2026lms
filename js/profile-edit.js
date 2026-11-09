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
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 flex items-center justify-center p-4 fade-in';
    overlay.style.zIndex = '330';   // inline: see UI.confirm for why
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Confirm with password');
    overlay.innerHTML = `
        <div class="absolute inset-0 bg-gray-900 bg-opacity-60" data-pw-cancel></div>
        <form class="relative bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4" autocomplete="off">
            <div>
                <h3 class="text-base font-bold text-gray-800"><i class="fa-solid fa-shield-halved text-blue-600 mr-2" aria-hidden="true"></i>Confirm your changes</h3>
                <p class="text-xs text-gray-500 mt-1">Enter your current password to save.</p>
            </div>
            <input type="password" id="udPasswordPrompt" required autocomplete="current-password" placeholder="Current password" class="block w-full px-3 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
            <div class="grid grid-cols-2 gap-3">
                <button type="button" data-pw-cancel class="py-2.5 rounded-md border border-gray-300 text-sm font-bold text-gray-700 bg-white">Cancel</button>
                <button type="submit" class="py-2.5 rounded-md text-sm font-bold text-white bg-blue-600">Save</button>
            </div>
        </form>`;
    const done = (value) => { overlay.remove(); resolve(value); };
    overlay.addEventListener('click', (e) => { if (e.target.closest('[data-pw-cancel]')) done(null); });
    overlay.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const v = overlay.querySelector('input').value;
        if (v) done(v);
    });
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
    document.body.appendChild(overlay);
    setTimeout(() => overlay.querySelector('input')?.focus(), 50);
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
