// js/course-recitation.js
import { apiFetch } from './globals.js';
import { getLoadableAvatarSrc } from './components.js';

export const CourseRecitation = {
    students: [],
    isSpinning: false,

    openModal: async (courseId) => {
        document.getElementById('recitationModal').classList.remove('hidden');
        document.getElementById('recitationResult').classList.add('hidden');
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
    },

    drawWheel: () => {
        const wheel = document.getElementById('recitationWheel');
        const total = CourseRecitation.students.length;
        if (total === 0) {
            wheel.innerHTML = '<div class="absolute inset-0 flex items-center justify-center text-gray-500 font-bold">No students found</div>';
            return;
        }

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
        if (CourseRecitation.isSpinning || CourseRecitation.students.length === 0) return;
        CourseRecitation.isSpinning = true;
        
        document.getElementById('recitationResult').classList.add('hidden');
        document.getElementById('spinWheelBtn').disabled = true;

        const students = CourseRecitation.students;
        let maxPoints = 0;
        students.forEach(s => { if(s.Total_Points > maxPoints) maxPoints = s.Total_Points; });
        
        let totalWeight = 0;
        const weightedStudents = students.map(s => {
            const weight = (maxPoints - s.Total_Points) + 1;
            totalWeight += weight;
            return { ...s, weight };
        });

        let randomVal = Math.random() * totalWeight;
        let selectedIndex = 0;
        
        for(let i = 0; i < weightedStudents.length; i++) {
            randomVal -= weightedStudents[i].weight;
            if(randomVal <= 0) {
                selectedIndex = i;
                break;
            }
        }

        const selectedStudent = students[selectedIndex];
        const totalSlices = students.length;
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
            
            const avatarSrc = getLoadableAvatarSrc(selectedStudent.Avatar);
            const avatarImg = avatarSrc 
                ? `<img src="${avatarSrc}" class="w-24 h-24 rounded-full object-cover border-4 border-purple-500 mx-auto shadow-md">` 
                : `<i class="fa-solid fa-circle-user text-[96px] text-gray-300"></i>`;
            
            document.getElementById('recitationResultAvatar').innerHTML = avatarImg;
            document.getElementById('recitationResultName').textContent = selectedStudent.Name;
            document.getElementById('recitationResultPoints').textContent = `Total Points: ${selectedStudent.Total_Points}`;
            
            document.getElementById('recitationResult').classList.remove('hidden');
            
            wheel.style.transition = 'none';
            wheel.style.transform = `rotate(${finalRotation % 360}deg)`;
        }, 4000);
    }
};
