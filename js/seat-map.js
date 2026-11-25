// js/seat-map.js
// Floor plan of the classroom: rows of 10 seats, two columns of 5 per row (an aisle between them). Row 1 is nearest the board.
// Student view (the student faces the board): seats 1-10 run left to right on the first row, 11-20 on the next, and so on.
// Lecturer view (the lecturer faces the class): the same room turned half a turn, so row 1 is at the bottom nearest the lecturer
// and each row runs 10 ... 1 from the lecturer's left. Students see seat numbers only (no classmate names).
// Opened from the lecturer's Seat Plan (names) and when a student taps their seat number (own seat highlighted).
import { apiFetch, AppState } from './globals.js';
import { escapeHtml as esc } from './html-utils.js';

const PER_COLUMN = 5;
const PER_ROW = PER_COLUMN * 2;
const byId = (id) => document.getElementById(id);

const eyeRing = (eye) => {
    const e = String(eye || '').toLowerCase();
    return /blind/.test(e) ? 'border-amber-500 bg-amber-50' : /near/.test(e) ? 'border-purple-400 bg-purple-50'
        : /far/.test(e) ? 'border-teal-400 bg-teal-50' : 'border-gray-300 bg-white';
};

export const SeatMap = {
    state: null,   // { pov, seats: Map(seatNumber -> { name, eye, locked, mine }), extras: [...] , showNames }

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
            <div class="bg-white rounded-none sm:rounded-lg shadow-xl w-full max-w-xl h-full sm:h-auto p-4 sm:p-6 relative z-10 sheet-panel app-page max-h-full sm:max-h-[95vh] flex flex-col">
                <div class="flex items-center gap-3 mb-3 border-b pb-3 app-page-header">
                    <div class="flex-1 min-w-0">
                        <h3 id="seatMapTitle" class="text-lg font-bold text-gray-800"><i class="fa-solid fa-chair text-sky-600 mr-2" aria-hidden="true"></i>Classroom floor plan</h3>
                        <p id="seatMapSub" class="text-xs text-gray-500"></p>
                    </div>
                    <button id="seatMapClose" type="button" aria-label="Back" class="app-page-close order-first sm:order-last text-gray-500 sm:text-gray-400 hover:text-gray-800 transition-colors focus:outline-none">
                        <i class="fa-solid fa-arrow-left text-xl sm:hidden" aria-hidden="true"></i><i class="fa-solid fa-xmark text-xl hidden sm:inline" aria-hidden="true"></i>
                    </button>
                </div>
                <div class="grid grid-cols-2 gap-1 p-1 bg-gray-100 rounded-lg mb-3" role="group" aria-label="Point of view">
                    <button type="button" id="smPovStudent" class="sm-pov min-h-[44px] rounded-md text-sm font-bold" data-pov="student"><i class="fa-solid fa-user-graduate mr-1" aria-hidden="true"></i>Student view</button>
                    <button type="button" id="smPovLecturer" class="sm-pov min-h-[44px] rounded-md text-sm font-bold" data-pov="lecturer"><i class="fa-solid fa-chalkboard-user mr-1" aria-hidden="true"></i>Lecturer view</button>
                </div>
                <div id="smInfo" role="status" class="mb-3 p-2 rounded-lg bg-sky-50 border border-sky-200 text-sm text-sky-900 min-h-[40px]"></div>
                <div id="smPlan" class="overflow-auto flex-1"></div>
            </div>`;
        document.body.appendChild(el);
    },

    // Lecturer: students are the roster the class page already holds (with names).
    openLecturer: (students) => {
        const seats = new Map();
        const extras = [];
        (students || []).forEach(s => {
            const seat = String(s.Seat_Number || '').trim();
            const no = ['ud', 'dropped', 'graduated'].includes(String(s.account_status || '').toLowerCase());
            if (!seat || no) return;
            const info = { name: s.Name || '', eye: s.eye_condition || '', locked: Number(s.Seat_Locked) === 1 };
            if (/^\d+$/.test(seat) && Number(seat) > 0) seats.set(Number(seat), info); else extras.push({ seat, ...info });
        });
        SeatMap.show({ pov: 'lecturer', seats, extras, showNames: true, mine: null, title: 'Classroom floor plan' });
    },

    // Student: seat numbers only, the student's own seat is marked.
    openStudent: async (courseId) => {
        try {
            const r = await apiFetch(`/api/seat-map?courseId=${encodeURIComponent(courseId)}&studentId=${encodeURIComponent(AppState.user.User_ID)}`);
            const seats = new Map();
            const extras = [];
            let mine = null;
            (r.seats || []).forEach(x => {
                const n = /^\d+$/.test(x.seat) ? Number(x.seat) : 0;
                if (x.mine) mine = x.seat;
                if (n > 0) seats.set(n, { mine: !!x.mine }); else extras.push({ seat: x.seat, mine: !!x.mine });
            });
            SeatMap.show({ pov: 'student', seats, extras, showNames: false, mine, title: 'Your seat' });
        } catch (err) {
            import('./ui-feedback.js').then(m => m.UI.error(err.message || 'Could not load the floor plan.'));
        }
    },

    show: (state) => {
        SeatMap.ensureModal();
        SeatMap.state = { ...state, picked: state.mine && /^\d+$/.test(state.mine) ? Number(state.mine) : null };
        byId('seatMapSub').textContent = state.showNames ? 'Tap a seat to see who sits there.' : (state.mine ? `Your seat is ${state.mine}.` : 'You have no seat yet.');
        byId('seatMapModal').classList.remove('hidden');
        SeatMap.render();
    },

    close: () => byId('seatMapModal')?.classList.add('hidden'),

    seatCell: (n, st) => {
        const info = st.seats.get(n);
        const mine = !!(info && info.mine);
        const picked = st.picked === n;
        let cls = 'border-dashed border-gray-300 bg-gray-50 text-gray-400';          // empty
        if (info) cls = st.showNames ? eyeRing(info.eye) + ' text-gray-800' : 'border-sky-300 bg-sky-50 text-sky-800';   // taken
        if (mine) cls = 'border-green-600 bg-green-500 text-white shadow';
        const name = info && st.showNames ? esc(String(info.name).split(',')[0]) : '';
        return `<button type="button" style="flex:1 1 0" class="sm-seat min-w-0 min-h-[52px] rounded-md border-2 px-0.5 py-1 flex flex-col items-center justify-center leading-none ${cls} ${picked ? 'ring-2 ring-offset-1 ring-sky-600' : ''}" data-seat="${n}" aria-label="Seat ${n}${mine ? ', your seat' : info ? (st.showNames ? ', ' + esc(info.name) : ', taken') : ', empty'}">
            <span class="text-sm font-black">${n}</span>
            ${mine ? '<span class="text-[9px] font-bold mt-0.5">YOU</span>' : name ? `<span class="text-[9px] mt-0.5 w-full truncate text-center">${name}</span>` : ''}
            ${info && info.locked ? '<i class="fa-solid fa-lock text-[8px] mt-0.5 text-sky-600" aria-hidden="true"></i>' : ''}
        </button>`;
    },

    render: () => {
        const st = SeatMap.state;
        const plan = byId('smPlan');
        if (!st || !plan) return;
        const top = Math.max(PER_ROW, ...st.seats.keys());
        const rows = Math.ceil(top / PER_ROW);
        const lecturerPov = st.pov === 'lecturer';
        document.querySelectorAll('#seatMapModal .sm-pov').forEach(b => {
            const on = b.dataset.pov === st.pov;
            b.setAttribute('aria-pressed', String(on));
            b.className = `sm-pov min-h-[44px] rounded-md text-sm font-bold ${on ? 'bg-white text-sky-700 shadow' : 'text-gray-500'}`;
        });

        // Row 1 is the one nearest the board. Student view: rows run front to back down the screen, seats left to right.
        // Lecturer view: turned half a turn, so the back rows are at the top, the front row is at the bottom, and each row is reversed.
        const rowNumbers = Array.from({ length: rows }, (_, r) => r);
        if (lecturerPov) rowNumbers.reverse();
        const rowHtml = rowNumbers.map(r => {
            let nums = Array.from({ length: PER_ROW }, (_, i) => r * PER_ROW + i + 1);
            if (lecturerPov) nums = nums.reverse();
            const left = nums.slice(0, PER_COLUMN), right = nums.slice(PER_COLUMN);
            return `<div class="flex items-center gap-1 min-w-0">
                <span class="w-5 shrink-0 text-[10px] font-bold text-gray-400 text-center" aria-hidden="true">${r + 1}</span>
                <div class="flex min-w-0 gap-1" style="flex:1 1 0">${left.map(n => SeatMap.seatCell(n, st)).join('')}</div>
                <div class="w-4 shrink-0" aria-hidden="true"></div>
                <div class="flex min-w-0 gap-1" style="flex:1 1 0">${right.map(n => SeatMap.seatCell(n, st)).join('')}</div>
            </div>`;
        }).join('');

        const board = '<div class="mx-auto my-2 w-3/4 text-center text-[11px] font-bold tracking-widest uppercase rounded bg-gray-800 text-white py-1.5"><i class="fa-solid fa-chalkboard mr-1" aria-hidden="true"></i>Board</div>';
        const desk = '<div class="mx-auto my-2 w-3/4 text-center text-[11px] font-bold tracking-widest uppercase rounded bg-sky-700 text-white py-1.5"><i class="fa-solid fa-chalkboard-user mr-1" aria-hidden="true"></i>Lecturer</div>';
        const note = lecturerPov
            ? '<p class="text-[11px] text-gray-500 text-center">Seen from the lecturer, facing the class: row 1 is nearest you, and seat 10 is on your left.</p>'
            : '<p class="text-[11px] text-gray-500 text-center">Seen from a student facing the board: row 1 is at the front, seats count from left to right.</p>';
        const legend = st.showNames
            ? `<div class="flex flex-wrap gap-x-3 gap-y-1 justify-center text-[10px] text-gray-600 mt-2">
                <span><i class="fa-solid fa-square text-amber-300"></i> Legally Blind</span><span><i class="fa-solid fa-square text-purple-300"></i> Near Sighted</span>
                <span><i class="fa-solid fa-square text-teal-300"></i> Far Sighted</span><span><i class="fa-regular fa-square text-gray-400"></i> No condition</span>
                <span><i class="fa-solid fa-lock text-sky-600"></i> Locked</span></div>`
            : `<div class="flex flex-wrap gap-x-3 gap-y-1 justify-center text-[10px] text-gray-600 mt-2">
                <span><i class="fa-solid fa-square text-green-500"></i> You</span><span><i class="fa-solid fa-square text-sky-300"></i> Taken</span><span><i class="fa-regular fa-square text-gray-400"></i> Empty</span></div>`;
        const extras = st.extras.length ? `<p class="text-[11px] text-gray-500 mt-2">Other seat labels: ${st.extras.map(x => esc(x.seat) + (st.showNames ? ' (' + esc(x.name) + ')' : x.mine ? ' (you)' : '')).join(', ')}</p>` : '';

        plan.innerHTML = `${lecturerPov ? '' : board}<div class="space-y-1.5" role="group" aria-label="Seats">${rowHtml}</div>${lecturerPov ? desk : ''}${note}${legend}${extras}`;
        SeatMap.info();
    },

    info: () => {
        const st = SeatMap.state;
        const box = byId('smInfo');
        if (!st || !box) return;
        const n = st.picked;
        if (!n) { box.textContent = st.showNames ? 'Tap a seat to see who sits there.' : 'Tap a seat to see if it is taken.'; return; }
        const info = st.seats.get(n);
        const row = Math.ceil(n / PER_ROW), pos = (n - 1) % PER_ROW + 1;
        const where = `row ${row}, ${pos <= PER_COLUMN ? 'left' : 'right'} column (student view)`;
        if (!info) { box.innerHTML = `<b>Seat ${n}</b>: empty, ${where}.`; return; }
        if (info.mine) { box.innerHTML = `<b>Seat ${n}</b>: <b>your seat</b>, ${where}.`; return; }
        if (!st.showNames) { box.innerHTML = `<b>Seat ${n}</b>: taken, ${where}.`; return; }
        box.innerHTML = `<b>Seat ${n}</b>: ${esc(info.name)}${info.eye && info.eye !== 'No Eye Condition' ? ' (' + esc(info.eye) + ')' : ''}${info.locked ? ', locked' : ''}, ${where}.`;
    },

    init: () => {
        // Capture phase, so a tap on a seat number inside a clickable card opens the plan instead of the card.
        document.addEventListener('click', (e) => {
            const t = e.target.closest && e.target.closest('.seat-map-trigger');
            if (t) { e.preventDefault(); e.stopPropagation(); SeatMap.openStudent(t.dataset.courseId); return; }
        }, true);
        document.addEventListener('click', (e) => {
            if (e.target.closest('#seatMapClose') || e.target.id === 'seatMapBg') { SeatMap.close(); return; }
            const pov = e.target.closest('.sm-pov');
            if (pov && SeatMap.state) { SeatMap.state.pov = pov.dataset.pov; SeatMap.render(); return; }
            const seat = e.target.closest('.sm-seat');
            if (seat && SeatMap.state) { SeatMap.state.picked = Number(seat.dataset.seat); SeatMap.render(); }
        });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && byId('seatMapModal') && !byId('seatMapModal').classList.contains('hidden')) SeatMap.close(); });
    }
};
