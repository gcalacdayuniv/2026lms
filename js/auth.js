// js/auth.js
import { apiFetch } from './globals.js';

export const Auth = {
    initLogin() {
        const form = document.getElementById('login-form');
        if (!form) return;
        
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('login-username').value.trim();
            const password = document.getElementById('login-password').value.trim();
            
            const response = await apiFetch('/login', {
                method: 'POST',
                body: JSON.stringify({ username, password })
            });
            
            if (response.success) {
                localStorage.setItem('professionalPortalUser', JSON.stringify(response.user));
                window.location.hash = '#dashboard';
            } else {
                alert(response.message || 'Login failed.');
            }
        });
    },
    
    initRegister() {
        const form = document.getElementById('register-form');
        if (!form) return;
        
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('reg-name').value.trim();
            const email = document.getElementById('reg-email').value.trim();
            const username = document.getElementById('reg-username').value.trim();
            const password = document.getElementById('reg-password').value.trim();
            
            const response = await apiFetch('/register', {
                method: 'POST',
                body: JSON.stringify({ name, email, username, password })
            });
            
            if (response.success) {
                alert('Account created successfully. You can now log in.');
                window.location.hash = '#login';
            } else {
                alert(response.message || 'Registration failed.');
            }
        });
    },

    initDashboard() {
        const userJson = localStorage.getItem('professionalPortalUser');
        if (!userJson) {
            window.location.hash = '#login';
            return;
        }
        
        const user = JSON.parse(userJson);
        const welcomeText = document.getElementById('dashboard-welcome');
        if (welcomeText) {
            welcomeText.textContent = `Welcome back, ${user.Name || user.Username}!`;
        }

        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                localStorage.removeItem('professionalPortalUser');
                window.location.hash = '#login';
            });
        }
    },
    
    isAuthenticated() {
        return localStorage.getItem('professionalPortalUser') !== null;
    }
};
