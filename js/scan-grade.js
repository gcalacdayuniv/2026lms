// js/scan-grade.js  (the same file is used by the Worker: worker/scan-grade.js)
// Scores one scanned sheet of an exam with several question types. Every scanned answer is turned back into the
// answer a student would have typed in the online exam, then graded by the same rules (grading.js), so points,
// bonus, partial credit and numeric tolerance behave exactly like an online exam.
import { gradeQuestion, questionPoints } from './grading.js';

const BLANK = -1;
const MULTIPLE = -2;
const MULTI_BASE = 1000;
const round2 = (n) => Math.round(n * 100) / 100;
const pick = (list, code) => (Number.isInteger(code) && code >= 0 && code < list.length ? list[code] : '');

// codes = the cells of one item (see scan-items.js). Returns the answer in the saved-exam format.
export const decodeItem = (item, codes) => {
    const shown = item.shown || [];
    switch (item.t) {
        case 'mc': case 'tf': return pick(shown, codes[0]);
        case 'multi': {
            const out = [];
            if (codes[0] >= MULTI_BASE) shown.forEach((c, k) => { if ((codes[0] - MULTI_BASE) & (1 << k)) out.push(c); });
            return out;
        }
        case 'match': return codes.map(c => pick(shown, c));
        case 'order': {
            const out = new Array(shown.length).fill('');
            codes.forEach((p, j) => { if (Number.isInteger(p) && p >= 0 && p < out.length && !out[p]) out[p] = shown[j]; });
            return out;
        }
        case 'num': {
            const digits = codes.slice(2);
            if (!digits.length || digits.some(d => !(d >= 0 && d <= 9))) return '';
            const dp = codes[1] >= 0 && codes[1] <= 4 ? codes[1] : 0;
            const text = digits.join('');
            const body = dp ? `${text.slice(0, text.length - dp)}.${text.slice(text.length - dp)}` : text;
            return (codes[0] === 1 ? '-' : '') + body;
        }
        default: return '';
    }
};

// set = { items: [{ t, s, n, b, row, shown }] }; answers = one code per cell; marks = { [item index]: points } for
// questions marked by hand. max = highest score (null = no limit).
export const gradeScanSet = (set, answers, marks, max) => {
    let raw = 0, bonus = 0, wrong = 0, blank = 0, multiple = 0, pending = 0, full = 0;
    const per = [];
    (set.items || []).forEach((it, idx) => {
        const pts = questionPoints(it.row);
        const add = (e) => { if (it.b) bonus += e; else raw += e; };
        if (it.t === 'manual') {
            const m = marks ? marks[idx] : undefined;
            if (m === undefined || m === null || m === '' || !Number.isFinite(Number(m))) { pending++; per.push({ state: 'pending', max: pts, earned: 0 }); return; }
            const e = Math.min(pts, Math.max(0, Number(m)));
            add(e);
            per.push({ state: e >= pts ? 'right' : 'wrong', max: pts, earned: e });
            return;
        }
        const codes = (answers || []).slice(it.s, it.s + it.n);
        if (codes.length && codes.every(c => c === BLANK)) { blank++; per.push({ state: 'blank', max: pts, earned: 0 }); return; }
        if (codes.some(c => c === MULTIPLE)) multiple++;
        const e = gradeQuestion(it.row, decodeItem(it, codes));
        add(e);
        if (e >= pts) { full++; per.push({ state: 'right', max: pts, earned: e }); }
        else { wrong++; per.push({ state: e > 0 ? 'partial' : 'wrong', max: pts, earned: e }); }
    });
    raw = round2(raw); bonus = round2(bonus);
    const cap = max == null ? Infinity : Number(max);
    return { raw, bonus, wrong, blank, multiple, pending, right: full, score: round2(Math.min(cap, raw + bonus)), per };
};

// Highest score of a set: points of the regular (not bonus) questions, scannable or marked by hand.
export const setMaxPoints = (set) => round2((set.items || []).filter(it => !it.b).reduce((sum, it) => sum + questionPoints(it.row), 0));
