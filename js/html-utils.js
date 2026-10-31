// js/html-utils.js
// Helpers for putting server/user text into innerHTML safely.

const ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;'
};

// Turns text into HTML-safe text. Use it for every user-supplied value inside a template string.
export const escapeHtml = (value) =>
    String(value == null ? '' : value).replace(/[&<>"'`]/g, ch => ESCAPE_MAP[ch]);

// Returns the URL only if it is http(s) or mailto; otherwise '#'. Use it for href/src values.
export const safeUrl = (value) => {
    const url = String(value == null ? '' : value).trim();
    return /^(https?:\/\/|mailto:)/i.test(url) ? escapeHtml(url) : '#';
};
