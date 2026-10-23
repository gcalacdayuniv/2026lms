// js/a11y.js
// Keeps screen readers and keyboard users inside the topmost open dialog.
//
// Problem: modals and full-screen overlays are drawn on top of the page, but the
// page behind them is still in the accessibility tree, so a screen reader keeps
// reading (and tabbing into) content the user cannot see.
//
// Fix: while a dialog is open, every element outside it is made `inert` (removed
// from the accessibility tree, tab order and pointer events) and `aria-hidden`.
// The dialog gets role/label semantics, receives focus when it opens, keeps Tab
// inside it, closes on Escape, and hands focus back to whatever opened it.
//
// It works from the DOM, so the existing code that shows/hides modals by toggling
// the `hidden` class needs no changes.

const DIALOG_SELECTOR = '.fixed.inset-0';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT']);
// Never made inert: toasts must still be announced, and the profile backdrop must stay
// clickable (it closes the drawer). The backdrop has no content, so it is only aria-hidden.
const EXEMPT_IDS = new Set(['toastHost', 'profilePanelOverlay']);
// Icon-only buttons get a name from their Font Awesome icon.
const ICON_LABELS = [
    ['fa-xmark', 'Close'],
    ['fa-arrow-left', 'Back'],
    ['fa-chevron-left', 'Previous'],
    ['fa-chevron-right', 'Next'],
    ['fa-bars', 'Menu']
];

const isRendered = (el) => el.isConnected && el.getClientRects().length > 0;

export const A11y = {
    applied: new Map(),   // element -> state to restore when it is no longer behind a dialog
    stack: [],            // open dialogs, bottom to top: { el, opener }
    lastOutside: null,    // last focused element that was not inside the current top dialog
    uid: 0,
    observer: null,

    init: () => {
        if (A11y.observer) return;
        document.addEventListener('focusin', A11y.trackFocus, true);
        document.addEventListener('keydown', A11y.handleKeydown);
        A11y.observer = new MutationObserver(A11y.handleMutations);
        A11y.observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });
        A11y.sync(true);
    },

    // Cheap filter: only react when a dialog is shown/hidden or the screen is re-rendered.
    handleMutations: (records) => {
        let relevant = false;
        let rerender = false;
        for (const m of records) {
            if (m.type === 'attributes') {
                const t = m.target;
                if (t.id === 'profilePanel' || (t.id !== 'profilePanelOverlay' && t.classList.contains('inset-0'))) {
                    relevant = true;
                }
            } else if (m.target === document.body || m.target.id === 'app-root') {
                relevant = true;
                rerender = true;
            }
        }
        if (relevant) A11y.sync(rerender);
    },

    // Open dialogs ordered bottom to top by z-index.
    openDialogs: () => {
        const list = [];
        document.querySelectorAll(DIALOG_SELECTOR).forEach(el => {
            if (el.id !== 'profilePanelOverlay' && isRendered(el)) list.push(el);
        });
        const panel = document.getElementById('profilePanel');
        if (panel && panel.classList.contains('translate-x-0')) list.push(panel);
        return list
            .map((el, i) => ({ el, i, z: parseInt(getComputedStyle(el).zIndex, 10) || 0 }))
            .sort((a, b) => (a.z - b.z) || (a.i - b.i))
            .map(o => o.el);
    },

    sync: (decorateAll) => {
        const dialogs = A11y.openDialogs();
        const top = dialogs[dialogs.length - 1] || null;

        A11y.applyInert(top);
        if (decorateAll) A11y.decorate(document.body);
        if (top) A11y.prepare(top);
        A11y.updateStack(dialogs);
    },

    // Everything outside `top` is inert + aria-hidden. The closed profile drawer
    // (parked off-screen, but still readable) is hidden too.
    applyInert: (top) => {
        const desired = new Set();
        if (top) {
            for (let node = top; node.parentElement && node !== document.body; node = node.parentElement) {
                for (const sib of node.parentElement.children) {
                    if (sib === node || SKIP_TAGS.has(sib.tagName)) continue;
                    if (EXEMPT_IDS.has(sib.id)) {
                        if (sib.id === 'profilePanelOverlay') sib.setAttribute('aria-hidden', 'true');
                        continue;
                    }
                    desired.add(sib);
                }
            }
        }
        const panel = document.getElementById('profilePanel');
        if (panel && panel !== top && !panel.classList.contains('translate-x-0')) desired.add(panel);

        for (const [el, prev] of A11y.applied) {
            if (desired.has(el) && el.isConnected) continue;
            if (!prev.inert) el.removeAttribute('inert');
            if (prev.ariaHidden === null) el.removeAttribute('aria-hidden');
            else el.setAttribute('aria-hidden', prev.ariaHidden);
            A11y.applied.delete(el);
        }
        desired.forEach(el => {
            if (A11y.applied.has(el)) return;
            A11y.applied.set(el, { inert: el.hasAttribute('inert'), ariaHidden: el.getAttribute('aria-hidden') });
            el.setAttribute('inert', '');
            el.setAttribute('aria-hidden', 'true');
        });
    },

    // Dialog semantics: role, aria-modal, an accessible name, decorative backdrops hidden.
    prepare: (el) => {
        if (!el.hasAttribute('role')) el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) {
            const heading = Array.from(el.querySelectorAll('h1, h2, h3, h4')).find(isRendered);
            if (heading) {
                if (!heading.id) heading.id = `dialog-title-${++A11y.uid}`;
                el.setAttribute('aria-labelledby', heading.id);
            } else {
                el.setAttribute('aria-label', 'Dialog');
            }
        }
        el.querySelectorAll(':scope > .absolute.inset-0').forEach(b => {
            if (!b.textContent.trim()) b.setAttribute('aria-hidden', 'true');
        });
        A11y.decorate(el);
    },

    // Hide decorative icons and name icon-only buttons.
    decorate: (root) => {
        root.querySelectorAll('i[class*="fa-"]:not([aria-hidden])').forEach(i => i.setAttribute('aria-hidden', 'true'));
        root.querySelectorAll('button:not([aria-label]):not([aria-labelledby]):not([title]), a[href]:not([aria-label]):not([aria-labelledby]):not([title])').forEach(el => {
            if (el.textContent.trim()) return;
            const icon = el.querySelector('i[class*="fa-"]');
            if (!icon) return;
            const hit = ICON_LABELS.find(([cls]) => icon.classList.contains(cls));
            if (hit) el.setAttribute('aria-label', hit[1]);
        });
    },

    // Move focus into a newly opened dialog; give it back to the opener when it closes.
    updateStack: (dialogs) => {
        const previous = A11y.stack;
        const prevTop = previous[previous.length - 1] || null;
        const known = new Map(previous.map(e => [e.el, e]));
        const next = dialogs.map(el => known.get(el) || { el, opener: A11y.findOpener(el), fresh: true });
        A11y.stack = next;
        const top = next[next.length - 1] || null;

        if (top && top.fresh) {
            A11y.focusInto(top.el);
        } else if (prevTop && !dialogs.includes(prevTop.el)) {
            const o = prevTop.opener;
            if (o && isRendered(o) && !o.closest('[inert]')) o.focus({ preventScroll: true });
        }
        next.forEach(e => { delete e.fresh; });
    },

    findOpener: (dialog) => {
        const o = A11y.lastOutside;
        return o && o.isConnected && !dialog.contains(o) ? o : null;
    },

    focusInto: (dialog) => {
        if (dialog.contains(document.activeElement)) return; // the dialog already placed focus itself
        if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
        dialog.style.outline = 'none';
        dialog.focus({ preventScroll: true });
    },

    trackFocus: (e) => {
        const dialog = e.target.closest ? e.target.closest(`${DIALOG_SELECTOR}, #profilePanel`) : null;
        const isKnown = dialog && A11y.stack.some(s => s.el === dialog);
        if (dialog && !isKnown) return; // focus moving into a dialog that is just opening
        const top = A11y.stack[A11y.stack.length - 1];
        if (!top || top.el !== dialog) A11y.lastOutside = e.target;
    },

    focusables: (root) => Array.from(root.querySelectorAll(FOCUSABLE))
        .filter(el => isRendered(el) && !el.closest('[inert]') && getComputedStyle(el).visibility !== 'hidden'),

    handleKeydown: (e) => {
        if (e.defaultPrevented) return;

        // Elements marked role="button" that are not real buttons must work with Enter/Space.
        if (e.key === 'Enter' || e.key === ' ') {
            const t = e.target;
            if (t.getAttribute && t.getAttribute('role') === 'button' && t.tagName !== 'BUTTON' && t.tagName !== 'A') {
                e.preventDefault();
                t.click();
                return;
            }
        }

        const entry = A11y.stack[A11y.stack.length - 1];
        if (!entry) return;
        const dialog = entry.el;
        // The accessible exam runs its own keyboard handling (and must not be left by accident).
        if (dialog.id === 'accessibleExamOverlay') return;

        if (e.key === 'Escape') {
            if (dialog.getAttribute('role') === 'alertdialog') return; // confirm handles its own Escape
            const closer = dialog.querySelector('button[id^="close"], button[aria-label="Close"]');
            if (closer) {
                e.preventDefault();
                closer.click();
            }
            return;
        }

        if (e.key === 'Tab') {
            const items = A11y.focusables(dialog);
            if (items.length === 0) {
                e.preventDefault();
                dialog.focus();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            const active = document.activeElement;
            const inside = dialog.contains(active);
            if (e.shiftKey && (!inside || active === first || active === dialog)) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && (!inside || active === last)) {
                e.preventDefault();
                first.focus();
            }
        }
    }
};
