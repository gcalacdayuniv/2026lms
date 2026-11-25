// worker/exam-sets.js
// Worker copy of the pure part of js/exam-sets.js (printed exam sets). The same exam id always gives the same sets, so a
// student's sheet of Set B-F can be mapped back to the exam's questions and choices for review. tools/tests/worker.test.mjs
// checks that this copy and js/exam-sets.js give identical sets: change both together.
const MAX_SETS = 6;
const SET_LETTERS = 'ABCDEF';
const MULTI_BASE = 1000;
const norm = (s) => String(s ?? '').trim().toLowerCase();
const FIXED = /\b(all|none|both|neither)\b.*\b(above|these|them)\b|\bany of the above\b/i;

export const multiCode = (indexes) => MULTI_BASE + indexes.reduce((m, k) => m | (1 << k), 0);
export const indexesOf = (code) => {
    const mask = Number.isInteger(code) && code >= MULTI_BASE ? code - MULTI_BASE : 0, out = [];
    for (let k = 0; k < 10; k++) if (mask & (1 << k)) out.push(k);
    return out;
};

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

export const scannableItems = (rows, maxChoices = 5) => {
    const items = [];
    (Array.isArray(rows) ? rows : []).forEach((q, orig) => {
        const choices = Array.isArray(q[2]) ? q[2].map(String) : [];
        if (choices.length < 2 || choices.length > maxChoices) return;
        const base = { pos: items.length, orig, part: Math.max(0, parseInt(q[0], 10) || 0), text: String(q[1] ?? ''), choices, bonus: Boolean(q[5]) };
        if (q[6] === 'multi') {
            const wanted = Array.isArray(q[3]) ? q[3].map(a => choices.findIndex(c => norm(c) === norm(a))) : [];
            if (!wanted.length || wanted.some(i => i < 0)) return;
            items.push({ ...base, multi: true, idxs: [...new Set(wanted)].sort((a, b) => a - b), idx: -1 });
            return;
        }
        const idx = choices.findIndex(c => norm(c) === norm(q[3]));
        if (idx < 0) return;
        items.push({ ...base, idx });
    });
    return items;
};

export const buildSets = (items, { seed = 'exam', count = 4 } = {}) => {
    const total = Math.min(MAX_SETS, Math.max(1, count));
    const sets = [];
    for (let s = 0; s < total; s++) {
        const rng = rngOf(seedOf(`${seed}|${SET_LETTERS[s]}`));
        let list;
        if (s === 0) {
            list = items.map(it => ({ ...it, key: it.multi ? multiCode(it.idxs) : it.idx }));
        } else {
            const byPart = new Map();
            items.forEach(it => { if (!byPart.has(it.part)) byPart.set(it.part, []); byPart.get(it.part).push(it); });
            list = [];
            [...byPart.keys()].sort((a, b) => a - b).forEach(p => shuffled(byPart.get(p), rng).forEach(it => list.push(it)));
            list = list.map(it => {
                if (it.choices.some(c => FIXED.test(c))) return { ...it, key: it.multi ? multiCode(it.idxs) : it.idx };
                const order = shuffled(it.choices.map((_, i) => i), rng);
                const key = it.multi ? multiCode(it.idxs.map(i => order.indexOf(i))) : order.indexOf(it.idx);
                return { ...it, choices: order.map(i => it.choices[i]), key };
            });
        }
        sets.push({ letter: SET_LETTERS[s], items: list, key: list.map(i => i.key), order: list.map(i => i.pos), bonus: list.map(i => i.bonus), parts: list.map(i => i.part) });
    }
    return sets;
};
