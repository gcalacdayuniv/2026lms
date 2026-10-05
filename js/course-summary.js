// js/course-summary.js
import { apiFetch } from './globals.js';
import { getLoadableAvatarSrc } from './components-utils.js';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const parseLocalDate = (dateStr) => {
    if (!dateStr) return null;
    if (dateStr.includes('-')) {
        const [y, m, d] = dateStr.split('-');
        return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
    }
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
};

const STATUS_BADGE = {
    'Active': 'text-green-600 border-green-200 bg-green-50',
    'Inactive': 'text-gray-500 border-gray-200 bg-gray-50',
    'Suspended': 'text-orange-500 border-orange-200 bg-orange-50',
    'UD': 'text-red-500 border-red-200 bg-red-50',
    'Dropped': 'text-red-700 border-red-300 bg-red-100'
};

export const CourseSummary = {
    course: null,
    sessions: [],
    rows: [],
    visibleRows: [],
    currentTerm: 'midterm',

    init: () => {
        document.addEventListener('click', CourseSummary.handleClicks);
        document.addEventListener('change', CourseSummary.handleChanges);
        document.addEventListener('input', CourseSummary.handleInput);
    },

    handleClicks: async (e) => {
        if (e.target.closest('#openClassSummaryBtn')) {
            document.getElementById('courseMenuModal')?.classList.add('hidden');
            document.getElementById('classSummaryModal').classList.remove('hidden');
            const courseId = window.location.hash.replace('#class-', '');
            await CourseSummary.load(courseId);
        }

        if (e.target.closest('#closeClassSummaryBtn') || e.target.id === 'closeClassSummaryBg') {
            document.getElementById('classSummaryModal').classList.add('hidden');
        }

        if (e.target.closest('#csExportCsvBtn')) {
            CourseSummary.exportCsv();
        }
    },

    handleChanges: (e) => {
        if (e.target.id === 'csTermSelect') {
            CourseSummary.currentTerm = e.target.value;
            CourseSummary.render();
        }
    },

    handleInput: (e) => {
        if (e.target.id === 'csSearchInput') {
            CourseSummary.render();
        }
    },

    sortStudents: (students) => {
        const eyeOrder = { 'Near Sighted': 1, 'No Eye Condition': 2, 'Far Sighted': 3 };
        return [...students].sort((a, b) => {
            const seatAStr = (a.Seat_Number || '').toString().trim();
            const seatBStr = (b.Seat_Number || '').toString().trim();
            const hasSeatA = seatAStr !== '';
            const hasSeatB = seatBStr !== '';
            if (hasSeatA && !hasSeatB) return -1;
            if (!hasSeatA && hasSeatB) return 1;
            if (hasSeatA && hasSeatB) {
                const numA = parseFloat(seatAStr);
                const numB = parseFloat(seatBStr);
                if (!isNaN(numA) && !isNaN(numB)) {
                    if (numA !== numB) return numA - numB;
                } else if (seatAStr !== seatBStr) {
                    return seatAStr.localeCompare(seatBStr);
                }
            }
            const eyeA = eyeOrder[a.eye_condition] || 4;
            const eyeB = eyeOrder[b.eye_condition] || 4;
            if (eyeA !== eyeB) return eyeA - eyeB;
            return (a.Name || '').localeCompare(b.Name || '');
        });
    },

    load: async (courseId) => {
        const loading = document.getElementById('csLoading');
        const loadingText = document.getElementById('csLoadingText');
        const errorDiv = document.getElementById('csError');
        const content = document.getElementById('csContent');
        const exportBtn = document.getElementById('csExportCsvBtn');

        loading.classList.remove('hidden');
        errorDiv.classList.add('hidden');
        content.classList.add('hidden');
        exportBtn.disabled = true;
        loadingText.textContent = 'Loading class list...';

        try {
            const ts = new Date().getTime();
            const details = await apiFetch(`/api/course-details?courseId=${courseId}&_t=${ts}`);
            CourseSummary.course = details.course;
            const students = CourseSummary.sortStudents(details.students || []);

            const results = new Array(students.length);
            let next = 0;
            let done = 0;

            const worker = async () => {
                while (next < students.length) {
                    const i = next++;
                    try {
                        results[i] = await apiFetch(`/api/student-summary?courseId=${courseId}&studentId=${students[i].User_ID}&_t=${ts}`);
                    } catch (err) {
                        results[i] = { error: err.message, records: [] };
                    }
                    done++;
                    loadingText.textContent = `Loading performance data... ${done} / ${students.length}`;
                }
            };
            await Promise.all(Array.from({ length: Math.min(6, students.length) }, worker));

            const firstOk = results.find(r => r && !r.error);
            CourseSummary.sessions = firstOk ? (firstOk.sessions || []) : [];
            if (firstOk && firstOk.course) {
                CourseSummary.course = { ...CourseSummary.course, ...firstOk.course };
            }

            CourseSummary.rows = students.map((s, i) => ({
                student: s,
                records: results[i].records || [],
                assessments: results[i].assessments || [],
                failed: !!results[i].error
            }));

            document.getElementById('csCourseTitle').textContent = `${details.course.CourseCode} | ${details.course.CourseTitle}`;
            loading.classList.add('hidden');
            content.classList.remove('hidden');
            exportBtn.disabled = false;
            CourseSummary.render();
        } catch (err) {
            loading.classList.add('hidden');
            errorDiv.textContent = err.message || 'Failed to load class summary.';
            errorDiv.classList.remove('hidden');
        }
    },

    computeTerm: (records, termKey) => {
        const course = CourseSummary.course || {};
        const sessions = CourseSummary.sessions || [];
        const start = termKey === 'midterm' ? course.Midterm_Start : course.Final_Start;
        const end = termKey === 'midterm' ? course.Midterm_End : course.Final_End;

        const stats = { present: 0, late: 0, excused: 0, absent: 0, classDays: 0, pct: 0, points: 0, records: [] };
        if (!start || !end) return stats;

        const tStart = parseLocalDate(start);
        const tEnd = parseLocalDate(end);
        if (!tStart || !tEnd) return stats;

        const dayMap = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
        const targetDay = dayMap[(course.ScheduleDay || '').trim().toLowerCase()];

        let theoreticalDays = 0;
        if (targetDay !== undefined) {
            const cur = new Date(tStart.getFullYear(), tStart.getMonth(), tStart.getDate());
            const endDate = new Date(tEnd.getFullYear(), tEnd.getMonth(), tEnd.getDate());
            while (cur <= endDate) {
                if (cur.getDay() === targetDay) theoreticalDays++;
                cur.setDate(cur.getDate() + 1);
            }
        }

        let noClassCount = 0;
        sessions.forEach(s => {
            if (s.Is_No_Class === 1) {
                const sDate = parseLocalDate(s.Date);
                if (sDate && sDate >= tStart && sDate <= tEnd && sDate.getDay() === targetDay) noClassCount++;
            }
        });

        const termRecords = records.filter(r => {
            const rDate = parseLocalDate(r.Date);
            return rDate && rDate >= tStart && rDate <= tEnd;
        });

        termRecords.forEach(r => {
            if (r.Status === 'Present') stats.present++;
            else if (r.Status === 'Late') stats.late++;
            else if (r.Status === 'Excused') stats.excused++;
            else if (r.Status === 'Absent') stats.absent++;
            stats.points += (r.Performance_Points || 0);
        });

        stats.records = termRecords;
        stats.classDays = Math.max(0, theoreticalDays - noClassCount - stats.excused);
        return stats;
    },

    computeStats: (records, term) => {
        let stats;
        if (term === 'all') {
            const m = CourseSummary.computeTerm(records, 'midterm');
            const f = CourseSummary.computeTerm(records, 'finalterm');
            stats = {
                present: m.present + f.present,
                late: m.late + f.late,
                excused: m.excused + f.excused,
                absent: m.absent + f.absent,
                classDays: m.classDays + f.classDays,
                points: m.points + f.points,
                records: [...m.records, ...f.records],
                pct: 0
            };
        } else {
            stats = CourseSummary.computeTerm(records, term);
        }
        const score = stats.present + (stats.late * 0.5);
        stats.pct = stats.classDays > 0 ? ((score / stats.classDays) * 100).toFixed(1) : '0.0';
        return stats;
    },

    computeScores: (assessments, term) => {
        const terms = term === 'midterm' ? ['MidTerm'] : (term === 'finalterm' ? ['FinalTerm'] : ['MidTerm', 'FinalTerm']);
        const out = {
            Written: { score: 0, max: 0, count: 0 },
            Performance: { score: 0, max: 0, count: 0 },
            MajorExam: { score: 0, max: 0, count: 0 },
            items: []
        };
        (assessments || []).forEach(a => {
            if (!terms.includes(a.Term) || !out[a.Category] || a.Category === 'items') return;
            if (a.Score === null || a.Score === undefined) return;
            out[a.Category].score += a.Score;
            out[a.Category].max += a.Max_Score;
            out[a.Category].count++;
            out.items.push(a);
        });
        return out;
    },

    scoreText: (c) => {
        if (!c.count) return '—';
        const n = (v) => Number(v.toFixed(2));
        return `${n(c.score)}/${n(c.max)}`;
    },

    termLabel: (term) => term === 'midterm' ? 'Mid Term' : (term === 'finalterm' ? 'Final Term' : 'Mid + Final Term'),

    render: () => {
        const tbody = document.getElementById('csTableBody');
        if (!tbody) return;

        const term = document.getElementById('csTermSelect').value;
        const search = (document.getElementById('csSearchInput').value || '').toLowerCase().trim();
        CourseSummary.currentTerm = term;

        const computed = CourseSummary.rows.map(r => ({ ...r, stats: CourseSummary.computeStats(r.records, term), scores: CourseSummary.computeScores(r.assessments, term) }));

        const filtered = computed.filter(r => {
            if (!search) return true;
            const s = r.student;
            return [s.Name, s.Student_Number, s.Email, s.Contact_Number, s.Group_Name, s.Assigned_Topic, s.account_status]
                .some(v => (v || '').toString().toLowerCase().includes(search));
        });

        CourseSummary.visibleRows = filtered;
        document.getElementById('csCount').textContent = `${filtered.length} of ${computed.length} students | ${CourseSummary.termLabel(term)}`;

        const course = CourseSummary.course || {};
        const hasDates = term === 'midterm' ? (course.Midterm_Start && course.Midterm_End)
            : term === 'finalterm' ? (course.Final_Start && course.Final_End)
            : (course.Midterm_Start && course.Midterm_End) || (course.Final_Start && course.Final_End);
        const warn = document.getElementById('csTermWarning');
        if (hasDates) warn.classList.add('hidden');
        else warn.classList.remove('hidden');

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="14" class="px-3 py-8 text-center text-gray-500 italic">No students found.</td></tr>';
            return;
        }

        tbody.innerHTML = filtered.map((r, idx) => {
            const s = r.student;
            const st = r.stats;
            const avatarSrc = getLoadableAvatarSrc(s.Avatar);
            const avatar = avatarSrc
                ? `<img src="${esc(avatarSrc)}" class="w-10 h-10 rounded-full object-cover border border-gray-200 flex-shrink-0" alt="">`
                : '<i class="fa-solid fa-circle-user text-[40px] text-gray-300 flex-shrink-0"></i>';
            const sc = r.scores;
            const scoreBlock = sc.items.length === 0 ? '' : `
                                <div class="flex justify-between gap-3 pt-2 mt-2 border-t border-gray-300 font-bold text-gray-500 uppercase"><span>Assessment</span><span>Score</span></div>
                                ${sc.items.map(a => `<div class="flex justify-between gap-3 py-0.5 border-b border-gray-100 last:border-0"><span class="font-medium text-gray-700">${esc(a.Title)} <span class="text-gray-400">(${esc(a.Term === 'MidTerm' ? 'Mid' : 'Final')})</span></span><span class="font-mono font-bold text-blue-600">${esc(Number(a.Score.toFixed(2)))}/${esc(Number(a.Max_Score.toFixed(2)))}</span></div>`).join('')}`;
            const statusText = s.account_status || 'Inactive';
            const badge = `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${STATUS_BADGE[statusText] || STATUS_BADGE['Inactive']}">${esc(statusText)}</span>`;

            const logItems = st.records.length === 0
                ? '<div class="text-gray-400 italic">No records.</div>'
                : st.records.map(rec => `<div class="flex justify-between gap-3 py-0.5 border-b border-gray-100 last:border-0"><span class="font-medium text-gray-700">${esc(rec.Date)}</span><span class="text-gray-600">${esc(rec.Status || 'N/A')}</span><span class="font-mono font-bold text-blue-600">${esc(rec.Performance_Points || 0)}</span></div>`).join('');

            return `
                <tr class="hover:bg-gray-50 align-top">
                    <td class="px-3 py-2 text-center text-gray-400 font-bold">${idx + 1}</td>
                    <td class="px-3 py-2">
                        <div class="flex items-center gap-2">
                            ${avatar}
                            <div>
                                <div class="font-bold text-gray-800">${esc(s.Name)}</div>
                                <div class="text-[10px] text-gray-500">${esc(s.Student_Number || 'N/A')}${r.failed ? ' <span class="text-red-500 font-bold">(failed to load records)</span>' : ''}</div>
                            </div>
                        </div>
                    </td>
                    <td class="px-3 py-2 text-center font-bold">${esc(s.Seat_Number || '')}</td>
                    <td class="px-3 py-2 break-all">${s.Email ? `<a href="mailto:${esc(s.Email)}" class="text-blue-600 hover:underline">${esc(s.Email)}</a>` : ''}</td>
                    <td class="px-3 py-2 whitespace-nowrap">${esc(s.Contact_Number || '')}</td>
                    <td class="px-3 py-2 text-center">${badge}</td>
                    <td class="px-3 py-2">${esc(s.Group_Name || '')}</td>
                    <td class="px-3 py-2">${esc(s.Assigned_Topic || '')}</td>
                    <td class="px-3 py-2 text-center">
                        <div class="font-black text-blue-700 text-sm">${st.pct}%</div>
                        <div class="text-[10px] text-gray-600">${st.present}P, ${st.late}L, ${st.excused}E, ${st.absent}A</div>
                        <div class="text-[9px] text-gray-400 uppercase font-bold">Days: ${st.classDays}</div>
                    </td>
                    <td class="px-3 py-2 text-center font-black text-blue-700 text-sm">${st.points}</td>
                    <td class="px-3 py-2 text-center font-mono font-bold text-gray-800">${CourseSummary.scoreText(sc.Written)}</td>
                    <td class="px-3 py-2 text-center font-mono font-bold text-gray-800">${CourseSummary.scoreText(sc.Performance)}</td>
                    <td class="px-3 py-2 text-center font-mono font-bold text-gray-800">${CourseSummary.scoreText(sc.MajorExam)}</td>
                    <td class="px-3 py-2">
                        <details>
                            <summary class="cursor-pointer text-blue-600 font-bold text-[11px]">View (${st.records.length})</summary>
                            <div class="mt-1 max-h-40 overflow-y-auto text-[10px] bg-gray-50 border border-gray-200 rounded p-2 min-w-[200px]">
                                <div class="flex justify-between gap-3 pb-1 mb-1 border-b border-gray-300 font-bold text-gray-500 uppercase"><span>Date</span><span>Status</span><span>Pts</span></div>
                                ${logItems}${scoreBlock}
                            </div>
                        </details>
                    </td>
                </tr>
            `;
        }).join('');
    },

    csvCell: (value) => {
        let str = String(value ?? '');
        if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
        return `"${str.replace(/"/g, '""')}"`;
    },

    exportCsv: () => {
        const rows = CourseSummary.visibleRows;
        if (!rows || rows.length === 0) {
            alert('No students to export.');
            return;
        }

        const course = CourseSummary.course || {};
        const term = CourseSummary.currentTerm;
        const termLabel = CourseSummary.termLabel(term);

        const header = [
            'Seat No.', 'Student No.', 'Name', 'Email', 'Contact Number', 'Account Status', 'Course/Year/Section', 'Group', 'Assigned Topic',
            'Term', 'Present', 'Late', 'Excused', 'Absent', 'Class Days', 'Attendance %', 'Participation Points',
            'Written Score', 'Written Max', 'Task Score', 'Task Max', 'Major Exam Score', 'Major Exam Max',
            'Attendance & Participation Log', 'Assessment Scores'
        ];

        const lines = [header.map(CourseSummary.csvCell).join(',')];

        rows.forEach(r => {
            const s = r.student;
            const st = r.stats;
            const cys = `${s.course || ''} ${s.year || ''} ${s.section ? '- ' + s.section : ''}`.trim();
            const log = st.records.map(rec => `${rec.Date}: ${rec.Status || 'N/A'} (${rec.Performance_Points || 0} pts)`).join('; ');
            const sc = r.scores;
            const blank = (c) => c.count ? [Number(c.score.toFixed(2)), Number(c.max.toFixed(2))] : ['', ''];
            const scoreLog = sc.items.map(a => `${a.Title} [${a.Term === 'MidTerm' ? 'Mid' : 'Final'}]: ${Number(a.Score.toFixed(2))}/${Number(a.Max_Score.toFixed(2))}`).join('; ');
            lines.push([
                s.Seat_Number || '', s.Student_Number || '', s.Name || '', s.Email || '', s.Contact_Number || '', s.account_status || 'Inactive', cys,
                s.Group_Name || '', s.Assigned_Topic || '', termLabel,
                st.present, st.late, st.excused, st.absent, st.classDays, st.pct, st.points,
                ...blank(sc.Written), ...blank(sc.Performance), ...blank(sc.MajorExam),
                log, scoreLog
            ].map(CourseSummary.csvCell).join(','));
        });

        const csv = '\uFEFF' + lines.join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const safeCode = (course.CourseCode || 'class').replace(/[^a-zA-Z0-9_-]/g, '_');
        const safeTerm = term === 'all' ? 'all-terms' : term;
        a.href = url;
        a.download = `${safeCode}_summary_${safeTerm}_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
};
