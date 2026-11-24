// js/submission-edit.js
// Lecturer: change the term, title and description of a student's upload.
// The Worker keeps the "[Group Upload ...]" tags and updates every member's row of a group upload.
import { apiFetch } from './globals.js';
import { UI } from './ui-feedback.js';
import { CourseClass } from './course-class.js';

const byId = (id) => document.getElementById(id);
const TAG_AT = /\n\n\[(Group Upload by:|Uploaded by lecturer:)/;
let editingId = null;

const alertBox = (message) => {
    const box = byId('seAlert');
    if (!box) return;
    box.textContent = message;
    box.classList.toggle('hidden', !message);
};

const close = () => { byId('editSubmissionModal')?.classList.add('hidden'); editingId = null; };

const refresh = async () => {
    const studentId = CourseClass.currentSummaryStudentId;
    const courseId = window.location.hash.replace('#class-', '');
    if (!studentId || !courseId) return;
    const data = await apiFetch(`/api/student-summary?courseId=${courseId}&studentId=${studentId}&_t=${Date.now()}`);
    if (CourseClass.currentSummaryData) CourseClass.currentSummaryData.submissions = data.submissions;
    CourseClass.renderSubmissionsHistory(data.submissions, 'historySubmissionsList');
};

export const SubmissionEdit = {
    init: () => document.addEventListener('click', SubmissionEdit.handleClicks),

    handleClicks: async (e) => {
        const edit = e.target.closest('.edit-submission-btn');
        if (edit) {
            const sub = ((CourseClass.currentSummaryData || {}).submissions || []).find(x => x.Submission_ID === edit.dataset.subId);
            if (!sub || !byId('editSubmissionModal')) return;
            editingId = sub.Submission_ID;
            const d = String(sub.Description || '');
            const at = d.search(TAG_AT);
            byId('seTerm').value = sub.Term === 'FinalTerm' ? 'FinalTerm' : 'MidTerm';
            byId('seTitle').value = sub.Title || '';
            byId('seDesc').value = at >= 0 ? d.slice(0, at) : d;
            alertBox('');
            byId('editSubmissionModal').classList.remove('hidden');
            return;
        }
        if (e.target.closest('#closeEditSubmissionBtn') || e.target.id === 'closeEditSubmissionBg') { close(); return; }
        if (e.target.closest('#seSaveBtn') && editingId) {
            const btn = byId('seSaveBtn');
            btn.disabled = true;
            alertBox('');
            try {
                await apiFetch('/api/update-submission', {
                    method: 'POST',
                    body: JSON.stringify({ submissionId: editingId, term: byId('seTerm').value, title: byId('seTitle').value, description: byId('seDesc').value })
                });
                close();
                await refresh();
                UI.toast('Details saved.', 'success');
            } catch (err) { alertBox(err.message || 'Could not save.'); }
            btn.disabled = false;
        }
    }
};
