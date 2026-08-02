// js/auth.js
import { apiFetch, AppState } from './globals.js';

export const AuthModule = {
    init: () => {
        document.addEventListener('submit', AuthModule.handleForms);
        document.addEventListener('click', AuthModule.handleClicks);
        document.addEventListener('change', AuthModule.handleChanges);
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
    },

    handleClicks: (e) => {
        if (e.target.id === 'logoutBtn') {
            AuthModule.logout();
        }
        if (e.target.closest('#btnCamera')) {
            document.getElementById('regCameraInput').click();
        }
        if (e.target.closest('#btnFile')) {
            document.getElementById('regFileInput').click();
        }
    },

    handleChanges: (e) => {
        if (e.target.id === 'regCameraInput' || e.target.id === 'regFileInput') {
            AuthModule.processImageUpload(e.target.files[0]);
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
                
                // Compress payload string size to 80% JPEG quality
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

    logout: () => {
        localStorage.removeItem('professionalPortalUser');
        AppState.user = null;
        window.location.hash = '#login';
    }
};
