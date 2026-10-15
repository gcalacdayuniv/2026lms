// js/auth.js
import { apiFetch, AppState } from './globals.js';
import { getLoadableAvatarSrc } from './components-utils.js';
import { CourseExam } from './course-exam.js';

export const AuthModule = {
    usersList: [],
    currentImageGallery: [],
    currentImageIndex: 0,
    accessibleExams: [],
    accessibleStudent: null,
    accessibleCredentials: null,

    init: () => {
        document.addEventListener('submit', AuthModule.handleForms);
        document.addEventListener('click', AuthModule.handleClicks);
        document.addEventListener('input', AuthModule.handleInputs);
        document.addEventListener('change', AuthModule.handleChanges);
    },

    speak: (text) => {
        if (!('speechSynthesis' in window)) return;
        try {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 0.98;
            utterance.pitch = 1;
            window.speechSynthesis.speak(utterance);
        } catch (e) {
            console.error('Speech synthesis error:', e);
        }
    },

    loadStudentAccessibleExams: async () => {
        const idInput = document.getElementById('loginIdentifier');
        const pwInput = document.getElementById('loginPassword');
        const errorDiv = document.getElementById('loginError');
        const listDiv = document.getElementById('accessibleExamPortalList');
        const btn = document.getElementById('enterExamLoginBtn');

        if (!idInput || !pwInput || !listDiv) return;

        const identifier = idInput.value.trim();
        const password = pwInput.value;

        errorDiv.classList.add('hidden');

        if (!identifier || !password) {
            const msg = "Please enter your Username or Student Number and your Password first, then press Enter Assigned Exam.";
            errorDiv.textContent = msg;
            errorDiv.classList.remove('hidden');
            AuthModule.speak(msg);
            if (!identifier) idInput.focus();
            else pwInput.focus();
            return;
        }

        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Checking Assigned Exams...';
        AuthModule.speak("Checking your assigned exams. Please wait.");

        try {
            const data = await apiFetch('/api/student-accessible-exams', {
                method: 'POST',
                body: JSON.stringify({ identifier, password })
            });

            AuthModule.accessibleStudent = data.student;
            AuthModule.accessibleExams = data.exams || [];
            AuthModule.accessibleCredentials = { identifier, password };

            listDiv.classList.remove('hidden');

            if (AuthModule.accessibleExams.length === 0) {
                const emptyMsg = `Hello ${data.student.Name}. You currently have no open exams assigned to you.`;
                listDiv.innerHTML = `
                    <div class="p-3 bg-indigo-900 border border-indigo-700 rounded-lg text-xs text-yellow-200 font-bold text-center">
                        ${emptyMsg}
                    </div>
                `;
                AuthModule.speak(emptyMsg);
                return;
            }

            const pendingExams = AuthModule.accessibleExams.filter(e => e.status !== 'Completed');
            let speechSummary = `Hello ${data.student.Name}. You have ${AuthModule.accessibleExams.length} assigned exam${AuthModule.accessibleExams.length > 1 ? 's' : ''}. `;
            if (pendingExams.length > 0) {
                speechSummary += `Select an exam button below to start. `;
                pendingExams.forEach((ex, idx) => {
                    speechSummary += `Option ${idx + 1}: ${ex.examTitle} for ${ex.courseCode}. `;
                });
            } else {
                speechSummary += `All assigned exams have already been completed.`;
            }
            AuthModule.speak(speechSummary);

            listDiv.innerHTML = `
                <div class="text-xs font-bold text-yellow-300 mb-2">
                    Welcome, ${data.student.Name} (${data.student.eye_condition || 'Student'})
                </div>
                ${AuthModule.accessibleExams.map((ex) => {
                    const isDone = ex.status === 'Completed';
                    return `
                        <div class="p-3 rounded-lg border ${isDone ? 'bg-indigo-900/60 border-indigo-700' : 'bg-indigo-900 border-yellow-400'} flex flex-col gap-2">
                            <div>
                                <div class="text-sm font-black text-white">${ex.examTitle}</div>
                                <div class="text-[11px] text-indigo-200 font-medium">${ex.courseCode} - ${ex.courseTitle} (${ex.term})</div>
                                <div class="text-[10px] text-yellow-300 mt-0.5">
                                    Questions: ${ex.regularCount}${ex.bonusCount > 0 ? ` + ${ex.bonusCount} Bonus` : ''} | Max Score: ${ex.maxScore}
                                </div>
                            </div>
                            ${isDone ? `
                                <div class="w-full py-2 px-3 bg-green-700 text-white font-black text-xs rounded text-center">
                                    <i class="fa-solid fa-circle-check mr-1"></i> Submitted - Score: ${ex.finalScore} / ${ex.maxScore}
                                </div>
                            ` : `
                                <button type="button" class="start-accessible-exam-btn w-full py-2.5 px-3 bg-yellow-400 hover:bg-yellow-300 text-gray-950 font-black text-xs rounded-md shadow transition flex items-center justify-center focus:outline-none focus:ring-4 focus:ring-white" data-assignment-id="${ex.assignmentId}">
                                    <i class="fa-solid fa-play mr-2"></i> Start Exam: ${ex.examTitle}
                                </button>
                            `}
                        </div>
                    `;
                }).join('')}
            `;
        } catch (err) {
            errorDiv.textContent = err.message;
            errorDiv.classList.remove('hidden');
            AuthModule.speak("Error: " + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    },

    handleForms: async (e) => {
        if (e.target.id === 'loginForm') {
            e.preventDefault();
            const btn = document.getElementById('loginBtn') || e.target.querySelector('button[type="submit"]');
            const errorDiv = document.getElementById('loginError');
            errorDiv.classList.add('hidden');
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading...';

            try {
                const data = await apiFetch('/api/login', {
                    method: 'POST',
                    body: JSON.stringify({
                        identifier: document.getElementById('loginId')?.value.trim() || document.getElementById('loginIdentifier')?.value.trim(),
                        password: document.getElementById('loginPassword').value
                    })
                });
                
                AppState.setUser(data.user);
                localStorage.setItem('user', JSON.stringify(data.user));
                window.location.hash = 'dashboard';
            } catch (err) {
                errorDiv.textContent = err.message;
                errorDiv.classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btn.innerHTML = 'Sign In to Dashboard';
            }
        }

        if (e.target.id === 'registerForm') {
            e.preventDefault();
            const btn = document.getElementById('regSubmitBtn');
            const errorDiv = document.getElementById('registerError');
            const successDiv = document.getElementById('registerSuccess');
            const originalBtnText = btn.innerHTML;
            
            errorDiv.classList.add('hidden');
            successDiv.classList.add('hidden');
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating Account...';

            const pw = document.getElementById('regPassword').value;

            try {
                const payload = {
                    username: document.getElementById('regUsername').value.trim(),
                    password: pw,
                    name: `${document.getElementById('regLastName').value.trim()}, ${document.getElementById('regGivenName').value.trim()} ${document.getElementById('regSuffix').value.trim()}`.trim(),
                    email: document.getElementById('regEmail').value.trim(),
                    contact_number: document.getElementById('regContact').value.trim(),
                    student_number: document.getElementById('regStudentNo').value.trim(),
                    course: document.getElementById('regCourse').value,
                    year: document.getElementById('regYear').value,
                    section: document.getElementById('regSection').value.trim().toUpperCase(),
                    eye_condition: document.getElementById('regEyeCondition').value,
                    avatarBase64: null
                };

                const fileInput = document.getElementById('regFileInput');
                const cameraInput = document.getElementById('regCameraInput');
                let activeFile = null;
                
                if (fileInput && fileInput.files.length > 0) activeFile = fileInput.files[0];
                if (cameraInput && cameraInput.files.length > 0) activeFile = cameraInput.files[0];

                if (activeFile) {
                    payload.avatarBase64 = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result.split(',')[1]);
                        reader.onerror = error => reject(error);
                        reader.readAsDataURL(activeFile);
                    });
                } else {
                     throw new Error("Profile photo is required.");
                }

                await apiFetch('/api/register', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });

                successDiv.textContent = "Registration successful! You can now log in once approved.";
                successDiv.classList.remove('hidden');
                e.target.reset();
                document.getElementById('avatarPreview').classList.add('hidden');
                setTimeout(() => window.location.hash = 'login', 3000);
            } catch (err) {
                errorDiv.textContent = err.message;
                errorDiv.classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalBtnText;
            }
        }

        if (e.target.id === 'updateDetailsForm') {
            e.preventDefault();
            const btn = document.getElementById('udSubmitBtn');
            const errorDiv = document.getElementById('udError');
            const successDiv = document.getElementById('udSuccess');
            
            errorDiv.classList.add('hidden');
            successDiv.classList.add('hidden');
            
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
            
            const givenName = document.getElementById('udGivenName').value.trim();
            const lastName = document.getElementById('udLastName').value.trim();
            const suffix = document.getElementById('udSuffix').value.trim();
            const formattedName = `${lastName}, ${givenName} ${suffix}`.trim();

            const payload = {
                userId: AppState.user.User_ID,
                password: document.getElementById('udPassword').value,
                name: formattedName,
                username: document.getElementById('udUsername').value.trim(),
                email: document.getElementById('udEmail').value.trim(),
                contact: document.getElementById('udContact').value.trim(),
                studentNumber: document.getElementById('udStudentNumber').value.trim()
            };

            try {
                await apiFetch('/api/update-details', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                
                AppState.user.Name = payload.name;
                AppState.user.Username = payload.username;
                AppState.user.Email = payload.email;
                AppState.user.Contact_Number = payload.contact;
                AppState.user.Student_Number = payload.studentNumber;
                
                localStorage.setItem('user', JSON.stringify(AppState.user));
                localStorage.setItem('portal_user', JSON.stringify(AppState.user));
                
                successDiv.textContent = "Details updated successfully.";
                successDiv.classList.remove('hidden');
                document.getElementById('udPassword').value = '';
                
                setTimeout(() => {
                    successDiv.classList.add('hidden');
                    document.getElementById('udModal').classList.add('hidden');
                    window.dispatchEvent(new Event('hashchange'));
                }, 1500);
            } catch (err) {
                errorDiv.textContent = err.message;
                errorDiv.classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btn.innerHTML = 'Save Details';
            }
        }

        if (e.target.id === 'changePasswordForm') {
            e.preventDefault();
            const btn = document.getElementById('cpSubmitBtn');
            const errorDiv = document.getElementById('cpError');
            const successDiv = document.getElementById('cpSuccess');
            
            errorDiv.classList.add('hidden');
            successDiv.classList.add('hidden');
            
            const current = document.getElementById('cpCurrent').value;
            const newPw = document.getElementById('cpNew').value;
            const repeatPw = document.getElementById('cpRepeat').value;
            
            if (newPw !== repeatPw) {
                errorDiv.textContent = "New passwords do not match.";
                errorDiv.classList.remove('hidden');
                return;
            }
            
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
            
            try {
                await apiFetch('/api/change-password', {
                    method: 'POST',
                    body: JSON.stringify({ userId: AppState.user.User_ID, currentPassword: current, newPassword: newPw })
                });
                successDiv.textContent = "Password updated securely.";
                successDiv.classList.remove('hidden');
                e.target.reset();
                setTimeout(() => {
                    successDiv.classList.add('hidden');
                    document.getElementById('cpModal').classList.add('hidden');
                }, 2000);
            } catch (err) {
                errorDiv.textContent = err.message;
                errorDiv.classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btn.innerHTML = 'Update Password';
            }
        }
    },

    handleInputs: (e) => {
        if (e.target.id === 'regStudentNo' || e.target.id === 'udStudentNumber') {
            let val = e.target.value.replace(/\D/g, '');
            if (val.length > 2) {
                val = val.substring(0, 2) + '-' + val.substring(2, 6);
            }
            e.target.value = val.substring(0, 7);
        }
        
        if (e.target.id === 'muSearchInput') {
            AuthModule.renderManageUsers();
        }
    },

    handleChanges: async (e) => {
        if (e.target.id === 'muFilterStatus') {
            AuthModule.renderManageUsers();
        }

        if (e.target.id === 'regFileInput' || e.target.id === 'regCameraInput') {
             const file = e.target.files[0];
             if (file) {
                 const reader = new FileReader();
                 reader.onload = (e) => {
                     const preview = document.getElementById('avatarPreview');
                     preview.src = e.target.result;
                     preview.classList.remove('hidden');
                 };
                 reader.readAsDataURL(file);
             }
        }
        
        if (e.target.classList.contains('mu-status-select')) {
            const studentId = e.target.dataset.userId;
            const status = e.target.value;
            
            e.target.className = `mu-status-select w-full sm:w-32 px-2 py-1.5 text-xs font-bold border rounded outline-none cursor-pointer transition ${
                status === 'Active' ? 'text-green-600 border-green-300 bg-green-50' : 
                status === 'Inactive' ? 'text-gray-600 border-gray-300 bg-gray-50' :
                status === 'Suspended' ? 'text-orange-600 border-orange-300 bg-orange-50' :
                status === 'UD' ? 'text-red-600 border-red-300 bg-red-50' :
                status === 'Dropped' ? 'text-red-800 border-red-400 bg-red-100' : 'text-gray-600 border-gray-300 bg-gray-50'
            }`;

            try {
                await apiFetch('/api/update-user-status', {
                    method: 'POST',
                    body: JSON.stringify({ studentId, status })
                });
                
                const user = AuthModule.usersList.find(u => u.User_ID === studentId);
                if(user) user.account_status = status;
                
            } catch (err) {
                alert('Failed to update status: ' + err.message);
            }
        }
    },

    updateGlobalImageUI: () => {
        const item = AuthModule.currentImageGallery[AuthModule.currentImageIndex];
        if (!item) return;

        document.getElementById('globalImageSrc').src = item.src;
        document.getElementById('giName').textContent = item.name;
        document.getElementById('giInfo').textContent = item.info;
        
        document.getElementById('globalImageDetails').classList.remove('hidden');
        
        const prevBtn = document.getElementById('prevGlobalImageBtn');
        const nextBtn = document.getElementById('nextGlobalImageBtn');
        
        if (AuthModule.currentImageGallery.length > 1) {
            if (AuthModule.currentImageIndex > 0) prevBtn.classList.remove('hidden');
            else prevBtn.classList.add('hidden');
            
            if (AuthModule.currentImageIndex < AuthModule.currentImageGallery.length - 1) nextBtn.classList.remove('hidden');
            else nextBtn.classList.add('hidden');
        } else {
            prevBtn.classList.add('hidden');
            nextBtn.classList.add('hidden');
        }
    },

    handleClicks: async (e) => {
        if (e.target.closest('#readLoginScreenBtn')) {
            AuthModule.speak("Welcome to the Online Portal Accessible Exam Login. Please enter your Username or Student Number in the first text box, and your Password in the second text box. Then press the Enter Assigned Exam button to hear and start your available exams.");
        }

        if (e.target.closest('#enterExamLoginBtn')) {
            await AuthModule.loadStudentAccessibleExams();
        }

        if (e.target.closest('.start-accessible-exam-btn')) {
            const btn = e.target.closest('.start-accessible-exam-btn');
            const assignmentId = btn.dataset.assignmentId;
            const examObj = AuthModule.accessibleExams.find(ex => ex.assignmentId === assignmentId);
            if (examObj && AuthModule.accessibleStudent && CourseExam.startAccessibleExam) {
                CourseExam.startAccessibleExam(examObj, AuthModule.accessibleStudent, () => {
                    AuthModule.loadStudentAccessibleExams();
                });
            }
        }

        if (e.target.closest('#toggleLoginPassword')) {
            const input = document.getElementById('loginPassword');
            const icon = e.target.closest('#toggleLoginPassword').querySelector('i');
            if (input.type === 'password') {
                input.type = 'text';
                icon.classList.replace('fa-eye', 'fa-eye-slash');
            } else {
                input.type = 'password';
                icon.classList.replace('fa-eye-slash', 'fa-eye');
            }
        }
        
        if (e.target.closest('#btnCamera')) {
             document.getElementById('regCameraInput').click();
        }
        
        if (e.target.closest('#btnFile')) {
             document.getElementById('regFileInput').click();
        }

        if (e.target.closest('#profileToggleBtn')) {
            document.getElementById('profilePanelOverlay').classList.remove('hidden');
            const panel = document.getElementById('profilePanel');
            panel.classList.remove('translate-x-full');
            panel.classList.add('translate-x-0');
        }

        if (e.target.closest('#closeProfilePanel') || e.target.id === 'profilePanelOverlay') {
            document.getElementById('profilePanelOverlay').classList.add('hidden');
            const panel = document.getElementById('profilePanel');
            panel.classList.add('translate-x-full');
            panel.classList.remove('translate-x-0');
        }

        if (e.target.closest('#logoutBtn')) {
            AppState.setUser(null);
            localStorage.removeItem('user');
            window.location.hash = 'login';
        }

        if (e.target.closest('#openUdModalBtn')) {
            document.getElementById('profilePanelOverlay').classList.add('hidden');
            document.getElementById('profilePanel').classList.add('translate-x-full');
            document.getElementById('profilePanel').classList.remove('translate-x-0');
            document.getElementById('udModal').classList.remove('hidden');
        }

        if (e.target.closest('#closeUdModalBtn') || e.target.id === 'udModalOverlay') {
            document.getElementById('udModal').classList.add('hidden');
            document.getElementById('updateDetailsForm').reset();
            document.getElementById('udError').classList.add('hidden');
            document.getElementById('udSuccess').classList.add('hidden');
        }

        if (e.target.closest('#openCpModalBtn')) {
            document.getElementById('profilePanelOverlay').classList.add('hidden');
            document.getElementById('profilePanel').classList.add('translate-x-full');
            document.getElementById('profilePanel').classList.remove('translate-x-0');
            document.getElementById('cpModal').classList.remove('hidden');
        }

        if (e.target.closest('#closeCpModalBtn') || e.target.id === 'cpModalOverlay') {
            document.getElementById('cpModal').classList.add('hidden');
            document.getElementById('changePasswordForm').reset();
            document.getElementById('cpError').classList.add('hidden');
            document.getElementById('cpSuccess').classList.add('hidden');
        }
        
        if (e.target.closest('#openCreateCourseModalBtn')) {
            document.getElementById('profilePanelOverlay').classList.add('hidden');
            document.getElementById('profilePanel').classList.add('translate-x-full');
            document.getElementById('profilePanel').classList.remove('translate-x-0');
            document.getElementById('ccModal').classList.remove('hidden');
        }

        if (e.target.closest('#closeCcModalBtn') || e.target.id === 'ccModalOverlay') {
            document.getElementById('ccModal').classList.add('hidden');
        }
        
        if (e.target.closest('#openApModalBtn')) {
            document.getElementById('profilePanelOverlay').classList.add('hidden');
            document.getElementById('profilePanel').classList.add('translate-x-full');
            document.getElementById('profilePanel').classList.remove('translate-x-0');
            document.getElementById('apModal').classList.remove('hidden');
        }

        if (e.target.closest('#closeApModalBtn') || e.target.id === 'apModalOverlay') {
            document.getElementById('apModal').classList.add('hidden');
        }

        if (e.target.closest('#openMuModalBtn')) {
            document.getElementById('profilePanelOverlay').classList.add('hidden');
            document.getElementById('profilePanel').classList.add('translate-x-full');
            document.getElementById('profilePanel').classList.remove('translate-x-0');
            document.getElementById('muModal').classList.remove('hidden');
            AuthModule.loadManageUsers();
        }

        if (e.target.closest('#closeMuModalBtn') || e.target.id === 'muModalOverlay') {
            document.getElementById('muModal').classList.add('hidden');
            document.getElementById('muSearchInput').value = '';
            document.getElementById('muFilterStatus').value = '';
        }
        
        if (e.target.closest('.view-avatar-btn')) {
            const clickedBtn = e.target.closest('.view-avatar-btn');
            
            const allAvatars = Array.from(document.querySelectorAll('.view-avatar-btn'));
            AuthModule.currentImageGallery = allAvatars.map(a => ({
                src: a.dataset.src,
                name: a.dataset.name || '',
                info: a.dataset.info || ''
            }));
            
            AuthModule.currentImageIndex = AuthModule.currentImageGallery.findIndex(item => item.src === clickedBtn.dataset.src);
            
            if (AuthModule.currentImageIndex === -1) {
                AuthModule.currentImageIndex = 0;
            }

            AuthModule.updateGlobalImageUI();
            document.getElementById('globalImageModal').classList.remove('hidden');
        }

        if (e.target.closest('#nextGlobalImageBtn')) {
            if (AuthModule.currentImageIndex < AuthModule.currentImageGallery.length - 1) {
                AuthModule.currentImageIndex++;
                AuthModule.updateGlobalImageUI();
            }
        }

        if (e.target.closest('#prevGlobalImageBtn')) {
            if (AuthModule.currentImageIndex > 0) {
                AuthModule.currentImageIndex--;
                AuthModule.updateGlobalImageUI();
            }
        }

        if (e.target.closest('#closeGlobalImageBtn') || e.target.id === 'closeGlobalImageBg') {
            const modal = document.getElementById('globalImageModal');
            if (modal) {
                modal.classList.add('hidden');
                document.getElementById('globalImageSrc').src = '';
                AuthModule.currentImageGallery = [];
                AuthModule.currentImageIndex = 0;
            }
        }
    },

    loadPrograms: async () => {
        const courseSelect = document.getElementById('regCourse');
        if (!courseSelect) return;
        
        try {
            const ts = new Date().getTime();
            const data = await apiFetch(`/api/programs?_t=${ts}`);
            
            if (data.programs && data.programs.length > 0) {
                courseSelect.innerHTML = '<option value="" disabled selected>Select Course</option>' + 
                    data.programs.map(p => `<option value="${p.ProgramCode}">${p.ProgramCode}</option>`).join('');
            } else {
                courseSelect.innerHTML = '<option value="" disabled selected>No courses available</option>';
            }
        } catch (err) {
            courseSelect.innerHTML = '<option value="" disabled selected>Error loading courses</option>';
            console.error('Failed to load programs:', err);
        }
    },

    loadManageUsers: async () => {
        const list = document.getElementById('manageUsersList');
        if (!list) return;
        list.innerHTML = '<div class="text-center py-10"><i class="fa-solid fa-spinner fa-spin text-blue-600 text-3xl"></i></div>';
        try {
            const ts = new Date().getTime();
            const data = await apiFetch(`/api/users?_t=${ts}`);
            AuthModule.usersList = data.users;
            AuthModule.renderManageUsers();
        } catch(err) {
            list.innerHTML = `<div class="text-red-500 p-4 text-center font-bold bg-red-50 border border-red-200 rounded">${err.message}</div>`;
        }
    },

    renderManageUsers: () => {
        const list = document.getElementById('manageUsersList');
        const search = document.getElementById('muSearchInput')?.value.toLowerCase() || '';
        const filter = document.getElementById('muFilterStatus')?.value || '';
        
        const filtered = AuthModule.usersList.filter(u => {
            const matchSearch = u.Name.toLowerCase().includes(search) || (u.Student_Number && u.Student_Number.toLowerCase().includes(search));
            const matchFilter = filter === '' || u.account_status === filter;
            return matchSearch && matchFilter;
        });
        
        if(filtered.length === 0) {
            list.innerHTML = '<div class="text-gray-500 p-8 text-center text-sm font-medium">No users found.</div>';
            return;
        }
        
        list.innerHTML = filtered.map(u => {
            const avatarSrc = u.Avatar ? getLoadableAvatarSrc(u.Avatar) : null;
            const avatarImg = avatarSrc 
                ? `<img src="${avatarSrc}" class="w-12 h-12 sm:w-14 sm:h-14 rounded-full object-cover border border-gray-200 cursor-pointer view-avatar-btn hover:opacity-80 transition shadow-sm" data-src="${avatarSrc}" data-name="${u.Name}" data-info="${u.course || ''} ${u.year || ''} ${u.section || ''}">` 
                : `<i class="fa-solid fa-circle-user text-[48px] sm:text-[56px] text-gray-300"></i>`;
                
            const regDate = u.registration_timestamp ? new Date(u.registration_timestamp + 'Z').toLocaleString() : 'N/A';
            const disabilityBadge = u.eye_condition === 'Legally Blind'
                ? `<span class="ml-1 text-[9px] bg-amber-100 text-amber-900 px-2 py-0.5 rounded border border-amber-300 font-black uppercase"><i class="fa-solid fa-universal-access mr-1"></i>Legally Blind</span>`
                : '';
            
            return `
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 sm:p-4 bg-white border border-gray-200 rounded-lg shadow-sm hover:border-blue-300 transition gap-4">
                <div class="flex items-center gap-4 w-full sm:w-auto overflow-hidden">
                    <div class="flex-shrink-0">
                        ${avatarImg}
                    </div>
                    <div class="overflow-hidden min-w-0">
                        <div class="font-black text-gray-800 text-sm sm:text-base truncate">${u.Name} <span class="ml-2 text-[9px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200 uppercase tracking-widest align-middle">${u.role}</span>${disabilityBadge}</div>
                        
                        <div class="text-[11px] sm:text-xs text-gray-600 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span class="font-bold text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">${u.Student_Number || 'N/A'}</span>
                            <a href="mailto:${u.Email || ''}" class="text-blue-600 hover:underline truncate bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 transition inline-flex items-center" title="Send Email"><i class="fa-regular fa-envelope mr-1.5"></i>${u.Email || 'No Email Provided'}</a>
                        </div>
                        
                        <div class="text-[10px] sm:text-[11px] text-gray-500 mt-1.5 truncate"><i class="fa-solid fa-graduation-cap mr-1.5 text-gray-400"></i>${u.course || 'N/A'} ${u.year || ''} ${u.section || ''}</div>
                        <div class="text-[9px] sm:text-[10px] text-gray-400 font-mono mt-1 uppercase tracking-wider"><i class="fa-regular fa-clock mr-1"></i>Reg: ${regDate}</div>
                    </div>
                </div>
                <div class="w-full sm:w-auto flex-shrink-0 mt-2 sm:mt-0 pt-3 sm:pt-0 border-t sm:border-t-0 border-gray-100">
                    <label class="block sm:hidden text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Account Status</label>
                    <select class="mu-status-select w-full sm:w-36 px-3 py-2 text-xs sm:text-sm font-bold border rounded-md outline-none cursor-pointer transition shadow-sm ${
                        u.account_status === 'Active' ? 'text-green-700 border-green-300 bg-green-50 focus:ring-green-500' : 
                        u.account_status === 'Inactive' ? 'text-gray-600 border-gray-300 bg-gray-50 focus:ring-gray-500' :
                        u.account_status === 'Suspended' ? 'text-orange-700 border-orange-300 bg-orange-50 focus:ring-orange-500' :
                        u.account_status === 'UD' ? 'text-red-600 border-red-300 bg-red-50 focus:ring-red-500' :
                        u.account_status === 'Dropped' ? 'text-red-800 border-red-400 bg-red-100 focus:ring-red-500' : 'text-gray-600 border-gray-300 bg-gray-50'
                    }" data-user-id="${u.User_ID}">
                        <option value="Active" ${u.account_status === 'Active' ? 'selected' : ''}>Active</option>
                        <option value="Inactive" ${u.account_status === 'Inactive' ? 'selected' : ''}>Inactive</option>
                        <option value="Suspended" ${u.account_status === 'Suspended' ? 'selected' : ''}>Suspended</option>
                        <option value="UD" ${u.account_status === 'UD' ? 'selected' : ''}>UD</option>
                        <option value="Dropped" ${u.account_status === 'Dropped' ? 'selected' : ''}>Dropped</option>
                    </select>
                </div>
            </div>
            `;
        }).join('');
    }
};
