// js/scan-items.js
// Turns an exam (saved rows) into what the answer-sheet scanner needs: printed sets, the bubble cells of the
// answer sheet, the answer key of every set and the questions that must be marked by hand.
// Pure code: the same exam always gives the same sets, so papers printed now and keys used when scanning later agree.
//
// Cell = [kind, choices, itemNo, sub, part, tag]   one row of bubbles on the answer sheet
//   kind  a = one answer (A, B, C ...)   m = multiple answer   t = True/False   p = position number (ordering)
//         s = sign of a number (+ / -)   x = digits after the point (0-4)   d = one digit (0-9)
//   itemNo = the number printed on the question paper; sub = 0,1,2 ... for items that need several rows
//   tag = short text for the row label of numeric items
// Every set has the SAME cells (one printed sheet fits all sets): other sets only swap questions that have the same shape.
import { multiCode } from './scan-codes.js';

export const MAX_SETS = 6;
export const SET_LETTERS = 'ABCDEF';
export const MAX_OPTIONS = 10;
export const NUM_DIGITS = 4;       // digit rows of a numeric answer (more when the answer needs them, up to 6)
export const MAX_DECIMALS = 4;

const norm = (s) => String(s ?? '').trim().toLowerCase();
const FIXED = /\b(all|none|both|neither)\b.*\b(above|these|them)\b|\bany of the above\b/i;
const SCANNABLE = ['mc', 'multi', 'tf', 'match', 'order', 'num'];

export const seedOf = (str) => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
};
export const rngOf = (seed) => () => {
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
// A shuffle that never returns the original order (so a list shown "out of order" really is).
const scrambled = (arr, rng) => {
    if (arr.length < 2) return arr.slice();
    for (let t = 0; t < 8; t++) {
        const s = shuffled(arr, rng);
        if (s.some((v, i) => v !== arr[i])) return s;
    }
    return arr.slice(1).concat(arr[0]);
};

export const rowType = (q) => {
    if (typeof q[6] === 'string' && q[6]) return q[6];
    if (Array.isArray(q[3])) return 'enum';
    const choices = Array.isArray(q[2]) ? q[2] : [];
    return choices.length === 0 ? 'id' : 'mc';
};
const metaOf = (q) => (q[8] && typeof q[8] === 'object' ? q[8] : {});
const clean = (list) => (Array.isArray(list) ? list : []).map(x => String(x ?? '').trim()).filter(Boolean);
const pairsOf = (q) => (Array.isArray(q[3]) ? q[3].filter(p => Array.isArray(p) && String(p[0] ?? '').trim() && String(p[1] ?? '').trim()) : []);

// "-12.50" -> { neg, int digits, decimals } or null when the answer cannot be shaded.
export const numberShape = (value) => {
    const s = String(value ?? '').trim().replace(/\s+/g, '');
    const m = /^([-+]?)(\d*)\.?(\d*)$/.exec(s);
    if (!m || (!m[2] && !m[3]) || !/^[-+]?\d*\.?\d*$/.test(s)) return null;
    const dec = m[3].replace(/0+$/, '');
    const int = m[2].replace(/^0+(?=\d)/, '') || '0';
    if (dec.length > MAX_DECIMALS) return null;
    const digits = Math.max(NUM_DIGITS, int.replace(/^0+$/, '').length + dec.length);
    if (digits > 6) return null;
    return { neg: m[1] === '-', int: m[2] ? int : '0', dec, digits };
};

// One saved row -> item. `scannable` items get cells; the rest are marked by hand.
const makeItem = (q, orig, no, rng) => {
    const type = rowType(q);
    const base = { t: 'manual', orig, no, part: Math.max(0, parseInt(q[0], 10) || 0), bonus: Boolean(q[5]), text: String(q[1] ?? ''), type, row: q.slice(), cells: [], key: [] };
    if (!SCANNABLE.includes(type)) return base;
    const choices = Array.isArray(q[2]) ? q[2].map(String) : [];

    if (type === 'mc' || type === 'multi') {
        if (choices.length < 2 || choices.length > MAX_OPTIONS) return base;
        if (type === 'mc') {
            const idx = choices.findIndex(c => norm(c) === norm(q[3]));
            if (idx < 0) return base;
            return { ...base, t: 'mc', cells: [['a', choices.length]], key: [idx], shown: choices };
        }
        const wanted = (Array.isArray(q[3]) ? q[3] : [q[3]]).map(a => choices.findIndex(c => norm(c) === norm(a)));
        if (!wanted.length || wanted.some(i => i < 0) || choices.length > 10) return base;
        return { ...base, t: 'multi', cells: [['m', choices.length]], key: [multiCode([...new Set(wanted)].sort((a, b) => a - b))], shown: choices };
    }
    if (type === 'tf') {
        const a = norm(q[3]);
        if (a !== 'true' && a !== 'false') return base;
        return { ...base, t: 'tf', cells: [['t', 2]], key: [a === 'true' ? 0 : 1], shown: ['True', 'False'] };
    }
    if (type === 'match') {
        const pairs = pairsOf(q);
        const opts0 = clean(pairs.map(p => p[1]).concat(clean(metaOf(q).extra)));
        const opts = scrambled(opts0, rng);
        if (pairs.length < 2 || pairs.length > MAX_OPTIONS || opts.length > MAX_OPTIONS) return base;
        const used = new Array(opts.length).fill(false);
        const key = pairs.map(p => {
            let at = opts.findIndex((o, i) => !used[i] && norm(o) === norm(p[1]));
            if (at < 0) at = 0;
            used[at] = true;
            return at;
        });
        return { ...base, t: 'match', cells: pairs.map(() => ['a', opts.length]), key, shown: opts, lefts: pairs.map(p => String(p[0])) };
    }
    if (type === 'order') {
        const items = clean(q[3]);
        if (items.length < 2 || items.length > MAX_OPTIONS) return base;
        const list = scrambled(items, rng);
        const used = new Array(items.length).fill(false);
        const key = list.map(it => {
            let at = items.findIndex((o, i) => !used[i] && norm(o) === norm(it));
            if (at < 0) at = 0;
            used[at] = true;
            return at;
        });
        return { ...base, t: 'order', cells: list.map(() => ['p', items.length]), key, shown: list };
    }
    // num
    const shape = numberShape(q[3]);
    if (!shape) return base;
    const D = shape.digits;
    const all = (shape.int + shape.dec).padStart(D, '0');
    if (all.length > D) return base;
    const cells = [['s', 2, 0, 0, 0, '+/-'], ['x', 5, 0, 0, 0, 'dec']];
    const key = [shape.neg ? 1 : 0, shape.dec.length];
    for (let i = 0; i < D; i++) { cells.push(['d', 10, 0, 0, 0, String(i + 1)]); key.push(Number(all[i])); }
    return { ...base, t: 'num', cells, key, digits: D };
};

// Same-shaped items can swap places between sets.
const shapeOf = (it) => it.t + ':' + it.cells.map(c => c[0] + c[1]).join(',');

// Builds every set. rows = saved exam rows (array or JSON text).
// -> { sets: [{ letter, items, key }], cells: [...], manual: n, scannable: n }
export const buildScanSets = (examData, { seed = 'exam', count = 4 } = {}) => {
    let rows = [];
    try { rows = typeof examData === 'string' ? JSON.parse(examData || '[]') : (examData || []); } catch (e) { rows = []; }
    if (!Array.isArray(rows)) rows = [];
    const total = Math.min(MAX_SETS, Math.max(1, count));
    const sets = [];
    let cells = null;

    for (let s = 0; s < total; s++) {
        const letter = SET_LETTERS[s];
        // items in position order; Set A = the exam as written
        let base = rows.map((q, orig) => makeItem(q, orig, 0, rngOf(seedOf(`${seed}|${letter}|o${orig}`))));
        let order = base.map((_, i) => i);
        if (s > 0) {
            const rng = rngOf(seedOf(`${seed}|${letter}`));
            const slots = new Map();   // part + shape -> positions
            base.forEach((it, i) => { const k = it.part + '|' + shapeOf(it); if (!slots.has(k)) slots.set(k, []); slots.get(k).push(i); });
            order = base.map((_, i) => i);
            slots.forEach(pos => { const sh = shuffled(pos, rng); pos.forEach((p, j) => { order[p] = sh[j]; }); });
        }
        const items = order.map((srcIdx, pos) => {
            let it = base[srcIdx];
            // choices of mc / multi are shuffled in the other sets, except "all of the above" style lists
            if (s > 0 && (it.t === 'mc' || it.t === 'multi') && !it.shown.some(c => FIXED.test(c))) {
                const rng = rngOf(seedOf(`${seed}|${letter}|c${it.orig}`));
                const perm = shuffled(it.shown.map((_, i) => i), rng);
                const key = it.t === 'mc' ? [perm.indexOf(it.key[0])] : [multiCode(maskIdx(it.key[0]).map(i => perm.indexOf(i)))];
                it = { ...it, shown: perm.map(i => it.shown[i]), key };
            }
            const placed = { ...it, no: pos + 1 };
            if (placed.t === 'mc' || placed.t === 'multi' || placed.t === 'tf') {
                placed.row = placed.row.slice();
                placed.row[2] = placed.shown.slice();
            }
            return placed;
        });
        let n = 0;
        const flat = [], key = [];
        items.forEach(it => {
            it.s = flat.length;
            it.cells = it.cells.map((c, sub) => [c[0], c[1], it.no, sub, it.part, c[5] || '']);
            it.cells.forEach(c => flat.push(c));
            it.key.forEach(k => key.push(k));
            n += it.cells.length;
        });
        if (!cells) cells = flat;
        sets.push({ letter, items, key });
    }
    const first = sets[0] ? sets[0].items : [];
    return { sets, cells: cells || [], scannable: first.filter(i => i.t !== 'manual').length, manual: first.filter(i => i.t === 'manual').length };
};

const maskIdx = (code) => { const out = []; for (let k = 0; k < 10; k++) if ((code - 1000) & (1 << k)) out.push(k); return out; };

// What gets stored with a session and sent to the Worker for grading: per set only what grading needs.
export const gradingSets = (built) => built.sets.map(set => ({
    key: set.key,
    bonus: set.items.flatMap(it => it.cells.map(() => it.bonus)),
    items: set.items.map(it => ({ t: it.t, no: it.no, o: it.orig, s: it.s, n: it.cells.length, b: it.bonus, row: stripRow(it), shown: it.shown }))
}));
const stripRow = (it) => { const r = it.row.slice(); r[1] = ''; if (it.t === 'match') r[3] = pairsOf(it.row).map(p => [String(p[0]), String(p[1])]); return r; };

// Labels of the options of one answer cell, and the row name printed on the sheet (12, 12.3, 12.dec ...).
export const cellLabels = (cell) => {
    const [kind, c] = cell;
    if (kind === 't') return ['T', 'F'];
    if (kind === 's') return ['+', '-'];
    if (kind === 'p') return Array.from({ length: c }, (_, k) => String(k + 1));
    if (kind === 'd' || kind === 'x') return Array.from({ length: c }, (_, k) => String(k));
    return Array.from({ length: c }, (_, k) => 'ABCDEFGHIJ'[k]);
};
export const cellName = (cells, q) => {
    const c = cells[q];
    const same = (cells[q - 1] && cells[q - 1][2] === c[2]) || (cells[q + 1] && cells[q + 1][2] === c[2]);
    return same ? `${c[2]}.${c[5] || c[3] + 1}` : String(c[2]);
};
// Text of a key / answer code of one cell: "B", "A, C", "blank".
export const codeText = (cell, code) => {
    const labels = cellLabels(cell);
    if (code === -1) return 'blank';
    if (code === -2) return 'double';
    if (cell[0] === 'm') return labels.filter((_, k) => code >= 1000 && ((code - 1000) & (1 << k))).join(', ') || '?';
    return labels[code] || '?';
};
