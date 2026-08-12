// js/course-recitation.js
import { apiFetch } from './globals.js';
import { getLoadableAvatarSrc } from './components.js';

export const CourseRecitation = {
    students: [],
    isSpinning: false,
    currentSelectedStudentId: null,

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
        const courseId = window.location.hash.replace('#class-', '');
        const today = new Date().toISOString().split('T')[0];
        const calledKey = `student_caller_${courseId}_${today}`;
        
        let calledToday = [];
        try {
            calledToday = JSON.parse(localStorage.getItem(calledKey)) || [];
        } catch(e) {}
        
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
                    <span class="text-xs font-bold text-gray-800">${student.Name}</span>
                    <button type="button" class="remove-called-student text-red-500 hover:text-red-700 text-xs font-bold px-1.5 py-0.5 bg-red-50 hover:bg-red-100 rounded transition" data-user-id="${student.User_ID}">
                        <i class="fa-solid fa-xmark"></i> Remove
                    </button>
                </div>
            `;
        }).join('');
    },

    removeCalledStudent: (userId) => {
        const courseId = window.location.hash.replace('#class-', '');
        const today = new Date().toISOString().split('T')[0];
        const calledKey = `student_caller_${courseId}_${today}`;
        
        let calledToday = [];
        try {
            calledToday = JSON.parse(localStorage.getItem(calledKey)) || [];
        } catch(e) {}
        
        calledToday = calledToday.filter(id => id !== userId);
        localStorage.setItem(calledKey, JSON.stringify(calledToday));
        
        CourseRecitation.updateCalledListUI();
        CourseRecitation.drawWheel();
    },

    resetCalledList: () => {
        const courseId = window.location.hash.replace('#class-', '');
        const today = new Date().toISOString().split('T')[0];
        const calledKey = `student_caller_${courseId}_${today}`;
        
        localStorage.removeItem(calledKey);
        CourseRecitation.updateCalledListUI();
        CourseRecitation.drawWheel();
    },

    drawWheel: () => {
        const wheel = document.getElementById('recitationWheel');
        
        const mode = document.querySelector('input[name="callerMode"]:checked').value;
        const courseId = window.location.hash.replace('#class-', '');
        const today = new Date().toISOString().split('T')[0];
        const calledKey = `student_caller_${courseId}_${today}`;
        
        let calledToday = [];
        try {
            calledToday = JSON.parse(localStorage.getItem(calledKey)) || [];
        } catch(e) {}
        
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

    savePoints: async () => {
        const btn = document.getElementById('saveRecitationPointsBtn');
        const input = document.getElementById('recitationPointsInput');
        const alertBox = document.getElementById('recitationPointsAlert');
        const points = parseInt(input.value);
        
        if (isNaN(points) || points <= 0) return;
        
        const courseId = window.location.hash.replace('#class-', '');
        const dateVal = document.getElementById('attendanceDate').value;
        
        if (!dateVal) {
            alertBox.textContent = "Please select an attendance date in the roster.";
            alertBox.className = "mt-2 text-xs font-bold text-center w-full rounded py-1 bg-red-100 text-red-700 block";
            return;
        }

        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

        try {
            await apiFetch('/api/add-participation-points', {
                method: 'POST',
                body: JSON.stringify({ courseId, studentId: CourseRecitation.currentSelectedStudentId, date: dateVal, points })
            });

            const row = document.querySelector(`.student-row[data-student-id="${CourseRecitation.currentSelectedStudentId}"]`);
            if (row) {
                const rosterInput = row.querySelector('.points-input');
                if (rosterInput) {
                    const currentVal = parseInt(rosterInput.value) || 0;
                    rosterInput.value = currentVal + points;
                }
                
                const draftStr = localStorage.getItem(`attendance_draft_${courseId}_${dateVal}`);
                if (draftStr) {
                     const draft = JSON.parse(draftStr);
                     if (draft[CourseRecitation.currentSelectedStudentId]) {
                         draft[CourseRecitation.currentSelectedStudentId].points = parseInt(draft[CourseRecitation.currentSelectedStudentId].points || 0) + points;
                         localStorage.setItem(`attendance_draft_${courseId}_${dateVal}`, JSON.stringify(draft));
                     }
                }
            }
            
            const studentInPool = CourseRecitation.students.find(s => s.User_ID === CourseRecitation.currentSelectedStudentId);
            if (studentInPool) {
                studentInPool.Total_Points = (studentInPool.Total_Points || 0) + points;
            }

            alertBox.textContent = "Points added!";
            alertBox.className = "mt-2 text-xs font-bold text-center w-full rounded py-1 bg-green-100 text-green-700 block fade-in";
            input.value = '';
            setTimeout(() => { alertBox.classList.add('hidden'); }, 2000);
        } catch (err) {
            alertBox.textContent = err.message;
            alertBox.className = "mt-2 text-xs font-bold text-center w-full rounded py-1 bg-red-100 text-red-700 block fade-in";
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    },

    spin: () => {
        const mode = document.querySelector('input[name="callerMode"]:checked').value;
        const courseId = window.location.hash.replace('#class-', '');
        const today = new Date().toISOString().split('T')[0];
        const calledKey = `student_caller_${courseId}_${today}`;
        
        let calledToday = [];
        if (mode === '2') {
            try { calledToday = JSON.parse(localStorage.getItem(calledKey)) || []; } catch(e) {}
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
            
            const pointsInput = document.getElementById('recitationPointsInput');
            if (pointsInput) pointsInput.value = '';
            
            const pointsAlert = document.getElementById('recitationPointsAlert');
            if (pointsAlert) pointsAlert.classList.add('hidden');
            
            const avatarSrc = getLoadableAvatarSrc(selectedStudent.Avatar);
            const avatarImg = avatarSrc 
                ? `<img src="${avatarSrc}" class="w-32 h-32 rounded-full object-cover border-4 border-purple-500 mx-auto shadow-md">` 
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
