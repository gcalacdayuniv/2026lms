// js/router.js
import { Components } from './components.js';
import { AppState } from './globals.js';
import { CourseModule } from './course.js';

export const AppRouter = {
    init: () => {
        window.addEventListener('hashchange', AppRouter.handleRoute);
        AppRouter.handleRoute();
    },

    handleRoute: async () => {
        const root = document.getElementById('app-root');
        const hash = window.location.hash || '#login';
        
        // Protect routes
        if (!AppState.user && hash !== '#login' && hash !== '#register') {
            window.location.hash = '#login';
            return;
        }

        if (AppState.user && (hash === '#login' || hash === '#register')) {
            window.location.hash = '#dashboard';
            return;
        }

        switch (hash) {
            case '#login':
                root.innerHTML = Components.renderLogin();
                break;
            case '#register':
                root.innerHTML = Components.renderRegister();
                break;
            case '#dashboard':
                root.innerHTML = Components.renderDashboard(AppState.user);
                await CourseModule.loadDashboardData();
                break;
            default:
                root.innerHTML = Components.renderLogin();
        }
    }
};
