// js/grade-base.js
// Class grade computation: every assessment is converted to a common base of 100 before it is added, so a long quiz
// (say 100 items) does not outweigh a short exam. Score / max x 100, never above 100 (extra credit stops at the max).
// Used by Class Summary, the student's score cards and the Class Grade export.
export const GRADE_BASE = 100;

export const onBase = (score, max) => {
    const s = Number(score);
    const m = Number(max);
    if (!Number.isFinite(s) || !(m > 0)) return 0;
    return (Math.min(Math.max(s, 0), m) / m) * GRADE_BASE;
};
