// js/exam-sets.js
// Printed exam sets (Set A, B, C, D ...). Pure code: the same exam always gives the same sets, so the
// question papers printed now and the answer keys used when scanning later always agree.
// Set A is the exam as written. The other sets reorder the questions inside each part and shuffle the choices.
import { escapeHtml as esc } from './html-utils.js';
import { PRINT_CSS, PAGINATE_SCRIPT, partTitle } from './print-preview.js';

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

// mode: 'papers' = question paper of ONE set; 'keys' = its answer key (teacher copy).
// set = index of the set to print (0 = A). Two columns, like a normal paper test.
export const buildSetsHtml = ({ title = '', course = '', sets, set = 0, mode = 'papers' }) => {
    const sel = sets[Math.min(sets.length - 1, Math.max(0, set))];
    const subtitle = esc(title).toUpperCase() + (sets.length > 1 ? ` - SET ${sel.letter}` : '') + (mode === 'keys' ? ' - ANSWER KEY' : '');
    const head = `<div class="hd">${course ? `<div>${esc(course).toUpperCase()}</div>` : ''}<div>${subtitle}</div></div>`;
    let inner;
    if (mode === 'keys') {
        inner = `${head}<div class="keyg">${sel.key.map((k, i) => `<div class="k">${i + 1}. ${'abcde'[k]}${sel.bonus[i] ? ' *' : ''}</div>`).join('')}</div>${sel.bonus.some(Boolean) ? '<p style="font-size:9pt">* bonus question</p>' : ''}`;
    } else {
        const byPart = new Map();
        sel.items.forEach((it, i) => { if (!byPart.has(it.part)) byPart.set(it.part, []); byPart.get(it.part).push({ it, no: i + 1 }); });
        const paper = [...byPart.keys()].sort((a, b) => a - b).map(p => {
            const list = byPart.get(p);
            return `<div class="part">${esc(partTitle(p, list.map(() => 'mc')))}</div>` + list.map(({ it, no }) =>
                `<div class="q">${no}. ${esc(it.text)}${it.bonus ? ' <i>(bonus)</i>' : ''}${it.choices.map((c, k) => `<div class="c">${'abcde'[k]}. ${esc(c)}</div>`).join('')}</div>`).join('');
        }).join('');
        inner = `<div id="src">${head}${paper}</div>${PAGINATE_SCRIPT}`;
    }
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>${inner}</body></html>`;
};
