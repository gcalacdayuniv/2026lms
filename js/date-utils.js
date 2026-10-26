// js/date-utils.js
// Local (device timezone) date helpers. Never use toISOString() for calendar dates:
// it returns the UTC date, which is "yesterday" in the Philippines before 8:00 AM.

const pad = (n) => String(n).padStart(2, '0');

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Returns YYYY-MM-DD using the device's local timezone.
export const getLocalDateString = (d = new Date()) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Parses YYYY-MM-DD as a local date (no UTC shift).
export const parseLocalDate = (dateStr) => {
    if (!dateStr) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr));
    if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
};

export const getWeekdayName = (dateStr) => {
    const d = parseLocalDate(dateStr);
    return d ? WEEKDAYS[d.getDay()] : '';
};

// True when the date falls on the class's scheduled weekday (or no schedule is set).
export const matchesScheduleDay = (dateStr, scheduleDay) => {
    if (!scheduleDay || !String(scheduleDay).trim()) return true;
    return getWeekdayName(dateStr).toLowerCase() === String(scheduleDay).trim().toLowerCase();
};
