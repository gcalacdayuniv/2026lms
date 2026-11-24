// js/course-scores.js
import { StudentSheetViewer } from './student-sheet-viewer.js';
import { apiFetch } from './globals.js';
import { CourseSummary } from './course-summary.js';
import { UI } from './ui-feedback.js';
import { getLocalDateString } from './date-utils.js';
import { escapeHtml as esc } from './html-utils.js';
import { onBase, GRADE_BASE } from './grade-base.js';

const fmt = (n) => Number(Number(n).toFixed(2));

const TERM_LABELS = { MidTerm: 'Mid Term', FinalTerm: 'Final Term' };
const CATEGORY_LABELS = {
    Written: 'Written Output (Quizzes/Long)',
    Narrative: 'Written Output (Narrative)',
    Individual: 'Written Output (Individual)',
    Performance: 'Performance Output (Tasks)',
    Report: 'Performance Output (Report)',
    MajorExam: 'Major Exam'
};
const CATEGORY_ELEMENT = {
    Written: 'WrittenScore',
    Narrative: 'NarrativeScore',
    Individual: 'IndividualScore',
    Performance: 'PerformanceTaskScore',
    Report: 'ReportScore',
    MajorExam: 'MajorExamScore'
};
// Categories that previously came only from submission grades; keep that value when no assessment is recorded.
const SUBMISSION_FALLBACK = ['Narrative', 'Individual', 'Report'];

export const CourseScores = {
    summaryData: null,
    courseId: null,
    students: [],
    assessments: [],
    currentId: '',

    init: () => {
        document.addEventListener('click', CourseScores.handleClicks);
        document.addEventListener('change', CourseScores.handleChanges);
        document.addEventListener('input', CourseScores.handleInput);
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
        if (e.target.id === 'scGroupSet') {
            await CourseScores.chooseGroupSet(e.target.value);
            return;
        }
        if (e.target.id === 'scAssessmentSelect') {
            await CourseScores.selectAssessment(e.target.value);
        }
    },

    handleInput: (e) => {
        CourseScores.fillGroup(e);
        if (e.target.id === 'scMax' || (e.target.classList && e.target.classList.contains('score-input'))) CourseScores.markExtraCredit();
    },

    // One score for the group: loads a set's groups; typing a score for one member then fills the other members.
    groupOf: {},
    chooseGroupSet: async (setId) => {
        CourseScores.groupOf = {};
        if (setId) {
            try {
                const r = await apiFetch(`/api/group-set?courseId=${CourseScores.courseId}&setId=${encodeURIComponent(setId)}&_t=${Date.now()}`);
                r.groups.forEach(g => g.members.forEach(m => { CourseScores.groupOf[m.User_ID] = g.name; }));
            } catch (err) {
                CourseScores.setAlert(err.message || 'Could not load the groups.', false);
            }
        }
        CourseScores.showGroupNames();
    },

    showGroupNames: () => {
        document.querySelectorAll('#scGridBody .sc-group-tag').forEach(el => {
            el.textContent = CourseScores.groupOf[el.dataset.studentId] || '';
        });
    },

    fillGroup: (e) => {
        const input = e.target;
        if (!input.classList || !input.classList.contains('score-input')) return;
        const group = CourseScores.groupOf[input.dataset.studentId];
        if (!group) return;
        document.querySelectorAll('.score-input').forEach(other => {
            if (other !== input && CourseScores.groupOf[other.dataset.studentId] === group) other.value = input.value;
        });
    },

    loadGroupSets: async () => {
        const select = document.getElementById('scGroupSet');
        if (!select) return;
        try {
            const r = await apiFetch(`/api/group-sets?courseId=${CourseScores.courseId}`);
            select.innerHTML = '<option value="">Off</option>' + (r.sets || []).map(s => `<option value="${esc(s.Set_ID)}">${esc(s.Name)}</option>`).join('');
        } catch (err) { /* the tool stays Off */ }
        select.value = '';
        CourseScores.groupOf = {};
    },

    // A score above the max is extra credit: kept as typed here, counted as the max in the class grade.
    markExtraCredit: () => {
        const max = parseFloat(document.getElementById('scMax')?.value);
        let over = 0;
        document.querySelectorAll('.score-input').forEach(input => {
            const extra = max > 0 && parseFloat(input.value) > max;
            input.classList.toggle('border-amber-500', extra);
            input.classList.toggle('bg-amber-50', extra);
            input.classList.toggle('border-gray-300', !extra);
            if (extra) over++;
        });
        const note = document.getElementById('scExtraNote');
        if (note) {
            note.textContent = over ? `${over} score${over === 1 ? ' is' : 's are'} above the max (extra credit). The class grade counts at most ${fmt(max)}.` : '';
            note.classList.toggle('hidden', !over);
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
                if (!SUBMISSION_FALLBACK.includes(category)) el.textContent = '—';
                return;
            }
            // The card shows the average of the assessments on a base of 100; the breakdown list below keeps the raw scores.
            const average = scored.reduce((sum, a) => sum + onBase(a.Score, a.Max_Score), 0) / scored.length;
            el.textContent = `${fmt(average)}/${GRADE_BASE}`;
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
                        <td class="px-3 py-2 text-center text-gray-600">${esc(a.Title)}${StudentSheetViewer.buttonHtml(a, data.studentId)}</td>
                        <td class="px-3 py-2 text-center font-mono font-bold text-blue-600">${scoreText}</td>
                    </tr>
                `;
            }).join('');
        }

        document.getElementById('detailsModal').classList.remove('hidden');
    },

    // ---------- Lecturer side (Record Scores modal) ----------

    ensureCategoryOptions: () => {
        const select = document.getElementById('scCategory');
        if (!select) return;
        const labels = {
            Written: 'Written (Quiz/Long)',
            Narrative: 'Written (Narrative)',
            Individual: 'Written (Individual)',
            Performance: 'Performance (Task)',
            Report: 'Performance (Report)',
            MajorExam: 'Major Exam'
        };
        const current = select.value;
        select.innerHTML = Object.keys(labels).map(k => `<option value="${k}">${labels[k]}</option>`).join('');
        select.value = labels[current] ? current : 'Written';
    },

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
        CourseScores.ensureCategoryOptions();
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
            await CourseScores.loadGroupSets();
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
        const today = getLocalDateString();

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
            CourseScores.baseline = { ...map };   // what the database held when this grid was opened
            CourseScores.renderGrid(map);
        } catch (err) {
            CourseScores.baseline = null;
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
                        <div class="text-[10px] text-gray-500">${esc(s.Student_Number || 'N/A')} <span class="sc-group-tag font-bold text-violet-600" data-student-id="${esc(s.User_ID)}">${esc(CourseScores.groupOf[s.User_ID] || '')}</span></div>
                    </td>
                    <td class="px-3 py-2 text-center">
                        <input type="number" step="any" min="0" data-student-id="${esc(s.User_ID)}" data-name="${esc(s.Name)}" class="score-input w-24 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none text-center bg-gray-50 focus:bg-white font-mono" value="${val !== undefined && val !== null ? val : ''}" placeholder="—">
                    </td>
                </tr>
            `;
        }).join('');
        CourseScores.markExtraCredit();
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
        const clear = [];
        const base = CourseScores.currentId ? CourseScores.baseline : null;
        const same = (a, b) => Number(a) === Number(b);
        const inputs = Array.from(document.querySelectorAll('.score-input'));
        inputs.forEach(i => i.classList.remove('border-red-500'));

        for (const input of inputs) {
            if (input.value.trim() === '') {
                if (base && base[input.dataset.studentId] !== undefined) clear.push(input.dataset.studentId);
                continue;
            }
            const value = parseFloat(input.value);
            if (isNaN(value) || value < 0) {
                input.classList.add('border-red-500');
                input.focus();
                return CourseScores.setAlert(`Score for ${input.dataset.name} must be 0 or more (above ${fmt(max)} is extra credit).`, false);
            }
            // Only scores the lecturer changed are sent, so a score corrected elsewhere (scan review) is never overwritten by an older grid.
            if (base && base[input.dataset.studentId] !== undefined && same(base[input.dataset.studentId], value)) continue;
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
                body: JSON.stringify({ assessmentId: id, scores, clear, partial: !!base })
            });

            const ts = new Date().getTime();
            const list = await apiFetch(`/api/assessments?courseId=${CourseScores.courseId}&_t=${ts}`);
            CourseScores.assessments = list.assessments || [];
            CourseScores.currentId = id;
            CourseScores.renderSelect();
            document.getElementById('scDeleteBtn').classList.remove('hidden');

            await CourseScores.selectAssessment(id).catch(() => {});   // reload so the grid shows what is really stored
            CourseScores.setAlert(`Saved "${title}" with ${scores.length} score(s).`, true);
            UI.success(`Saved "${title}" (${scores.length} score${scores.length === 1 ? '' : 's'}).`);
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
        const confirmed = await UI.confirm({
            title: 'Delete assessment',
            message: 'Delete this assessment and all of its recorded scores? This cannot be undone.',
            confirmText: 'Delete',
            danger: true
        });
        if (!confirmed) return;

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
            UI.success('Assessment deleted.');
        } catch (err) {
            CourseScores.setAlert(err.message || 'Failed to delete.', false);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
};
