// js/course-recitation.js
import { apiFetch } from './globals.js';
import { CourseAttendance } from './course-attendance.js';
import { getLoadableAvatarSrc } from './components.js';
import { initialsOf } from './components-utils.js';
import { getLocalDateString } from './date-utils.js';
import { escapeHtml, safeUrl } from './html-utils.js';

// Storage key for today's called list (local date, not UTC).
const getCalledKey = () => {
    const courseId = window.location.hash.replace('#class-', '');
    return `student_caller_${courseId}_${getLocalDateString()}`;
};

const readCalled = (key) => {
    try {
        return JSON.parse(localStorage.getItem(key)) || [];
    } catch (e) {
        return [];
    }
};

// The student's row in the class list on screen (it holds the "Pts" box for the attendance date).
const getStudentRow = (userId) => {
    const safeId = window.CSS && CSS.escape ? CSS.escape(userId) : String(userId).replace(/"/g, '\\"');
    return document.querySelector(`.student-row[data-student-id="${safeId}"]`);
};

export const CourseRecitation = {
    students: [],
    isSpinning: false,
    currentSelectedStudentId: null,
    savedPoints: {},  // points the server holds for each student on the shown date, by student id
    pendingSave: null,
    saveTimer: null,
    saveChain: Promise.resolve(),

    openModal: async (courseId) => {
        document.getElementById('recitationModal').classList.remove('hidden');
        CourseRecitation.showWheelOnly();
        document.getElementById('spinWheelBtn').disabled = false;

        const mode = document.querySelector('input[name="callerMode"]:checked').value;
        const toggleBtn = document.getElementById('toggleCalledListBtn');
        if (mode === '2') {
            toggleBtn.classList.remove('hidden');
        } else {
            toggleBtn.classList.add('hidden');
        }

        const wheel = document.getElementById('recitationWheel');
        wheel.style.transform = `rotate(0deg)`;
        wheel.innerHTML = '<div class="absolute inset-0 flex items-center justify-center text-gray-500 font-bold"><i class="fa-solid fa-spinner fa-spin text-3xl"></i></div>';

        try {
            const data = await apiFetch(`/api/recitation-pool?courseId=${courseId}`);
            CourseRecitation.students = data.students || [];
            CourseRecitation.drawWheel();
            CourseRecitation.updateCalledListUI();
        } catch(err) {
            wheel.innerHTML = `<div class="absolute inset-0 flex items-center justify-center text-red-500 font-bold text-xs text-center p-4">${escapeHtml(err.message)}</div>`;
        }
    },

    closeModal: () => {
        if (CourseRecitation.isSpinning) return;
        CourseRecitation.flushPoints();
        document.getElementById('recitationModal').classList.add('hidden');
        CourseRecitation.showWheelOnly();
        document.getElementById('calledListModal')?.classList.add('hidden');
    },

    // The same circle shows the wheel or the called student's photo; the button reads CALL STUDENT, then CALL NEXT.
    // One form: the details under the button are a skeleton until a student is called.
    showDetails: (on) => {
        document.getElementById('recitationSkeleton').classList.toggle('hidden', on);
        document.getElementById('recitationDetails').classList.toggle('hidden', !on);
    },

    showWheelOnly: () => {
        CourseRecitation.showDetails(false);
        const photo = document.getElementById('recitationResultAvatar');
        photo.classList.add('hidden');
        photo.innerHTML = '';
        document.getElementById('wheelPointer')?.classList.remove('hidden');
        document.getElementById('spinWheelBtn').textContent = 'CALL STUDENT';
    },

    resetToWheel: () => {
        CourseRecitation.flushPoints();
        CourseRecitation.showWheelOnly();
        CourseRecitation.drawWheel();
    },

    // Copies the students called today, in the order they were called, as a numbered list.
    copyCalledList: async () => {
        const names = readCalled(getCalledKey()).map(id => (CourseRecitation.students.find(s => s.User_ID === id) || {}).Name).filter(Boolean);
        if (!names.length) return;
        const header = `Called today (${getLocalDateString()})`;
        const text = [header, ...names.map((n, i) => `${i + 1}. ${n}`)].join('\n');
        let done = false;
        try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); done = true; } } catch (e) { /* fall back */ }
        if (!done) {   // older iOS: copy through a temporary text field
            const ta = document.createElement('textarea');
            ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
            document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
            try { done = document.execCommand('copy'); } catch (e) { done = false; }
            ta.remove();
        }
        const btn = document.getElementById('copyCalledListBtn');
        if (btn) { const old = btn.innerHTML; btn.innerHTML = done ? '<i class="fa-solid fa-check" aria-hidden="true"></i> Copied' : 'Could not copy'; setTimeout(() => { btn.innerHTML = old; }, 1800); }
    },

    updateCalledListUI: () => {
        const calledToday = readCalled(getCalledKey());

        const contentContainer = document.getElementById('calledStudentsListContent');
        if (!contentContainer) return;
        const count = calledToday.filter(id => CourseRecitation.students.some(s => s.User_ID === id)).length;
        const countEl = document.getElementById('calledListCount');
        if (countEl) countEl.textContent = count ? `(${count})` : '';
        const copyBtn = document.getElementById('copyCalledListBtn');
        if (copyBtn) copyBtn.disabled = count === 0;

        if (calledToday.length === 0) {
            contentContainer.innerHTML = '<div class="text-xs text-gray-500 italic text-center py-2">No students called yet today.</div>';
            return;
        }

        contentContainer.innerHTML = calledToday.map(userId => {
            const student = CourseRecitation.students.find(s => s.User_ID === userId);
            if (!student) return '';
            return `
                <div class="flex justify-between items-center bg-white p-2 border border-gray-200 rounded shadow-sm">
                    <span class="text-xs font-bold text-gray-800">${escapeHtml(student.Name)}</span>
                    <button type="button" class="remove-called-student text-red-500 hover:text-red-700 text-xs font-bold px-1.5 py-0.5 bg-red-50 hover:bg-red-100 rounded transition" data-user-id="${student.User_ID}">
                        <i class="fa-solid fa-xmark"></i> Remove
                    </button>
                </div>
            `;
        }).join('');
    },

    // Fills the points box with the student's current points from the class list.
    showPoints: (userId) => {
        const input = document.getElementById('recitationPointsInput');
        const hint = document.getElementById('recitationPointsHint');
        if (!input || !hint) return;

        const rowInput = getStudentRow(userId)?.querySelector('.points-input');
        if (!rowInput) {
            input.value = '';
            CourseRecitation.setPointsLocked(true);
            hint.textContent = 'This student is not in the class list on screen.';
            return;
        }

        const current = parseInt(rowInput.value, 10) || 0;
        // What is already saved: the attendance screen's saved copy if it has one, else what the list shows.
        const base = CourseAttendance.baselineReady ? CourseAttendance.baseline[userId] : null;
        CourseRecitation.savedPoints[userId] = base ? base.points : current;

        input.value = String(current);
        CourseRecitation.setPointsStatus('');

        // Absent or Excused students do not earn participation points, so the box stays locked.
        const status = getStudentRow(userId).querySelector('.attendance-btn[data-selected="true"]')?.dataset.status;
        if (status === 'Absent' || status === 'Excused') {
            CourseRecitation.setPointsLocked(true);
            hint.textContent = `Marked ${status} in the list. Change the status first to give points.`;
            return;
        }
        CourseRecitation.setPointsLocked(false);

        const date = document.getElementById('attendanceDate')?.value;
        hint.textContent = (date ? `Points for ${date}. ` : '') + 'Saved automatically when you stop typing.';
    },

    // Locks or unlocks the points box and its minus / plus buttons together.
    setPointsLocked: (locked) => {
        const input = document.getElementById('recitationPointsInput');
        if (input) input.disabled = locked;
        CourseRecitation.syncStepButtons();
    },

    // Minus is off at 0, plus is off at 999, both are off while locked.
    syncStepButtons: () => {
        const input = document.getElementById('recitationPointsInput');
        const minus = document.getElementById('recitationPointsMinus');
        const plus = document.getElementById('recitationPointsPlus');
        if (!input || !minus || !plus) return;
        const value = parseInt(input.value, 10) || 0;
        minus.disabled = input.disabled || value <= 0;
        plus.disabled = input.disabled || value >= 999;
    },

    // The minus / plus buttons: change the points by one and save like a typed change.
    stepPoints: (step) => {
        const input = document.getElementById('recitationPointsInput');
        if (!input || input.disabled) return;
        const next = Math.min(999, Math.max(0, (parseInt(input.value, 10) || 0) + step));
        input.value = String(next);
        CourseRecitation.updatePoints(String(next));
    },

    setPointsStatus: (text, isError = false) => {
        const el = document.getElementById('recitationPointsStatus');
        if (!el) return;
        el.textContent = text;
        el.className = `text-[11px] font-bold mt-1 min-h-[16px] ${isError ? 'text-red-600' : 'text-green-700'}`;
    },

    // Called when the points box is edited: copies the value into the student list.
    updatePoints: (rawValue) => {
        const userId = CourseRecitation.currentSelectedStudentId;
        if (!userId || rawValue === '') return;

        const value = Math.min(999, Math.max(0, parseInt(rawValue, 10) || 0));
        const rowInput = getStudentRow(userId)?.querySelector('.points-input');
        if (!rowInput) return;
        CourseRecitation.syncStepButtons();

        rowInput.value = String(value);
        // Lets the attendance screen notice the change (unsaved-changes dot, draft saving).
        rowInput.dispatchEvent(new Event('input', { bubbles: true }));

        // Save shortly after the last keystroke.
        CourseRecitation.pendingSave = {
            userId,
            value,
            courseId: window.location.hash.replace('#class-', ''),
            date: document.getElementById('attendanceDate')?.value
        };
        CourseRecitation.setPointsStatus('Saving...');
        clearTimeout(CourseRecitation.saveTimer);
        CourseRecitation.saveTimer = setTimeout(CourseRecitation.flushPoints, 700);
    },

    // Sends any waiting points change now. Safe to call at any time (Next Student, closing the window).
    flushPoints: () => {
        clearTimeout(CourseRecitation.saveTimer);
        const job = CourseRecitation.pendingSave;
        CourseRecitation.pendingSave = null;
        if (!job) return CourseRecitation.saveChain;
        // Jobs run one after another so the amounts added never overlap.
        CourseRecitation.saveChain = CourseRecitation.saveChain.then(() => CourseRecitation.savePoints(job));
        return CourseRecitation.saveChain;
    },

    savePoints: async (job) => {
        const { userId, value, courseId, date } = job;
        const before = CourseRecitation.savedPoints[userId] ?? 0;
        const delta = value - before;
        const isShown = () => CourseRecitation.currentSelectedStudentId === userId;

        if (delta === 0) {
            if (isShown() && !CourseRecitation.pendingSave) CourseRecitation.setPointsStatus('Saved');
            return;
        }
        if (!courseId || !date) {
            if (isShown()) CourseRecitation.setPointsStatus('Pick an attendance date first.', true);
            return;
        }

        try {
            await apiFetch('/api/add-participation-points', {
                method: 'POST',
                body: JSON.stringify({ courseId, studentId: userId, date, points: delta })
            });
        } catch (err) {
            if (isShown() && !CourseRecitation.pendingSave) {
                CourseRecitation.setPointsStatus(`Not saved: ${err.message}. It stays in the list; press Save Attendance to retry.`, true);
            }
            return;
        }

        CourseRecitation.savedPoints[userId] = value;

        // The wheel's weighting follows the saved change.
        const student = CourseRecitation.students.find(s => s.User_ID === userId);
        if (student) student.Total_Points = (Number(student.Total_Points) || 0) + delta;

        // Tell the attendance screen these points are now saved (only the points, not the status).
        const row = document.querySelector(`.student-row[data-student-id="${userId}"]`);
        if (CourseAttendance.baselineReady && row) {
            const base = CourseAttendance.baseline[userId] || CourseAttendance.snapshotRow(row);
            CourseAttendance.baseline[userId] = { ...base, points: value };
            if (!CourseAttendance.updateDirty()) CourseAttendance.clearDraft(courseId, date);
        }

        if (isShown() && !CourseRecitation.pendingSave) CourseRecitation.setPointsStatus('Saved');
    },

    removeCalledStudent: (userId) => {
        const calledKey = getCalledKey();
        const calledToday = readCalled(calledKey).filter(id => id !== userId);
        localStorage.setItem(calledKey, JSON.stringify(calledToday));

        CourseRecitation.updateCalledListUI();
        CourseRecitation.drawWheel();
    },

    resetCalledList: () => {
        localStorage.removeItem(getCalledKey());
        CourseRecitation.updateCalledListUI();
        CourseRecitation.drawWheel();
    },

    // The called student's photo grows out of their slice into the result card.
    zoomIn: (from, src) => {
        const target = document.getElementById('recitationResultAvatar');   // the wheel's own circle, photo inside
        if (!target || !src || !target.animate || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
        target.style.visibility = 'hidden';
        requestAnimationFrame(() => {
            const end = target.getBoundingClientRect();
            if (!end.width) { target.style.visibility = ''; return; }
            const fly = document.createElement('img');
            fly.src = src;
            fly.alt = '';
            fly.setAttribute('aria-hidden', 'true');
            fly.style.cssText = 'position:fixed;z-index:130;border-radius:9999px;object-fit:cover;border:4px solid #374151;box-shadow:0 10px 30px rgba(0,0,0,.25);pointer-events:none;margin:0';
            document.body.appendChild(fly);
            const box = (cx, cy, size) => ({ left: `${cx - size / 2}px`, top: `${cy - size / 2}px`, width: `${size}px`, height: `${size}px` });
            const anim = fly.animate([
                box(from.cx, from.cy, from.size),
                { ...box(end.left + end.width / 2, end.top + end.height / 2, end.width * 1.04), offset: 0.75 },
                box(end.left + end.width / 2, end.top + end.height / 2, end.width)
            ], { duration: 800, easing: 'cubic-bezier(.4,.1,.2,1)', fill: 'forwards' });
            const done = () => { target.style.visibility = ''; fly.remove(); };
            anim.onfinish = done;
            anim.oncancel = done;
            setTimeout(done, 1500);   // never leave the photo hidden
        });
    },

    drawWheel: () => {
        const wheel = document.getElementById('recitationWheel');

        const mode = document.querySelector('input[name="callerMode"]:checked').value;
        const calledToday = readCalled(getCalledKey());

        let availableStudents = CourseRecitation.students;
        if (mode === '2') {
            availableStudents = CourseRecitation.students.filter(s => !calledToday.includes(s.User_ID));
        }

        const total = availableStudents.length;
        if (total === 0) {
            wheel.innerHTML = '<div class="absolute inset-0 flex items-center justify-center text-gray-500 font-bold text-center px-4">All students called for today.</div>';
            document.getElementById('spinWheelBtn').disabled = true;
            return;
        }

        document.getElementById('spinWheelBtn').disabled = false;

        let conicString = '';
        const angle = 360 / total;
        const colors = ['#f56565', '#ed8936', '#ecc94b', '#48bb78', '#38b2ac', '#4299e1', '#667eea', '#9f7aea', '#ed64a6'];

        for(let i = 0; i < total; i++) {
            const startAngle = i * angle;
            const endAngle = (i + 1) * angle;
            const color = colors[i % colors.length];
            conicString += `${color} ${startAngle}deg ${endAngle}deg${i < total - 1 ? ',' : ''}`;
        }

        wheel.style.background = `conic-gradient(${conicString})`;

        // Each slice is the student's photo cropped to the slice shape (a wedge), with the slice color and the
        // initials behind it for a student without a photo. A slice is a box standing on the wheel center, turned to
        // its angle, so the photo is upright when its slice reaches the pointer.
        const R = (wheel.clientWidth || 248) / 2;
        const half = (angle / 2) * Math.PI / 180;
        const wide = total === 1 ? 2 * R : (total === 2 ? 2 * R : 2 * R * Math.tan(half));   // width of the box that holds the wedge
        const clip = total <= 2 ? 'none' : `polygon(50% 100%, 0 0, 100% 0)`;
        const fontPx = Math.max(8, Math.min(18, Math.round(2 * R * 0.68 * Math.sin(half) * 0.55)));
        const slices = availableStudents.map((s, i) => {
            const theta = (i + 0.5) * angle;
            const rad = theta * Math.PI / 180;
            const lx = total === 1 ? 50 : 50 + 0.68 * 50 * Math.sin(rad);
            const ly = total === 1 ? 50 : 50 - 0.68 * 50 * Math.cos(rad);
            const src = getLoadableAvatarSrc(s.Avatar, 256);
            const label = `<span style="position:absolute;left:${lx}%;top:${ly}%;transform:translate(-50%,-50%) rotate(${total === 1 ? 0 : theta}deg);font-size:${fontPx}px" class="font-black text-white drop-shadow">${escapeHtml(initialsOf(s.Name))}</span>`;
            const box = total === 1 || total === 2
                ? `left:calc(50% - ${R}px);top:${total === 1 ? 0 : `calc(50% - ${R}px)`};width:${2 * R}px;height:${total === 1 ? 2 * R : R}px`
                : `left:calc(50% - ${wide / 2}px);top:calc(50% - ${R}px);width:${wide}px;height:${R}px`;
            const rot = total === 1 ? 0 : (total === 2 ? i * 180 : theta);
            const photo = src ? `<div style="position:absolute;${box};transform-origin:50% ${total === 1 ? '50%' : '100%'};transform:rotate(${rot}deg);clip-path:${clip};overflow:hidden"><img class="wheel-photo" src="${safeUrl(src)}" alt="" decoding="async" style="width:100%;height:100%;object-fit:cover;object-position:50% 25%;display:block"></div>` : '';
            return label + photo;
        }).join('');
        const lines = total > 1 ? availableStudents.map((_, i) => `<div style="position:absolute;left:calc(50% - 1px);top:calc(50% - ${R}px);width:2px;height:${R}px;background:#fff;transform-origin:50% 100%;transform:rotate(${i * angle}deg);opacity:.9"></div>`).join('') : '';
        wheel.innerHTML = slices + lines;
        wheel.querySelectorAll('img.wheel-photo').forEach(img => img.addEventListener('error', () => {
            if (!img.dataset.retried) { img.dataset.retried = '1'; setTimeout(() => { img.src = img.src + (img.src.includes('?') ? '&' : '?') + 'r=' + Date.now(); }, 1500); }
            else img.remove();   // the slice color and initials behind it stay
        }));
    },

    spin: () => {
        if (CourseRecitation.isSpinning) return;
        if (CourseRecitation.currentSelectedStudentId && !document.getElementById('recitationDetails').classList.contains('hidden')) {
            CourseRecitation.resetToWheel();   // CALL NEXT: save the points, redraw the wheel without the called student
        }
        const mode = document.querySelector('input[name="callerMode"]:checked').value;
        const calledKey = getCalledKey();

        let calledToday = [];
        if (mode === '2') {
            calledToday = readCalled(calledKey);
        }

        let availableStudents = CourseRecitation.students;
        if (mode === '2') {
            availableStudents = CourseRecitation.students.filter(s => !calledToday.includes(s.User_ID));
        }

        if (CourseRecitation.isSpinning || availableStudents.length === 0) return;
        CourseRecitation.isSpinning = true;

        CourseRecitation.showDetails(false);
        document.getElementById('recitationResultAvatar').classList.add('hidden');
        document.getElementById('wheelPointer')?.classList.remove('hidden');
        document.getElementById('spinWheelBtn').disabled = true;

        let selectedIndex = 0;

        if (mode === '1') {
            let maxPoints = 0;
            availableStudents.forEach(s => { if(s.Total_Points > maxPoints) maxPoints = s.Total_Points; });

            let totalWeight = 0;
            const weightedStudents = availableStudents.map(s => {
                const weight = (maxPoints - s.Total_Points) + 1;
                totalWeight += weight;
                return { ...s, weight };
            });

            let randomVal = Math.random() * totalWeight;

            for(let i = 0; i < weightedStudents.length; i++) {
                randomVal -= weightedStudents[i].weight;
                if(randomVal <= 0) {
                    selectedIndex = i;
                    break;
                }
            }
        } else {
            selectedIndex = Math.floor(Math.random() * availableStudents.length);
        }

        const selectedStudent = availableStudents[selectedIndex];
        const totalSlices = availableStudents.length;
        const sliceAngle = 360 / totalSlices;

        const sliceCenter = (selectedIndex * sliceAngle) + (sliceAngle / 2);

        const extraRotations = 5 * 360;
        const finalRotation = extraRotations + (360 - sliceCenter);

        const wheel = document.getElementById('recitationWheel');
        wheel.style.transition = 'none';

        void wheel.offsetHeight;

        wheel.style.transition = 'transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99)';
        wheel.style.transform = `rotate(${finalRotation}deg)`;

        setTimeout(() => {
            CourseRecitation.isSpinning = false;
            document.getElementById('spinWheelBtn').disabled = false;

            if (mode === '2') {
                calledToday.push(selectedStudent.User_ID);
                localStorage.setItem(calledKey, JSON.stringify(calledToday));
                CourseRecitation.updateCalledListUI();
            }

            CourseRecitation.currentSelectedStudentId = selectedStudent.User_ID;
            CourseRecitation.showPoints(selectedStudent.User_ID);

            const seatDisplay = document.getElementById('recitationResultSeat');
            if (seatDisplay) {
                seatDisplay.textContent = selectedStudent.Seat_Number || 'Unassigned';
            }

            const avatarSrc = getLoadableAvatarSrc(selectedStudent.Avatar, 640);
            const avatarImg = avatarSrc
                ? `<img src="${safeUrl(avatarSrc)}" alt="" class="w-full h-full object-cover" style="object-position:50% 25%">`
                : `<i class="fa-solid fa-circle-user text-[200px] text-gray-300" aria-hidden="true"></i>`;

            // The photo fills the wheel's own circle (same size, same place); the wheel stays underneath.
            const photoBox = document.getElementById('recitationResultAvatar');
            photoBox.innerHTML = avatarImg;
            // The small thumbnail the wheel already loaded shows at once behind the sharper photo, so the circle is never blank.
            const quick = getLoadableAvatarSrc(selectedStudent.Avatar, 256);
            photoBox.style.background = quick ? `#f3f4f6 url("${safeUrl(quick)}") center 25% / cover no-repeat` : '';
            photoBox.classList.remove('hidden');
            document.getElementById('wheelPointer')?.classList.add('hidden');
            document.getElementById('recitationResultName').textContent = selectedStudent.Name;

            // Where the winning slice is (under the pointer, at the top of the wheel), measured before the wheel is hidden.
            const dial = wheel.parentElement.getBoundingClientRect();
            const half = (sliceAngle / 2) * Math.PI / 180;
            const startSize = totalSlices <= 2 ? 120 : Math.max(36, Math.min(110, 2 * 0.68 * (dial.width / 2) * Math.sin(half)));
            const from = { cx: dial.left + dial.width / 2, cy: dial.top + dial.height / 2 - 0.68 * (dial.height / 2), size: startSize };

            document.getElementById('spinWheelBtn').textContent = 'CALL NEXT';
            CourseRecitation.showDetails(true);
            CourseRecitation.zoomIn(from, avatarSrc);

            wheel.style.transition = 'none';
            wheel.style.transform = `rotate(${finalRotation % 360}deg)`;
        }, 4000);
    }
};
