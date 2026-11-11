// js/exam-builder-model.js
// Pure data helpers for the Exam Builder and the CSV import/export (no DOM).
//
// One saved question row:
//   [part, question, choices[], answer, explanation, isBonus, type, ordered]
//   - type is 'mc' | 'tf' | 'id' | 'enum'. Rows saved before types existed have only the first six values;
//     their type is worked out from the choices (none = identification, True/False = tf, else multiple choice).
//   - enumeration: answer is an array of the items the student must list; ordered = the order must match.
//     Every correct item is worth 1 point.
//
// One spreadsheet / CSV row (same columns in the builder grid, the CSV upload and the CSV export):
//   Part | Type | Question | Choice A ... Choice H | Answer | Explanation | Bonus

export const MAX_OPTIONS = 8;
export const MIN_OPTIONS = 2;
export const MAX_ITEMS = 30;
export const MIN_ITEMS = 2;

export const TYPES = [
    { id: 'mc', label: 'Multiple choice', icon: 'fa-list-ul' },
    { id: 'tf', label: 'True or False', icon: 'fa-circle-half-stroke' },
    { id: 'id', label: 'Identification', icon: 'fa-pen-to-square' },
    { id: 'enum', label: 'Enumeration', icon: 'fa-list-ol' }
];

// The spreadsheet type list also separates ordered enumerations.
export const SHEET_TYPES = [
    { key: 'mc', label: 'Multiple choice' },
    { key: 'tf', label: 'True or False' },
    { key: 'id', label: 'Identification' },
    { key: 'enum', label: 'Enumeration' },
    { key: 'enumo', label: 'Enumeration (ordered)' }
];

let seq = 0;
export const newId = () => `q${Date.now().toString(36)}${(++seq).toString(36)}`;

export const blankQuestion = (type = 'mc', part = 0) => ({
    id: newId(),
    type,
    part,
    text: '',
    options: type === 'mc' ? ['', '', '', ''] : [],
    correct: -1,          // multiple choice: index of the right option
    tf: '',               // true or false: 'True' | 'False'
    answer: '',           // identification: the exact answer
    items: type === 'enum' ? ['', '', ''] : [],   // enumeration: the items to list
    ordered: false,       // enumeration: the order matters
    expl: '',
    bonus: false
});

export const typeKey = (q) => (q.type === 'enum' && q.ordered ? 'enumo' : q.type);
export const typeLabel = (q) => (SHEET_TYPES.find(t => t.key === typeKey(q)) || SHEET_TYPES[0]).label;

// How many points a question is worth: 1, or one per item for an enumeration.
export const pointsOf = (q) => (q.type === 'enum' ? q.items.map(i => i.trim()).filter(Boolean).length : 1);

const isTrueFalse = (choices) => {
    if (choices.length !== 2) return false;
    const set = choices.map(c => String(c).trim().toLowerCase()).sort().join('|');
    return set === 'false|true';
};

// ---------- Saved rows ----------

// One saved row -> one builder question.
export const fromRow = (row) => {
    const part = parseInt(row[0], 10) || 0;
    const choices = Array.isArray(row[2]) ? row[2].map(c => String(c ?? '')) : [];
    const rawAnswer = row[3];
    const base = { id: newId(), part, text: String(row[1] ?? ''), expl: String(row[4] ?? ''), bonus: Boolean(row[5]) };
    const saved = typeof row[6] === 'string' ? row[6] : '';

    if (saved === 'enum' || (!saved && Array.isArray(rawAnswer))) {
        const items = (Array.isArray(rawAnswer) ? rawAnswer : String(rawAnswer ?? '').split('|')).map(i => String(i ?? '').trim());
        return { ...blankQuestion('enum', part), ...base, items: items.length ? items : ['', '', ''], ordered: Boolean(row[7]) };
    }
    const answer = String(rawAnswer ?? '');
    if (saved === 'id' || (!saved && choices.length === 0)) {
        return { ...blankQuestion('id', part), ...base, answer };
    }
    if (saved === 'tf' || (!saved && isTrueFalse(choices))) {
        const tf = answer.trim().toLowerCase() === 'true' ? 'True' : answer.trim().toLowerCase() === 'false' ? 'False' : '';
        return { ...blankQuestion('tf', part), ...base, tf };
    }
    const options = choices.slice(0, MAX_OPTIONS);
    const correct = options.findIndex(c => c.trim() === answer.trim());
    return { ...blankQuestion('mc', part), ...base, options, correct };
};

export const fromExamData = (rows) => (Array.isArray(rows) ? rows : []).map(fromRow);

// One builder question -> one saved row.
export const toRow = (q) => {
    const text = q.text.trim();
    const expl = q.expl.trim();
    const bonus = Boolean(q.bonus);
    if (q.type === 'tf') return [q.part, text, ['True', 'False'], q.tf, expl, bonus, 'tf', false];
    if (q.type === 'id') return [q.part, text, [], q.answer.trim(), expl, bonus, 'id', false];
    if (q.type === 'enum') return [q.part, text, [], q.items.map(i => i.trim()).filter(Boolean), expl, bonus, 'enum', Boolean(q.ordered)];
    const options = q.options.map(o => o.trim()).filter(Boolean);
    const right = q.correct >= 0 && q.options[q.correct] ? q.options[q.correct].trim() : '';
    return [q.part, text, options, right, expl, bonus, 'mc', false];
};

// Returns a list of { id, message } problems; empty = ready to save.
export const validate = (title, questions) => {
    const problems = [];
    if (!String(title || '').trim()) problems.push({ id: null, message: 'Give the exam a title.' });
    if (questions.length === 0) problems.push({ id: null, message: 'Add at least one question.' });
    questions.forEach((q, i) => {
        const n = i + 1;
        const add = (message) => problems.push({ id: q.id, message: `Question ${n}: ${message}` });
        if (!q.text.trim()) add('write the question.');
        if (q.type === 'mc') {
            const filled = q.options.map(o => o.trim()).filter(Boolean);
            if (filled.length < MIN_OPTIONS) add('needs at least 2 choices.');
            if (new Set(filled.map(o => o.toLowerCase())).size !== filled.length) add('two choices are the same.');
            if (q.correct < 0 || !q.options[q.correct] || !q.options[q.correct].trim()) add('select the correct answer.');
        } else if (q.type === 'tf') {
            if (q.tf !== 'True' && q.tf !== 'False') add('select True or False as the answer.');
        } else if (q.type === 'enum') {
            const filled = q.items.map(o => o.trim()).filter(Boolean);
            if (filled.length < MIN_ITEMS) add('an enumeration needs at least 2 items.');
            if (new Set(filled.map(o => o.toLowerCase())).size !== filled.length) add('two items are the same.');
        } else if (!q.answer.trim()) {
            add('type the correct answer.');
        }
    });
    return problems;
};

// ---------- Spreadsheet view ----------
// Column order of the grid, the CSV and a paste.
export const COLUMNS = ['part', 'type', 'text', 'o0', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'answer', 'expl', 'bonus'];

export const letter = (i) => String.fromCharCode(65 + i);

const TYPE_WORDS = {
    mc: 'mc', 'multiple choice': 'mc', multiple: 'mc', choice: 'mc',
    tf: 'tf', 'true or false': 'tf', 'true/false': 'tf', 'true false': 'tf', boolean: 'tf',
    id: 'id', identification: 'id', 'fill in the blank': 'id', text: 'id',
    enum: 'enum', enumeration: 'enum', enumerate: 'enum', list: 'enum',
    enumo: 'enumo', 'enumeration (ordered)': 'enumo', 'ordered enumeration': 'enumo', 'enumeration ordered': 'enumo'
};

export const parseTypeWord = (word) => TYPE_WORDS[String(word || '').trim().toLowerCase()] || '';

// Enumeration items typed in one cell: separated by | or line breaks.
export const splitItems = (value) => String(value ?? '').split(/\||\r?\n/).map(s => s.trim()).filter(Boolean);

// Switches the type and keeps whatever still makes sense. key can be 'enumo' (ordered enumeration).
export const changeType = (q, key) => {
    const type = key === 'enumo' ? 'enum' : key;
    const ordered = key === 'enumo';
    if (q.type === type) {
        if (type === 'enum') q.ordered = ordered;
        return q;
    }
    if (type === 'mc') {
        if (q.options.length < MIN_OPTIONS) q.options = ['', '', '', ''];
        q.correct = -1;
    } else if (type === 'tf') {
        q.tf = '';
    } else if (type === 'enum') {
        const carried = q.type === 'id' ? splitItems(q.answer) : [];
        q.items = carried.length ? carried : ['', '', ''];
        q.ordered = ordered;
    } else {
        q.answer = q.type === 'mc' && q.correct >= 0 ? (q.options[q.correct] || '')
            : q.type === 'enum' ? q.items.map(i => i.trim()).filter(Boolean).join(' | ') : '';
    }
    q.type = type;
    return q;
};

// Sets one cell of a question from text (typed, pasted or read from a CSV). Returns the changed question.
export const setCell = (q, col, raw) => {
    const value = String(raw ?? '');
    if (col === 'part') {
        q.part = parseInt(value, 10) || 0;
    } else if (col === 'type') {
        const t = parseTypeWord(value);
        if (t) changeType(q, t);
    } else if (col === 'text') {
        q.text = value;
    } else if (/^o[0-7]$/.test(col)) {
        const idx = parseInt(col.slice(1), 10);
        if (q.type === 'mc') {
            while (q.options.length <= idx) q.options.push('');
            q.options[idx] = value;
        }
    } else if (col === 'answer') {
        if (q.type === 'mc') {
            const v = value.trim();
            let idx = -1;
            if (/^[A-Ha-h]$/.test(v)) idx = v.toUpperCase().charCodeAt(0) - 65;
            else idx = q.options.findIndex(o => o.trim().toLowerCase() === v.toLowerCase());
            q.correct = idx >= 0 && idx < q.options.length ? idx : -1;
        } else if (q.type === 'tf') {
            const v = value.trim().toLowerCase();
            q.tf = v === 'true' || v === 't' ? 'True' : v === 'false' || v === 'f' ? 'False' : '';
        } else if (q.type === 'enum') {
            const items = splitItems(value).slice(0, MAX_ITEMS);
            q.items = items.length ? items : ['', '', ''];
        } else {
            q.answer = value;
        }
    } else if (col === 'expl') {
        q.expl = value;
    } else if (col === 'bonus') {
        const v = value.trim().toLowerCase();
        q.bonus = v === '1' || v === 'true' || v === 'yes' || v === 'bonus' || v === 'x';
    }
    return q;
};

// The text of one grid cell (the inverse of setCell). Used by the CSV export.
export const cellText = (q, col) => {
    if (col === 'part') return String(q.part);
    if (col === 'type') return typeLabel(q);
    if (col === 'text') return q.text;
    if (/^o[0-7]$/.test(col)) return q.type === 'mc' ? (q.options[parseInt(col.slice(1), 10)] || '') : '';
    if (col === 'answer') {
        if (q.type === 'mc') return q.correct >= 0 ? letter(q.correct) : '';
        if (q.type === 'tf') return q.tf;
        if (q.type === 'enum') return q.items.map(i => i.trim()).filter(Boolean).join(' | ');
        return q.answer;
    }
    if (col === 'expl') return q.expl;
    if (col === 'bonus') return q.bonus ? 'Yes' : '';
    return '';
};

// Splits pasted spreadsheet text (tab separated, one row per line; quoted cells may hold line breaks).
export const parsePaste = (text) => parseDelimited(text, '\t');

// ---------- CSV ----------

export const CSV_HEADER = ['Part', 'Type', 'Question', ...Array.from({ length: MAX_OPTIONS }, (_, k) => `Choice ${letter(k)}`), 'Answer', 'Explanation', 'Bonus'];

// Reads delimited text. Quoted cells may hold the delimiter and line breaks; "" is a quote.
export function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    const src = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (quoted) {
            if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
            else if (ch === '"') quoted = false;
            else cell += ch;
        } else if (ch === '"' && cell === '') {
            quoted = true;
        } else if (ch === delimiter) {
            row.push(cell); cell = '';
        } else if (ch === '\n') {
            row.push(cell); rows.push(row); row = []; cell = '';
        } else {
            cell += ch;
        }
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

// Excel in some regions saves CSV with ; or tabs. Picks the separator that the first line uses most.
export const detectDelimiter = (text) => {
    const first = String(text).replace(/^﻿/, '').split(/\r?\n/)[0] || '';
    const count = (d) => first.split(d).length - 1;
    const best = [',', ';', '\t'].map(d => [d, count(d)]).sort((a, b) => b[1] - a[1])[0];
    return best[1] > 0 ? best[0] : ',';
};

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

// Questions -> CSV text in the spreadsheet layout.
export const toCsv = (questions) => {
    const lines = [CSV_HEADER.map(csvCell).join(',')];
    questions.forEach(q => lines.push(COLUMNS.map(c => csvCell(cellText(q, c))).join(',')));
    return lines.join('\r\n');
};

// Works out the type of a row whose Type cell is empty.
const inferKey = (options, answer) => {
    if (options.length === 0) return answer.includes('|') || answer.includes('\n') ? 'enum' : 'id';
    if (options.length === 2 && isTrueFalse(options)) return 'tf';
    return 'mc';
};

// CSV rows (already split into cells) -> { questions, skipped }.
// Reads the new layout (header has a Type column) and the old 6-column layout:
//   Part Index | Question | Choices (separated by |) | Answer | Explanation | Bonus
export const fromCsvRows = (rows) => {
    const clean = rows.filter(r => r.some(c => String(c).trim() !== ''));
    const questions = [];
    let skipped = 0;
    if (!clean.length) return { questions, skipped };

    const head = clean[0].map(c => String(c).trim().toLowerCase());
    const isNew = head[1] === 'type';
    const hasHeader = isNew || !/^\d+$/.test(head[0] || '');
    const body = hasHeader ? clean.slice(1) : clean;

    body.forEach(r => {
        const cell = (i) => String(r[i] ?? '').trim();
        if (isNew) {
            const options = Array.from({ length: MAX_OPTIONS }, (_, k) => String(r[3 + k] ?? '').trim());
            const answer = cell(3 + MAX_OPTIONS);
            const text = String(r[2] ?? '');
            if (!text.trim()) { skipped++; return; }
            const filled = options.filter(Boolean);
            const key = parseTypeWord(cell(1)) || inferKey(filled, answer);
            const q = blankQuestion('mc', parseInt(cell(0), 10) || 0);
            setCell(q, 'type', key);
            q.text = text.trim();
            if (q.type === 'mc') {
                // keep the grid positions so an answer given as a letter still points at the right choice
                let last = options.length;
                while (last > 0 && !options[last - 1]) last--;
                q.options = options.slice(0, Math.max(last, MIN_OPTIONS));
                while (q.options.length < MIN_OPTIONS) q.options.push('');
            }
            setCell(q, 'answer', answer);
            q.expl = cell(4 + MAX_OPTIONS);
            setCell(q, 'bonus', cell(5 + MAX_OPTIONS));
            questions.push(q);
        } else {
            if (r.length < 4 || !String(r[1] ?? '').trim()) { skipped++; return; }
            const choices = cell(2) ? cell(2).split('|').map(c => c.trim()).filter(Boolean) : [];
            const answer = cell(3);
            const row = [parseInt(cell(0), 10) || 0, String(r[1]).trim(), choices, answer, cell(4), /^(1|true|yes|bonus)$/i.test(cell(5))];
            const q = fromRow(row);
            if (q.type === 'mc' && q.correct < 0) setCell(q, 'answer', answer);   // answer given as a letter
            questions.push(q);
        }
    });
    return { questions, skipped };
};

// Raw CSV text -> { questions, skipped }.
export const fromCsvText = (text) => fromCsvRows(parseDelimited(text, detectDelimiter(text)));
