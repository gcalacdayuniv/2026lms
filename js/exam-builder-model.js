// js/exam-builder-model.js
// Pure data helpers for the Exam Builder (no DOM). The saved format is the same one the CSV upload makes:
// ExamData = [part, question, choices[], answer, explanation, isBonus]   (no choices = identification)

export const MAX_OPTIONS = 8;
export const MIN_OPTIONS = 2;
export const TYPES = [
    { id: 'mc', label: 'Multiple choice', icon: 'fa-list-ul' },
    { id: 'tf', label: 'True or False', icon: 'fa-circle-half-stroke' },
    { id: 'id', label: 'Identification', icon: 'fa-pen-to-square' }
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
    expl: '',
    bonus: false
});

const isTrueFalse = (choices) => {
    if (choices.length !== 2) return false;
    const set = choices.map(c => String(c).trim().toLowerCase()).sort().join('|');
    return set === 'false|true';
};

// One saved row -> one builder question.
export const fromRow = (row) => {
    const part = parseInt(row[0], 10) || 0;
    const choices = Array.isArray(row[2]) ? row[2].map(c => String(c ?? '')) : [];
    const answer = String(row[3] ?? '');
    const base = { id: newId(), part, text: String(row[1] ?? ''), expl: String(row[4] ?? ''), bonus: Boolean(row[5]) };
    if (choices.length === 0) {
        return { ...blankQuestion('id', part), ...base, answer };
    }
    if (isTrueFalse(choices)) {
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
    if (q.type === 'tf') return [q.part, text, ['True', 'False'], q.tf, q.expl.trim(), Boolean(q.bonus)];
    if (q.type === 'id') return [q.part, text, [], q.answer.trim(), q.expl.trim(), Boolean(q.bonus)];
    const options = q.options.map(o => o.trim()).filter(Boolean);
    const right = q.correct >= 0 && q.options[q.correct] ? q.options[q.correct].trim() : '';
    return [q.part, text, options, right, q.expl.trim(), Boolean(q.bonus)];
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
        } else if (!q.answer.trim()) {
            add('type the correct answer.');
        }
    });
    return problems;
};

// ---------- Spreadsheet view ----------
// Column order of the grid (also the order a paste fills them in).
export const COLUMNS = ['part', 'type', 'text', 'o0', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'answer', 'expl', 'bonus'];

export const letter = (i) => String.fromCharCode(65 + i);

const TYPE_WORDS = {
    mc: 'mc', 'multiple choice': 'mc', multiple: 'mc', choice: 'mc',
    tf: 'tf', 'true or false': 'tf', 'true/false': 'tf', 'true false': 'tf', boolean: 'tf',
    id: 'id', identification: 'id', 'fill in the blank': 'id', text: 'id'
};

// Sets one cell of a question from text (typed or pasted). Returns the changed question.
export const setCell = (q, col, raw) => {
    const value = String(raw ?? '');
    if (col === 'part') {
        q.part = parseInt(value, 10) || 0;
    } else if (col === 'type') {
        const t = TYPE_WORDS[value.trim().toLowerCase()];
        if (t && t !== q.type) changeType(q, t);
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

// Switches the type and keeps whatever still makes sense.
export const changeType = (q, type) => {
    if (q.type === type) return q;
    if (type === 'mc') {
        if (q.options.length < MIN_OPTIONS) q.options = ['', '', '', ''];
        q.correct = -1;
    } else if (type === 'tf') {
        q.tf = '';
    } else {
        q.answer = q.type === 'mc' && q.correct >= 0 ? (q.options[q.correct] || '') : '';
    }
    q.type = type;
    return q;
};

// Splits pasted spreadsheet text (tab separated, one row per line; quoted cells may hold line breaks).
export const parsePaste = (text) => {
    const rows = [];
    let row = [], cell = '', quoted = false;
    const src = String(text).replace(/\r\n?/g, '\n');
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (quoted) {
            if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
            else if (ch === '"') quoted = false;
            else cell += ch;
        } else if (ch === '"' && cell === '') {
            quoted = true;
        } else if (ch === '\t') {
            row.push(cell); cell = '';
        } else if (ch === '\n') {
            row.push(cell); rows.push(row); row = []; cell = '';
        } else {
            cell += ch;
        }
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
};
