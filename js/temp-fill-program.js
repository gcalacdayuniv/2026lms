// TEMPORARY: Admin tools > Fill Program Course. Copies each student's class course into a blank Program Course.
// Delete this file, its import in course.js, the tile in components-dashboard.js and /api/fill-program-course once done.
import { apiFetch } from './globals.js';
import { UI } from './ui-feedback.js';

document.addEventListener('click', async (e) => {
    const btn = e.target.closest('#fillProgramBtn');
    if (!btn) return;
    btn.disabled = true;
    try {
        const r = await apiFetch('/api/fill-program-course', { method: 'POST', body: JSON.stringify({ dryRun: true }) });
        if (!r.count) { UI.success('Every student with a class course already has a Program Course.'); return; }
        const ok = await UI.confirm({
            title: 'Fill blank Program Course?',
            message: `${r.count} student${r.count === 1 ? ' has' : 's have'} no Program Course. Their class course will be copied into it. Students who already have one are not changed.`,
            confirmText: 'Fill'
        });
        if (!ok) return;
        const d = await apiFetch('/api/fill-program-course', { method: 'POST', body: JSON.stringify({}) });
        UI.success(`${d.filled} student${d.filled === 1 ? '' : 's'} updated`);
    } catch (err) {
        UI.error(err.message || 'Could not fill Program Course');
    } finally {
        btn.disabled = false;
    }
});
