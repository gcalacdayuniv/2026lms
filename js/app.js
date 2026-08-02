// js/app.js
import { AppRouter } from './router.js';
import { AuthModule } from './auth.js';

document.addEventListener('DOMContentLoaded', () => {
    AuthModule.init();
    AppRouter.init();
});
