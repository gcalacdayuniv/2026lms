// js/scan-codes.js
// How one answer (or one answer-key entry) of a scanned sheet is stored as a single number.
//   0, 1, 2 ...   one circle shaded (A, B, C ...)
//   -1            blank
//   -2            more than one circle on a one-answer question (needs a look)
//   1000 + mask   multiple-answer question: every shaded circle counts. mask bit k = circle k, so A+C = 1000 + 1 + 4.
// The Worker repeats these rules (SCAN_MULTI_BASE in worker.js).
export const BLANK = -1;
export const MULTIPLE = -2;
export const MULTI_BASE = 1000;
const LETTERS = 'ABCDEFGHIJ';

export const isMulti = (code) => Number.isInteger(code) && code >= MULTI_BASE;
export const maskOf = (code) => (isMulti(code) ? code - MULTI_BASE : 0);
export const multiCode = (indexes) => MULTI_BASE + indexes.reduce((m, k) => m | (1 << k), 0);
export const indexesOf = (code) => {
    const mask = maskOf(code), out = [];
    for (let k = 0; k < 10; k++) if (mask & (1 << k)) out.push(k);
    return out;
};
// Adds the circle k to a multiple-answer code, or removes it when it is already there. Nothing left = BLANK.
export const toggleMulti = (code, k) => {
    const set = new Set(isMulti(code) ? indexesOf(code) : []);
    if (set.has(k)) set.delete(k); else set.add(k);
    return set.size ? multiCode([...set]) : BLANK;
};
// "A, C" for a code; 'blank' / 'double' for the special ones.
export const codeLabel = (code, blank = 'blank', dbl = 'double') =>
    code === BLANK ? blank : code === MULTIPLE ? dbl : isMulti(code) ? indexesOf(code).map(k => LETTERS[k]).join(', ') : (LETTERS[code] || '?');
