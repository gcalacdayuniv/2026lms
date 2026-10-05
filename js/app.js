// js/app.js
import { AppRouter } from './router.js';
import { AuthModule } from './auth.js';
import { CourseModule } from './course.js';
import { CourseSummary } from './course-summary.js';
import { CourseScores } from './course-scores.js';
import { CourseExam } from './course-exam.js';
import { AppState } from './globals.js';

document.addEventListener('DOMContentLoaded', () => {
    AppState.init();
    AuthModule.init();
    CourseModule.init();
    CourseSummary.init();
    CourseScores.init();
    CourseExam.init();
    AppRouter.init();
});
