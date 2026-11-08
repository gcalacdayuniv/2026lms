// js/course-scan-queue.js
// Cache for scanned sheets that are not yet in the database. A sheet is added when it is ready to upload and
// is removed only after the server confirms it saved (or the lecturer discards it), so nothing is lost when
// the connection drops or the page is closed. Only answers are cached, never photos.
const KEY = 'omr_pending_v1';

const read = () => {
    try {
        const list = JSON.parse(localStorage.getItem(KEY) || '[]');
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
};

const write = (list) => {
    try {
        localStorage.setItem(KEY, JSON.stringify(list));
        return true;
    } catch (e) {
        return false;   // storage blocked or full: the sheet still uploads from memory
    }
};

export const ScanQueue = {
    all: () => read(),

    forCourse: (courseId) => read().filter(e => e.courseId === courseId),

    // Adds the entry, or replaces the earlier one of the same captured sheet.
    put: (entry) => {
        const list = read().filter(e => e.scanId !== entry.scanId);
        list.push({ ...entry, queuedAt: entry.queuedAt || Date.now() });
        return write(list);
    },

    update: (scanId, patch) => {
        const list = read();
        const item = list.find(e => e.scanId === scanId);
        if (!item) return false;
        Object.assign(item, patch);
        return write(list);
    },

    remove: (scanIds) => {
        const drop = new Set(scanIds);
        return write(read().filter(e => !drop.has(e.scanId)));
    },

    // Deletes the entries the server confirmed, but keeps one that was edited after it was sent.
    removeIfSame: (sent) => {
        const same = (a, b) => JSON.stringify([a.studentId, a.answers, a.removeStudent, a.replace]) === JSON.stringify([b.studentId, b.answers, b.removeStudent, b.replace]);
        const drop = new Set(sent.map(e => e.scanId));
        return write(read().filter(e => {
            if (!drop.has(e.scanId)) return true;
            const was = sent.find(x => x.scanId === e.scanId);
            return !same(e, was);
        }));
    },

    count: (courseId) => ScanQueue.forCourse(courseId).length
};
