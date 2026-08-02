// js/auth.js
import { apiFetch, AppState } from './globals.js';

export const AuthModule = {
    init: () => {
        document.addEventListener('submit', AuthModule.handleForms);
        document.addEventListener('click', AuthModule.handleClicks);
        document.addEventListener('change', AuthModule.handleChanges);
        document.addEventListener('input', AuthModule.handleInput);
        document.addEventListener('keydown', AuthModule.handleKeydown);
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
            // Ensure sidebar is closed when modal opens for better UX on mobile
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
    },

    handleChanges: (e) => {
        if (e.target.id === 'regCameraInput' || e.target.id === 'regFileInput') {
            AuthModule.processImageUpload(e.target.files[0]);
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

            localStorage.setItem('professionalPortalUser', JSON.stringify(data.user));
            AppState.user = data.user;
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

        const payload = {
            username: document.getElementById('regUsername').value.trim(),
            password: document.getElementById('regPassword').value,
            name: document.getElementById('regName').value.trim(),
            email: document.getElementById('regEmail').value.trim(),
            student_number: document.getElementById('regStudentNo').value.trim(),
            contact_number: document.getElementById('regContact').value.trim(),
            course: document.getElementById('regCourse').value.trim(),
            year: document.getElementById('regYear').value.trim(),
            section: document.getElementById('regSection').value.trim(),
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
        localStorage.removeItem('professionalPortalUser');
        AppState.user = null;
        window.location.hash = '#login';
    }
};
