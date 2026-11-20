// js/schedule-time.js
// Exam open/close times are written and read as Philippine time (GMT+8), whatever timezone the phone is set to.
// Stored text: "YYYY-MM-DDTHH:mm" (what a datetime-local field gives). Older exams hold only a date ("YYYY-MM-DD"):
// as an opening time that means 12:00 AM, as a closing time 11:59 PM.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Value for <input type="datetime-local">.
export const toInputValue = (v, isEnd = false) => {
    const t = String(v || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t}T${isEnd ? '23:59' : '00:00'}`;
    const m = t.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    return m ? `${m[1]}T${m[2]}` : '';
};

// "Nov 20, 2026 5:00 PM" (no timezone conversion; the text already is GMT+8).
export const formatSchedule = (v, isEnd = false, empty = 'Any') => {
    const x = toInputValue(v, isEnd);
    if (!x) return empty;
    const [d, tm] = x.split('T');
    const [y, mo, da] = d.split('-').map(Number);
    let [h, mi] = tm.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${MONTHS[mo - 1]} ${da}, ${y} ${h}:${String(mi).padStart(2, '0')} ${ap}`;
};
