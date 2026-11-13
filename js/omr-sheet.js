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
const LETTER_GAP = 7;   // letters A-E are printed this far above the first row of a column

// Student number grid, inside column 0.
const STU = { left: 14, colPitch: 6, gap: 3, top: 38, rowPitch: 4.4 };

const PAPERS = {
    letter: { w: 215.9, h: 279.4, label: 'Letter' },
    a4: { w: 210, h: 297, label: 'A4' }
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

// One entry per question: where each choice bubble is.
export const answerRows = (n, c) => {
    const rows = [];
    for (let i = 0; i < n; i++) {
        const slot = slotOf(i);
        if (!slot) break;
        const u0 = ANS.left + slot.block * ANS.blockW;
        const v = COLUMNS[slot.block].top + slot.row * ANS.pitch;
        rows.push({
            q: i, u0, v,
            bubbles: Array.from({ length: c }, (_, k) => ({ k, u: u0 + ANS.firstK + k * ANS.kPitch, v }))
        });
    }
    return rows;
};

// One entry per digit column of the student number (00-0000 = 6 columns, digits 0-9 top to bottom).
export const studentCols = () => Array.from({ length: STUDENT_DIGITS }, (_, col) => {
    const u = STU.left + col * STU.colPitch + (col >= 2 ? STU.gap : 0);
    return {
        col, u,
        bubbles: Array.from({ length: 10 }, (_, d) => ({ digit: d, u, v: STU.top + d * STU.rowPitch }))
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
export const buildSheetHtml = ({ title = '', n, c, paper = 'letter', parts: qParts = null }) => {
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
    parts.push(`<div class="hl" style="left:${mm(9)};top:${mm(14)};width:${mm(162)}">` +
        '<span>Name:</span><span class="ul" style="flex:3"></span>' +
        '<span>Year &amp; Section:</span><span class="ul" style="flex:1.3"></span>' +
        '<span>Date:</span><span class="ul" style="flex:1.1"></span></div>');
    parts.push(textHtml(9, 22, 162,
        'Use a black or blue pen, or a dark pencil. Shade the circle completely. ' +
        'Do not fold or stain this sheet. Erase fully if you change an answer. ' +
        'Shade ONE circle per number.', 'note'));

    // Student number grid (top of column 0)
    parts.push(textHtml(ANS.left + 2, STU.top - 6.5, 42, 'STUDENT NO. (00-0000)', 'cap'));
    const cols = studentCols();
    for (let d = 0; d < 10; d++) {
        parts.push(textHtml(ANS.left + 2, STU.top + d * STU.rowPitch - 1.4, 4, String(d), 'num'));
    }
    cols.forEach(col => col.bubbles.forEach(b => parts.push(bubbleHtml(b.u, b.v, STU_BUBBLE_D))));
    parts.push(textHtml(STU.left + 1.5 * STU.colPitch + STU.gap / 2 - 2, STU.top + 4.5 * STU.rowPitch - 2, 4, '-', 'hyphen center'));

    // Answers: letters above the first row of every column in use, then the rows
    const rows = answerRows(n, c);
    const lastBlock = rows.length ? slotOf(rows[rows.length - 1].q).block : 0;
    for (let b = 0; b <= lastBlock; b++) {
        const u0 = ANS.left + b * ANS.blockW;
        for (let k = 0; k < c; k++) {
            parts.push(textHtml(u0 + ANS.firstK + k * ANS.kPitch - 3, COLUMNS[b].top - LETTER_GAP, 6, String.fromCharCode(65 + k), 'cap center'));
        }
    }
    const showParts = Array.isArray(qParts) && new Set(qParts.slice(0, n)).size > 1;
    rows.forEach(r => {
        if (showParts && (r.q === 0 || qParts[r.q] !== qParts[r.q - 1])) {
            parts.push(textHtml(r.u0, r.v - 4.3, 10, 'PART ' + (Number(qParts[r.q]) + 1), 'part'));
        }
        parts.push(textHtml(r.u0, r.v - 1.6, 9, String(r.q + 1), 'num right'));
        r.bubbles.forEach(bb => parts.push(bubbleHtml(bb.u, bb.v)));
    });

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
.num { font-size: 2.6mm; }
.part { font-size: 1.9mm; line-height: 2mm; font-weight: bold; white-space: nowrap; }
.right { text-align: right; }
.center { text-align: center; }
.hyphen { font-size: 4mm; font-weight: bold; }
</style></head>
<body><div class="page"><div class="frame">${parts.join('')}</div></div>
<script>window.onload = function () { setTimeout(function () { window.print(); }, 400); };<\/script>
</body></html>`;
};
