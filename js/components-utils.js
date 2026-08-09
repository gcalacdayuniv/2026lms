// js/components-utils.js

// Helper function to bypass Google Drive's hotlinking block for legacy accounts
export const getLoadableAvatarSrc = (src) => {
    if (!src) return null;
    if (src.includes('drive.google.com/uc')) {
        const match = src.match(/[?&]id=([^&]+)/);
        if (match && match[1]) {
            return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w1000`;
        }
    }
    return src;
};
