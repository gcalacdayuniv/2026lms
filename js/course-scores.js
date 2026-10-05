// js/course-scores.js
import { apiFetch } from './globals.js';
import { CourseSummary } from './course-summary.js';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmt = (n) => Number(Number(n).toFixed(2));

const TERM_LABELS = { MidTerm: 'Mid Term', FinalTerm: 'Final Term' };
const CATEGORY_LABELS = {
    Written: 'Written Output (Quizzes/Long)',
    Performance: 'Performance Output (Tasks)',
    MajorExam: 'Major Exam'
};
const CATEGORY_ELEMENT = {
    Written: 'WrittenScore',
    Performance: 'PerformanceTaskScore',
    MajorExam: 'MajorExamScore'
};

export const CourseScores = {
    summaryData: null,
    courseId: null,
    students: [],
    assessments: [],
    currentId: '',

    init: () => {
        document.addEventListener('click', CourseScores.handleClicks);
        document.addEventListener('change', CourseScores.handleChanges);
        document.addEventListener('keydown', CourseScores.handleKeydown);
    },

    handleClicks: async (e) => {
        if (e.target.closest('.view-scores-trigger')) {
            const trigger = e.target.closest('.view-scores-trigger');
            CourseScores.showBreakdown(trigger.dataset.term, trigger.dataset.category);
        }

        if (e.target.closest('#openScoresModalBtn')) {
            document.getElementById('courseMenuModal')?.classList.add('hidden');
            document.getElementById('scoresModal').classList.remove('hidden');
            CourseScores.courseId = window.location.hash.replace('#class-', '');
            await CourseScores.load();
        }

        if (e.target.closest('#closeScoresModalBtn') || e.target.id === 'closeScoresModalBg') {
            document.getElementById('scoresModal').classList.add('hidden');
        }

        if (e.target.closest('#scSaveBtn')) {
            await CourseScores.save();
        }

        if (e.target.closest('#scDeleteBtn')) {
            await CourseScores.remove();
        }
    },

    handleChanges: async (e) => {
        if (e.target.id === 'scAssessmentSelect') {
            await CourseScores.selectAssessment(e.target.value);
        }
    },

    handleKeydown: (e) => {
        if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('score-input')) {
            e.preventDefault();
            const inputs = Array.from(document.querySelectorAll('.score-input'));
            const next = inputs[inputs.indexOf(e.target) + 1];
            if (next) {
                next.focus();
                next.select();
            }
        }
    },

    // ---------- Student / summary side ----------

    renderTermScores: (term, data) => {
        CourseScores.summaryData = data;
        const subTerm = term === 'midterm' ? 'MidTerm' : 'FinalTerm';
        const assessments = data.assessments || [];

        Object.keys(CATEGORY_ELEMENT).forEach(category => {
            const el = document.getElementById(`${term}${CATEGORY_ELEMENT[category]}`);
            if (!el) return;

            const scored = assessments.filter(a => a.Term === subTerm && a.Category === category && a.Score !== null && a.Score !== undefined);
            if (scored.length === 0) {
                el.textContent = '—';
                return;
            }
            const total = scored.reduce((sum, a) => sum + a.Score, 0);
            const max = scored.reduce((sum, a) => sum + a.Max_Score, 0);
            el.textContent = `${fmt(total)}/${fmt(max)}`;
        });
    },

    showBreakdown: (term, category) => {
        const data = CourseScores.summaryData;
        if (!data) return;

        const subTerm = term === 'midterm' ? 'MidTerm' : 'FinalTerm';
        const items = (data.assessments || []).filter(a => a.Term === subTerm && a.Category === category);

        document.getElementById('detailsModalTitle').textContent = `${TERM_LABELS[subTerm]} | ${CATEGORY_LABELS[category]}`;
        document.getElementById('detailsScoreHeader').textContent = 'Score';

        const tbody = document.getElementById('detailsTableBody');
        if (items.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="px-3 py-4 text-center text-gray-500 italic">No scores recorded for this period.</td></tr>';
        } else {
            tbody.innerHTML = items.map(a => {
                const scoreText = (a.Score === null || a.Score === undefined) ? '—' : `${fmt(a.Score)}/${fmt(a.Max_Score)}`;
                return `
                    <tr class="hover:bg-gray-50 transition">
                        <td class="px-3 py-2 whitespace-nowrap font-medium text-gray-700">${esc(a.Date || '')}</td>
                        <td class="px-3 py-2 text-center text-gray-600">${esc(a.Title)}</td>
                        <td class="px-3 py-2 text-center font-mono font-bold text-blue-600">${scoreText}</td>
                    </tr>
                `;
            }).join('');
        }

        document.getElementById('detailsModal').classList.remove('hidden');
    },

    // ---------- Lecturer side (Record Scores modal) ----------

    setAlert: (message, ok) => {
        const box = document.getElementById('scAlert');
        if (!box) return;
        if (!message) {
            box.classList.add('hidden');
            return;
        }
        box.textContent = message;
        box.className = `mb-3 p-2 rounded text-xs font-bold fade-in ${ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`;
    },

    load: async () => {
        CourseScores.setAlert('');
        const body = document.getElementById('scGridBody');
        body.innerHTML = '<tr><td colspan="4" class="px-3 py-8 text-center text-gray-500"><i class="fa-solid fa-spinner fa-spin text-xl text-blue-600"></i></td></tr>';

        try {
            const ts = new Date().getTime();
            const [details, list] = await Promise.all([
                apiFetch(`/api/course-details?courseId=${CourseScores.courseId}&_t=${ts}`),
                apiFetch(`/api/assessments?courseId=${CourseScores.courseId}&_t=${ts}`)
            ]);
            CourseScores.students = CourseSummary.sortStudents(details.students || []);
            CourseScores.assessments = list.assessments || [];
            CourseScores.currentId = '';
            CourseScores.renderSelect();
            await CourseScores.selectAssessment('');
        } catch (err) {
            body.innerHTML = '';
            CourseScores.setAlert(err.message || 'Failed to load.', false);
        }
    },

    renderSelect: () => {
        const select = document.getElementById('scAssessmentSelect');
        const options = ['<option value="">+ New assessment</option>'].concat(
            CourseScores.assessments.map(a =>
                `<option value="${esc(a.Assessment_ID)}">${esc(TERM_LABELS[a.Term] || a.Term)} | ${esc(CATEGORY_LABELS[a.Category] || a.Category)} | ${esc(a.Title)} (${fmt(a.Max_Score)})</option>`
            )
        );
        select.innerHTML = options.join('');
        select.value = CourseScores.currentId;
    },

    selectAssessment: async (id) => {
        CourseScores.currentId = id;
        CourseScores.setAlert('');
        const deleteBtn = document.getElementById('scDeleteBtn');
        const today = new Date().toISOString().split('T')[0];

        if (!id) {
            document.getElementById('scTitle').value = '';
            document.getElementById('scMax').value = '';
            document.getElementById('scDate').value = today;
            deleteBtn.classList.add('hidden');
            CourseScores.renderGrid({});
            return;
        }

        const a = CourseScores.assessments.find(x => x.Assessment_ID === id);
        if (!a) return;

        document.getElementById('scTitle').value = a.Title;
        document.getElementById('scTerm').value = a.Term;
        document.getElementById('scCategory').value = a.Category;
        document.getElementById('scMax').value = a.Max_Score;
        document.getElementById('scDate').value = a.Date || today;
        deleteBtn.classList.remove('hidden');

        try {
            const ts = new Date().getTime();
            const data = await apiFetch(`/api/assessment-scores?assessmentId=${id}&_t=${ts}`);
            const map = {};
            (data.scores || []).forEach(s => { map[s.Student_ID] = s.Score; });
            CourseScores.renderGrid(map);
        } catch (err) {
            CourseScores.renderGrid({});
            CourseScores.setAlert(err.message || 'Failed to load scores.', false);
        }
    },

    renderGrid: (scoreMap) => {
        const body = document.getElementById('scGridBody');
        const students = CourseScores.students;
        document.getElementById('scStudentCount').textContent = `${students.length} students`;

        if (students.length === 0) {
            body.innerHTML = '<tr><td colspan="4" class="px-3 py-8 text-center text-gray-500 italic">No students enrolled.</td></tr>';
            return;
        }

        body.innerHTML = students.map((s, i) => {
            const val = scoreMap[s.User_ID];
            return `
                <tr class="hover:bg-gray-50">
                    <td class="px-3 py-2 text-center text-gray-400 font-bold">${i + 1}</td>
                    <td class="px-3 py-2 text-center font-bold">${esc(s.Seat_Number || '')}</td>
                    <td class="px-3 py-2">
                        <div class="font-bold text-gray-800">${esc(s.Name)}</div>
                        <div class="text-[10px] text-gray-500">${esc(s.Student_Number || 'N/A')}</div>
                    </td>
                    <td class="px-3 py-2 text-center">
                        <input type="number" step="any" min="0" data-student-id="${esc(s.User_ID)}" data-name="${esc(s.Name)}" class="score-input w-24 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none text-center bg-gray-50 focus:bg-white font-mono" value="${val !== undefined && val !== null ? val : ''}" placeholder="—">
                    </td>
                </tr>
            `;
        }).join('');
    },

    save: async () => {
        const btn = document.getElementById('scSaveBtn');
        const title = document.getElementById('scTitle').value.trim();
        const term = document.getElementById('scTerm').value;
        const category = document.getElementById('scCategory').value;
        const max = parseFloat(document.getElementById('scMax').value);
        const date = document.getElementById('scDate').value;

        if (!title) return CourseScores.setAlert('Please enter a title.', false);
        if (!(max > 0)) return CourseScores.setAlert('Maximum score must be greater than 0.', false);

        const scores = [];
        const inputs = Array.from(document.querySelectorAll('.score-input'));
        inputs.forEach(i => i.classList.remove('border-red-500'));

        for (const input of inputs) {
            if (input.value.trim() === '') continue;
            const value = parseFloat(input.value);
            if (isNaN(value) || value < 0 || value > max) {
                input.classList.add('border-red-500');
                input.focus();
                return CourseScores.setAlert(`Score for ${input.dataset.name} must be between 0 and ${fmt(max)}.`, false);
            }
            scores.push({ studentId: input.dataset.studentId, score: value });
        }

        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Saving...';
        CourseScores.setAlert('');

        try {
            const res = await apiFetch('/api/assessments', {
                method: 'POST',
                body: JSON.stringify({
                    assessmentId: CourseScores.currentId || null,
                    courseId: CourseScores.courseId,
                    term, category, title,
                    maxScore: max,
                    date
                })
            });
            const id = res.assessmentId;

            await apiFetch('/api/assessment-scores', {
                method: 'POST',
                body: JSON.stringify({ assessmentId: id, scores })
            });

            const ts = new Date().getTime();
            const list = await apiFetch(`/api/assessments?courseId=${CourseScores.courseId}&_t=${ts}`);
            CourseScores.assessments = list.assessments || [];
            CourseScores.currentId = id;
            CourseScores.renderSelect();
            document.getElementById('scDeleteBtn').classList.remove('hidden');

            CourseScores.setAlert(`Saved "${title}" with ${scores.length} score(s).`, true);
        } catch (err) {
            CourseScores.setAlert(err.message || 'Failed to save.', false);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    },

    remove: async () => {
        const id = CourseScores.currentId;
        if (!id) return;
        if (!window.confirm('Delete this assessment and all of its recorded scores? This cannot be undone.')) return;

        const btn = document.getElementById('scDeleteBtn');
        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

        try {
            await apiFetch('/api/assessments', {
                method: 'DELETE',
                body: JSON.stringify({ assessmentId: id })
            });
            const ts = new Date().getTime();
            const list = await apiFetch(`/api/assessments?courseId=${CourseScores.courseId}&_t=${ts}`);
            CourseScores.assessments = list.assessments || [];
            CourseScores.currentId = '';
            CourseScores.renderSelect();
            await CourseScores.selectAssessment('');
            CourseScores.setAlert('Assessment deleted.', true);
        } catch (err) {
            CourseScores.setAlert(err.message || 'Failed to delete.', false);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
};
