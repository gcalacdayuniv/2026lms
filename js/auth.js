// js/auth.js
import { apiFetch, AppState } from './globals.js';

export const AuthModule = {
    init: () => {
        document.addEventListener('submit', AuthModule.handleForms);
        document.addEventListener('click', AuthModule.handleClicks);
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
    },

    login: async () => {
        const errorDiv = document.getElementById('loginError');
        errorDiv.classList.add('hidden');
        
        const payload = {
            identifier: document.getElementById('loginIdentifier').value,
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
        const submitBtn = document.querySelector('#registerForm button[type="submit"]');
        
        errorDiv.classList.add('hidden');
        successDiv.classList.add('hidden');
        submitBtn.disabled = true;

        const payload = {
            username: document.getElementById('regUsername').value,
            password: document.getElementById('regPassword').value,
            name: document.getElementById('regName').value,
            email: document.getElementById('regEmail').value,
            student_number: document.getElementById('regStudentNo').value,
            contact_number: document.getElementById('regContact').value,
            course: document.getElementById('regCourse').value,
            year: document.getElementById('regYear').value,
            section: document.getElementById('regSection').value
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
        }
    },

    logout: () => {
        localStorage.removeItem('professionalPortalUser');
        AppState.user = null;
        window.location.hash = '#login';
    }
};
