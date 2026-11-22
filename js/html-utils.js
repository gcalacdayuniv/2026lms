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

// Uploaded files are stored with a Drive download link (drive.google.com/uc?...export=download). iOS Safari and the
// installed app cannot open that kind of link, so show Drive's preview page instead (it has its own download button).
export const fileViewUrl = (value) => {
    const url = String(value == null ? '' : value).trim();
    const m = /^https:\/\/drive\.google\.com\/uc\?(?:[^#]*&)?id=([\w-]+)/i.exec(url);
    return m ? `https://drive.google.com/file/d/${m[1]}/view` : url;
};
