// js/app.js
import { AppRouter } from './router.js';
import { AuthModule } from './auth.js';
import { CourseModule } from './course.js';

document.addEventListener('DOMContentLoaded', () => {
    AuthModule.init();
    CourseModule.init();
    AppRouter.init();
});
