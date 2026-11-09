// js/mu-swipe.js
// Manage Users on phones: swipe a card right to set Active, left to pick another status.
import { AuthModule } from './auth.js';

const START_PX = 12;
const COMMIT_PX = 90;
const MAX_PULL = 110;
const IGNORE = 'select, a, input, button, .view-avatar-btn';
let g = null;

const phone = () => window.matchMedia('(max-width: 639px)').matches;
const reset = (card) => {
    card.style.transition = 'transform .18s ease, background-color .18s ease';
    card.style.transform = '';
    card.style.backgroundColor = '';
    setTimeout(() => { card.style.transition = ''; }, 200);
};

export const MuSwipe = {
    init: () => {
        document.addEventListener('touchstart', (e) => {
            g = null;
            if (!phone() || e.touches.length !== 1) return;
            const t = e.target;
            if (!t.closest || t.closest(IGNORE)) return;
            const card = t.closest('.mu-card');
            if (!card) return;
            g = { card, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, mode: '' };
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            if (!g) return;
            const dx = e.touches[0].clientX - g.x;
            const dy = e.touches[0].clientY - g.y;
            if (!g.mode) {
                if (Math.abs(dy) > START_PX && Math.abs(dy) > Math.abs(dx)) { g = null; return; }   // a scroll
                if (Math.abs(dx) < START_PX) return;
                if (Math.abs(dx) <= Math.abs(dy) * 1.5) { g = null; return; }
                g.mode = 'swipe';
            }
            if (e.cancelable) e.preventDefault();
            g.dx = dx;
            const ready = Math.abs(dx) >= COMMIT_PX;
            g.card.style.transition = 'none';
            g.card.style.transform = `translateX(${Math.max(-MAX_PULL, Math.min(MAX_PULL, dx * 0.6))}px)`;
            g.card.style.backgroundColor = dx > 0 ? (ready ? '#bbf7d0' : '#f0fdf4') : (ready ? '#e0e7ff' : '#eef2ff');
        }, { passive: false });

        const finish = (commit) => {
            if (!g) return;
            const { card, dx, mode } = g;
            g = null;
            reset(card);
            if (!commit || mode !== 'swipe' || Math.abs(dx) < COMMIT_PX) return;
            if (navigator.vibrate) navigator.vibrate(12);
            const id = card.dataset.userId;
            if (dx > 0) {
                const user = AuthModule.usersList.find(u => u.User_ID === id);
                if (user && user.account_status !== 'Active') AuthModule.setUserStatus(id, 'Active');
            } else {
                AuthModule.openStatusSheet(id);
            }
        };
        document.addEventListener('touchend', () => finish(true));
        document.addEventListener('touchcancel', () => finish(false));
    }
};
