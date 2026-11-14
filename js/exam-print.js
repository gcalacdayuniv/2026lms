// js/exam-print.js
// Print an exam as a paper test (all question types), with an optional answer key on its own page.
import { escapeHtml as esc } from './html-utils.js';
import { pointsOf } from './exam-builder-model.js';
import { PRINT_CSS, PAGINATE_SCRIPT, partTitle } from './print-preview.js';

export const PRINT_MAX_SETS = 6;
const SET_LETTERS = 'ABCDEF';
const FIXED = /\b(all|none|both|neither)\b.*\b(above|these|them)\b|\bany of the above\b/i;

// a, b, c ... z, then aa, ab ... (matching can have more choices than 10 when decoys are added)
const letter = (k) => (k < 26 ? String.fromCharCode(97 + k) : String.fromCharCode(97 + Math.floor(k / 26) - 1) + String.fromCharCode(97 + (k % 26)));
const seeded = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const shuffledBy = (arr, seed) => {
    let s = seed;
    const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
};
// Set A is the exam as written. Other sets reorder the questions inside each part and shuffle the choices of
// multiple choice / multiple answer questions; ordering and matching items are shuffled differently per set.
// Answers are remapped, so the answer key of every set is right for its own paper.
export const makeSet = (questions, setIndex, seed = 'exam') => {
    const letter = SET_LETTERS[setIndex];
    if (!setIndex) return questions.map(q => ({ ...q, salt: '' }));
    const rnd0 = seeded(`${seed}|${letter}`);
    const order = (arr, extra) => shuffledBy(arr, rnd0 ^ seeded(String(extra)));
    const byPart = new Map();
    questions.forEach((q, i) => { if (!byPart.has(q.part)) byPart.set(q.part, []); byPart.get(q.part).push({ q, i }); });
    const out = [];
    [...byPart.keys()].sort((a, b) => a - b).forEach(p => order(byPart.get(p), 'p' + p).forEach(({ q, i }) => {
        const nq = { ...q, salt: letter };
        if ((q.type === 'mc' || q.type === 'multi') && !q.options.some(o => FIXED.test(o))) {
            const perm = order(q.options.map((_, k) => k), 'q' + i);
            nq.options = perm.map(k => q.options[k]);
            nq.correct = q.correct >= 0 ? perm.indexOf(q.correct) : -1;
            nq.corrects = (q.corrects || []).map(k => perm.indexOf(k)).sort((a, b) => a - b);
        }
        out.push(nq);
    }));
    return out;
};

// Question numbers an item uses: one per enumeration answer, matching pair, item to order or correct choice;
// one per point for other types when points are set to a whole number above 1 (essays always use one).
const spanOf = (q) => {
    switch (q.type) {
        case 'enum': case 'order': return Math.max(1, clean(q.items || []).length);
        case 'match': return Math.max(1, (q.pairs || []).filter(p => p.l.trim() && p.r.trim()).length);
        case 'multi': return Math.max(1, (q.corrects || []).length);
        case 'essay': return 1;
        default: { const p = pointsOf(q); return Number.isInteger(p) && p > 1 && p <= 50 ? p : 1; }
    }
};
const rangeOf = (n, sp) => (sp > 1 ? `${n}-${n + sp - 1}` : String(n));

const lines = (n) => Array.from({ length: n }, () => '<div class="ln"></div>').join('');
const clean = (list) => list.map(x => String(x ?? '').trim()).filter(Boolean);

const body = (q, n) => {
    switch (q.type) {
        case 'mc': return q.options.map((o, k) => `<div class="c">${letter(k)}. ${esc(o)}</div>`).join('');
        case 'multi': return '<div class="hint">Select all that apply.</div>' + q.options.map((o, k) => `<div class="c">${letter(k)}. ${esc(o)}</div>`).join('');
        case 'tf': return '<div class="c">True &nbsp;&nbsp;/&nbsp;&nbsp; False</div>';
        case 'id': case 'num': return '<div class="ln"></div>';
        case 'enum': return `<div class="hint">List ${clean(q.items).length} item${clean(q.items).length === 1 ? '' : 's'}${q.ordered ? ' in order' : ''}.</div>` +
            clean(q.items).map((_, i) => `<div class="ln"><span>${n + i}.</span></div>`).join('');
        case 'order': {
            const items = shuffledBy(clean(q.items), seeded(q.text + 'o' + (q.salt || '')));
            return '<div class="hint">Write the numbers 1, 2, 3... to put the items in the right order.</div>' +
                items.map((i, k) => `<div class="c">${n + k}. ____ ${esc(i)}</div>`).join('');
        }
        case 'match': {
            const pairs = q.pairs.filter(p => p.l.trim() && p.r.trim());
            const right = shuffledBy(clean(pairs.map(p => p.r).concat(q.extra || [])), seeded(q.text + 'm' + (q.salt || '')));
            return '<div class="hint">Write the letter of the matching item.</div><div class="mt"><div>' +
                pairs.map((p, i) => `<div class="c">${n + i}. ____ ${esc(p.l)}</div>`).join('') + '</div><div>' +
                right.map((r, k) => `<div class="c">${letter(k)}. ${esc(r)}</div>`).join('') + '</div></div>';
        }
        case 'essay': return lines(4);
        default: return '';
    }
};

const keyOf = (q) => {
    switch (q.type) {
        case 'mc': return q.correct >= 0 ? `${letter(q.correct)}. ${q.options[q.correct] || ''}` : '';
        case 'multi': return q.corrects.map(k => letter(k)).join(', ');
        case 'tf': return q.tf;
        case 'id': case 'num': return q.answer + (q.type === 'num' && q.tol ? ` (±${q.tol})` : '');
        case 'enum': return clean(q.items).join(q.ordered ? ' → ' : ', ');
        case 'order': return clean(q.items).join(' → ');
        case 'match': return q.pairs.filter(p => p.l.trim() && p.r.trim()).map(p => `${p.l} = ${p.r}`).join('; ');
        case 'essay': return q.answer ? q.answer : '(graded manually)';
        default: return '';
    }
};



// set = which set to print (0 = A, 1 = B ...; makeSet makes it from the exam, the same every time).
// sets = how many sets the exam has (only decides whether the SET letter is shown). course = optional first title line.
export const buildExamPrintHtml = ({ title = '', course = '', questions, withKey = false, set = 0, sets = 1, seed = 'exam' }) => {
    const qs = makeSet(questions, Math.min(PRINT_MAX_SETS - 1, Math.max(0, set)), seed);
    const subtitle = esc(title) + (sets > 1 ? ` - SET ${SET_LETTERS[set]}` : '');
    const head = `<div class="hd">${course ? `<div>${esc(course).toUpperCase()}</div>` : ''}<div>${subtitle.toUpperCase()}${withKey ? ' - ANSWER KEY' : ''}</div></div>`;
    if (withKey) {
        return doc(title, `${head}<div class="keyg">${(() => { let k = 1; return qs.map(q => { const sp = spanOf(q); const t = `<div class="k">${rangeOf(k, sp)}. ${esc(keyOf(q))}</div>`; k += sp; return t; }).join(''); })()}</div>`);
    }
    const byPart = new Map();
    qs.forEach(q => { if (!byPart.has(q.part)) byPart.set(q.part, []); byPart.get(q.part).push(q); });
    let n = 0;
    const paper = [...byPart.keys()].sort((a, b) => a - b).map(p => {
        const list = byPart.get(p);
        const items = list.map(q => {
            const start = n + 1, sp = spanOf(q);
            n += sp;
            const pts = pointsOf(q) !== 1 ? ` <span class="pts">(${pointsOf(q)} pts)</span>` : '';
            return `<div class="q">${rangeOf(start, sp)}. ${esc(q.text)}${q.bonus ? ' <i>(bonus)</i>' : ''}${pts}${body(q, start)}</div>`;
        }).join('');
        return `<div class="part">${esc(partTitle(p, list.map(q => q.type)))}</div>${items}`;
    }).join('');
    return doc(title, `<div id="src">${head}${paper}</div>`, true);
};

const doc = (title, inner, paginate = false) => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>${inner}${paginate ? PAGINATE_SCRIPT : ''}</body></html>`;
