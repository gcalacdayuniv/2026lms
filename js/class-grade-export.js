// js/class-grade-export.js
// Builds the CLASS GRADE workbook (the lecturer's template: Midterm, Final Term and Summary blocks) from the
// Class Summary data and downloads it as .xlsx. ExcelJS is loaded only when the button is used.
import { CLASS_GRADE_TEMPLATE_B64 } from './class-grade-template.js';
import { downloadBlob } from './download-utils.js';

const EXCELJS_URLS = [
    'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js'
];

// Template columns (1-based). Each term has a written block (9 outputs), a performance block (9 outputs) and a major exam.
const SLOTS = 9;
const PERF_EXTRAS = 2; // the first two performance slots hold Attendance and Participation
const TERMS = {
    MidTerm: {
        written: 3, writtenTotal: 12,        // C..K, L
        perf: 16, perfTotal: 25,             // P..X, Y
        exam: 29                             // AC
    },
    FinalTerm: {
        written: 37, writtenTotal: 46,       // AK..AS, AT
        perf: 50, perfTotal: 59,             // AX..BF, BG
        exam: 63                             // BK
    }
};
const WRITTEN_CATEGORIES = ['Written', 'Narrative', 'Individual'];
const PERFORMANCE_CATEGORIES = ['Performance', 'Report'];
const FIRST_ROW = 6;
const TEMPLATE_LAST_ROW = 9;
const LAST_COL = 73; // BU

const colLetter = (n) => {
    let s = '';
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
};

const safeName = (v) => String(v || '').replace(/[\\/:*?"<>|\[\]]+/g, ' ').replace(/\s+/g, ' ').trim();

const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

const decodeBase64 = (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
};

const byDate = (a, b) => String(a.Date || '').localeCompare(String(b.Date || ''));

// Which assessments go in which block, per term, in date order.
function planTerm(rows, term) {
    const seen = new Map();
    for (const row of rows) {
        for (const a of row.assessments || []) {
            if (a.Term === term && !seen.has(a.Assessment_ID)) seen.set(a.Assessment_ID, a);
        }
    }
    const all = [...seen.values()].sort(byDate);
    const written = all.filter(a => WRITTEN_CATEGORIES.includes(a.Category));
    const perf = all.filter(a => PERFORMANCE_CATEGORIES.includes(a.Category));
    const exams = all.filter(a => a.Category === 'MajorExam');
    return { written, perf, exams };
}

export function courseLabels(course) {
    const c = course || {};
    const title = safeName(c.CourseTitle || c.CourseCode || 'Course');
    const yearSection = safeName([c.Target_Course, [c.Target_Year, c.Target_Section].filter(Boolean).join('-')].filter(Boolean).join(' ')) || 'Year and Section';
    const ayEs = safeName([c.AcademicYear, c.Semester].filter(Boolean).join(' ')) || 'AY and Sem';
    return {
        sheetName: safeName(`${title} - ${yearSection}`).slice(0, 31) || 'Class Grade',
        fileName: `${title}_${yearSection}_${ayEs}_CLASS GRADE.xlsx`.replace(/\s+/g, ' '),
        classId: [c.Target_Course, [c.Target_Year, c.Target_Section].filter(Boolean).join('-')].filter(Boolean).join(' ')   // e.g. BSIT 3-A
    };
}

// Fills the template and returns { workbook, warnings }. ExcelJS is passed in so this runs in the browser and in tests.
export async function buildClassGrade(ExcelJS, { course, rows, templateBytes }) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(templateBytes || decodeBase64(CLASS_GRADE_TEMPLATE_B64));
    const ws = wb.worksheets[0];
    const warnings = [];
    const labels = courseLabels(course);

    ws.name = labels.sheetName;
    // BR2 carries the class course, year and section (the template's fixed "BSP 1-4" is replaced); BR3 no longer shows the subject code.
    ws.getCell('BR2').value = labels.classId || null;
    ws.getCell('BR3').value = null;

    const students = [...rows].sort((a, b) => String(a.student.Name || '').localeCompare(String(b.student.Name || '')));
    const n = students.length;
    const lastRow = FIRST_ROW + Math.max(n, 1) - 1;

    // Rows beyond the template's four student rows copy the look of the last template row.
    for (let r = TEMPLATE_LAST_ROW + 1; r <= lastRow; r++) {
        const src = ws.getRow(TEMPLATE_LAST_ROW);
        const dst = ws.getRow(r);
        dst.height = src.height;
        for (let c = 1; c <= LAST_COL; c++) dst.getCell(c).style = { ...src.getCell(c).style };
    }
    // Unused template rows are emptied.
    for (let r = FIRST_ROW + n; r <= TEMPLATE_LAST_ROW; r++) {
        for (let c = 1; c <= LAST_COL; c++) ws.getCell(r, c).value = null;
    }

    // Header blocks: labels (row 3), perfect scores (row 5), and the output slots.
    const slotCols = {};
    for (const term of Object.keys(TERMS)) {
        const t = TERMS[term];
        const plan = planTerm(rows, term);
        const termName = term === 'MidTerm' ? 'Midterm' : 'Final term';

        // Performance block: Attendance and Participation first, then Performance and Report assessments.
        const att = rows.map(r => (r.attendance && r.attendance[term]) || { score: 0, max: 0, points: 0 });
        const attMax = Math.max(0, ...att.map(a => a.max));
        const topPoints = Math.max(0, ...att.map(a => a.points));
        t.extras = [];
        if (attMax > 0) t.extras.push({ label: 'Attendance', max: attMax, col: t.perf + t.extras.length, value: (r) => (r.attendance && r.attendance[term] ? r.attendance[term].score : null) });
        else warnings.push(`${termName}: no class days found (check the term dates in course settings), so Attendance was left out.`);
        // Participation: up to 4 points per class day (2 by default for Present / Late), so that is the perfect score.
        const partMax = attMax > 0 ? attMax * 4 : topPoints;
        if (partMax > 0) t.extras.push({ label: 'Participation', max: partMax, col: t.perf + t.extras.length, value: (r) => (r.attendance && r.attendance[term] ? r.attendance[term].points : null) });
        const perfSlots = SLOTS - t.extras.length;

        const blocks = [
            { list: plan.written, start: t.written, name: 'written', slots: SLOTS, offset: 0 },
            { list: plan.perf, start: t.perf, name: 'performance', slots: perfSlots, offset: t.extras.length }
        ];
        for (const b of blocks) {
            if (b.list.length > b.slots) {
                warnings.push(`${termName} ${b.name} outputs: ${b.list.length} found, the template has room for ${b.slots}. Left out: ${b.list.slice(b.slots).map(a => a.Title).join(', ')}.`);
            }
            const used = b.list.slice(0, b.slots);
            for (let i = 0; i < SLOTS; i++) {
                const col = b.start + i;
                if (i < b.offset) continue;
                const a = used[i - b.offset];
                ws.getCell(3, col).value = a ? String(a.Title || '').slice(0, 28) : null;
                ws.getCell(5, col).value = a ? num(a.Max_Score) : null;
                if (a) (slotCols[a.Assessment_ID] = slotCols[a.Assessment_ID] || []).push(col);
            }
        }
        for (const e of t.extras) {
            ws.getCell(3, e.col).value = e.label;
            ws.getCell(5, e.col).value = e.max;
        }
        ws.getCell(5, t.exam).value = plan.exams.length ? plan.exams.reduce((s, a) => s + (num(a.Max_Score) || 0), 0) : null;
        t.examIds = plan.exams.map(a => a.Assessment_ID);
    }

    // Students.
    students.forEach((row, i) => {
        const r = FIRST_ROW + i;
        const L = (c) => `${colLetter(c)}${r}`;
        const status = String(row.student.account_status || '');
        const remark = status && status.toLowerCase() !== 'active' ? status : null;
        const scoreOf = new Map();
        for (const a of row.assessments || []) scoreOf.set(a.Assessment_ID, num(a.Score));

        ws.getCell(r, 1).value = i + 1;
        ws.getCell(r, 2).value = row.student.Name || '';
        ws.getCell(r, 35).value = i + 1;                                  // AI
        ws.getCell(r, 36).value = { formula: `B${r}` };                   // AJ
        ws.getCell(r, 69).value = i + 1;                                  // BQ
        ws.getCell(r, 70).value = { formula: `B${r}` };                   // BR

        for (const term of Object.keys(TERMS)) {
            const t = TERMS[term];
            for (const start of [t.written, t.perf]) {
                for (let k = 0; k < SLOTS; k++) ws.getCell(r, start + k).value = null;
            }
            ws.getCell(r, t.exam).value = null;
        }
        for (const term of Object.keys(TERMS)) {
            for (const e of TERMS[term].extras) {
                const v = e.value(row);
                if (v !== null && v !== undefined) ws.getCell(r, e.col).value = v;
            }
        }
        for (const [id, cols] of Object.entries(slotCols)) {
            const v = scoreOf.get(id);
            if (v !== undefined && v !== null) for (const col of cols) ws.getCell(r, col).value = v;
        }
        for (const term of Object.keys(TERMS)) {
            const t = TERMS[term];
            const scores = t.examIds.map(id => scoreOf.get(id)).filter(v => v !== undefined && v !== null);
            if (scores.length) ws.getCell(r, t.exam).value = scores.reduce((s, v) => s + v, 0);
        }

        // Midterm formulas.
        ws.getCell(r, 12).value = { formula: `SUM(C${r}:K${r})` };
        ws.getCell(r, 13).value = { formula: `IFERROR((L${r}/L$5),0)*60+40` };
        ws.getCell(r, 14).value = { formula: `M${r}*N$4` };
        ws.getCell(r, 25).value = { formula: `SUM(P${r}:X${r})` };
        ws.getCell(r, 26).value = { formula: `IFERROR((Y${r}/Y$5),0)*60+40` };
        ws.getCell(r, 27).value = { formula: `Z${r}*AA$4` };
        ws.getCell(r, 30).value = { formula: `IFERROR((AC${r}/AC$5),0)*60+40` };
        ws.getCell(r, 31).value = { formula: `AD${r}*AE$4` };
        ws.getCell(r, 32).value = { formula: `AE${r}+AA${r}+N${r}` };
        ws.getCell(r, 33).value = remark;
        // Final term formulas.
        ws.getCell(r, 46).value = { formula: `SUM(AK${r}:AS${r})` };
        ws.getCell(r, 47).value = { formula: `IFERROR((AT${r}/AT$5),0)*60+40` };
        ws.getCell(r, 48).value = { formula: `AU${r}*AV$4` };
        ws.getCell(r, 59).value = { formula: `SUM(AX${r}:BF${r})` };
        ws.getCell(r, 60).value = { formula: `IFERROR((BG${r}/BG$5),0)*60+40` };
        ws.getCell(r, 61).value = { formula: `BH${r}*BI$4` };
        ws.getCell(r, 64).value = { formula: `IFERROR((BK${r}/BK$5),0)*60+40` };
        ws.getCell(r, 65).value = { formula: `IFERROR(BL${r}*BM$4,0)` };
        ws.getCell(r, 67).value = { formula: `BM${r}+BI${r}+AV${r}` };
        ws.getCell(r, 68).value = remark;
        // Summary.
        ws.getCell(r, 71).value = { formula: `AF${r}` };
        ws.getCell(r, 72).value = { formula: `BO${r}` };
        ws.getCell(r, 73).value = { formula: `(BS${r}+BT${r})/2` };
    });

    // Formulas the template saved with old results must be recalculated by whatever opens the file.
    for (let r = 1; r <= lastRow; r++) {
        for (let c = 1; c <= LAST_COL; c++) {
            const cell = ws.getCell(r, c);
            const v = cell.value;
            if (v && typeof v === 'object' && v.formula !== undefined) cell.value = { formula: v.formula };
            else if (v && typeof v === 'object' && v.sharedFormula !== undefined) cell.value = { formula: v.formula || v.sharedFormula };
        }
    }
    wb.calcProperties = { ...(wb.calcProperties || {}), fullCalcOnLoad: true };
    return { workbook: wb, warnings, fileName: labels.fileName };
}

let excelPromise = null;
function loadExcelJS() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    if (excelPromise) return excelPromise;
    const tryUrl = (i) => new Promise((resolve, reject) => {
        if (i >= EXCELJS_URLS.length) return reject(new Error('Could not load the spreadsheet library. Check your connection and try again.'));
        const s = document.createElement('script');
        s.src = EXCELJS_URLS[i];
        s.onload = () => (window.ExcelJS ? resolve(window.ExcelJS) : tryUrl(i + 1).then(resolve, reject));
        s.onerror = () => { s.remove(); tryUrl(i + 1).then(resolve, reject); };
        document.head.appendChild(s);
    });
    excelPromise = tryUrl(0).catch((err) => { excelPromise = null; throw err; });
    return excelPromise;
}

export async function exportClassGrade(course, rows) {
    const ExcelJS = await loadExcelJS();
    const { workbook, warnings, fileName } = await buildClassGrade(ExcelJS, { course, rows });
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName);
    return { warnings, fileName };
}
