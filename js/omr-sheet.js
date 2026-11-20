// js/omr-sheet.js
// Layout of the printable answer sheet (bubble sheet) and the HTML that prints it.
// The scanner (omr-scan.js) uses the SAME numbers, so never change one without the other.
//
// Coordinates are in millimetres inside the "frame": a 180 x 240 mm rectangle whose four
// corners hold the alignment markers. (0,0) is the centre of the top-left marker.
// The top-left marker is larger than the others so the scanner can tell which way is up.
//
// Page flow: header, one line for name / year and section / date, instructions, then four columns.
// The first column starts with the student number grid and question 1 follows right below it;
// the other columns hold only questions.
import { escapeHtml } from './html-utils.js';

export const FRAME = { w: 180, h: 240 };
export const MARKER = { size: 8, tlSize: 11 };
export const BUBBLE_D = 4.6;          // answer circles
export const STU_BUBBLE_D = 3.8;      // student number circles (smaller so the grid stays compact)
export const BUBBLE_BORDER = 0.35;
export const MAX_QUESTIONS = 100;
export const MAX_CHOICES = 5;
export const STUDENT_DIGITS = 6;

// Answer columns. Column 0 sits under the student number grid, so it starts lower and holds fewer rows.
const ANS = { left: 4, blockW: 44.5, firstK: 12, kPitch: 6.4, pitch: 5.8 };
const COLUMNS = [
    { top: 90, rows: 24 },
    { top: 41, rows: 32 },
    { top: 41, rows: 32 },
    { top: 41, rows: 32 }
];
const LETTER_GAP = 7;
const WRITE = { pitch: 8.7 };   // distance to a line for a written answer (identification / enumeration)
const CPITCH = 6.1, CHDR_A = 5.3, CHDR_B = 4.4;   // compact sheets: every question sits in a box, so rows and label rows are a little further apart
const HDR_A = 4.0, HDR_B = 3.9;   // label row squeezed between two answer rows: distance below the row above / above the row below   // letters A-E are printed this far above the first row of a column

// SET row (which printed exam set the student has): up to 6 circles A-F, printed only for exams with sets.
export const MAX_SETS = 6;
// It sits at the top of the left column, above the student number grid.
const SETROW = { u0: 15.5, v: 12.5, pitch: 6, capV: 5.2 };
export const setBubbles = (count = MAX_SETS) => Array.from({ length: count }, (_, k) => ({ k, u: SETROW.u0 + k * SETROW.pitch, v: SETROW.v }));

// Student number grid, inside column 0.
const STU = { left: 14, colPitch: 6, gap: 3, top: 38, rowPitch: 4.4 };

// Essays are written on the bubble page, in a band across the bottom: caption, then lines of ESSAY_MM across the page.
const ESSAY_MM = 8;
const ESSAY_BOTTOM = 246;   // the essay lines may run below the bottom markers, into the page margin (like the header above the top markers)
export const essayHeight = (lines) => 4 + lines * ESSAY_MM + 3;
// written = [{ no, lines, essay }] -> height (mm) the essay band needs
export const bandFor = (written) => (written || []).filter(w => w.essay).reduce((sum, w) => sum + essayHeight(w.lines), 0);

// Geometry of the sheet. g = number of sets, or { sets, band }. The OLD layout (plain multiple choice, no sets) never
// changes, so sheets printed before still scan. Mixed-type sheets and sheets with SET circles use the compact layout:
// the title, name line and instructions sit above the top markers (they are never scanned), so the columns start
// higher; an essay band at the bottom shortens the columns.
// written = [{ no, lines, part }]: identification / enumeration items, which get numbered lines in the answer columns
// between the bubble rows, in the order of the exam.
const normGeo = (g) => (g && typeof g === 'object' ? { sets: Number(g.sets) || 0, band: Number(g.band) || 0, written: Array.isArray(g.written) ? g.written : [] } : { sets: Number(g) || 0, band: 0, written: [] });
export const shortWritten = (written) => (written || []).filter(w => !w.essay).map(w => ({ no: w.no, lines: w.lines, part: Number(w.part) || 0 }));
const geoOf = (g, mixed = false) => {
    const { sets, band, written } = normGeo(g);
    if (!mixed && sets <= 1) return { compact: false, sets, band: 0, written: [], stuTop: STU.top, limit: null, cols: COLUMNS };
    const stuTop = sets > 1 ? 26 : 12;
    const limit = band > 0 ? ESSAY_BOTTOM - 5 - band : 228;       // centre of the lowest answer row
    const cols = [stuTop + 53, 14, 14, 14].map(top => ({ top, rows: Math.max(0, Math.floor((limit - top) / CPITCH) + 1) }));
    return { compact: true, sets, band, written, stuTop, limit, cols };
};

const PAPERS = {
    letter: { w: 215.9, h: 279.4, label: 'Letter' },
    a4: { w: 210, h: 297, label: 'A4' },
    legal: { w: 215.9, h: 355.6, label: 'Legal' }
};

// ---- Answer rows ----
// A cell = [kind, choices, itemNo, sub, part, tag] (see scan-items.js). A cell with more than 5 choices continues
// on a second row of the same column ("block"): matching and ordering items group their rows by block.
// Header rows (the labels A B C ..., T F, 0 1 2 ...) are placed whenever the labels change.
const labelsOf = (fam, count) => {
    const b = Number(fam.slice(1)) || 0;
    if (fam === 'T') return ['T', 'F'];
    if (fam === 'S') return ['+', '\u2212'];
    const all = fam[0] === 'L' ? 'ABCDEFGHIJKLMNOPQRST'.split('') : fam[0] === 'P' ? Array.from({ length: 20 }, (_, k) => String(k + 1)) : '0123456789'.split('');
    return all.slice(b * 5, Math.min(b * 5 + 5, count));
};
const famOf = (kind, block) => (kind === 'a' || kind === 'm' ? 'L' + block : kind === 't' ? 'T' : kind === 'p' ? 'P' + block : kind === 's' ? 'S' : 'D' + block);

// -> { ok, error, rows: [{ q, u0, v, text, bubbles: [{ k, u, v }] }], headers: [{ u0, v, labels }], columnHeaders: [labels|null] }
export const planSheet = (cells, g = 0, strict = true) => {
    const geo = geoOf(g, strict);
    const COLUMNS = geo.cols;
    const groups = [];
    let i = 0;
    while (i < cells.length) {
        const slots = [];
        let j = i;
        while (j < cells.length && cells[j][2] === cells[i][2]) j++;
        const blocks = Math.max(...cells.slice(i, j).map(c => Math.ceil(c[1] / 5)));
        const itemMajor = cells[i][0] === 'a' || cells[i][0] === 'p';
        if (itemMajor) {
            // matching / ordering: all rows of one number together (A-E, then F-J ...), then the next number
            for (let k = i; k < j; k++) for (let b = 0; b < Math.ceil(cells[k][1] / 5); b++) slots.push({ cell: k, block: b });
        } else {
            for (let b = 0; b < blocks; b++) for (let k = i; k < j; k++) if (b === 0 || cells[k][1] > 5 * b) slots.push({ cell: k, block: b });
        }
        groups.push({ no: cells[i][2], slots });
        i = j;
    }
    // identification / enumeration lines go between the bubble rows, in the order of the exam
    const slots = [];
    const wl = geo.written.slice().sort((a, b) => a.no - b.no);
    const wslots = (w) => Array.from({ length: w.lines }, (_, k) => ({ w: true, no: w.no + k, part: w.part }));
    groups.forEach(gr => {
        while (wl.length && wl[0].no < gr.no) wslots(wl.shift()).forEach(x => slots.push(x));
        gr.slots.forEach(x => slots.push(x));
    });
    wl.forEach(w => wslots(w).forEach(x => slots.push(x)));
    const letterMax = Math.max(0, ...cells.filter(c => c[0] === 'a' || c[0] === 'm').map(c => c[1]));
    const posMax = Math.max(0, ...cells.filter(c => c[0] === 'p').map(c => c[1]));
    const countFor = (fam, cell) => (fam[0] === 'L' || fam[0] === 'P' ? cell[1] : countOf(fam));
    const countOf = (fam) => (fam[0] === 'L' ? letterMax : fam[0] === 'P' ? posMax : 10);

    const rows = cells.map((c, q) => ({ q, u0: 0, v: 0, text: '', bubbles: [], cell: c }));
    const headers = [], columnHeaders = [];
    // y = centre of the previous row inside the column, in mm from the column top. A label row between answer rows is
    // squeezed in (HDR_A below the previous row, HDR_B above the next one) instead of taking a whole row.
    // (mixed sheets) the letters are printed again whenever a new part starts or the kind of question changes, e.g.
    // a matching item with A-E after a multiple choice item with A-E.
    const sizes = new Map();
    cells.forEach(c => sizes.set(c[2], (sizes.get(c[2]) || 0) + 1));
    const wrows = [];
    const hdrAt = new Map();   // `${u0}|${v}` of the first row under a label row -> top of those letters (they are boxed with the question)
    let ci = 0, yPrev = null, last = null, lastSig = '', lastW = false, lastMulti = false, prevPart = null;
    const PITCH = geo.compact ? CPITCH : ANS.pitch, HA = geo.compact ? CHDR_A : HDR_A, HB = geo.compact ? CHDR_B : HDR_B;
    const maxY = (c) => (COLUMNS[c].rows - 1) * PITCH;
    // digit grids (numeric answers) are laid out block-major over many rows: keep a whole item in one column when it fits
    const runOf = new Map();
    slots.forEach((x, i) => {
        if (x.w || !['s', 'd', 'x'].includes(cells[x.cell][0])) return;
        const no = cells[x.cell][2];
        if (!runOf.has(no)) runOf.set(no, { first: i, n: 0, fams: new Set() });
        const r = runOf.get(no);
        r.n++; r.fams.add(famOf(cells[x.cell][0], x.block));
    });
    for (let si = 0; si < slots.length; si++) {
        const sl = slots[si];
        const cell = sl.w ? ['w', 0, sl.no, 0, sl.part, ''] : cells[sl.cell];
        const fam = sl.w ? 'W' : famOf(cell[0], sl.block);
        if (ci >= COLUMNS.length) break;
        let yHdr = null, y = yPrev === null ? 0 : yPrev + (sl.w ? WRITE.pitch : lastW ? 6.0 : PITCH);
        const sig = `${cell[4] || 0}|${cell[0]}${sizes.get(cell[2]) > 1 ? 'G' : 'S'}`;
        if (yPrev !== null && !sl.w && (fam !== last || (strict && sig !== lastSig))) { yHdr = yPrev + (lastW ? 5.0 : HA); y = yHdr + HB; }
        // (compact sheets) the rows of one boxed question stay together in one column
        let need = geo.compact && !sl.w && sl.block === 0 && !['x', 'd'].includes(cell[0]) && cell[1] > 5 ? (Math.ceil(cell[1] / 5) - 1) * (HA + HB) : 0;
        const run = !sl.w && ['s', 'd', 'x'].includes(cell[0]) ? runOf.get(cell[2]) : null;
        if (geo.compact && run && run.first === si) {
            const total = (run.n - 1) * PITCH + run.fams.size * (HA + HB - PITCH);
            if (total <= maxY(Math.min(ci, COLUMNS.length - 1))) need = total;
        }
        while (ci < COLUMNS.length && y + need > maxY(ci) + 0.01) { ci++; yPrev = null; last = null; yHdr = null; y = 0; }
        if (ci >= COLUMNS.length) break;
        if (yHdr !== null) {
            headers.push({ u0: ANS.left + ci * ANS.blockW, v: COLUMNS[ci].top + yHdr, labels: labelsOf(fam, countFor(fam, cell)) });
        }
        if (yPrev === null) columnHeaders[ci] = sl.w ? [] : labelsOf(fam, countFor(fam, cell));
        last = fam; lastSig = sig; lastW = Boolean(sl.w); lastMulti = !sl.w && sl.block > 0;
        const u0 = ANS.left + ci * ANS.blockW;
        const newPart = (sl.w || sl.block === 0) && (Number(cell[4]) || 0) !== prevPart;
        if (sl.w || sl.block === 0) prevPart = Number(cell[4]) || 0;
        if (sl.w) { wrows.push({ no: sl.no, part: sl.part, u0, v: COLUMNS[ci].top + y, partFirst: newPart }); yPrev = y; continue; }
        const v = COLUMNS[ci].top + y;
        if (yHdr !== null) hdrAt.set(`${u0}|${v.toFixed(2)}`, COLUMNS[ci].top + yHdr - 2.0);
        else if (yPrev === null) hdrAt.set(`${u0}|${v.toFixed(2)}`, COLUMNS[ci].top - LETTER_GAP - 1.0);
        const r = rows[sl.cell];
        if (sl.block === 0) {
            r.u0 = u0; r.v = v; r.placed = true; r.partFirst = newPart; r.colFirst = yPrev === null;
            const single = !(cells[sl.cell - 1] && cells[sl.cell - 1][2] === cell[2]) && !(cells[sl.cell + 1] && cells[sl.cell + 1][2] === cell[2]);
            r.text = cell[5] || (single ? String(cell[2]) : `${cell[2]}.${cell[3] + 1}`);
        }
        // the extra rows of one number (F-J, K-O ...) do not repeat the number
        if (sl.block > 0 && !r.cont) r.cont = [];
        if (sl.block > 0) r.cont.push({ u0, v, text: '' });
        for (let k = sl.block * 5; k < Math.min(cell[1], sl.block * 5 + 5); k++) {
            r.bubbles.push({ k, u: u0 + ANS.firstK + (k - sl.block * 5) * ANS.kPitch, v });
        }
        yPrev = y;
    }
    const placed = rows.every(r => r.placed) && wrows.length === geo.written.reduce((t, w) => t + w.lines, 0);
    return { ok: placed, wrows, hdrAt, error: placed ? '' : 'The answer sheet is full: this exam has too many answer rows for one sheet.', rows: rows.filter(r => r.placed), headers, columnHeaders, end: { ci, y: yPrev }, geo };
};

const plainCells = (n, c, parts = null) => Array.from({ length: n }, (_, i) => ['a', c, i + 1, 0, parts ? Number(parts[i]) || 0 : 0, '']);

// Capacity check used by the scanner setup: do the answer rows (and the written answers) fit on one sheet?
export const sheetFits = (cells, g = 0) => planSheet(cells, g, true).ok;

// One entry per answer row: where each choice bubble is. answerRows(n, c, g) = n rows of c choices (plain multiple
// choice); answerRows(cells, g) = the rows of a mixed-type sheet.
// Where the written answers sit (frame units), for cutting them out of a photo in the review:
// lines = [{no, part, u0, v}] (one per numbered line), essays = [{no, top, h}] in the bottom band, lineW = length of a short line.
export const writtenLayout = (cells, g, written) => {
    const plan = planSheet(cells, g, true);
    let vE = ESSAY_BOTTOM - bandFor(written);
    const essays = (written || []).filter(w => w.essay).map(w => { const h = essayHeight(w.lines); const e = { no: w.no, top: vE, h }; vE += h; return e; });
    return { lines: plan.wrows, essays, lineW: 4 * ANS.kPitch + BUBBLE_D, firstK: ANS.firstK };
};
export const answerRows = (n, c, g = 0) => (Array.isArray(n) ? planSheet(n, c, true) : planSheet(plainCells(n, c), g, false)).rows;

// One entry per digit column of the student number (00-0000 = 6 columns, digits 0-9 top to bottom).
export const studentCols = (g = 0, mixed = false) => Array.from({ length: STUDENT_DIGITS }, (_, col) => {
    const top = geoOf(g, mixed).stuTop;
    const u = STU.left + col * STU.colPitch + (col >= 2 ? STU.gap : 0);
    return {
        col, u,
        bubbles: Array.from({ length: 10 }, (_, d) => ({ digit: d, u, v: top + d * STU.rowPitch }))
    };
});

const mm = (v) => `${Number(v).toFixed(2)}mm`;

const bubbleHtml = (u, v, d = BUBBLE_D) =>
    `<div class="b" style="left:${mm(u - d / 2)};top:${mm(v - d / 2)};width:${mm(d)};height:${mm(d)}"></div>`;

const textHtml = (u, v, w, text, cls = '') =>
    `<div class="t ${cls}" style="left:${mm(u)};top:${mm(v)};width:${mm(w)}">${text}</div>`;

const markerHtml = (cx, cy, size) =>
    `<div class="mk" style="left:${mm(cx - size / 2)};top:${mm(cy - size / 2)};width:${mm(size)};height:${mm(size)}"></div>`;

// Complete printable HTML document for one answer sheet.
// title = the header typed by the lecturer (printed at the top; may be empty).
// parts = optional list with the 0-based part of each question; when the exam has more than one part,
// a small "PART n" label is printed above the first question of each part.
// Last sentence of the instructions, depending on what the sheet holds.
const noteOf = (multi, cells) => {
    const kinds = new Set((cells || []).map(c => c[0]));
    let t = (multi || kinds.has('m')) ? 'Shade ONE circle per number, unless the question says to select all that apply: then shade ALL the correct circles.' : 'Shade ONE circle per number.';
    if (kinds.has('x')) t += ' Numbers: shade the sign, the decimal places, then every digit (use leading zeros, e.g. 9.8 = 0098 with 1 decimal).';
    return t;
};

export const buildSheetHtml = ({ title = '', course = '', copies = 1, n, c, paper = 'a4', parts: qParts = null, sets = 0, multi = false, cells: given = null, written = null }) => {
    const p = PAPERS[paper] || PAPERS.a4;
    const g = { sets, band: given ? bandFor(written) : 0, written: given ? shortWritten(written) : [] };
    const geo = geoOf(g, Boolean(given));
    const compact = geo.compact;
    const left = (p.w - FRAME.w) / 2;
    const top = (p.h - FRAME.h) / 2 + (compact ? 7 : 0);
    const parts = [];

    parts.push(markerHtml(0, 0, MARKER.tlSize));
    parts.push(markerHtml(FRAME.w, 0, MARKER.size));
    parts.push(markerHtml(0, FRAME.h, MARKER.size));
    parts.push(markerHtml(FRAME.w, FRAME.h, MARKER.size));

    // Header, then ONE line for name / year and section / date, then the instructions. On the compact layout they sit
    // beside and above the top markers (outside the answer area, never scanned).
    const hv = compact ? { title: -17.4, line: -12.2, note: -8.2, course: -21.7 } : { title: 5.5, line: 14, note: 22, course: 1 };
    if (String(course).trim()) parts.push(textHtml(9, hv.course, 162, escapeHtml(String(course).trim().toUpperCase()), 'course'));
    if (String(title).trim()) parts.push(textHtml(9, hv.title, 162, escapeHtml(String(title).trim()), 'title'));
    parts.push(`<div class="hl" style="left:${mm(9)};top:${mm(hv.line)};width:${mm(162)}">` +
        '<span>Name:</span><span class="ul" style="flex:3"></span>' +
        '<span>Year &amp; Section:</span><span class="ul" style="flex:1.3"></span>' +
        '<span>Date:</span><span class="ul" style="flex:1.1"></span></div>');
    parts.push(textHtml(9, hv.note, 162,
        'Use a black pen or a dark pencil. Shade the circle completely. ' +
        'Do not fold or stain this sheet. ' +
        noteOf(multi, given), 'note'));

    // SET row: one circle per printed exam set, shaded by the student (same letter as on the question paper)
    if (sets > 1) {
        const sb = setBubbles(Math.min(MAX_SETS, sets));
        parts.push(textHtml(ANS.left + 1, SETROW.v - 1.6, 10, 'SET', 'cap'));
        sb.forEach(b => {
            parts.push(textHtml(b.u - 3, SETROW.capV, 6, String.fromCharCode(65 + b.k), 'cap center'));
            parts.push(bubbleHtml(b.u, b.v));
        });
    }

    // Student number grid (top of column 0)
    const stuTop = geo.stuTop;
    parts.push(textHtml(ANS.left + 2, stuTop - 6.5, 42, 'STUDENT NO. (00-0000)', 'cap'));
    const cols = studentCols(g, Boolean(given));
    for (let d = 0; d < 10; d++) {
        parts.push(textHtml(ANS.left + 2, stuTop + d * STU.rowPitch - 1.4, 4, String(d), 'num'));
    }
    cols.forEach(col => col.bubbles.forEach(b => parts.push(bubbleHtml(b.u, b.v, STU_BUBBLE_D))));
    parts.push(textHtml(STU.left + 1.5 * STU.colPitch + STU.gap / 2 - 2, stuTop + 4.5 * STU.rowPitch - 2, 4, '-', 'hyphen center'));

    // Answers: labels above the first row of every column in use, label rows where the labels change, then the rows
    const cells = given || plainCells(n, c, qParts);
    const plan = planSheet(cells, g, Boolean(given));
    const COLUMNS = geo.cols;
    plan.columnHeaders.forEach((labels, b) => {
        if (!labels) return;
        const u0 = ANS.left + b * ANS.blockW;
        labels.forEach((t, k) => parts.push(textHtml(u0 + ANS.firstK + k * ANS.kPitch - 3, COLUMNS[b].top - LETTER_GAP, 6, t, 'cap center')));
    });
    plan.headers.forEach(h => h.labels.forEach((t, k) => parts.push(textHtml(h.u0 + ANS.firstK + k * ANS.kPitch - 3, h.v - 1.1, 6, t, 'cap center hd'))));
    const showParts = new Set([...cells.map(c => Number(c[4]) || 0), ...g.written.map(w => w.part)]).size > 1;
    plan.rows.forEach(r => {
        const c = r.cell;
        if (showParts && r.partFirst) parts.push(textHtml(r.u0 + (r.u0 > ANS.left + 1 ? 2.5 : 0), r.v - 4.3, 10, 'PART ' + (Number(c[4]) + 1), 'part'));
        // (compact sheets) every question is boxed, number on the left; the rows of one question share one box
        const boxed = plan.geo.compact;
        parts.push(textHtml(r.u0 - 3 - (boxed ? 2.5 : 0), r.v - 1.6, 12, r.text, 'num right'));
        r.bubbles.forEach(bb => parts.push(bubbleHtml(bb.u, bb.v)));
        if (boxed) {
            const together = r.cont && r.cont.length && !['x', 'd'].includes(c[0]) && r.cont.every(x => x.u0 === r.u0);
            const groups = together ? [r.bubbles] : [];
            if (!together) {
                // one box per row of bubbles; a row that continues in another column is boxed in each column
                [...new Set(r.bubbles.map(bb => bb.v))].forEach(v => {
                    let cur = null;
                    r.bubbles.filter(bb => bb.v === v).sort((a, b) => a.u - b.u).forEach(bb => {
                        if (cur && bb.u - cur[cur.length - 1].u < 2 * ANS.kPitch) cur.push(bb);
                        else { cur = [bb]; groups.push(cur); }
                    });
                });
            }
            groups.forEach(g => {
                const vs = g.map(bb => bb.v), us = g.map(bb => bb.u);
                const vmin = Math.min(...vs);
                const col = Math.floor((Math.min(...us) - ANS.left) / ANS.blockW);
                const hv = plan.hdrAt.get(`${ANS.left + col * ANS.blockW}|${vmin.toFixed(2)}`);
                const top = hv !== undefined ? hv : vmin - 2.85, bottom = Math.max(...vs) + 2.85, left = ANS.left + col * ANS.blockW + 7.0, right = ANS.left + col * ANS.blockW + ANS.firstK + 4 * ANS.kPitch + 3.2;   // always the width of 5 bubbles
                parts.push(`<div class="bx" style="left:${mm(left)};top:${mm(top)};width:${mm(right - left)};height:${mm(bottom - top)}"></div>`);
            });
        }
    });
    if (!plan.ok) parts.push(textHtml(52, 30, 120, 'This exam has too many answer rows for one sheet.', 'note'));

    // Written answers: numbered lines between the bubble rows (same order as the exam), essays in the bottom band
    if (given && plan.ok) {
        const lineW = 4 * ANS.kPitch + BUBBLE_D;       // as long as one row of 5 bubbles
        plan.wrows.forEach(l => {
            if (showParts && l.partFirst) parts.push(textHtml(l.u0 + (l.u0 > ANS.left + 1 ? 2.5 : 0), l.v - 4.3, 10, 'PART ' + (l.part + 1), 'part'));
            parts.push(textHtml(l.u0 - 3, l.v + 2.3 - 3.2, 12, String(l.no), 'num right'));
            parts.push(`<div class="wl" style="left:${mm(l.u0 + ANS.firstK - BUBBLE_D / 2)};top:${mm(l.v + 2.3)};width:${mm(lineW)}"></div>`);
        });
        let vE = ESSAY_BOTTOM - bandFor(written);
        (written || []).filter(w => w.essay).forEach(w => {
            parts.push(textHtml(9, vE, 100, `ESSAY ${w.no}`, 'cap small'));
            for (let k = 0; k < w.lines; k++) {
                const lv = vE + 4 + (k + 1) * ESSAY_MM;
                if (k === 0) parts.push(textHtml(9, lv - 3.4, 10, `${w.no}.`, 'num'));
                parts.push(`<div class="wl" style="left:${mm(9)};top:${mm(lv)};width:${mm(162)}"></div>`);
            }
            vE += essayHeight(w.lines);
        });
    }

    // Two copies on one paper: the paper turns to landscape and each half holds the whole sheet, scaled to fit.
    const twoUp = Number(copies) === 2;
    const one = `<div class="page"><div class="frame">${parts.join('')}</div></div>`;
    let sheet = one;
    if (twoUp) {
        const halfW = p.h / 2, H = p.w;
        const cTop = Math.max(2, top - 24), cBottom = Math.min(p.h, top + 250), cLeft = left - 8, cW = FRAME.w + 16;
        const sc = Math.min((halfW - 2) / cW, (H - 6) / (cBottom - cTop));
        const tx = (halfW - cW * sc) / 2 - cLeft * sc, ty = (H - (cBottom - cTop) * sc) / 2 - cTop * sc;
        const half = (at) => `<div class="half" style="left:${at}mm"><div class="page" style="transform:translate(${tx.toFixed(2)}mm,${ty.toFixed(2)}mm) scale(${sc.toFixed(4)});transform-origin:0 0"><div class="frame">${parts.join('')}</div></div></div>`;
        sheet = `<div class="two">${half(0)}${half(halfW)}<div class="cut"></div></div>`;
    }
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Answer Sheet${title ? ' | ' + escapeHtml(title) : ''}</title>
<style>
@page { size: ${twoUp ? p.h : p.w}mm ${twoUp ? p.w : p.h}mm; margin: 0; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; background: #fff; font-family: Arial, sans-serif; color: #000; }
.page { position: relative; width: ${p.w}mm; height: ${p.h}mm; overflow: ${twoUp ? 'visible' : 'hidden'}; }
.two { position: relative; width: ${p.h}mm; height: ${p.w}mm; overflow: hidden; }
.half { position: absolute; top: 0; width: ${p.h / 2}mm; height: ${p.w}mm; overflow: hidden; }
.cut { position: absolute; left: ${p.h / 2}mm; top: 0; height: ${p.w}mm; border-left: 0.2mm dashed #999; }
.frame { position: absolute; left: ${mm(left)}; top: ${mm(top)}; width: ${FRAME.w}mm; height: ${FRAME.h}mm; }
.mk { position: absolute; background: #000; box-shadow: inset 0 0 0 10mm #000; }
.b { position: absolute; box-sizing: border-box; border: ${BUBBLE_BORDER}mm solid #000; border-radius: 50%; }
.t { position: absolute; font-size: 2.9mm; line-height: 3.2mm; }
.course { font-size: 3.3mm; font-weight: bold; line-height: 4mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.title { font-size: 4.4mm; font-weight: bold; line-height: 5mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hl { position: absolute; display: flex; align-items: flex-end; gap: 1.6mm; font-size: 3.2mm; line-height: 3.6mm; white-space: nowrap; }
.ul { display: block; height: 3.6mm; border-bottom: 0.3mm solid #000; }
.note { font-size: 2.5mm; line-height: 3mm; color: #222; }
.cap { font-size: 2.2mm; font-weight: bold; }
.small { font-size: 2.2mm; white-space: nowrap; }
.hd { font-size: 2.0mm; line-height: 2.2mm; }
.bx { position: absolute; border: 0.3mm dashed #777; border-radius: 1.2mm; }
.wl { position: absolute; border-top: 0.3mm solid #000; height: 0; }
.num { font-size: 2.6mm; }
.part { font-size: 1.9mm; line-height: 2mm; font-weight: bold; white-space: nowrap; }
.right { text-align: right; }
.center { text-align: center; }
.hyphen { font-size: 4mm; font-weight: bold; }
</style></head>
<body>${sheet}
<script>window.onload = function () { setTimeout(function () { window.print(); }, 400); };<\/script>
</body></html>`;
};
