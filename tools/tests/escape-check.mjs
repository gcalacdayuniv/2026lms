// Fails when a JS template inserts student/lecturer text into HTML without escaping it.
// Looks at `${...}` inside templates that contain HTML, where the expression reads a user-text field
// (Name, Email, Barangay, Title, ...). Safe: escapeHtml(...), esc(...), safeUrl(...), or text set with textContent.
// A line that is safe for another reason can carry the comment  // escape-ok: why
import { readFileSync, readdirSync } from 'node:fs';

const FIELD = /\.(Name|Email|Username|Description|Assigned_Topic|Group_Name|Barangay|Middle_Name|Contact_Number|Student_Number|Program_Course|Program_Year|Program_Section|Body|CourseCode|CourseTitle|Room|LecturerName)\b/;
const SAFE = /\b(row|input)\(|showPrintPreview\(|escapeHtml\(|\besc\(|safeUrl\(|textContent|\.value\s*=|console\.|setAttribute|\.length\b|Error\(|toast|UI\.(success|error|notice|confirm)/;
const bad = [];
for (const f of readdirSync('js').filter(x => x.endsWith('.js'))) {
    const lines = readFileSync(`js/${f}`, 'utf8').split('\n');
    let inTpl = false, html = false;
    lines.forEach((l, i) => {
        const ticks = (l.match(/(?<!\\)`/g) || []).length;
        const startsTpl = !inTpl && ticks % 2 === 1;
        if (startsTpl) { inTpl = true; html = false; }
        if (inTpl && /<[a-zA-Z][^>]*>|<\/[a-z]/.test(l)) html = true;
        if (inTpl || ticks) {
            for (const m of l.matchAll(/\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
                const e = m[1];
                if (!FIELD.test(e) || SAFE.test(e) || SAFE.test(l) || /escape-ok/.test(l)) continue;
                // text only goes to the screen if the template is HTML-ish: this line or an earlier line of it has a tag
                if ((inTpl && html) || /<[a-zA-Z]/.test(l)) bad.push(`js/${f}:${i + 1}: \${${e.trim().slice(0, 60)}}`);
            }
        }
        if (inTpl && ticks % 2 === 1 && !startsTpl) inTpl = false;
    });
}
if (bad.length) { console.error('Unescaped user text in HTML templates (use escapeHtml):\n' + bad.join('\n')); process.exit(1); }
console.log('escape check: no unescaped user text in HTML templates');
