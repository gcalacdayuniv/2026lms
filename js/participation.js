// js/participation.js
// Participation points, one rule for every screen and for the class grade export:
//  - a student who is Present or Late gets 2 points for that day by default;
//  - points the lecturer adds on top count too, but a day is worth at most 4;
//  - Absent days give nothing;
//  - the term total can never be more than 4 points for each class day.
export const DAY_BASE = 2;
export const DAY_MAX = 4;

export const dayPoints = (status, recorded) => {
    if (status === 'Absent') return 0;
    const base = (status === 'Present' || status === 'Late') ? DAY_BASE : 0;
    return Math.min(DAY_MAX, base + Math.max(0, Number(recorded) || 0));
};

// classDays = scheduled class days in the term (no-class days left out). Unknown (0) means no cap.
export const termPoints = (records, classDays) => {
    const sum = (records || []).reduce((t, r) => t + dayPoints(r.Status, r.Performance_Points), 0);
    return classDays > 0 ? Math.min(sum, DAY_MAX * classDays) : sum;
};
