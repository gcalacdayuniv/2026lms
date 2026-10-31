// js/course-recitation.js
import { apiFetch } from './globals.js';
import { getLoadableAvatarSrc } from './components.js';
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
    shownPoints: 0,   // the points value last shown for the selected student

    openModal: async (courseId) => {
        document.getElementById('recitationModal').classList.remove('hidden');
        document.getElementById('recitationResult').classList.add('hidden');
        document.getElementById('wheelContainer').classList.remove('hidden');
        document.getElementById('spinWheelBtn').classList.remove('hidden');
        document.getElementById('spinWheelBtn').disabled = false;

        const mode = document.querySelector('input[name="callerMode"]:checked').value;
        const toggleBtn = document.getElementById('toggleCalledListBtn');
        if (mode === '2') {
            toggleBtn.classList.remove('hidden');
        } else {
            toggleBtn.classList.add('hidden');
            document.getElementById('calledListContainer').classList.add('hidden');
            toggleBtn.textContent = "View Called List";
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
            wheel.innerHTML = `<div class="absolute inset-0 flex items-center justify-center text-red-500 font-bold text-xs text-center p-4">${err.message}</div>`;
        }
    },

    closeModal: () => {
        if (CourseRecitation.isSpinning) return;
        document.getElementById('recitationModal').classList.add('hidden');
        document.getElementById('recitationResult').classList.add('hidden');
        document.getElementById('wheelContainer').classList.remove('hidden');
        document.getElementById('spinWheelBtn').classList.remove('hidden');
        document.getElementById('calledListContainer').classList.add('hidden');
    },

    resetToWheel: () => {
        document.getElementById('recitationResult').classList.add('hidden');
        document.getElementById('wheelContainer').classList.remove('hidden');
        document.getElementById('spinWheelBtn').classList.remove('hidden');
        CourseRecitation.drawWheel();
    },

    updateCalledListUI: () => {
        const calledToday = readCalled(getCalledKey());

        const contentContainer = document.getElementById('calledStudentsListContent');
        if (!contentContainer) return;

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
            input.disabled = true;
            hint.textContent = 'This student is not in the class list on screen.';
            return;
        }

        const current = parseInt(rowInput.value, 10) || 0;
        CourseRecitation.shownPoints = current;
        input.disabled = false;
        input.value = String(current);

        const date = document.getElementById('attendanceDate')?.value;
        hint.textContent = (date ? `Points for ${date}. ` : '') + 'Changes show in the student list. Press Save Attendance to keep them.';
    },

    // Called when the points box is edited: copies the value into the student list.
    updatePoints: (rawValue) => {
        const userId = CourseRecitation.currentSelectedStudentId;
        if (!userId || rawValue === '') return;

        const value = Math.min(999, Math.max(0, parseInt(rawValue, 10) || 0));
        const rowInput = getStudentRow(userId)?.querySelector('.points-input');
        if (!rowInput) return;

        rowInput.value = String(value);
        // Lets the attendance screen notice the change (unsaved-changes dot, draft saving).
        rowInput.dispatchEvent(new Event('input', { bubbles: true }));

        // Keep the wheel's weighting in step with the edit.
        const student = CourseRecitation.students.find(s => s.User_ID === userId);
        if (student) student.Total_Points = (Number(student.Total_Points) || 0) + (value - CourseRecitation.shownPoints);
        CourseRecitation.shownPoints = value;
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
        wheel.innerHTML = '';
    },

    spin: () => {
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

        document.getElementById('recitationResult').classList.add('hidden');
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

            const avatarSrc = getLoadableAvatarSrc(selectedStudent.Avatar);
            const avatarImg = avatarSrc
                ? `<img src="${safeUrl(avatarSrc)}" class="w-32 h-32 rounded-full object-cover border-4 border-purple-500 mx-auto shadow-md">`
                : `<i class="fa-solid fa-circle-user text-[128px] text-gray-300"></i>`;

            document.getElementById('recitationResultAvatar').innerHTML = avatarImg;
            document.getElementById('recitationResultName').textContent = selectedStudent.Name;

            document.getElementById('wheelContainer').classList.add('hidden');
            document.getElementById('spinWheelBtn').classList.add('hidden');
            document.getElementById('recitationResult').classList.remove('hidden');

            wheel.style.transition = 'none';
            wheel.style.transform = `rotate(${finalRotation % 360}deg)`;
        }, 4000);
    }
};
