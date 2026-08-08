// js/auth.js
import { apiFetch, AppState } from './globals.js';
import { getLoadableAvatarSrc } from './components.js';

let currentImageIndex = -1;
let imageElements = [];

export const AuthModule = {
    allUsersData: [],
    
    init: () => {
        document.addEventListener('submit', AuthModule.handleForms);
        document.addEventListener('click', AuthModule.handleClicks);
        document.addEventListener('change', AuthModule.handleChanges);
        document.addEventListener('input', AuthModule.handleInput);
        document.addEventListener('keydown', AuthModule.handleKeydown);
    },

    loadPrograms: async () => {
        const select = document.getElementById('regCourse');
        if (!select) return;
        try {
            const data = await apiFetch('/api/programs');
            select.innerHTML = '<option value="" disabled selected>Select Course</option>' + 
                data.programs.map(p => `<option value="${p.ProgramCode}">${p.ProgramCode}</option>`).join('');
        } catch (e) {
            select.innerHTML = '<option value="" disabled>Error loading courses</option>';
        }
    },

    handleForms: async (e) => {
        if (e.target.id === 'loginForm') {
            e.preventDefault();
            await AuthModule.login();
        }
        if (e.target.id === 'registerForm') {
            e.preventDefault();
            await AuthModule.register();
        }
        if (e.target.id === 'changePasswordForm') {
            e.preventDefault();
            await AuthModule.changePassword();
        }
    },

    handleClicks: (e) => {
        if (e.target.closest('#logoutBtn')) {
            AuthModule.logout();
        }
        if (e.target.closest('#btnCamera')) {
            document.getElementById('regCameraInput').click();
        }
        if (e.target.closest('#btnFile')) {
            document.getElementById('regFileInput').click();
        }
        
        // Login Password Toggle
        if (e.target.closest('#toggleLoginPassword')) {
            const pwdInput = document.getElementById('loginPassword');
            const eyeIcon = document.getElementById('loginPasswordEye');
            if (pwdInput && eyeIcon) {
                if (pwdInput.type === 'password') {
                    pwdInput.type = 'text';
                    eyeIcon.classList.remove('fa-eye');
                    eyeIcon.classList.add('fa-eye-slash');
                } else {
                    pwdInput.type = 'password';
                    eyeIcon.classList.remove('fa-eye-slash');
                    eyeIcon.classList.add('fa-eye');
                }
            }
        }
        
        // Sliding Panel Toggle Logic
        if (e.target.closest('#profileToggleBtn')) {
            const panel = document.getElementById('profilePanel');
            const overlay = document.getElementById('profilePanelOverlay');
            if (panel && overlay) {
                panel.classList.remove('translate-x-full');
                overlay.classList.remove('hidden');
            }
        }
        
        if (e.target.closest('#closeProfilePanel') || e.target.id === 'profilePanelOverlay') {
            const panel = document.getElementById('profilePanel');
            const overlay = document.getElementById('profilePanelOverlay');
            if (panel && overlay) {
                panel.classList.add('translate-x-full');
                overlay.classList.add('hidden');
            }
        }

        // Change Password Modal Toggle Logic
        if (e.target.closest('#openCpModalBtn')) {
            document.getElementById('cpModal').classList.remove('hidden');
            const panel = document.getElementById('profilePanel');
            const overlay = document.getElementById('profilePanelOverlay');
            if (panel && overlay) {
                panel.classList.add('translate-x-full');
                overlay.classList.add('hidden');
            }
        }
        if (e.target.closest('#closeCpModalBtn') || e.target.id === 'cpModalOverlay') {
            document.getElementById('cpModal').classList.add('hidden');
            document.getElementById('changePasswordForm').reset();
            document.getElementById('cpError').classList.add('hidden');
            document.getElementById('cpSuccess').classList.add('hidden');
        }

        // Create Course Modal Toggle Logic
        if (e.target.closest('#openCreateCourseModalBtn')) {
            document.getElementById('ccModal').classList.remove('hidden');
            const panel = document.getElementById('profilePanel');
            const overlay = document.getElementById('profilePanelOverlay');
            if (panel && overlay) {
                panel.classList.add('translate-x-full');
                overlay.classList.add('hidden');
            }
        }
        if (e.target.closest('#closeCcModalBtn') || e.target.id === 'ccModalOverlay') {
            document.getElementById('ccModal').classList.add('hidden');
            document.getElementById('addCourseForm').reset();
            const courseErr = document.getElementById('courseError');
            if(courseErr) courseErr.classList.add('hidden');
        }

        // Add Program Modal Toggle Logic
        if (e.target.closest('#openApModalBtn')) {
            document.getElementById('apModal').classList.remove('hidden');
            const panel = document.getElementById('profilePanel');
            const overlay = document.getElementById('profilePanelOverlay');
            if (panel && overlay) {
                panel.classList.add('translate-x-full');
                overlay.classList.add('hidden');
            }
        }
        if (e.target.closest('#closeApModalBtn') || e.target.id === 'apModalOverlay') {
            document.getElementById('apModal').classList.add('hidden');
            document.getElementById('addProgramForm').reset();
            const err = document.getElementById('programError');
            const succ = document.getElementById('programSuccess');
            if(err) err.classList.add('hidden');
            if(succ) succ.classList.add('hidden');
        }

        // Manage Users Modal Logic
        if (e.target.closest('#openMuModalBtn')) {
            document.getElementById('muModal').classList.remove('hidden');
            const panel = document.getElementById('profilePanel');
            const overlay = document.getElementById('profilePanelOverlay');
            if (panel && overlay) {
                panel.classList.add('translate-x-full');
                overlay.classList.add('hidden');
            }
            AuthModule.loadUsersList();
        }
        if (e.target.closest('#closeMuModalBtn') || e.target.id === 'muModalOverlay') {
            document.getElementById('muModal').classList.add('hidden');
            document.getElementById('muSearchInput').value = '';
            document.getElementById('muFilterStatus').value = '';
        }

        // Global Image Viewer Logic
        if (e.target.closest('.view-avatar-btn')) {
            const btn = e.target.closest('.view-avatar-btn');
            imageElements = Array.from(document.querySelectorAll('.view-avatar-btn'));
            currentImageIndex = imageElements.indexOf(btn);
            
            AuthModule.updateGlobalImageModal();
            document.getElementById('globalImageModal').classList.remove('hidden');
        }
        
        if (e.target.closest('#prevGlobalImageBtn')) {
            if (currentImageIndex > 0) {
                currentImageIndex--;
                AuthModule.updateGlobalImageModal();
            }
        }
        
        if (e.target.closest('#nextGlobalImageBtn')) {
            if (currentImageIndex < imageElements.length - 1) {
                currentImageIndex++;
                AuthModule.updateGlobalImageModal();
            }
        }
        
        if (e.target.closest('#closeGlobalImageBtn') || e.target.id === 'closeGlobalImageBg') {
            const modal = document.getElementById('globalImageModal');
            const img = document.getElementById('globalImageSrc');
            if (modal && img) {
                modal.classList.add('hidden');
                img.src = '';
                document.getElementById('globalImageDetails').classList.add('hidden');
            }
        }
    },

    updateGlobalImageModal: () => {
        const imgEl = imageElements[currentImageIndex];
        if (!imgEl) return;
        
        const src = imgEl.dataset.src || imgEl.getAttribute('src');
        const name = imgEl.dataset.name;
        const info = imgEl.dataset.info;
        
        document.getElementById('globalImageSrc').src = src;
        
        const detailsDiv = document.getElementById('globalImageDetails');
        if (name || info) {
            detailsDiv.classList.remove('hidden');
            document.getElementById('giName').textContent = name || '';
            document.getElementById('giInfo').textContent = info || '';
        } else {
            detailsDiv.classList.add('hidden');
        }
        
        const prevBtn = document.getElementById('prevGlobalImageBtn');
        const nextBtn = document.getElementById('nextGlobalImageBtn');
        
        if (imageElements.length > 1) {
            prevBtn.classList.toggle('hidden', currentImageIndex === 0);
            nextBtn.classList.toggle('hidden', currentImageIndex === imageElements.length - 1);
        } else {
            prevBtn.classList.add('hidden');
            nextBtn.classList.add('hidden');
        }
    },

    loadUsersList: async () => {
        const listContainer = document.getElementById('manageUsersList');
        if(!listContainer) return;
        
        listContainer.innerHTML = '<div class="text-center py-10"><i class="fa-solid fa-spinner fa-spin text-2xl mb-2 text-blue-600"></i><br><span class="text-gray-500">Loading users...</span></div>';
        
        try {
            const data = await apiFetch('/api/users');
            AuthModule.allUsersData = data.users;
            AuthModule.renderUsersList();
        } catch(e) {
             listContainer.innerHTML = `<div class="p-4 text-red-500 border border-red-200 bg-red-50 rounded text-center font-medium">${e.message}</div>`;
        }
    },

    renderUsersList: () => {
        const search = (document.getElementById('muSearchInput')?.value || '').toLowerCase();
        const status = document.getElementById('muFilterStatus')?.value || '';
        const listContainer = document.getElementById('manageUsersList');
        
        if (!AuthModule.allUsersData) return;

        let filtered = AuthModule.allUsersData.filter(u => {
            const matchName = u.Name.toLowerCase().includes(search) || (u.Student_Number||'').toLowerCase().includes(search);
            const matchStatus = status ? u.account_status === status : true;
            return matchName && matchStatus;
        });

        if (filtered.length === 0) {
            listContainer.innerHTML = '<div class="p-8 text-center text-gray-500 bg-white border border-gray-200 rounded shadow-sm">No users found matching filters.</div>';
            return;
        }

        const html = filtered.map(u => {
            const displayCourse = `${u.course || ''} ${u.year || ''} ${u.section ? '- ' + u.section : ''}`.trim();
            const avatarSrc = getLoadableAvatarSrc(u.Avatar);
            const avatarImg = avatarSrc ? `<img src="${avatarSrc}" class="w-10 h-10 rounded-full object-cover border border-gray-200">` : `<i class="fa-solid fa-circle-user text-[40px] text-gray-300"></i>`;
            
            const getStatusColor = (st) => {
                return st === 'Active' ? 'text-green-600 border-green-300 bg-green-50' : 
                       st === 'Inactive' ? 'text-gray-600 border-gray-300 bg-gray-50' :
                       st === 'Suspended' ? 'text-orange-600 border-orange-300 bg-orange-50' :
                       st === 'UD' ? 'text-red-600 border-red-300 bg-red-50' :
                       st === 'Dropped' ? 'text-red-800 border-red-400 bg-red-100' : 'text-gray-600 border-gray-300 bg-gray-50';
            };

            return `
                <div class="flex items-center justify-between p-3 bg-white border border-gray-200 rounded shadow-sm hover:border-blue-300 transition">
                    <div class="flex items-center space-x-3">
                        <div class="flex-shrink-0">${avatarImg}</div>
                        <div>
                            <div class="font-bold text-gray-800 text-sm flex items-center gap-2">
                                ${u.Name} 
                                <span class="text-[10px] bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded text-gray-600">${u.role}</span>
                            </div>
                            <div class="text-[11px] text-gray-500 mt-0.5">
                                <span class="font-bold text-gray-700">${u.Student_Number || 'N/A'}</span> &bull; ${displayCourse || 'N/A'}
                            </div>
                        </div>
                    </div>
                    <div class="w-32">
                        <select data-user-id="${u.User_ID}" class="mu-status-select w-full px-2 py-1.5 text-xs border rounded outline-none font-bold cursor-pointer transition ${getStatusColor(u.account_status)}">
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

        listContainer.innerHTML = html;
    },

    handleChanges: async (e) => {
        if (e.target.id === 'regCameraInput' || e.target.id === 'regFileInput') {
            AuthModule.processImageUpload(e.target.files[0]);
        }
        
        if (e.target.classList.contains('mu-status-select')) {
            const studentId = e.target.dataset.userId;
            const status = e.target.value;
            
            const getStatusColor = (st) => {
                return st === 'Active' ? 'text-green-600 border-green-300 bg-green-50' : 
                       st === 'Inactive' ? 'text-gray-600 border-gray-300 bg-gray-50' :
                       st === 'Suspended' ? 'text-orange-600 border-orange-300 bg-orange-50' :
                       st === 'UD' ? 'text-red-600 border-red-300 bg-red-50' :
                       st === 'Dropped' ? 'text-red-800 border-red-400 bg-red-100' : 'text-gray-600 border-gray-300 bg-gray-50';
            };
            
            e.target.className = `mu-status-select w-full px-2 py-1.5 text-xs border rounded outline-none font-bold cursor-pointer transition ${getStatusColor(status)}`;
            
            try {
                await apiFetch('/api/update-user-status', {
                    method: 'POST',
                    body: JSON.stringify({ studentId, status })
                });
                
                // Update internal array
                const userObj = AuthModule.allUsersData.find(u => u.User_ID === studentId);
                if (userObj) userObj.account_status = status;
                
            } catch (err) {
                console.error('Failed to update user status:', err);
                alert('Failed to update status.');
            }
        }
    },

    handleInput: (e) => {
        if (e.target.id === 'regStudentNo') {
            let val = e.target.value.replace(/\D/g, '');
            if (val.length > 6) val = val.substring(0, 6);

            if (val.length >= 3) {
                e.target.value = val.substring(0, 2) + '-' + val.substring(2);
            } else {
                e.target.value = val;
            }
        }
        
        if (e.target.id === 'muSearchInput' || e.target.id === 'muFilterStatus') {
            AuthModule.renderUsersList();
        }
    },

    handleKeydown: (e) => {
        if (e.target.id === 'regStudentNo' && e.key === 'Backspace') {
            const input = e.target;
            if (input.value.length === 3 && input.value.endsWith('-')) {
                input.value = input.value.substring(0, 1);
                e.preventDefault();
            }
        }
    },

    processImageUpload: (file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 500;
                let scaleSize = 1;
                
                if (img.width > MAX_WIDTH) {
                    scaleSize = MAX_WIDTH / img.width;
                }
                
                canvas.width = img.width * scaleSize;
                canvas.height = img.height * scaleSize;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                const base64String = canvas.toDataURL('image/jpeg', 0.8);
                
                document.getElementById('avatarPreview').src = base64String;
                document.getElementById('avatarPreview').classList.remove('hidden');
                document.getElementById('regAvatarBase64').value = base64String;
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    },

    login: async () => {
        const errorDiv = document.getElementById('loginError');
        errorDiv.classList.add('hidden');
        
        const payload = {
            identifier: document.getElementById('loginIdentifier').value.trim(),
            password: document.getElementById('loginPassword').value
        };

        try {
            const data = await apiFetch('/api/login', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            AppState.setUser(data.user);
            window.location.hash = '#dashboard';
        } catch (error) {
            errorDiv.textContent = error.message;
            errorDiv.classList.remove('hidden');
        }
    },

    register: async () => {
        const errorDiv = document.getElementById('registerError');
        const successDiv = document.getElementById('registerSuccess');
        const submitBtn = document.getElementById('regSubmitBtn');
        const avatarBase64 = document.getElementById('regAvatarBase64').value;
        
        errorDiv.classList.add('hidden');
        successDiv.classList.add('hidden');

        if (!avatarBase64) {
            errorDiv.textContent = "Profile photo is required. Please take a photo or upload a file.";
            errorDiv.classList.remove('hidden');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Processing...';

        const givenName = document.getElementById('regGivenName').value.trim();
        const lastName = document.getElementById('regLastName').value.trim();
        const suffix = document.getElementById('regSuffix').value.trim();
        
        let fullName = `${lastName}, ${givenName}`;
        if (suffix) {
            fullName += ` ${suffix}`;
        }
        fullName = fullName.trim().replace(/\s+/g, ' ');

        const payload = {
            username: document.getElementById('regUsername').value.trim(),
            password: document.getElementById('regPassword').value,
            name: fullName,
            email: document.getElementById('regEmail').value.trim(),
            student_number: document.getElementById('regStudentNo').value.trim(),
            contact_number: document.getElementById('regContact').value.trim(),
            course: document.getElementById('regCourse').value.trim(),
            year: document.getElementById('regYear').value.trim(),
            section: document.getElementById('regSection').value.trim(),
            eye_condition: document.getElementById('regEyeCondition').value.trim(),
            avatarBase64: avatarBase64
        };

        try {
            await apiFetch('/api/register', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            successDiv.classList.remove('hidden');
            setTimeout(() => {
                window.location.hash = '#login';
            }, 2000);
        } catch (error) {
            errorDiv.textContent = error.message;
            errorDiv.classList.remove('hidden');
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Create Account';
        }
    },
    
    changePassword: async () => {
        const currentPassword = document.getElementById('cpCurrent').value;
        const newPassword = document.getElementById('cpNew').value;
        const repeatPassword = document.getElementById('cpRepeat').value;
        const errorDiv = document.getElementById('cpError');
        const successDiv = document.getElementById('cpSuccess');
        const submitBtn = document.getElementById('cpSubmitBtn');

        errorDiv.classList.add('hidden');
        successDiv.classList.add('hidden');

        if (newPassword !== repeatPassword) {
            errorDiv.textContent = "New passwords do not match.";
            errorDiv.classList.remove('hidden');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>';

        try {
            const payload = {
                userId: AppState.user.User_ID,
                currentPassword: currentPassword,
                newPassword: newPassword
            };
            
            const data = await apiFetch('/api/change-password', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            successDiv.textContent = data.message || "Password updated successfully.";
            successDiv.classList.remove('hidden');
            document.getElementById('changePasswordForm').reset();
            
            setTimeout(() => {
                successDiv.classList.add('hidden');
                document.getElementById('cpModal').classList.add('hidden');
            }, 2500);
            
        } catch (error) {
            errorDiv.textContent = error.message;
            errorDiv.classList.remove('hidden');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Update Password';
        }
    },

    logout: () => {
        AppState.setUser(null);
        window.location.hash = '#login';
    }
};
