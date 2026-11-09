// js/app.js
import { AppRouter } from './router.js';
import { AuthModule } from './auth.js';
import { CourseModule } from './course.js';
import { CourseSummary } from './course-summary.js';
import { CourseScores } from './course-scores.js';
import { CourseExam } from './course-exam.js';
import { CourseScanner } from './course-scanner.js';
import { CourseScanRecords } from './course-scan-records.js';
import { CourseFab } from './course-fab.js';
import { CourseSwipe } from './course-swipe.js';
import { CoursePull } from './course-pull.js';
import { PWA } from './pwa.js';
import { DashNav } from './dash-nav.js';
import { CourseAttendance } from './course-attendance.js';
import { CourseAttendanceDates } from './course-attendance-dates.js';
import { AppState } from './globals.js';
import { A11y } from './a11y.js';

document.addEventListener('DOMContentLoaded', () => {
    AppState.init();
    AuthModule.init();
    CourseModule.init();
    // Must come after CourseModule.init(): the row is updated first, then saved.
    CourseAttendance.init();
    CourseSummary.init();
    CourseScores.init();
    CourseExam.init();
    CourseScanner.init();
    CourseScanRecords.init();
    CourseFab.init();
    CourseSwipe.init();
    CoursePull.init();
    PWA.init();
    DashNav.init();
    CourseAttendanceDates.init();
    AppRouter.init();
    A11y.init();
});
