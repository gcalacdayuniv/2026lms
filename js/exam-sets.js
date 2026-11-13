// js/exam-sets.js
// Printed exam sets (Set A, B, C, D ...). Pure code: the same exam always gives the same sets, so the
// question papers printed now and the answer keys used when scanning later always agree.
// Set A is the exam as written. The other sets reorder the questions inside each part and shuffle the choices.
import { escapeHtml as esc } from './html-utils.js';

export const MAX_SETS = 6;
export const SET_LETTERS = 'ABCDEF';

const norm = (s) => String(s ?? '').trim().toLowerCase();
// Choices that point at other choices must keep their place.
const FIXED = /\b(all|none|both|neither)\b.*\b(above|these|them)\b|\bany of the above\b/i;

const seedOf = (str) => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
};
const rngOf = (seed) => () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffled = (arr, rng) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};

// Same rule the scanner uses: multiple-choice questions with 2-maxChoices choices whose answer is one of them.
export const scannableItems = (examData, maxChoices = 5) => {
    let rows = [];
    try { rows = typeof examData === 'string' ? JSON.parse(examData || '[]') : (examData || []); } catch (e) { rows = []; }
    const items = [];
    rows.forEach((q, orig) => {
        const choices = Array.isArray(q[2]) ? q[2].map(String) : [];
        const idx = choices.findIndex(c => norm(c) === norm(q[3]));
        if (choices.length < 2 || choices.length > maxChoices || idx < 0) return;
        items.push({ pos: items.length, orig, part: Math.max(0, parseInt(q[0], 10) || 0), text: String(q[1] ?? ''), choices, idx, bonus: Boolean(q[5]) });
    });
    return items;
};

// -> [{ letter, items: [{ orig, part, text, choices, key, bonus }], key: [...], bonus: [...], parts: [...] }]
export const buildSets = (items, { seed = 'exam', count = 4 } = {}) => {
    const total = Math.min(MAX_SETS, Math.max(1, count));
    const sets = [];
    for (let s = 0; s < total; s++) {
        const rng = rngOf(seedOf(`${seed}|${SET_LETTERS[s]}`));
        let list;
        if (s === 0) {
            list = items.map(it => ({ ...it, key: it.idx }));
        } else {
            const byPart = new Map();
            items.forEach(it => { if (!byPart.has(it.part)) byPart.set(it.part, []); byPart.get(it.part).push(it); });
            list = [];
            [...byPart.keys()].sort((a, b) => a - b).forEach(p => shuffled(byPart.get(p), rng).forEach(it => list.push(it)));
            list = list.map(it => {
                if (it.choices.some(c => FIXED.test(c))) return { ...it, key: it.idx };
                const order = shuffled(it.choices.map((_, i) => i), rng);
                return { ...it, choices: order.map(i => it.choices[i]), key: order.indexOf(it.idx) };
            });
        }
        sets.push({
            letter: SET_LETTERS[s],
            items: list,
            key: list.map(i => i.key),
            order: list.map(i => i.pos),
            bonus: list.map(i => i.bonus),
            parts: list.map(i => i.part)
        });
    }
    return sets;
};

const CSS = `
@page { margin: 14mm; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: Arial, sans-serif; color: #000; font-size: 11pt; margin: 0; }
.set { page-break-after: always; }
.set:last-child { page-break-after: auto; }
h1 { font-size: 15pt; margin: 0 0 2mm; }
.badge { float: right; border: 2px solid #000; border-radius: 4px; padding: 1mm 5mm; font-size: 20pt; font-weight: bold; }
.meta { display: flex; gap: 6mm; margin: 3mm 0 4mm; font-size: 10pt; }
.meta span.ul { flex: 1; border-bottom: 1px solid #000; }
.part { font-weight: bold; margin: 5mm 0 2mm; padding-bottom: 1mm; border-bottom: 1px solid #000; text-transform: uppercase; font-size: 10pt; }
.q { margin: 0 0 3.2mm; break-inside: avoid; }
.q b { display: inline-block; min-width: 8mm; }
.c { margin: 0.8mm 0 0 8mm; }
.keyg { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1mm 6mm; font-size: 10.5pt; margin-top: 3mm; }
.note { font-size: 9pt; color: #333; }
`;

// mode: 'papers' = question papers to give out; 'keys' = answer keys (teacher copy).
export const buildSetsHtml = ({ title = '', sets, mode = 'papers' }) => {
    const multiPart = sets.length && new Set(sets[0].parts).size > 1;
    const body = sets.map(set => {
        if (mode === 'keys') {
            return `<section class="set"><span class="badge">SET ${set.letter}</span><h1>${esc(title)} - Answer Key</h1>
<div class="note">Teacher copy. Number = position in Set ${set.letter}.</div>
<div class="keyg">${set.key.map((k, i) => `<div><b>${i + 1}.</b> ${'ABCDE'[k]}${set.bonus[i] ? ' *' : ''}</div>`).join('')}</div>
${set.bonus.some(Boolean) ? '<p class="note">* bonus question</p>' : ''}</section>`;
        }
        let lastPart = null;
        const qs = set.items.map((it, i) => {
            const head = multiPart && it.part !== lastPart ? `<div class="part">Part ${it.part + 1}</div>` : '';
            lastPart = it.part;
            return `${head}<div class="q"><b>${i + 1}.</b>${esc(it.text)}${it.bonus ? ' <i>(bonus)</i>' : ''}
${it.choices.map((c, k) => `<div class="c">${'ABCDE'[k]}. ${esc(c)}</div>`).join('')}</div>`;
        }).join('');
        return `<section class="set"><span class="badge">SET ${set.letter}</span><h1>${esc(title)}</h1>
<div class="meta"><span>Name:</span><span class="ul"></span><span>Date:</span><span class="ul" style="max-width:35mm"></span></div>
<div class="note">Write your SET letter (${set.letter}) on the answer sheet by shading its circle. Shade ONE circle per number.</div>${qs}</section>`;
    }).join('');
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${mode === 'keys' ? 'Answer Keys' : 'Exam Sets'} | ${esc(title)}</title><style>${CSS}</style></head>
<body>${body}<script>window.onload=function(){setTimeout(function(){window.print();},400);};<\/script></body></html>`;
};
