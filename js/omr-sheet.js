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
const HDR_A = 4.0, HDR_B = 3.9;   // label row squeezed between two answer rows: distance below the row above / above the row below   // letters A-E are printed this far above the first row of a column

// SET row (which printed exam set the student has): up to 6 circles A-F, printed only for exams with sets.
export const MAX_SETS = 6;
// It sits in the left column, below the instructions and above the student number grid.
const SETROW = { u0: 15.5, v: 43.5, pitch: 6, capV: 36.3 };
export const setBubbles = (count = MAX_SETS) => Array.from({ length: count }, (_, k) => ({ k, u: SETROW.u0 + k * SETROW.pitch, v: SETROW.v }));

// Student number grid, inside column 0.
const STU = { left: 14, colPitch: 6, gap: 3, top: 38, rowPitch: 4.4 };

// Sheets with SET circles push the student grid and column 0 down to make room for them.
const GEO_SETS = { stuTop: 55, cols: [{ top: 106, rows: 22 }, COLUMNS[1], COLUMNS[2], COLUMNS[3]] };
const GEO_BASE = { stuTop: STU.top, cols: COLUMNS };
const geoOf = (sets) => (sets > 1 ? GEO_SETS : GEO_BASE);

const PAPERS = {
    letter: { w: 215.9, h: 279.4, label: 'Letter' },
    a4: { w: 210, h: 297, label: 'A4' },
    legal: { w: 215.9, h: 355.6, label: 'Legal' }
};

// Which column and row question i (0-based) goes in; questions fill column 0, then 1, 2, 3.
const slotOf = (i) => {
    let rest = i;
    for (let b = 0; b < COLUMNS.length; b++) {
        if (rest < COLUMNS[b].rows) return { block: b, row: rest };
        rest -= COLUMNS[b].rows;
    }
    return null;
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
export const planSheet = (cells, sets = 0) => {
    const COLUMNS = geoOf(sets).cols;
    const slots = [];
    let i = 0;
    while (i < cells.length) {
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
        i = j;
    }
    const letterMax = Math.max(0, ...cells.filter(c => c[0] === 'a' || c[0] === 'm').map(c => c[1]));
    const posMax = Math.max(0, ...cells.filter(c => c[0] === 'p').map(c => c[1]));
    const countOf = (fam) => (fam[0] === 'L' ? letterMax : fam[0] === 'P' ? posMax : 10);

    const rows = cells.map((c, q) => ({ q, u0: 0, v: 0, text: '', bubbles: [], cell: c }));
    const headers = [], columnHeaders = [];
    // y = centre of the previous row inside the column, in mm from the column top. A label row between answer rows is
    // squeezed in (HDR_A below the previous row, HDR_B above the next one) instead of taking a whole row.
    let ci = 0, yPrev = null, last = null;
    const maxY = (c) => (COLUMNS[c].rows - 1) * ANS.pitch;
    for (const sl of slots) {
        const cell = cells[sl.cell];
        const fam = famOf(cell[0], sl.block);
        if (ci >= COLUMNS.length) break;
        let yHdr = null, y = yPrev === null ? 0 : yPrev + ANS.pitch;
        if (yPrev !== null && fam !== last) { yHdr = yPrev + HDR_A; y = yHdr + HDR_B; }
        if (y > maxY(ci) + 0.01) { ci++; yPrev = null; last = null; yHdr = null; y = 0; }
        if (ci >= COLUMNS.length) break;
        if (yHdr !== null) {
            headers.push({ u0: ANS.left + ci * ANS.blockW, v: COLUMNS[ci].top + yHdr, labels: labelsOf(fam, countOf(fam)) });
        }
        if (yPrev === null) columnHeaders[ci] = labelsOf(fam, countOf(fam));
        last = fam;
        const u0 = ANS.left + ci * ANS.blockW;
        const v = COLUMNS[ci].top + y;
        const r = rows[sl.cell];
        if (sl.block === 0) {
            r.u0 = u0; r.v = v; r.placed = true;
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
    const placed = rows.every(r => r.placed);
    return { ok: placed, error: placed ? '' : 'The answer sheet is full: this exam has too many answer rows for one sheet.', rows: rows.filter(r => r.placed), headers, columnHeaders, end: { ci, y: yPrev } };
};

// Capacity check used by the scanner setup: number of header + answer rows the cells need.
export const sheetFits = (cells, sets = 0) => planSheet(cells, sets).ok;

const plainCells = (n, c, parts = null) => Array.from({ length: n }, (_, i) => ['a', c, i + 1, 0, parts ? Number(parts[i]) || 0 : 0, '']);

// One entry per answer row: where each choice bubble is. answerRows(n, c) = n rows of c choices (plain multiple choice);
// answerRows(cells) = the rows of a mixed-type sheet.
export const answerRows = (n, c, sets = 0) => planSheet(Array.isArray(n) ? n : plainCells(n, c), Array.isArray(n) ? (Number(c) || 0) : sets).rows;

// One entry per digit column of the student number (00-0000 = 6 columns, digits 0-9 top to bottom).
export const studentCols = (sets = 0) => Array.from({ length: STUDENT_DIGITS }, (_, col) => {
    const top = geoOf(sets).stuTop;
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

// Written-answers pages: full-width lines, one numbered line per answer (identification, enumeration), a block of
// lines per essay. Pages are filled by height so every page keeps its margins. -> html ('' when nothing is written)
const LINE_MM = 9, ESSAY_MM = 7.6, HEAD_MM = 26;
const writtenPagesHtml = (written, title, p) => {
    const room = p.h - 28 - HEAD_MM;
    const blocks = written.map(w => {
        const label = w.span > 1 ? `${w.no}-${w.no + w.span - 1}` : String(w.no);
        if (w.essay) {
            const lines = Array.from({ length: w.lines }, (_, k) => `<div class="wr" style="height:${ESSAY_MM}mm">${k === 0 ? `<b>${label}.</b>` : '<b></b>'}</div>`).join('');
            return { h: 5 + w.lines * ESSAY_MM + 3, html: `<div class="wi"><div class="wc">Essay ${label}</div>${lines}</div>` };
        }
        const lines = Array.from({ length: w.lines }, (_, k) => `<div class="wr" style="height:${LINE_MM}mm"><b>${w.no + k}.</b></div>`).join('');
        return { h: w.lines * LINE_MM + 3, html: `<div class="wi">${lines}</div>` };
    });
    const pages = [];
    let cur = [], used = 0;
    blocks.forEach(b => {
        if (cur.length && used + b.h > room) { pages.push(cur); cur = []; used = 0; }
        cur.push(b.html); used += b.h;
    });
    if (cur.length) pages.push(cur);
    return pages.map((list, i) => `<div class="wp"><div class="wh">WRITTEN ANSWERS${title ? ' | ' + escapeHtml(String(title)) : ''}${pages.length > 1 ? ` (${i + 1}/${pages.length})` : ''}</div>
<div class="wid"><span>Name:</span><span class="l"></span><span>Year &amp; Section:</span><span class="l" style="max-width:40mm"></span><span>Set:</span><span class="l" style="max-width:14mm"></span></div>${list.join('')}</div>`).join('');
};

export const buildSheetHtml = ({ title = '', n, c, paper = 'letter', parts: qParts = null, sets = 0, multi = false, cells: given = null, written = null }) => {
    const p = PAPERS[paper] || PAPERS.letter;
    const left = (p.w - FRAME.w) / 2;
    const top = (p.h - FRAME.h) / 2;
    const parts = [];

    parts.push(markerHtml(0, 0, MARKER.tlSize));
    parts.push(markerHtml(FRAME.w, 0, MARKER.size));
    parts.push(markerHtml(0, FRAME.h, MARKER.size));
    parts.push(markerHtml(FRAME.w, FRAME.h, MARKER.size));

    // Header, then ONE line for name / year and section / date, then the instructions.
    if (String(title).trim()) parts.push(textHtml(9, 5, 162, escapeHtml(String(title).trim()), 'title'));
    const withSets = sets > 1;
    parts.push(`<div class="hl" style="left:${mm(9)};top:${mm(14)};width:${mm(162)}">` +
        '<span>Name:</span><span class="ul" style="flex:3"></span>' +
        '<span>Year &amp; Section:</span><span class="ul" style="flex:1.3"></span>' +
        '<span>Date:</span><span class="ul" style="flex:1.1"></span></div>');
    parts.push(textHtml(9, 22, 162,
        'Use a black or blue pen, or a dark pencil. Shade the circle completely. ' +
        'Do not fold or stain this sheet. Erase fully if you change an answer. ' +
        noteOf(multi, given), 'note'));

    // SET row: one circle per printed exam set, shaded by the student (same letter as on the question paper)
    if (withSets) {
        const sb = setBubbles(Math.min(MAX_SETS, sets));
        parts.push(textHtml(ANS.left + 1, SETROW.v - 1.6, 10, 'SET', 'cap'));
        sb.forEach(b => {
            parts.push(textHtml(b.u - 3, SETROW.capV, 6, String.fromCharCode(65 + b.k), 'cap center'));
            parts.push(bubbleHtml(b.u, b.v));
        });
    }

    // Student number grid (top of column 0)
    const stuTop = geoOf(sets).stuTop;
    parts.push(textHtml(ANS.left + 2, stuTop - 6.5, 42, 'STUDENT NO. (00-0000)', 'cap'));
    const cols = studentCols(sets);
    for (let d = 0; d < 10; d++) {
        parts.push(textHtml(ANS.left + 2, stuTop + d * STU.rowPitch - 1.4, 4, String(d), 'num'));
    }
    cols.forEach(col => col.bubbles.forEach(b => parts.push(bubbleHtml(b.u, b.v, STU_BUBBLE_D))));
    parts.push(textHtml(STU.left + 1.5 * STU.colPitch + STU.gap / 2 - 2, stuTop + 4.5 * STU.rowPitch - 2, 4, '-', 'hyphen center'));

    // Answers: labels above the first row of every column in use, label rows where the labels change, then the rows
    const cells = given || plainCells(n, c, qParts);
    const plan = planSheet(cells, sets);
    const COLUMNS = geoOf(sets).cols;
    plan.columnHeaders.forEach((labels, b) => {
        if (!labels) return;
        const u0 = ANS.left + b * ANS.blockW;
        labels.forEach((t, k) => parts.push(textHtml(u0 + ANS.firstK + k * ANS.kPitch - 3, COLUMNS[b].top - LETTER_GAP, 6, t, 'cap center')));
    });
    plan.headers.forEach(h => h.labels.forEach((t, k) => parts.push(textHtml(h.u0 + ANS.firstK + k * ANS.kPitch - 3, h.v - 1.3, 6, t, 'cap center hd'))));
    const showParts = new Set(cells.map(c => c[4])).size > 1;
    plan.rows.forEach(r => {
        const c = r.cell;
        const first = r.q === 0 || cells[r.q - 1][4] !== c[4];
        if (showParts && first) parts.push(textHtml(r.u0, r.v - 4.3, 10, 'PART ' + (Number(c[4]) + 1), 'part'));
        parts.push(textHtml(r.u0 - 3, r.v - 1.6, 12, r.text, 'num right'));
        
        r.bubbles.forEach(bb => parts.push(bubbleHtml(bb.u, bb.v)));
    });
    if (!plan.ok) parts.push(textHtml(9, 36, 162, 'This exam has too many answer rows for one sheet.', 'note'));

    // Answers that are written, not shaded, go on the extra page(s) after the bubble sheet.
    const writtenPages = written && written.length ? writtenPagesHtml(written, title, p) : '';
    if (writtenPages) parts.push(textHtml(9, 233, 162, 'Written answers (identification, enumeration, essay): use the next page.', 'note'));

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Answer Sheet${title ? ' | ' + escapeHtml(title) : ''}</title>
<style>
@page { size: ${p.w}mm ${p.h}mm; margin: 0; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; background: #fff; font-family: Arial, sans-serif; color: #000; }
.page { position: relative; width: ${p.w}mm; height: ${p.h}mm; overflow: hidden; }
.frame { position: absolute; left: ${mm(left)}; top: ${mm(top)}; width: ${FRAME.w}mm; height: ${FRAME.h}mm; }
.mk { position: absolute; background: #000; box-shadow: inset 0 0 0 10mm #000; }
.b { position: absolute; box-sizing: border-box; border: ${BUBBLE_BORDER}mm solid #000; border-radius: 50%; }
.t { position: absolute; font-size: 2.9mm; line-height: 3.2mm; }
.title { font-size: 4.4mm; font-weight: bold; line-height: 5mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hl { position: absolute; display: flex; align-items: flex-end; gap: 1.6mm; font-size: 3.2mm; line-height: 3.6mm; white-space: nowrap; }
.ul { display: block; height: 3.6mm; border-bottom: 0.3mm solid #000; }
.note { font-size: 2.5mm; line-height: 3mm; color: #222; }
.cap { font-size: 2.8mm; font-weight: bold; }
.small { font-size: 2.2mm; white-space: nowrap; }
.hd { font-size: 2.3mm; line-height: 2.6mm; }
.wp { position: relative; width: ${p.w}mm; height: ${p.h}mm; overflow: hidden; break-before: page; page-break-before: always; padding: 14mm 16mm; box-sizing: border-box; }
.wp .wh { font-size: 4.2mm; font-weight: bold; margin: 0 0 3mm; }
.wp .wid { display: flex; gap: 3mm; align-items: flex-end; font-size: 3.2mm; margin-bottom: 4mm; white-space: nowrap; }
.wp .wid span.l { flex: 1; border-bottom: 0.3mm solid #000; height: 3.6mm; }
.wp .wc { font-size: 3mm; font-weight: bold; margin: 0 0 1mm; }
.wp .wr { display: flex; align-items: flex-end; gap: 2mm; border-bottom: 0.3mm solid #000; }
.wp .wr b { font-size: 3.2mm; min-width: 11mm; text-align: right; font-weight: normal; line-height: 3.6mm; padding-bottom: 0.6mm; }
.wp .wi { margin-bottom: 3mm; }
.num { font-size: 2.6mm; }
.part { font-size: 1.9mm; line-height: 2mm; font-weight: bold; white-space: nowrap; }
.right { text-align: right; }
.center { text-align: center; }
.hyphen { font-size: 4mm; font-weight: bold; }
</style></head>
<body><div class="page"><div class="frame">${parts.join('')}</div></div>${writtenPages}
<script>window.onload = function () { setTimeout(function () { window.print(); }, 400); };<\/script>
</body></html>`;
};
