// js/seat-map.js
// Classroom floor plan: rows of 10 seats, two columns of 5 with an aisle between them. Row 1 is nearest the board.
// Student view (students only): the room as a student facing the board sees it, seats 1-10 left to right on row 1, 11-20 on row 2 ...
//   Only the student's own seat is marked ("YOU"); no classmate is identified.
// Lecturer view (full-screen overlay; Check attendance sits in the header; tapping a box (attendance off) opens a small participation popover on it) (lecturers only): the room as the lecturer facing the class sees it, so row 1 is at the bottom next to the lecturer
//   bar and each row runs 10 ... 1. It is built for a wide (landscape) screen: ten large boxes across, each with the student's profile
//   picture as its background. In Attendance mode a tap puts the chosen status (Present, Late, Absent, Excused) on that student and
//   saves it at once (/api/attendance/single), so the plan doubles as an attendance sheet.
import { apiFetch, AppState, apiPost } from './globals.js';
const post = apiPost;
import { escapeHtml as esc, safeUrl } from './html-utils.js';
import { getLoadableAvatarSrc } from './components-utils.js';
import { UI } from './ui-feedback.js';
import { CourseClass } from './course-class.js';
import { LecturerNotes } from './lecturer-notes.js';

const PER_COLUMN = 5;
const PER_ROW = PER_COLUMN * 2;
const byId = (id) => document.getElementById(id);

const STATUSES = [
    { key: 'Present', letter: 'P', ring: '#16a34a', fill: 'rgba(22,163,74,.38)', btn: 'bg-green-600 text-white border-green-600', idle: 'text-green-700 border-green-300' },
    { key: 'Late', letter: 'L', ring: '#ca8a04', fill: 'rgba(234,179,8,.42)', btn: 'bg-yellow-500 text-white border-yellow-500', idle: 'text-yellow-700 border-yellow-300' },
    { key: 'Absent', letter: 'A', ring: '#dc2626', fill: 'rgba(220,38,38,.45)', btn: 'bg-red-600 text-white border-red-600', idle: 'text-red-700 border-red-300' },
    { key: 'Excused', letter: 'E', ring: '#2563eb', fill: 'rgba(37,99,235,.40)', btn: 'bg-blue-600 text-white border-blue-600', idle: 'text-blue-700 border-blue-300' }
];
const statusOf = (key) => STATUSES.find(s => s.key === key) || null;

const eyeRing = (eye) => {
    const e = String(eye || '').toLowerCase();
    return /blind/.test(e) ? '#f59e0b' : /near/.test(e) ? '#a78bfa' : /far/.test(e) ? '#2dd4bf' : '#d1d5db';
};

const todayManila = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

export const SeatMap = {
    state: null,
    onDirty: null,

    ensureModal: () => {
        if (byId('seatMapModal')) return;
        const el = document.createElement('div');
        el.id = 'seatMapModal';
        el.className = 'hidden fixed inset-0 z-[130] flex items-center justify-center fade-in p-0 sm:p-4';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-labelledby', 'seatMapTitle');
        el.innerHTML = `
            <div class="absolute inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm" id="seatMapBg"></div>
            <div id="seatMapPanel" class="bg-white rounded-none sm:rounded-lg shadow-xl w-full max-w-xl h-full sm:h-auto p-3 sm:p-5 relative z-10 sheet-panel app-page max-h-full sm:max-h-[96vh] flex flex-col">
                <div class="flex items-center gap-3 mb-2 border-b pb-2 app-page-header">
                    <div class="flex-1 min-w-0">
                        <h3 id="seatMapTitle" class="text-lg font-bold text-gray-800"><i class="fa-solid fa-chair text-sky-600 mr-2" aria-hidden="true"></i><span id="seatMapTitleText">Classroom floor plan</span></h3>
                        <p id="seatMapSub" class="text-xs text-gray-500"></p>
                    </div>
                    <div id="smHeadTools" class="hidden shrink-0"></div>
                    <button id="seatMapClose" type="button" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-500 sm:text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden" aria-hidden="true"></i><i class="fa-solid fa-xmark text-xl hidden sm:inline" aria-hidden="true"></i>
                    </button>
                </div>
                <div id="smTools" class="hidden mb-1.5"></div>
                <div id="smInfo" role="status" class="mb-2 px-2 py-1 rounded-lg bg-sky-50 border border-sky-200 text-sm text-sky-900 min-h-[36px]"></div>
                <div id="smPlan" class="overflow-auto flex-1 min-h-0 relative"></div>
            </div>`;
        document.body.appendChild(el);
    },

    // Lecturer: the roster the class page already holds (names, pictures). opts: { courseId, attendance, date, onDirty }
    openLecturer: async (students, opts = {}) => {
        const seats = new Map();
        const extras = [];
        let unseated = 0;
        (students || []).forEach(s => {
            const seat = String(s.Seat_Number || '').trim();
            const no = ['ud', 'dropped', 'graduated'].includes(String(s.account_status || '').toLowerCase());
            if (no) return;
            if (!seat) { unseated++; return; }
            const info = { id: s.User_ID, name: s.Name || '', eye: s.eye_condition || '', locked: Number(s.Seat_Locked) === 1, pic: getLoadableAvatarSrc(s.Avatar, 400) };
            if (/^\d+$/.test(seat) && Number(seat) > 0) seats.set(Number(seat), info); else extras.push({ seat, ...info });
        });
        SeatMap.onDirty = opts.onDirty || null;
        SeatMap.show({
            pov: 'lecturer', seats, extras, unseated, courseId: opts.courseId || window.location.hash.replace('#class-', ''), picked: null,
            att: { on: false, date: opts.date || byId('attendanceDate')?.value || todayManila(), records: new Map(), brush: 'Present', noClass: false, dirty: false }
        });
        if (opts.attendance) await SeatMap.attendanceOn(true);
        else { await SeatMap.loadAttendance(); SeatMap.render(); }      // Absent / Excused colours show even when not checking attendance
    },

    // Student: only their own seat is marked. The server returns the student's seat and the highest seat number, nothing else.
    openStudent: async (courseId) => {
        try {
            const r = await apiFetch(`/api/seat-map?courseId=${encodeURIComponent(courseId)}&studentId=${encodeURIComponent(AppState.user.User_ID)}`);
            SeatMap.onDirty = null;
            SeatMap.show({ pov: 'student', mine: r.mine || '', maxSeat: Number(r.maxSeat) || 0, seats: new Map(), extras: [], picked: null });
        } catch (err) {
            UI.error(err.message || 'Could not load the floor plan.');
        }
    },

    show: (state) => {
        SeatMap.ensureModal();
        SeatMap.state = state;
        if (byId('smPlan')) byId('smPlan').innerHTML = '';
        const lecturer = state.pov === 'lecturer';
        // Lecturer: a true full-screen overlay (no margin, corners or width limit). Student: the small centred card.
        const panel = byId('seatMapPanel'), root = byId('seatMapModal');
        panel.classList.toggle('max-w-xl', !lecturer);
        panel.classList.toggle('max-w-none', lecturer);
        panel.classList.toggle('sm:rounded-lg', !lecturer);
        panel.classList.toggle('sm:h-auto', !lecturer);
        panel.classList.toggle('sm:max-h-[96vh]', !lecturer);
        panel.classList.toggle('rounded-none', lecturer);
        panel.classList.toggle('h-full', lecturer);
        root.classList.toggle('sm:p-4', !lecturer);
        byId('seatMapTitleText').textContent = lecturer ? 'Classroom floor plan' : 'Your seat';
        byId('seatMapSub').textContent = '';
        byId('seatMapSub').classList.add('hidden');
        byId('seatMapModal').classList.remove('hidden');
        SeatMap.layout();
        SeatMap.tools();
        SeatMap.render();
        if (lecturer) try { screen.orientation?.lock?.('landscape')?.catch(() => {}); } catch (e) { /* not allowed outside an installed app */ }
    },

    // The lecturer's plan is always landscape on a phone. A phone held upright cannot be forced to rotate by a web page, so the panel
    // is turned a quarter turn with CSS (the lecturer turns the phone counter-clockwise to read it); a phone already held sideways,
    // a tablet or a computer just shows it normally.
    layout: () => {
        const panel = byId('seatMapPanel');
        const st = SeatMap.state;
        if (!panel) return;
        const w = window.innerWidth, h = window.innerHeight;
        const turn = !!st && st.pov === 'lecturer' && w < h && w < 700 && !byId('seatMapModal').classList.contains('hidden');
        if (turn) {
            Object.assign(panel.style, { position: 'fixed', top: '0', left: '0', width: `${h}px`, height: `${w}px`, maxWidth: 'none', maxHeight: 'none', margin: '0', borderRadius: '0', transformOrigin: '0 0', transform: `translateX(${w}px) rotate(90deg)` });
        } else {
            ['position', 'top', 'left', 'width', 'height', 'maxWidth', 'maxHeight', 'margin', 'borderRadius', 'transformOrigin', 'transform'].forEach(k => { panel.style[k] = ''; });
        }
    },

    close: () => {
        byId('seatMapModal')?.classList.add('hidden');
        SeatMap.layout();
        try { screen.orientation?.unlock?.(); } catch (e) { /* ignore */ }
        const st = SeatMap.state;
        if (st && st.att && st.att.dirty && SeatMap.onDirty) SeatMap.onDirty();
        if (st && st.att) st.att.dirty = false;
    },

    // ---- attendance mode (lecturer)
    attendanceOn: async (on) => {
        const st = SeatMap.state;
        if (!st || st.pov !== 'lecturer') return;
        st.att.on = on;
        st.pop = null;
        SeatMap.tools();
        if (on) await SeatMap.loadAttendance();
        SeatMap.render();
    },

    loadAttendance: async () => {
        const st = SeatMap.state, a = st.att;
        try {
            const r = await apiFetch(`/api/attendance?courseId=${encodeURIComponent(st.courseId)}&date=${encodeURIComponent(a.date)}&_t=${Date.now()}`);
            a.records = new Map((r.records || []).map(x => [x.Student_ID, { status: x.Status || '', points: Number(x.Performance_Points) || 0 }]));
            a.noClass = !!r.isNoClass;
            a.loadedDate = a.date;
        } catch (err) {
            a.records = new Map(); a.noClass = false;
            UI.error(err.message || 'Could not load attendance.');
        }
    },

    setStatus: async (info, status) => {
        const st = SeatMap.state, a = st.att;
        const before = a.records.get(info.id);
        const points = before ? before.points : 0;
        if (status) a.records.set(info.id, { status, points }); else a.records.delete(info.id);
        SeatMap.render();
        try {
            await post('/api/attendance/single', { courseId: st.courseId, studentId: info.id, date: a.date, status, points });
            a.dirty = true;
        } catch (err) {
            if (before) a.records.set(info.id, before); else a.records.delete(info.id);
            SeatMap.render();
            UI.error(`Not saved for ${info.name}: ${err.message}`);
        }
    },

    markAllPresent: async () => {
        const st = SeatMap.state, a = st.att;
        const people = [...st.seats.values()].filter(i => !a.records.get(i.id)?.status);
        if (!people.length) { UI.info('Everyone seated already has a status.'); return; }
        const ok = await UI.confirm({ title: 'Mark the rest present?', message: `${people.length} student${people.length === 1 ? '' : 's'} with no status for ${a.date} will be marked Present.`, confirmText: 'Mark present' });
        if (!ok) return;
        const next = new Map(a.records);
        people.forEach(i => next.set(i.id, { status: 'Present', points: 0 }));
        try {
            // the whole day is sent (existing records included), because the day's list replaces what is saved
            await post('/api/attendance', { courseId: st.courseId, date: a.date, records: [...next].map(([studentId, r]) => ({ studentId, status: r.status, points: r.points })) });
            a.records = next; a.dirty = true;
            SeatMap.render();
        } catch (err) { UI.error(err.message || 'Not saved.'); }
    },

    tools: () => {
        const box = byId('smTools');
        const st = SeatMap.state;
        if (!box || !st) return;
        if (st.pov !== 'lecturer') { box.classList.add('hidden'); box.innerHTML = ''; byId('smHeadTools')?.classList.add('hidden'); return; }
        const a = st.att;
        const head = byId('smHeadTools');
        head.classList.remove('hidden');
        head.innerHTML = `<button type="button" id="smAttToggle" aria-pressed="${a.on}" class="min-h-[44px] px-3 rounded-md border text-sm font-bold ${a.on ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-sky-700 border-sky-300'}"><i class="fa-solid fa-clipboard-user mr-1" aria-hidden="true"></i>${a.on ? 'Checking attendance' : 'Check attendance'}</button>`;
        if (!a.on) { box.classList.add('hidden'); box.innerHTML = ''; return; }
        box.classList.remove('hidden');
        box.innerHTML = `<div class="flex flex-wrap items-center gap-2">
            <input type="date" id="smAttDate" value="${esc(a.date)}" aria-label="Attendance date" class="min-h-[44px] px-2 border border-gray-300 rounded-md text-sm">
            <div class="flex gap-1" role="group" aria-label="Status to give">${STATUSES.map(s => `<button type="button" class="sm-brush min-h-[44px] min-w-[44px] px-2 rounded-md border text-sm font-bold ${a.brush === s.key ? s.btn : 'bg-white ' + s.idle}" data-status="${s.key}" aria-pressed="${a.brush === s.key}" title="${s.key}">${s.letter}<span class="hidden lg:inline">${s.key.slice(1)}</span></button>`).join('')}</div>
            <button type="button" id="smAllPresent" class="min-h-[44px] px-3 rounded-md border border-green-300 text-green-700 text-sm font-bold bg-white" title="Mark everyone with no status as present">Rest present</button>
            <span id="smCounts" class="text-xs font-bold text-gray-600 sm:ml-auto"></span>
        </div>`;
    },

    counts: () => {
        const st = SeatMap.state, el = byId('smCounts');
        if (!st || !el || !st.att.on) return;
        const c = { Present: 0, Late: 0, Absent: 0, Excused: 0 };
        let unmarked = 0;
        st.seats.forEach(i => { const r = st.att.records.get(i.id); if (r && c[r.status] !== undefined) c[r.status]++; else unmarked++; });
        el.textContent = `P ${c.Present} · L ${c.Late} · A ${c.Absent} · E ${c.Excused} · none ${unmarked}`;
    },

    // ---- drawing
    seatCell: (n, st) => {
        if (st.pov === 'student') {
            const mine = String(st.mine) === String(n);
            return `<div class="sm-seat flex-1 min-w-0 min-h-[46px] rounded-md border-2 flex flex-col items-center justify-center leading-none ${mine ? 'border-green-600 bg-green-500 text-white shadow' : 'border-gray-200 bg-gray-50 text-gray-400'}" style="flex:1 1 0" ${mine ? 'aria-label="Your seat"' : 'aria-hidden="true"'}>
                <span class="text-sm font-black">${n}</span>${mine ? '<span class="text-[9px] font-bold mt-0.5">YOU</span>' : ''}</div>`;
        }
        const info = st.seats.get(n);
        const a = st.att;
        const rec = info ? a.records.get(info.id) : null;
        let stat = rec ? statusOf(rec.status) : null;
        if (!a.on && stat && !['Absent', 'Excused'].includes(stat.key)) stat = null;      // not checking: only Absent / Excused stay coloured
        if (!info) {
            return `<div class="min-w-0 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 flex items-start p-1" style="flex:1 1 0" aria-label="Seat ${n}, empty"><span class="text-[11px] font-black text-gray-400">${n}</span></div>`;
        }
        const pic = info.pic ? `background-image:url('${safeUrl(info.pic)}');background-size:cover;background-position:center top;` : '';
        const ring = stat ? stat.ring : eyeRing(info.eye);
        const last = esc(String(info.name).split(',')[0]);
        const picked = st.picked === n ? 'outline:3px solid #0284c7;outline-offset:1px;' : '';
        return `<button type="button" class="sm-seat relative min-w-0 rounded-lg overflow-hidden text-left bg-gray-200" data-seat="${n}" style="flex:1 1 0;border:3px solid ${ring};${pic}${picked}" aria-label="Seat ${n}, ${esc(info.name)}${stat ? ', ' + stat.key : ''}">
            ${info.pic ? '' : '<i class="fa-solid fa-user absolute inset-0 m-auto w-4 h-4 text-gray-400 pointer-events-none" aria-hidden="true"></i>'}
            ${stat ? `${['Absent', 'Excused'].includes(stat.key) ? `<span class="absolute inset-0 pointer-events-none" style="background:${stat.fill}"></span>` : ''}<span class="absolute top-0 right-0 px-1.5 py-0.5 text-[11px] font-black text-white rounded-bl-md" style="background:${stat.ring}">${stat.letter}</span>` : ''}
            <span class="absolute top-0 left-0 px-1.5 py-0.5 text-[11px] font-black bg-white/90 text-gray-800 rounded-br-md">${n}${info.locked ? ' <i class="fa-solid fa-lock text-[8px] text-sky-600" aria-hidden="true"></i>' : ''}</span>
            <span class="absolute bottom-0 inset-x-0 px-1 py-0.5 text-[10px] sm:text-[11px] font-bold text-white truncate" style="background:linear-gradient(transparent,rgba(0,0,0,.75))">${last}</span>
        </button>`;
    },

    render: () => {
        const st = SeatMap.state;
        const plan = byId('smPlan');
        if (!st || !plan) return;
        const lecturerPov = st.pov === 'lecturer';
        // At least 4 rows for the lecturer and 5 for a student; more rows are added when a seat number needs them.
        const minRows = lecturerPov ? 4 : 5;
        const top = Math.max(PER_ROW * minRows, ...st.seats.keys(), st.maxSeat || 0, Number(st.mine) || 0);
        const rows = Math.ceil(top / PER_ROW);
        const rowNumbers = Array.from({ length: rows }, (_, r) => r);
        if (lecturerPov) rowNumbers.reverse();      // the lecturer's view is the room turned half a turn: back rows on top
        const rowHtml = rowNumbers.map(r => {
            let nums = Array.from({ length: PER_ROW }, (_, i) => r * PER_ROW + i + 1);
            if (lecturerPov) nums = nums.reverse();
            const left = nums.slice(0, PER_COLUMN), right = nums.slice(PER_COLUMN);
            return `<div class="flex ${lecturerPov ? 'items-stretch min-h-0' : 'items-center'} gap-1.5 min-w-0" ${lecturerPov ? 'style="flex:1 1 0;min-height:60px"' : ''}>
                <span class="w-4 shrink-0 text-[10px] font-bold text-gray-400 text-center" aria-hidden="true">${r + 1}</span>
                <div class="flex min-w-0 gap-1.5" style="flex:1 1 0">${left.map(n => SeatMap.seatCell(n, st)).join('')}</div>
                <div class="w-3 sm:w-6 shrink-0" aria-hidden="true"></div>
                <div class="flex min-w-0 gap-1.5" style="flex:1 1 0">${right.map(n => SeatMap.seatCell(n, st)).join('')}</div>
            </div>`;
        }).join('');

        const bar = (icon, label, color) => `<div class="mx-auto ${lecturerPov ? 'mt-1 mb-0 w-1/2 py-0.5 text-[10px]' : 'my-2 w-3/4 py-1 text-[11px]'} shrink-0 text-center font-bold tracking-widest uppercase rounded ${color} text-white"><i class="fa-solid ${icon} mr-1" aria-hidden="true"></i>${label}</div>`;
        const note = lecturerPov ? '' : '<p class="text-[11px] text-gray-500 text-center">Seen from a student facing the board: row 1 is at the front, seats count from left to right.</p>';
        const extras = st.extras.length ? `<p class="text-[11px] text-gray-500 mt-1 text-center">Other seat labels: ${st.extras.map(x => esc(x.seat) + ' (' + esc(x.name) + ')').join(', ')}</p>` : '';

        const hadRows = !!byId('smRows');
        const prevScroll = hadRows ? byId('smRows').scrollTop : 0;
        plan.classList.toggle('flex', lecturerPov);
        plan.classList.toggle('flex-col', lecturerPov);
        plan.classList.toggle('overflow-hidden', lecturerPov);
        plan.classList.toggle('overflow-auto', !lecturerPov);
        if (lecturerPov) {
            // Only four rows fit the screen at a time; more rows scroll inside the plan, above the thin Lecturer bar.
            plan.innerHTML = `<div id="smRows" class="flex-1 min-h-0 overflow-y-auto relative"><div id="smRowList" class="flex flex-col gap-1 ${rows <= 4 ? 'h-full' : ''}" role="group" aria-label="Seats">${rowHtml}</div></div>${bar('fa-chalkboard-user', 'Lecturer', 'bg-sky-700')}${extras}`;
            const list = byId('smRowList'), box = byId('smRows');
            if (rows > 4) {
                const h = Math.floor((box.clientHeight - 3 * 4) / 4);
                list.querySelectorAll(':scope > div').forEach(r => { r.style.flex = '0 0 auto'; r.style.height = `${Math.max(60, h)}px`; });
                box.scrollTop = hadRows ? prevScroll : box.scrollHeight;      // opens at row 1, the row nearest the lecturer
            }
        } else {
            plan.innerHTML = `${bar('fa-chalkboard', 'Board', 'bg-gray-800')}<div class="space-y-1.5" role="group" aria-label="Seats">${rowHtml}</div>${note}${extras}`;
        }
        byId('seatMapSub').textContent = lecturerPov && st.unseated ? `${st.unseated} student${st.unseated === 1 ? ' has' : 's have'} no seat and ${st.unseated === 1 ? 'is' : 'are'} not shown.` : '';
        byId('seatMapSub').classList.toggle('hidden', !(lecturerPov && st.unseated));
        const rowsEl = byId('smRows');
        if (st.pop && rowsEl) { rowsEl.insertAdjacentHTML('beforeend', SeatMap.popHtml(st.pop)); SeatMap.popPlace(); }
        SeatMap.info();
        SeatMap.counts();
    },

    info: () => {
        const st = SeatMap.state, box = byId('smInfo');
        if (!st || !box) return;
        if (st.pov === 'student') {
            box.innerHTML = st.mine ? `Your seat is <b>${esc(st.mine)}</b>.` : 'You have no seat yet.';
            return;
        }
        // Lecturer: no tips bar; only a no-class warning in attendance mode.
        const a = st.att;
        if (a.on && a.noClass) { box.classList.remove('hidden'); box.innerHTML = `<b>${esc(a.date)}</b> is marked as a no-class day.`; }
        else { box.classList.add('hidden'); box.textContent = ''; }
    },

    // ---- participation popover, anchored on the tapped box
    openPop: async (n) => {
        const st = SeatMap.state, a = st.att, info = st.seats.get(n);
        if (!info) return;
        if (a.loadedDate !== a.date) { await SeatMap.loadAttendance(); a.loadedDate = a.date; }
        const pts = a.records.get(info.id)?.points || 0;
        st.pop = { n, info, value: pts, saved: pts, chain: Promise.resolve() };
        SeatMap.render();
    },

    closePop: () => {
        const st = SeatMap.state;
        if (!st || !st.pop) return;
        st.pop = null;
        SeatMap.render();
    },

    popPlace: () => {
        const st = SeatMap.state, box = byId('smRows'), pop = byId('smPop');
        if (!st || !st.pop || !box || !pop) return;
        const seat = box.querySelector(`button.sm-seat[data-seat="${st.pop.n}"]`);
        if (!seat) return;
        const w = pop.offsetWidth, h = pop.offsetHeight;
        // Above the box, else below it; always kept inside the visible part of the plan.
        let top = seat.offsetTop - h - 6;
        if (top < box.scrollTop) top = seat.offsetTop + seat.offsetHeight + 6;
        top = Math.max(box.scrollTop + 2, Math.min(top, box.scrollTop + box.clientHeight - h - 2));
        const left = Math.max(2, Math.min(seat.offsetLeft + seat.offsetWidth / 2 - w / 2, box.clientWidth - w - 2));
        pop.style.top = `${top}px`;
        pop.style.left = `${left}px`;
        pop.style.visibility = 'visible';
    },

    popHtml: (pop) => `<div id="smPop" role="dialog" aria-label="Participation for ${esc(pop.info.name)}" class="absolute z-20 w-72 max-w-full rounded-lg bg-white border border-gray-300 shadow-xl p-2" style="visibility:hidden;top:0;left:0">
        <div class="flex items-center gap-1"><p class="flex-1 min-w-0 text-xs font-bold text-gray-800 truncate">${esc(pop.info.name)}</p>
            <button type="button" id="smPopClose" aria-label="Close" class="w-8 h-8 shrink-0 text-gray-500"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>
        <div class="flex items-center gap-1 mt-1">
            <button type="button" id="smPopNote" class="min-h-[44px] px-2 shrink-0 rounded-md border border-amber-300 bg-amber-50 text-amber-800 text-xs font-bold" aria-label="Lecturer note"><i class="fa-solid fa-note-sticky mr-1" aria-hidden="true"></i>Note</button>
            <button type="button" class="sm-pop-step min-h-[44px] min-w-[44px] shrink-0 rounded-md border border-red-300 text-red-700 font-black text-lg bg-white" data-step="-1" aria-label="Minus one point">&minus;</button>
            <input type="number" id="smPopVal" step="1" value="${pop.value}" aria-label="Participation points" class="min-h-[44px] min-w-0 flex-1 w-full text-center border border-gray-300 rounded-md font-bold" style="font-size:16px">
            <button type="button" class="sm-pop-step min-h-[44px] min-w-[44px] shrink-0 rounded-md border border-green-300 text-green-700 font-black text-lg bg-white" data-step="1" aria-label="Plus one point">+</button>
        </div>
        <p id="smPopStatus" class="text-[11px] text-gray-500 min-h-[14px]" role="status">Participation points</p>
    </div>`,

    savePop: () => {
        const st = SeatMap.state, pop = st && st.pop;
        if (!pop) return;
        const status = () => byId('smPopStatus');
        if (status()) status().textContent = 'Saving...';
        pop.chain = pop.chain.then(async () => {
            const delta = pop.value - pop.saved;
            if (!delta) { if (st.pop === pop && status()) status().textContent = 'Saved'; return; }
            try {
                await post('/api/add-participation-points', { courseId: st.courseId, studentId: pop.info.id, date: st.att.date, points: delta });
                pop.saved += delta;
                const rec = st.att.records.get(pop.info.id);
                st.att.records.set(pop.info.id, { status: rec ? rec.status : 'Present', points: pop.saved });
                st.att.dirty = true;
                if (st.pop === pop && pop.value === pop.saved && status()) status().textContent = 'Saved';
            } catch (err) {
                pop.value = pop.saved;
                if (st.pop === pop && byId('smPopVal')) { byId('smPopVal').value = pop.value; status().textContent = `Not saved: ${err.message}`; }
                else UI.error(`Not saved for ${pop.info.name}: ${err.message}`);
            }
        });
    },

    init: () => {
        // Capture phase, so a tap on a seat number inside a clickable card opens the plan instead of the card.
        document.addEventListener('click', (e) => {
            const t = e.target.closest && e.target.closest('.seat-map-trigger');
            if (t) { e.preventDefault(); e.stopPropagation(); SeatMap.openStudent(t.dataset.courseId); }
        }, true);
        document.addEventListener('click', async (e) => {
            if (e.target.closest('#attendanceFloorBtn')) {
                const courseId = window.location.hash.replace('#class-', '');
                await SeatMap.openLecturer(CourseClass.currentStudents, { courseId, attendance: false, onDirty: () => CourseClass.loadClassScreen(courseId, true) });
                return;
            }
            if (e.target.closest('#seatMapClose') || e.target.id === 'seatMapBg') { SeatMap.close(); return; }
            const st = SeatMap.state;
            if (!st || !byId('seatMapModal') || byId('seatMapModal').classList.contains('hidden')) return;
            if (e.target.closest('#smAttToggle')) { await SeatMap.attendanceOn(!st.att.on); return; }
            if (e.target.closest('#smPopClose')) { SeatMap.closePop(); return; }
            if (e.target.closest('#smPopNote') && st.pop) { LecturerNotes.openModal(st.courseId, st.pop.info.id, st.pop.info.name); return; }
            const step = e.target.closest('.sm-pop-step');
            if (step && st.pop) {
                st.pop.value = Math.round((st.pop.value + Number(step.dataset.step)) * 100) / 100;
                byId('smPopVal').value = st.pop.value;
                SeatMap.savePop();
                return;
            }
            if (e.target.closest('#smPop')) return;
            if (st.pop && !e.target.closest('button.sm-seat')) { SeatMap.closePop(); }
            const brush = e.target.closest('.sm-brush');
            if (brush) { st.att.brush = brush.dataset.status; SeatMap.tools(); SeatMap.info(); return; }
            if (e.target.closest('#smAllPresent')) { await SeatMap.markAllPresent(); return; }
            const seat = e.target.closest('button.sm-seat');
            if (seat && st.pov === 'lecturer') {
                const n = Number(seat.dataset.seat);
                st.picked = n;
                const info = st.seats.get(n);
                if (st.pop && st.pop.n === n) { SeatMap.closePop(); return; }
                if (!st.att.on) { await SeatMap.openPop(n); return; }
                st.pop = null;
                if (st.att.on && info && !st.att.noClass) {
                    const cur = st.att.records.get(info.id)?.status || '';
                    await SeatMap.setStatus(info, cur === st.att.brush ? '' : st.att.brush);   // tapping the same status again clears it
                } else SeatMap.render();
            }
        });
        document.addEventListener('change', async (e) => {
            if (e.target.id === 'smPopVal' && SeatMap.state && SeatMap.state.pop) {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) { SeatMap.state.pop.value = v; SeatMap.savePop(); } else e.target.value = SeatMap.state.pop.value;
                return;
            }
            if (e.target.id !== 'smAttDate' || !SeatMap.state) return;
            if (e.target.value) { SeatMap.state.att.date = e.target.value; SeatMap.state.pop = null; await SeatMap.loadAttendance(); SeatMap.render(); }
        });
        const relayout = () => setTimeout(() => { SeatMap.layout(); if (SeatMap.state && byId('seatMapModal') && !byId('seatMapModal').classList.contains('hidden')) SeatMap.render(); }, 120);
        window.addEventListener('resize', relayout);
        window.addEventListener('orientationchange', relayout);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && byId('seatMapModal') && !byId('seatMapModal').classList.contains('hidden')) SeatMap.close(); });
    }
};
