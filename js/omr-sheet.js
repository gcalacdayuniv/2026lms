// js/omr-sheet.js
// Layout of the printable answer sheet (bubble sheet) and the HTML that prints it.
// The scanner (omr-scan.js) uses the SAME numbers, so never change one without the other.
//
// Coordinates are in millimetres inside the "frame": a 180 x 240 mm rectangle whose four
// corners hold the alignment markers. (0,0) is the centre of the top-left marker.
// The top-left marker is larger than the others so the scanner can tell which way is up.
import { escapeHtml } from './html-utils.js';

export const FRAME = { w: 180, h: 240 };
export const MARKER = { size: 8, tlSize: 11 };
export const BUBBLE_D = 4.6;
export const BUBBLE_BORDER = 0.35;
export const MAX_QUESTIONS = 100;
export const MAX_CHOICES = 5;
export const ROWS_PER_BLOCK = 25;
export const STUDENT_DIGITS = 6;

const ANS = { top: 82, pitch: 5.8, left: 4, blockW: 44.5, firstK: 12, kPitch: 6.4 };
const STU = { left: 118, colPitch: 7.4, gap: 4, top: 17, rowPitch: 5.2 };

const PAPERS = {
    letter: { w: 215.9, h: 279.4, label: 'Letter' },
    a4: { w: 210, h: 297, label: 'A4' }
};

// One entry per question: where each choice bubble is.
export const answerRows = (n, c) => {
    const rows = [];
    for (let i = 0; i < n; i++) {
        const block = Math.floor(i / ROWS_PER_BLOCK);
        const row = i % ROWS_PER_BLOCK;
        const u0 = ANS.left + block * ANS.blockW;
        const v = ANS.top + row * ANS.pitch;
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

const bubbleHtml = (u, v) =>
    `<div class="b" style="left:${mm(u - BUBBLE_D / 2)};top:${mm(v - BUBBLE_D / 2)}"></div>`;

const textHtml = (u, v, w, text, cls = '') =>
    `<div class="t ${cls}" style="left:${mm(u)};top:${mm(v)};width:${mm(w)}">${text}</div>`;

const markerHtml = (cx, cy, size) =>
    `<div class="mk" style="left:${mm(cx - size / 2)};top:${mm(cy - size / 2)};width:${mm(size)};height:${mm(size)}"></div>`;

// Complete printable HTML document for one answer sheet.
export const buildSheetHtml = ({ title = '', subtitle = '', n, c, paper = 'letter' }) => {
    const p = PAPERS[paper] || PAPERS.letter;
    const left = (p.w - FRAME.w) / 2;
    const top = (p.h - FRAME.h) / 2;
    const parts = [];

    parts.push(markerHtml(0, 0, MARKER.tlSize));
    parts.push(markerHtml(FRAME.w, 0, MARKER.size));
    parts.push(markerHtml(0, FRAME.h, MARKER.size));
    parts.push(markerHtml(FRAME.w, FRAME.h, MARKER.size));

    parts.push(textHtml(9, 7, 100, escapeHtml(title), 'title'));
    parts.push(textHtml(9, 14, 100, escapeHtml(subtitle), 'sub'));
    parts.push(textHtml(9, 24, 100, 'Name: ______________________________', 'line'));
    parts.push(textHtml(9, 33, 100, 'Date: ____________________  Score: ________', 'line'));
    parts.push(textHtml(9, 43, 100,
        'Use a black or blue pen, or a dark pencil. Shade the circle completely. ' +
        'Do not fold or stain this sheet. Erase fully if you change an answer. ' +
        'Shade ONE circle per number.', 'note'));

    // Student number grid
    parts.push(textHtml(STU.left - 8, 6, 50, 'STUDENT NO. (00-0000)', 'cap'));
    const cols = studentCols();
    for (let d = 0; d < 10; d++) {
        parts.push(textHtml(STU.left - 8, STU.top + d * STU.rowPitch - 1.5, 4, String(d), 'num'));
    }
    cols.forEach(col => col.bubbles.forEach(b => parts.push(bubbleHtml(b.u, b.v))));
    parts.push(textHtml(STU.left + 1.5 * STU.colPitch + STU.gap / 2 - 2, STU.top + 4.5 * STU.rowPitch - 2, 4, '-', 'hyphen center'));

    // Answer blocks
    const rows = answerRows(n, c);
    const blocks = Math.ceil(n / ROWS_PER_BLOCK);
    for (let b = 0; b < blocks; b++) {
        const u0 = ANS.left + b * ANS.blockW;
        for (let k = 0; k < c; k++) {
            parts.push(textHtml(u0 + ANS.firstK + k * ANS.kPitch - 3, ANS.top - 9, 6, String.fromCharCode(65 + k), 'cap center'));
        }
    }
    rows.forEach(r => {
        parts.push(textHtml(r.u0, r.v - 1.6, 9, String(r.q + 1), 'num right'));
        r.bubbles.forEach(bb => parts.push(bubbleHtml(bb.u, bb.v)));
    });

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Answer Sheet | ${escapeHtml(title)}</title>
<style>
@page { size: ${p.w}mm ${p.h}mm; margin: 0; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; background: #fff; font-family: Arial, sans-serif; color: #000; }
.page { position: relative; width: ${p.w}mm; height: ${p.h}mm; overflow: hidden; }
.frame { position: absolute; left: ${mm(left)}; top: ${mm(top)}; width: ${FRAME.w}mm; height: ${FRAME.h}mm; }
.mk { position: absolute; background: #000; box-shadow: inset 0 0 0 10mm #000; }
.b { position: absolute; box-sizing: border-box; width: ${BUBBLE_D}mm; height: ${BUBBLE_D}mm; border: ${BUBBLE_BORDER}mm solid #000; border-radius: 50%; }
.t { position: absolute; font-size: 2.9mm; line-height: 3.2mm; }
.title { font-size: 4.2mm; font-weight: bold; line-height: 5mm; }
.sub { font-size: 3.2mm; color: #222; }
.line { font-size: 3.4mm; }
.note { font-size: 2.5mm; line-height: 3mm; color: #222; }
.cap { font-size: 2.8mm; font-weight: bold; }
.num { font-size: 2.6mm; }
.right { text-align: right; }
.center { text-align: center; }
.hyphen { font-size: 4mm; font-weight: bold; }
</style></head>
<body><div class="page"><div class="frame">${parts.join('')}</div></div>
<script>window.onload = function () { setTimeout(function () { window.print(); }, 400); };<\/script>
</body></html>`;
};
