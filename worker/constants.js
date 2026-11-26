// worker/constants.js
// Lists shared by more than one route file.

export const ASSESSMENT_TERMS = ['MidTerm', 'FinalTerm'];
export const ASSESSMENT_CATEGORIES = ['Written', 'Narrative', 'Individual', 'Performance', 'Report', 'MajorExam'];

// Account statuses that change how a student is treated in a class (compared in lower case, see statusKey).
// js/student-status.js holds the same rules for the screens: keep the two in sync.
export const statusKey = (status) => String(status || 'Active').trim().toLowerCase();
export const AUTO_ABSENT_STATUSES = new Set(['ud', 'dropped']);                 // always Absent, no points, never called
export const NO_SEAT_STATUSES = new Set(['ud', 'dropped', 'graduated']);        // no seat number
