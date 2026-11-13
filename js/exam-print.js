// js/exam-print.js
// Print an exam as a paper test (all question types), with an optional answer key on its own page.
import { escapeHtml as esc } from './html-utils.js';
import { pointsOf } from './exam-builder-model.js';

export const PRINT_MAX_SETS = 6;
const SET_LETTERS = 'ABCDEF';
const FIXED = /\b(all|none|both|neither)\b.*\b(above|these|them)\b|\bany of the above\b/i;

const L = 'ABCDEFGHIJ';
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

const lines = (n) => Array.from({ length: n }, () => '<div class="ln"></div>').join('');
const clean = (list) => list.map(x => String(x ?? '').trim()).filter(Boolean);

const body = (q, n) => {
    switch (q.type) {
        case 'mc': return q.options.map((o, k) => `<div class="c">${L[k]}. ${esc(o)}</div>`).join('');
        case 'multi': return '<div class="hint">Select all that apply.</div>' + q.options.map((o, k) => `<div class="c">${L[k]}. ${esc(o)}</div>`).join('');
        case 'tf': return '<div class="c">True &nbsp;&nbsp;/&nbsp;&nbsp; False</div>';
        case 'id': case 'num': return '<div class="ln"></div>';
        case 'enum': return `<div class="hint">List ${clean(q.items).length} item${clean(q.items).length === 1 ? '' : 's'}${q.ordered ? ' in order' : ''}.</div>` +
            clean(q.items).map((_, i) => `<div class="ln"><span>${i + 1}.</span></div>`).join('');
        case 'order': {
            const items = shuffledBy(clean(q.items), seeded(q.text + 'o' + (q.salt || '')));
            return '<div class="hint">Write the numbers 1, 2, 3... to put the items in the right order.</div>' +
                items.map(i => `<div class="c">____ ${esc(i)}</div>`).join('');
        }
        case 'match': {
            const pairs = q.pairs.filter(p => p.l.trim() && p.r.trim());
            const right = shuffledBy(clean(pairs.map(p => p.r).concat(q.extra || [])), seeded(q.text + 'm' + (q.salt || '')));
            return '<div class="hint">Write the letter of the matching item.</div><div class="mt"><div>' +
                pairs.map((p, i) => `<div class="c">____ ${i + 1}. ${esc(p.l)}</div>`).join('') + '</div><div>' +
                right.map((r, k) => `<div class="c">${L[k]}. ${esc(r)}</div>`).join('') + '</div></div>';
        }
        case 'essay': return lines(6);
        default: return '';
    }
};

const keyOf = (q) => {
    switch (q.type) {
        case 'mc': return q.correct >= 0 ? `${L[q.correct]}. ${q.options[q.correct] || ''}` : '';
        case 'multi': return q.corrects.map(k => L[k]).join(', ');
        case 'tf': return q.tf;
        case 'id': case 'num': return q.answer + (q.type === 'num' && q.tol ? ` (±${q.tol})` : '');
        case 'enum': return clean(q.items).join(q.ordered ? ' → ' : ', ');
        case 'order': return clean(q.items).join(' → ');
        case 'match': return q.pairs.filter(p => p.l.trim() && p.r.trim()).map(p => `${p.l} = ${p.r}`).join('; ');
        case 'essay': return q.answer ? q.answer : '(graded manually)';
        default: return '';
    }
};

const CSS = `@page{margin:14mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:Arial,sans-serif;color:#000;font-size:11pt;margin:0}h1{font-size:15pt;margin:0 0 2mm}
.meta{display:flex;gap:6mm;margin:3mm 0 4mm;font-size:10pt}.meta .ul{flex:1;border-bottom:1px solid #000}
.part{font-weight:bold;margin:5mm 0 2mm;padding-bottom:1mm;border-bottom:1px solid #000;text-transform:uppercase;font-size:10pt}
.q{margin:0 0 4mm;break-inside:avoid}.q b{display:inline-block;min-width:8mm}.pts{color:#444;font-size:9pt}
.c{margin:.8mm 0 0 8mm}.hint{margin:1mm 0 0 8mm;font-size:9pt;color:#333;font-style:italic}
.ln{margin:5mm 0 0 8mm;border-bottom:1px solid #000;height:0}.ln span{position:relative;top:-4mm;font-size:10pt}
.badge{float:right;border:2px solid #000;border-radius:4px;padding:1mm 5mm;font-size:20pt;font-weight:bold}.set{page-break-after:always}.set:last-child{page-break-after:auto}
.mt{display:grid;grid-template-columns:1fr 1fr;gap:0 8mm}.key{page-break-before:always}.k{margin:0 0 2mm}`;

// sets = number of sets to print (1 = a single paper without a SET badge). seed = exam id, so sets stay the same.
export const buildExamPrintHtml = ({ title = '', questions, withKey = false, showPoints = true, sets = 1, seed = 'exam' }) => {
    const count = Math.min(PRINT_MAX_SETS, Math.max(1, sets));
    const sections = Array.from({ length: count }, (_, si) => {
        const qs = makeSet(questions, si, seed);
        const badge = count > 1 ? `<span class="badge">SET ${SET_LETTERS[si]}</span>` : '';
        const multiPart = new Set(qs.map(q => q.part)).size > 1;
        if (withKey) {
            return `<section class="set">${badge}<h1>${esc(title)} - Answer Key</h1>${qs.map((q, i) => `<div class="k"><b>${i + 1}.</b> ${esc(keyOf(q))}</div>`).join('')}</section>`;
        }
        let last = null, n = 0;
        const paper = qs.map(q => {
            n++;
            const head = multiPart && q.part !== last ? `<div class="part">Part ${q.part + 1}</div>` : '';
            last = q.part;
            const pts = showPoints ? ` <span class="pts">(${pointsOf(q)} pt${pointsOf(q) === 1 ? '' : 's'})</span>` : '';
            return `${head}<div class="q"><b>${n}.</b>${esc(q.text)}${q.bonus ? ' <i>(bonus)</i>' : ''}${pts}${body(q, n)}</div>`;
        }).join('');
        return `<section class="set">${badge}<h1>${esc(title)}</h1><div class="meta"><span>Name:</span><span class="ul"></span><span>Section:</span><span class="ul" style="max-width:30mm"></span><span>Date:</span><span class="ul" style="max-width:30mm"></span><span>Score:</span><span class="ul" style="max-width:20mm"></span></div>${paper}</section>`;
    }).join('');
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${sections}<script>window.onload=function(){setTimeout(function(){window.print();},400);};<\/script></body></html>`;
};
