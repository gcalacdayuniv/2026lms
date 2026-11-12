// js/exam-builder-model.js
// Pure data helpers for the Exam Builder and the CSV import/export (no DOM).
//
// One saved question row:
//   [part, question, choices[], answer, explanation, isBonus, type, ordered, meta]
//   type:  'mc' multiple choice | 'multi' multiple answer | 'tf' true or false | 'id' identification |
//          'num' numeric | 'enum' enumeration | 'order' ordering | 'match' matching | 'essay' essay (scored by hand)
//   Rows saved before types existed have only the first six values; their type is worked out from the choices.
//   answer: mc/tf/id/num/essay = text | multi = array of the correct choices | enum, order = array of items |
//           match = array of [left, right] pairs
//   ordered: enumeration only. The order of the items matters.
//   meta (optional object): points (number), mode ('all' = all or nothing, for multi and order),
//           tol (number, numeric tolerance), extra (array, wrong right-hand choices of a matching question)
//   Several accepted answers of an identification question, or of one enumeration item, are written
//   "CPU / Central Processing Unit" (space, slash, space).
//
// One spreadsheet / CSV row (same columns in the builder grid, the CSV upload and the CSV export):
//   Part | Type | Question | Choice A ... Choice H | Answer | Explanation | Bonus | Points

export const MAX_OPTIONS = 8;
export const MIN_OPTIONS = 2;
export const MAX_ITEMS = 30;
export const MIN_ITEMS = 2;
export const MAX_PAIRS = 8;
export const MIN_PAIRS = 2;
export const MAX_POINTS = 100;
export const ESSAY_POINTS = 5;

export const TYPES = [
    { id: 'mc', label: 'Multiple choice', icon: 'fa-list-ul' },
    { id: 'multi', label: 'Multiple answer', icon: 'fa-square-check' },
    { id: 'tf', label: 'True or False', icon: 'fa-circle-half-stroke' },
    { id: 'id', label: 'Identification', icon: 'fa-pen-to-square' },
    { id: 'num', label: 'Numeric', icon: 'fa-calculator' },
    { id: 'enum', label: 'Enumeration', icon: 'fa-list-ol' },
    { id: 'order', label: 'Ordering', icon: 'fa-arrow-down-1-9' },
    { id: 'match', label: 'Matching', icon: 'fa-right-left' },
    { id: 'essay', label: 'Essay', icon: 'fa-align-left' }
];

// The spreadsheet type list also separates ordered enumerations and the all-or-nothing variants.
export const SHEET_TYPES = [
    { key: 'mc', label: 'Multiple choice' },
    { key: 'multi', label: 'Multiple answer' },
    { key: 'multia', label: 'Multiple answer (all or nothing)' },
    { key: 'tf', label: 'True or False' },
    { key: 'id', label: 'Identification' },
    { key: 'num', label: 'Numeric' },
    { key: 'enum', label: 'Enumeration' },
    { key: 'enumo', label: 'Enumeration (ordered)' },
    { key: 'order', label: 'Ordering' },
    { key: 'ordera', label: 'Ordering (all or nothing)' },
    { key: 'match', label: 'Matching' },
    { key: 'essay', label: 'Essay' }
];

let seq = 0;
export const newId = () => `q${Date.now().toString(36)}${(++seq).toString(36)}`;

export const blankQuestion = (type = 'mc', part = 0) => ({
    id: newId(),
    type,
    part,
    text: '',
    options: type === 'mc' || type === 'multi' ? ['', '', '', ''] : [],
    correct: -1,          // multiple choice: index of the right option
    corrects: [],         // multiple answer: indexes of the right options
    tf: '',               // true or false: 'True' | 'False'
    answer: '',           // identification, numeric, essay: the answer (essay: model answer or rubric)
    tol: '',              // numeric: accepted difference, as text ('' = exact)
    items: type === 'enum' || type === 'order' ? ['', '', ''] : [],   // enumeration / ordering: the items
    ordered: false,       // enumeration: the order matters
    pairs: type === 'match' ? [{ l: '', r: '' }, { l: '', r: '' }, { l: '', r: '' }] : [],   // matching
    extra: [],            // matching: wrong choices on the right-hand side
    mode: 'partial',      // multiple answer / ordering: 'partial' credit or 'all' or nothing
    points: '',           // '' = the default of the type
    expl: '',
    bonus: false
});

export const typeKey = (q) => {
    if (q.type === 'enum' && q.ordered) return 'enumo';
    if (q.type === 'multi' && q.mode === 'all') return 'multia';
    if (q.type === 'order' && q.mode === 'all') return 'ordera';
    return q.type;
};
export const typeLabel = (q) => (SHEET_TYPES.find(t => t.key === typeKey(q)) || SHEET_TYPES[0]).label;

const filled = (list) => list.map(i => String(i ?? '').trim()).filter(Boolean);
const filledPairs = (q) => q.pairs.filter(p => p.l.trim() && p.r.trim());

// Points of a question when none are set: 1, one per item or pair, or 5 for an essay.
export const defaultPoints = (q) => {
    if (q.type === 'enum') return Math.max(1, filled(q.items).length);
    if (q.type === 'match') return Math.max(1, filledPairs(q).length);
    if (q.type === 'essay') return ESSAY_POINTS;
    return 1;
};

export const parsePoints = (value) => {
    const n = Number(String(value ?? '').trim());
    return Number.isFinite(n) && n > 0 && n <= MAX_POINTS ? Math.round(n * 100) / 100 : null;
};

// How many points a question is worth.
export const pointsOf = (q) => parsePoints(q.points) ?? defaultPoints(q);

// "9,5" or "1,250.5" -> number, or null.
export const parseNumber = (value) => {
    let s = String(value ?? '').trim().replace(/\s/g, '');
    if (!s) return null;
    if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
};

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
    const meta = row[8] && typeof row[8] === 'object' ? row[8] : {};
    const base = {
        id: newId(), part, text: String(row[1] ?? ''), expl: String(row[4] ?? ''), bonus: Boolean(row[5]),
        points: parsePoints(meta.points) !== null ? String(parsePoints(meta.points)) : ''
    };
    const saved = typeof row[6] === 'string' ? row[6] : '';
    const make = (type, extra) => ({ ...blankQuestion(type, part), ...base, ...extra });

    if (saved === 'multi') {
        const options = choices.slice(0, MAX_OPTIONS);
        const rights = filled(Array.isArray(rawAnswer) ? rawAnswer : [rawAnswer]).map(a => a.toLowerCase());
        const corrects = options.map((o, i) => (rights.includes(o.trim().toLowerCase()) ? i : -1)).filter(i => i >= 0);
        return make('multi', { options, corrects, mode: meta.mode === 'all' ? 'all' : 'partial' });
    }
    if (saved === 'match') {
        const pairs = (Array.isArray(rawAnswer) ? rawAnswer : []).map(p => ({ l: String(p[0] ?? ''), r: String(p[1] ?? '') }));
        return make('match', { pairs: pairs.length ? pairs.slice(0, MAX_PAIRS) : blankQuestion('match').pairs, extra: filled(meta.extra || []) });
    }
    if (saved === 'order') {
        const items = (Array.isArray(rawAnswer) ? rawAnswer : []).map(i => String(i ?? '').trim());
        return make('order', { items: items.length ? items : ['', '', ''], mode: meta.mode === 'all' ? 'all' : 'partial' });
    }
    if (saved === 'num') {
        return make('num', { answer: String(rawAnswer ?? ''), tol: meta.tol !== undefined && meta.tol !== null ? String(meta.tol) : '' });
    }
    if (saved === 'essay') {
        return make('essay', { answer: String(rawAnswer ?? '') });
    }
    if (saved === 'enum' || (!saved && Array.isArray(rawAnswer))) {
        const items = (Array.isArray(rawAnswer) ? rawAnswer : String(rawAnswer ?? '').split('|')).map(i => String(i ?? '').trim());
        return make('enum', { items: items.length ? items : ['', '', ''], ordered: Boolean(row[7]) });
    }
    const answer = String(rawAnswer ?? '');
    if (saved === 'id' || (!saved && choices.length === 0)) {
        return make('id', { answer });
    }
    if (saved === 'tf' || (!saved && isTrueFalse(choices))) {
        const tf = answer.trim().toLowerCase() === 'true' ? 'True' : answer.trim().toLowerCase() === 'false' ? 'False' : '';
        return make('tf', { tf });
    }
    const options = choices.slice(0, MAX_OPTIONS);
    const correct = options.findIndex(c => c.trim() === answer.trim());
    return make('mc', { options, correct });
};

export const fromExamData = (rows) => (Array.isArray(rows) ? rows : []).map(fromRow);

// One builder question -> one saved row.
export const toRow = (q) => {
    const text = q.text.trim();
    const expl = q.expl.trim();
    const bonus = Boolean(q.bonus);
    const meta = {};
    const pts = parsePoints(q.points);
    if (pts !== null) meta.points = pts;
    const done = (choices, answer, ordered = false) => {
        const row = [q.part, text, choices, answer, expl, bonus, q.type, ordered];
        if (Object.keys(meta).length) row.push(meta);
        return row;
    };

    if (q.type === 'tf') return done(['True', 'False'], q.tf);
    if (q.type === 'id') return done([], q.answer.trim());
    if (q.type === 'enum') return done([], filled(q.items), Boolean(q.ordered));
    if (q.type === 'num') {
        const tol = parseNumber(q.tol);
        if (tol !== null && tol > 0) meta.tol = tol;
        const n = parseNumber(q.answer);
        return done([], n === null ? q.answer.trim() : String(n));
    }
    if (q.type === 'essay') return done([], q.answer.trim());
    if (q.type === 'order') {
        if (q.mode === 'all') meta.mode = 'all';
        return done([], filled(q.items));
    }
    if (q.type === 'match') {
        if (filled(q.extra).length) meta.extra = filled(q.extra);
        return done([], filledPairs(q).map(p => [p.l.trim(), p.r.trim()]));
    }
    if (q.type === 'multi') {
        if (q.mode === 'all') meta.mode = 'all';
        return done(filled(q.options), q.corrects.filter(i => q.options[i] && q.options[i].trim()).map(i => q.options[i].trim()));
    }
    const options = filled(q.options);
    const right = q.correct >= 0 && q.options[q.correct] ? q.options[q.correct].trim() : '';
    return done(options, right);
};

const dupes = (list) => new Set(list.map(o => o.toLowerCase())).size !== list.length;

// Returns a list of { id, message } problems; empty = ready to save.
export const validate = (title, questions) => {
    const problems = [];
    if (!String(title || '').trim()) problems.push({ id: null, message: 'Give the exam a title.' });
    if (questions.length === 0) problems.push({ id: null, message: 'Add at least one question.' });
    questions.forEach((q, i) => {
        const add = (message) => problems.push({ id: q.id, message: `Question ${i + 1}: ${message}` });
        if (!q.text.trim()) add('write the question.');
        if (String(q.points).trim() !== '' && parsePoints(q.points) === null) add(`points must be a number from 0.01 to ${MAX_POINTS}.`);
        if (q.type === 'mc' || q.type === 'multi') {
            const opts = filled(q.options);
            if (opts.length < MIN_OPTIONS) add('needs at least 2 choices.');
            if (dupes(opts)) add('two choices are the same.');
            if (q.type === 'mc') {
                if (q.correct < 0 || !q.options[q.correct] || !q.options[q.correct].trim()) add('select the correct answer.');
            } else if (!q.corrects.some(k => q.options[k] && q.options[k].trim())) {
                add('tick at least one correct answer.');
            }
        } else if (q.type === 'tf') {
            if (q.tf !== 'True' && q.tf !== 'False') add('select True or False as the answer.');
        } else if (q.type === 'enum' || q.type === 'order') {
            const items = filled(q.items);
            const noun = q.type === 'enum' ? 'an enumeration' : 'an ordering';
            if (items.length < MIN_ITEMS) add(`${noun} needs at least 2 items.`);
            if (dupes(items)) add('two items are the same.');
        } else if (q.type === 'match') {
            if (filledPairs(q).length < MIN_PAIRS) add('matching needs at least 2 complete pairs.');
            if (dupes(filledPairs(q).map(p => p.l.trim()))) add('two left-hand items are the same.');
        } else if (q.type === 'num') {
            if (parseNumber(q.answer) === null) add('type the correct number.');
            if (String(q.tol).trim() !== '' && (parseNumber(q.tol) === null || parseNumber(q.tol) < 0)) add('the tolerance must be a number, 0 or more.');
        } else if (q.type === 'id') {
            if (!q.answer.trim()) add('type the correct answer.');
        }
    });
    return problems;
};

// ---------- Spreadsheet view ----------
// Column order of the grid, the CSV and a paste.
export const COLUMNS = ['part', 'type', 'text', 'o0', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'answer', 'expl', 'bonus', 'points'];

export const letter = (i) => String.fromCharCode(65 + i);

const TYPE_WORDS = {
    mc: 'mc', 'multiple choice': 'mc', choice: 'mc',
    multi: 'multi', 'multiple answer': 'multi', 'multiple answers': 'multi', 'select all': 'multi', checkbox: 'multi',
    multia: 'multia', 'multiple answer (all or nothing)': 'multia', 'multiple answer all or nothing': 'multia',
    tf: 'tf', 'true or false': 'tf', 'true/false': 'tf', 'true false': 'tf', boolean: 'tf',
    id: 'id', identification: 'id', 'fill in the blank': 'id', text: 'id',
    num: 'num', numeric: 'num', number: 'num', numerical: 'num',
    enum: 'enum', enumeration: 'enum', enumerate: 'enum', list: 'enum',
    enumo: 'enumo', 'enumeration (ordered)': 'enumo', 'ordered enumeration': 'enumo', 'enumeration ordered': 'enumo',
    order: 'order', ordering: 'order', sequence: 'order', sequencing: 'order',
    ordera: 'ordera', 'ordering (all or nothing)': 'ordera', 'ordering all or nothing': 'ordera',
    match: 'match', matching: 'match', 'matching type': 'match',
    essay: 'essay', 'short answer': 'essay', 'essay / short answer': 'essay'
};

export const parseTypeWord = (word) => TYPE_WORDS[String(word || '').trim().toLowerCase()] || '';

// Items typed in one cell: separated by | or line breaks.
export const splitItems = (value) => String(value ?? '').split(/\||\r?\n/).map(s => s.trim()).filter(Boolean);

// Switches the type and keeps whatever still makes sense. key can also be 'enumo', 'multia' or 'ordera'.
export const changeType = (q, key) => {
    const type = key === 'enumo' ? 'enum' : key === 'multia' ? 'multi' : key === 'ordera' ? 'order' : key;
    const was = q.type;
    if (type === 'enum') q.ordered = key === 'enumo';
    if (type === 'multi') q.mode = key === 'multia' ? 'all' : 'partial';
    if (type === 'order') q.mode = key === 'ordera' ? 'all' : 'partial';
    if (was === type) return q;

    const lines = () => (was === 'enum' || was === 'order' ? filled(q.items) : was === 'id' ? splitItems(q.answer) : []);
    if (type === 'mc' || type === 'multi') {
        if (was === 'mc' || was === 'multi') {
            if (type === 'multi') q.corrects = q.correct >= 0 ? [q.correct] : [];
            else q.correct = q.corrects.length ? q.corrects[0] : -1;
        } else {
            q.options = ['', '', '', ''];
            q.correct = -1;
            q.corrects = [];
        }
    } else if (type === 'tf') {
        q.tf = '';
    } else if (type === 'enum' || type === 'order') {
        const carried = lines();
        q.items = carried.length ? carried : ['', '', ''];
    } else if (type === 'match') {
        if (!q.pairs.length) q.pairs = blankQuestion('match').pairs;
    } else if (type === 'num') {
        q.answer = parseNumber(q.answer) !== null ? q.answer : '';
    } else if (type === 'id' || type === 'essay') {
        if (was === 'mc') q.answer = q.correct >= 0 ? (q.options[q.correct] || '') : '';
        else if (was === 'enum' || was === 'order') q.answer = filled(q.items).join(' | ');
        else if (was !== 'id' && was !== 'essay' && was !== 'num') q.answer = '';
    }
    q.type = type;
    return q;
};

const LETTERS_ONLY = /^[A-Ha-h]([\s,;]+[A-Ha-h])*$/;

// "9.8 ± 0.1", "9.8 +- 0.1" or "9.8" -> { value, tol }
const splitNumeric = (value) => {
    const m = /^(.*?)\s*(?:±|\+\/-|\+-)\s*(.*)$/.exec(String(value));
    return m ? { value: m[1].trim(), tol: m[2].trim() } : { value: String(value).trim(), tol: '' };
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
        if (q.type === 'mc' || q.type === 'multi') {
            while (q.options.length <= idx) q.options.push('');
            q.options[idx] = value;
        } else if (q.type === 'match') {
            while (q.pairs.length <= idx) q.pairs.push({ l: '', r: '' });
            const at = value.indexOf('|');
            q.pairs[idx] = at >= 0 ? { l: value.slice(0, at).trim(), r: value.slice(at + 1).trim() } : { l: value.trim(), r: '' };
        }
    } else if (col === 'answer') {
        if (q.type === 'mc') {
            const v = value.trim();
            let idx = -1;
            if (/^[A-Ha-h]$/.test(v)) idx = v.toUpperCase().charCodeAt(0) - 65;
            else idx = q.options.findIndex(o => o.trim().toLowerCase() === v.toLowerCase());
            q.correct = idx >= 0 && idx < q.options.length ? idx : -1;
        } else if (q.type === 'multi') {
            const v = value.trim();
            const tokens = LETTERS_ONLY.test(v) ? v.split(/[\s,;]+/) : splitItems(v);
            q.corrects = [...new Set(tokens.map(t => {
                if (/^[A-Ha-h]$/.test(t)) return t.toUpperCase().charCodeAt(0) - 65;
                return q.options.findIndex(o => o.trim().toLowerCase() === t.toLowerCase());
            }).filter(i => i >= 0 && i < q.options.length))];
        } else if (q.type === 'tf') {
            const v = value.trim().toLowerCase();
            q.tf = v === 'true' || v === 't' ? 'True' : v === 'false' || v === 'f' ? 'False' : '';
        } else if (q.type === 'enum' || q.type === 'order') {
            const items = splitItems(value).slice(0, MAX_ITEMS);
            q.items = items.length ? items : ['', '', ''];
        } else if (q.type === 'match') {
            q.extra = splitItems(value);
        } else if (q.type === 'num') {
            const { value: v, tol } = splitNumeric(value);
            q.answer = v;
            if (tol !== '' || /±|\+-|\+\/-/.test(value)) q.tol = tol;
        } else {
            q.answer = value;
        }
    } else if (col === 'expl') {
        q.expl = value;
    } else if (col === 'bonus') {
        const v = value.trim().toLowerCase();
        q.bonus = v === '1' || v === 'true' || v === 'yes' || v === 'bonus' || v === 'x';
    } else if (col === 'points') {
        q.points = value.trim();
    }
    return q;
};

// The text of one grid cell (the inverse of setCell). Used by the CSV export.
export const cellText = (q, col) => {
    if (col === 'part') return String(q.part);
    if (col === 'type') return typeLabel(q);
    if (col === 'text') return q.text;
    if (/^o[0-7]$/.test(col)) {
        const idx = parseInt(col.slice(1), 10);
        if (q.type === 'mc' || q.type === 'multi') return q.options[idx] || '';
        if (q.type === 'match') {
            const p = q.pairs[idx];
            return p && (p.l || p.r) ? `${p.l} | ${p.r}` : '';
        }
        return '';
    }
    if (col === 'answer') {
        if (q.type === 'mc') return q.correct >= 0 ? letter(q.correct) : '';
        if (q.type === 'multi') return q.corrects.slice().sort((a, b) => a - b).map(letter).join(', ');
        if (q.type === 'tf') return q.tf;
        if (q.type === 'enum' || q.type === 'order') return filled(q.items).join(' | ');
        if (q.type === 'match') return filled(q.extra).join(' | ');
        if (q.type === 'num') return String(q.tol).trim() !== '' ? `${q.answer} ± ${q.tol}` : q.answer;
        return q.answer;
    }
    if (col === 'expl') return q.expl;
    if (col === 'bonus') return q.bonus ? 'Yes' : '';
    if (col === 'points') return q.points;
    return '';
};

// Splits pasted spreadsheet text (tab separated, one row per line; quoted cells may hold line breaks).
export const parsePaste = (text) => parseDelimited(text, '\t');

// ---------- CSV ----------

export const CSV_HEADER = ['Part', 'Type', 'Question', ...Array.from({ length: MAX_OPTIONS }, (_, k) => `Choice ${letter(k)}`), 'Answer', 'Explanation', 'Bonus', 'Points'];

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

// A cell that starts with = + - @ would run as a formula in Excel. A leading ' keeps it text.
const csvCell = (v) => {
    let s = String(v ?? '');
    if (/^[=+@]/.test(s) || (/^-/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s))) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
};

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

const POINTS_COL = 3 + MAX_OPTIONS + 3;

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
        // Excel text marker added by the export
        const plain = (i) => cell(i).replace(/^'(?=[=+\-@])/, '');
        if (isNew) {
            const text = String(r[2] ?? '').replace(/^'(?=[=+\-@])/, '');
            if (!text.trim()) { skipped++; return; }
            const options = Array.from({ length: MAX_OPTIONS }, (_, k) => plain(3 + k));
            const answer = plain(3 + MAX_OPTIONS);
            const key = parseTypeWord(cell(1)) || inferKey(options.filter(Boolean), answer);
            const q = blankQuestion('mc', parseInt(cell(0), 10) || 0);
            setCell(q, 'type', key);
            q.text = text.trim();
            if (q.type === 'mc' || q.type === 'multi') q.options = [];
            if (q.type === 'match') q.pairs = [];
            options.forEach((o, k) => { if (o) setCell(q, `o${k}`, o); });
            if (q.type === 'mc' || q.type === 'multi') {
                while (q.options.length < MIN_OPTIONS) q.options.push('');
            } else if (q.type === 'match') {
                q.pairs = q.pairs.filter(p => p.l || p.r);
                while (q.pairs.length < MIN_PAIRS) q.pairs.push({ l: '', r: '' });
            }
            setCell(q, 'answer', answer);
            q.expl = plain(4 + MAX_OPTIONS);
            setCell(q, 'bonus', cell(5 + MAX_OPTIONS));
            setCell(q, 'points', cell(POINTS_COL));
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
