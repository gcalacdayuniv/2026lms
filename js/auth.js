// js/auth.js
import { apiFetch, AppState } from './globals.js';
import { getLoadableAvatarSrc } from './components-utils.js';

export const AuthModule = {
    usersList: [],

    init: () => {
        document.addEventListener('submit', AuthModule.handleForms);
        document.addEventListener('click', AuthModule.handleClicks);
        document.addEventListener('input', AuthModule.handleInputs);
        document.addEventListener('change', AuthModule.handleChanges);
    },

    handleForms: async (e) => {
        if (e.target.id === 'loginForm') {
            e.preventDefault();
            const btn = document.getElementById('loginBtn');
            const errorDiv = document.getElementById('loginError');
            errorDiv.classList.add('hidden');
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading...';

            try {
                const data = await apiFetch('/api/login', {
                    method: 'POST',
                    body: JSON.stringify({
                        identifier: document.getElementById('loginId').value.trim(),
                        password: document.getElementById('loginPassword').value
                    })
                });
                
                AppState.user = data.user;
                localStorage.setItem('user', JSON.stringify(data.user));
                window.location.hash = 'dashboard';
            } catch (err) {
                errorDiv.textContent = err.message;
                errorDiv.classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btn.innerHTML = 'Sign In';
            }
        }

        if (e.target.id === 'registerForm') {
            e.preventDefault();
            const btn = document.getElementById('registerBtn');
            const errorDiv = document.getElementById('registerError');
            const successDiv = document.getElementById('registerSuccess');
            const progressDiv = document.getElementById('uploadProgress');
            
            errorDiv.classList.add('hidden');
            successDiv.classList.add('hidden');
            btn.disabled = true;

            const pw = document.getElementById('regPassword').value;
            const pw2 = document.getElementById('regRepeatPassword').value;

            if (pw !== pw2) {
                errorDiv.textContent = "Passwords do not match.";
                errorDiv.classList.remove('hidden');
                btn.disabled = false;
                return;
            }

            progressDiv.classList.remove('hidden');

            try {
                const payload = {
                    username: document.getElementById('regUsername').value.trim(),
                    password: pw,
                    name: document.getElementById('regName').value.trim(),
                    email: document.getElementById('regEmail').value.trim(),
                    contact_number: document.getElementById('regContact').value.trim(),
                    student_number: document.getElementById('regStudentNo').value.trim(),
                    course: document.getElementById('regCourse').value,
                    year: document.getElementById('regYear').value,
                    section: document.getElementById('regSection').value.trim().toUpperCase(),
                    eye_condition: document.getElementById('regEyeCondition').value,
                    avatarBase64: null
                };

                const fileInput = document.getElementById('regAvatar');
                if (fileInput.files.length > 0) {
                    const file = fileInput.files[0];
                    payload.avatarBase64 = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result.split(',')[1]);
                        reader.onerror = error => reject(error);
                        reader.readAsDataURL(file);
                    });
                }

                await apiFetch('/api/register', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });

                progressDiv.classList.add('hidden');
                successDiv.textContent = "Registration successful! You can now log in once approved.";
                successDiv.classList.remove('hidden');
                e.target.reset();
                setTimeout(() => window.location.hash = 'login', 3000);
            } catch (err) {
                progressDiv.classList.add('hidden');
                errorDiv.textContent = err.message;
                errorDiv.classList.remove('hidden');
            } finally {
                btn.disabled = false;
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
        if (e.target.id === 'regStudentNo') {
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

    handleClicks: (e) => {
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
            AppState.user = null;
            localStorage.removeItem('user');
            window.location.hash = 'login';
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
            const btn = e.target.closest('.view-avatar-btn');
            const src = btn.dataset.src;
            const name = btn.dataset.name || '';
            const info = btn.dataset.info || '';
            
            let modal = document.getElementById('globalImageModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'globalImageModal';
                modal.className = 'fixed inset-0 z-[200] hidden flex items-center justify-center bg-black bg-opacity-90 backdrop-blur-sm fade-in';
                modal.innerHTML = `
                    <button id="closeGlobalImageBtn" class="absolute top-4 right-4 text-white hover:text-gray-300 focus:outline-none transition-colors z-[210]">
                        <i class="fa-solid fa-xmark text-3xl"></i>
                    </button>
                    <div class="relative max-w-4xl max-h-[90vh] w-full flex flex-col items-center justify-center p-4">
                        <img id="globalImageFull" src="" class="max-w-full max-h-[75vh] object-contain rounded-lg shadow-2xl scale-up border-2 border-gray-700 bg-gray-900">
                        <div class="mt-4 text-center">
                            <h4 id="globalImageName" class="text-white font-black text-xl tracking-wider"></h4>
                            <p id="globalImageInfo" class="text-gray-400 text-sm font-medium mt-1"></p>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
            }
            
            document.getElementById('globalImageFull').src = src;
            document.getElementById('globalImageName').textContent = name;
            document.getElementById('globalImageInfo').textContent = info;
            
            modal.classList.remove('hidden');
            
            const closeBtn = document.getElementById('closeGlobalImageBtn');
            const closeHandler = () => {
                modal.classList.add('hidden');
                closeBtn.removeEventListener('click', closeHandler);
                modal.removeEventListener('click', overlayHandler);
            };
            const overlayHandler = (ev) => {
                if (ev.target === modal) closeHandler();
            };
            
            closeBtn.addEventListener('click', closeHandler);
            modal.addEventListener('click', overlayHandler);
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
            
            return `
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 sm:p-4 bg-white border border-gray-200 rounded-lg shadow-sm hover:border-blue-300 transition gap-4">
                <div class="flex items-center gap-4 w-full sm:w-auto overflow-hidden">
                    <div class="flex-shrink-0">
                        ${avatarImg}
                    </div>
                    <div class="overflow-hidden min-w-0">
                        <div class="font-black text-gray-800 text-sm sm:text-base truncate">${u.Name} <span class="ml-2 text-[9px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200 uppercase tracking-widest align-middle">${u.role}</span></div>
                        
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
