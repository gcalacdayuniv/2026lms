// js/components-utils.js

// Helper function to bypass Google Drive's hotlinking block for legacy accounts.
// width: the thumbnail width Drive should send. Lists use a small one (128), the enlarged view keeps the default.
export const getLoadableAvatarSrc = (src, width = 1000) => {
    if (!src) return null;
    if (src.includes('drive.google.com/uc')) {
        const match = src.match(/[?&]id=([^&]+)/);
        if (match && match[1]) {
            return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w${width}`;
        }
    }
    return src;
};

// Initials for a student without a photo ("Last, Given M." -> "LG").
export const initialsOf = (name) => {
    const words = String(name || '').replace(/,/g, ' ').split(/\s+/).filter(Boolean);
    return ((words[0] || '')[0] || '') + ((words[1] || '')[0] || '');
};

// A photo that fails to load (Drive busy, link broken) is tried once more, then replaced by a placeholder, so the
// list never shows a broken image. Images opt in with class "avatar-img" (and data-initials for the wheel).
if (typeof document !== 'undefined') {
    document.addEventListener('error', (e) => {
        const img = e.target;
        if (!img || img.tagName !== 'IMG' || !img.classList.contains('avatar-img')) return;
        if (!img.dataset.retried) {
            img.dataset.retried = '1';
            setTimeout(() => { const u = img.src; img.src = u + (u.includes('?') ? '&' : '?') + 'r=' + Date.now(); }, 1500);
            return;
        }
        const size = img.clientWidth || 40;
        let stand;
        if (img.dataset.initials !== undefined) {
            stand = document.createElement('span');
            stand.textContent = img.dataset.initials;
            stand.className = img.className.replace('avatar-img', '') + ' flex items-center justify-center bg-white text-gray-600 font-black';
            stand.style.cssText = img.style.cssText + ';font-size:' + Math.max(8, Math.round(size * 0.4)) + 'px';
        } else {
            stand = document.createElement('i');
            stand.className = 'fa-solid fa-circle-user text-gray-300';
            stand.style.fontSize = size + 'px';
            stand.setAttribute('aria-label', img.alt || 'No photo');
        }
        img.replaceWith(stand);
    }, true);
}
