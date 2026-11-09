// js/router.js
import { StudentSummaryUI } from './student-summary-ui.js';
import { Components } from './components.js';
import { AppState } from './globals.js';
import { CourseClass } from './course-class.js';
import { CourseDashboard } from './course-dashboard.js';
import { AuthModule } from './auth.js';

// Phones: sliding the page in when going between the dashboard and a class (CSS: #app-root[data-route]).
let lastKind = '';
const routeKind = (hash) => hash.startsWith('#class-') ? 'class' : hash === '#dashboard' ? 'dashboard' : 'other';
const markTransition = (root, hash) => {
    const kind = routeKind(hash);
    const dir = (lastKind === 'dashboard' && kind === 'class') ? 'forward' : (lastKind === 'class' && kind === 'dashboard') ? 'back' : '';
    lastKind = kind;
    if (!dir || !window.matchMedia('(max-width: 639px)').matches) return;
    root.dataset.route = dir;
    // The first draw (skeleton or saved copy) plays the slide; later redraws must not repeat it.
    const clear = () => { delete root.dataset.route; };
    root.addEventListener('animationend', clear, { once: true });
    setTimeout(clear, 450);
};

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

        markTransition(root, hash);

        // Dynamic routing for Class Screens
        if (hash.startsWith('#class-')) {
            const courseId = hash.replace('#class-', '');
            await CourseClass.loadClassScreen(courseId);
            return;
        }

        switch (hash) {
            case '#login':
                root.innerHTML = Components.renderLogin();
                break;
            case '#register':
                root.innerHTML = Components.renderRegister();
                AuthModule.loadPrograms();
                break;
            case '#dashboard':
                root.innerHTML = Components.renderDashboard(AppState.user);
                StudentSummaryUI.init();
                await CourseDashboard.loadDashboardData();
                break;
            default:
                root.innerHTML = Components.renderLogin();
        }
    }
};
