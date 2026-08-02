// js/router.js
import { Components } from './components.js';
import { Auth } from './auth.js';

export const AppRouter = {
    init() {
        window.addEventListener('hashchange', this.route.bind(this));
        this.route();
    },
    
    route() {
        const root = document.getElementById('app-root');
        const hash = window.location.hash || '#login';
        
        if (hash === '#dashboard') {
            if (!Auth.isAuthenticated()) {
                window.location.hash = '#login';
                return;
            }
            root.innerHTML = Components.DashboardView();
            Auth.initDashboard();
        } else if (hash === '#register') {
            if (Auth.isAuthenticated()) {
                window.location.hash = '#dashboard';
                return;
            }
            root.innerHTML = Components.RegisterView();
            Auth.initRegister();
        } else {
            if (Auth.isAuthenticated()) {
                window.location.hash = '#dashboard';
                return;
            }
            root.innerHTML = Components.LoginView();
            Auth.initLogin();
        }
    }
};
