// TEMPORARY: Admin tools > Fill Program Details. Copies each student's class course, year and section into blank Program course, year and section.
// Delete this file, its import in course.js, the tile in components-dashboard.js and /api/fill-program-course once done.
import { apiFetch } from './globals.js';
import { UI } from './ui-feedback.js';

document.addEventListener('click', async (e) => {
    const btn = e.target.closest('#fillProgramBtn');
    if (!btn) return;
    btn.disabled = true;
    try {
        const r = await apiFetch('/api/fill-program-course', { method: 'POST', body: JSON.stringify({ dryRun: true }) });
        if (!r.count) { UI.success('No student has a blank Program course, year or section that can be filled.'); return; }
        const ok = await UI.confirm({
            title: 'Fill blank Program details?',
            message: `${r.count} student${r.count === 1 ? ' has' : 's have'} a blank Program course, year or section. Only the blank ones are filled from the class course, year and section; filled ones are not changed.`,
            confirmText: 'Fill'
        });
        if (!ok) return;
        const d = await apiFetch('/api/fill-program-course', { method: 'POST', body: JSON.stringify({}) });
        UI.success(`${d.filled} student${d.filled === 1 ? '' : 's'} updated`);
    } catch (err) {
        UI.error(err.message || 'Could not fill Program details');
    } finally {
        btn.disabled = false;
    }
});
