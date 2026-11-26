// js/student-status.js
// How a student's account status changes class screens. worker/constants.js holds the same rules for the server: keep them in sync.
//   UD and Dropped: always Absent (no points) and never called by the student caller.
//   UD, Dropped and Graduated: no seat number.
const key = (status) => String(status || 'Active').trim().toLowerCase();

export const isAutoAbsent = (status) => ['ud', 'dropped'].includes(key(status));
export const hasNoSeat = (status) => ['ud', 'dropped', 'graduated'].includes(key(status));
