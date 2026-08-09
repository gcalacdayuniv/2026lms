// js/course-recitation.js
import { apiFetch } from './globals.js';
import { getLoadableAvatarSrc } from './components.js';

export const CourseRecitation = {
    students: [],
    isSpinning: false,

    openModal: async (courseId) => {
        document.getElementById('recitationModal').classList.remove('hidden');
        document.getElementById('recitationResult').classList.add('hidden');
        document.getElementById('wheelContainer').classList.remove('hidden');
        document.getElementById('spinWheelBtn').classList.remove('hidden');
        document.getElementById('spinWheelBtn').disabled = false;
        
        const wheel = document.getElementById('recitationWheel');
        wheel.style.transform = `rotate(0deg)`;
        wheel.innerHTML = '<div class="absolute inset-0 flex items-center justify-center text-gray-500 font-bold"><i class="fa-solid fa-spinner fa-spin text-3xl"></i></div>';
        
        try {
            const data = await apiFetch(`/api/recitation-pool?courseId=${courseId}`);
            CourseRecitation.students = data.students || [];
            CourseRecitation.drawWheel();
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
    },

    resetToWheel: () => {
        document.getElementById('recitationResult').classList.add('hidden');
        document.getElementById('wheelContainer').classList.remove('hidden');
        document.getElementById('spinWheelBtn').classList.remove('hidden');
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
            }
            
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
