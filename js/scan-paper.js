// js/scan-paper.js
// Question paper and answer keys of an exam meant for the answer-sheet scanner (any mix of question types).
// Students shade the answer sheet; questions that cannot be shaded (identification, enumeration, essay) are
// written on the paper and marked by hand.
import { escapeHtml as esc } from './html-utils.js';
import { PRINT_CSS, PAGINATE_SCRIPT, partTitle } from './print-preview.js';
import { SET_LETTERS, itemLabel, writtenLabels } from './scan-items.js';
import { planWritten } from './omr-sheet.js';
import { questionPoints } from './grading.js';

const LET = 'ABCDEFGHIJ';
const lines = (n) => Array.from({ length: n }, () => '<div class="ln"></div>').join('');
const clean = (list) => (Array.isArray(list) ? list : []).map(x => String(x ?? '').trim()).filter(Boolean);

// Lines numbered with the question numbers the item uses (11, 12, 13).
const numbered = (it, n) => Array.from({ length: n }, (_, i) => `<div class="ln"><span>${it.no + i}.</span></div>`).join('');

const bodyOf = (it, onSheet) => {
    const r = it.row;
    switch (it.t) {
        case 'mc': return it.shown.map((o, k) => `<div class="c">${LET[k]}. ${esc(o)}</div>`).join('');
        case 'multi': return '<div class="hint">Select all that apply.</div>' + it.shown.map((o, k) => `<div class="c">${LET[k]}. ${esc(o)}</div>`).join('');
        case 'tf': return '<div class="hint">Shade T for True or F for False.</div>';
        case 'match': return `<div class="hint">Shade the letter of the matching item (numbers ${it.no} to ${it.no + it.cells.length - 1}).</div><div class="mt"><div>` +
            it.lefts.map((l, i) => `<div class="c">${it.no + i}. ${esc(l)}</div>`).join('') + '</div><div>' +
            it.shown.map((o, k) => `<div class="c">${LET[k]}. ${esc(o)}</div>`).join('') + '</div></div>';
        case 'order': return `<div class="hint">Shade the position (1 = first) of each item (numbers ${it.no} to ${it.no + it.cells.length - 1}).</div>` +
            it.shown.map((o, i) => `<div class="c">${it.no + i}. ${esc(o)}</div>`).join('');
        case 'num': return '<div class="hint">Shade the sign, the decimal places and every digit of your answer on the answer sheet.</div>';
        default:
            if (it.type === 'essay') return lines(4);
            if (onSheet) return `<div class="hint">Write your answer${it.span > 1 ? 's' : ''} on the answer sheet, number${it.span > 1 ? 's' : ''} ${itemLabel(it)}.</div>`;
            if (it.type === 'enum') return `<div class="hint">List ${it.span} item${it.span === 1 ? '' : 's'}.</div>` + numbered(it, it.span);
            return '<div class="ln"></div>';
    }
};

const keyOf = (it) => {
    const r = it.row;
    switch (it.t) {
        case 'mc': return `${LET[it.key[0]]}. ${it.shown[it.key[0]]}`;
        case 'multi': return it.shown.map((_, k) => k).filter(k => (it.key[0] - 1000) & (1 << k)).map(k => LET[k]).join(', ');
        case 'tf': return it.key[0] === 0 ? 'True' : 'False';
        case 'match': return it.key.map((k, i) => `${it.no + i}=${LET[k]}`).join('  ');
        case 'order': return it.key.map((p, i) => `${it.no + i}=${p + 1}`).join('  ');
        case 'num': return String(r[3]) + (r[8] && r[8].tol ? ` (±${r[8].tol})` : '');
        default:
            if (it.type === 'essay') return '(marked by hand)';
            return Array.isArray(r[3]) ? clean(r[3]).join(', ') : String(r[3] ?? '');
    }
};

// built = buildScanSets(...); set = 0-based set to print; mode = 'papers' | 'keys'
export const buildScanPaperHtml = ({ title = '', course = '', built, set = 0, mode = 'papers' }) => {
    const sel = built.sets[Math.min(built.sets.length - 1, Math.max(0, set))];
    const subtitle = esc(title) + (built.sets.length > 1 ? ` - SET ${SET_LETTERS[sel ? built.sets.indexOf(sel) : 0]}` : '');
    const head = `<div class="hd">${course ? `<div>${esc(course).toUpperCase()}</div>` : ''}<div>${subtitle.toUpperCase()}${mode === 'keys' ? ' - ANSWER KEY' : ''}</div></div>`;
    let inner;
    if (mode === 'keys') {
        inner = `${head}<div class="keyg">${sel.items.map(it => `<div class="k">${itemLabel(it)}${it.t === 'match' || it.t === 'order' ? ':' : '.'} ${esc(keyOf(it))}${it.bonus ? ' *' : ''}</div>`).join('')}</div>${sel.items.some(i => i.bonus) ? '<p style="font-size:9pt">* bonus question</p>' : ''}`;
    } else {
        // numbers that have lines on the answer sheet (written there instead of on the paper)
        const w = planWritten(built.cells, writtenLabels(built));
        const onSheetNos = new Set(w.lines.map(l => l.label));
        const byPart = new Map();
        sel.items.forEach(it => { if (!byPart.has(it.part)) byPart.set(it.part, []); byPart.get(it.part).push(it); });
        const paper = [...byPart.keys()].sort((a, b) => a - b).map(p => {
            const list = byPart.get(p);
            return `<div class="part">${esc(partTitle(p, list.map(it => (it.t === 'manual' ? it.type : it.t))))}</div>` + list.map(it =>
                `<div class="q">${itemLabel(it)}. ${esc(it.text)} <span class="pts">(${questionPoints(it.row)} pt${questionPoints(it.row) === 1 ? '' : 's'})</span>${it.bonus ? ' <i>(bonus)</i>' : ''}${bodyOf(it, it.t === 'manual' && it.type !== 'essay' && Array.from({ length: it.span }, (_, k) => String(it.no + k)).every(x => onSheetNos.has(x)))}</div>`).join('');
        }).join('');
        inner = `<div id="src">${head}${paper}</div>${PAGINATE_SCRIPT}`;
    }
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>${inner}</body></html>`;
};
