// js/app.js
import { AppRouter } from './router.js';
import { AuthModule } from './auth.js';
import { CourseModule } from './course.js';
import { AppState } from './globals.js';

document.addEventListener('DOMContentLoaded', () => {
    AppState.init();
    AuthModule.init();
    CourseModule.init();
    AppRouter.init();
});
