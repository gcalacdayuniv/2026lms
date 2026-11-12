// worker/grading.js
// Question types, points and grading for the exam system. Pure functions, no database.
//
// A saved question row is  [part, question, choices, answer, explanation, isBonus, type, ordered, meta]
//   type:  mc, multi, tf, id, num, enum, order, match, essay   (rows saved before types existed have 6 values)
//   meta:  { points, mode: 'all', tol, extra: [] }  (any part may be missing)
//   answer by type:
//     mc / tf / id / num / essay  text
//     multi                       array of the correct choice texts
//     enum / order                array of items
//     match                       array of [left, right] pairs
//   An identification answer, or one enumeration item, may hold alternatives written "CPU / processor".
//
// Student answers by type:
//     mc / tf / id / num / essay  text
//     multi                       array of the ticked choice texts
//     enum                        array of typed items
//     order                       array of items, one per position
//     match                       array of the chosen right-hand texts, one per left-hand item (same order as the pairs)

export const ESSAY_POINTS = 5;

export const normAnswer = (v) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const meta = (q) => (q && q[8] && typeof q[8] === "object" ? q[8] : {});
const list = (v) => (Array.isArray(v) ? v : String(v ?? "").split(/\||\r?\n/));
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function questionType(q) {
    if (typeof q[6] === "string" && q[6]) return q[6];
    if (Array.isArray(q[3])) return "enum";
    const choices = Array.isArray(q[2]) ? q[2] : [];
    return choices.length === 0 ? "id" : "mc";
}

export const enumItems = (value) => list(value).map(normAnswer).filter(Boolean);

// "CPU / processor" -> ["cpu / processor", "cpu", "processor"]  (the whole text and every alternative)
export function alternatives(value) {
    const whole = normAnswer(value);
    if (!whole) return [];
    const parts = String(value).split(" / ").map(normAnswer).filter(Boolean);
    return parts.length > 1 ? [whole, ...parts] : [whole];
}

const pairsOf = (q) => (Array.isArray(q[3]) ? q[3].filter(p => Array.isArray(p)) : []);

export function questionPoints(q) {
    const set = Number(meta(q).points);
    if (Number.isFinite(set) && set > 0) return set;
    const type = questionType(q);
    if (type === "enum") return Math.max(1, enumItems(q[3]).length);
    if (type === "match") return Math.max(1, pairsOf(q).length);
    if (type === "essay") return ESSAY_POINTS;
    return 1;
}

// A student's number: "9.8", " 9,8 ", "1,000.5". Returns null when it is not a number.
export function parseNumber(value) {
    let s = String(value ?? "").trim().replace(/\s+/g, "");
    if (!s) return null;
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
    else if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", ".");
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v]);

// Share (0 to 1) of the question answered correctly. An essay is not graded here.
export function gradeFraction(q, studentAnswer) {
    const type = questionType(q);
    const m = meta(q);

    if (type === "essay") return 0;

    if (type === "multi") {
        const key = new Set(enumItems(q[3]));
        const given = new Set(asList(studentAnswer).map(normAnswer).filter(Boolean));
        if (!key.size || !given.size) return 0;
        let hits = 0, wrong = 0;
        given.forEach(g => { if (key.has(g)) hits++; else wrong++; });
        if (m.mode === "all") return hits === key.size && wrong === 0 ? 1 : 0;
        return Math.max(0, (hits - wrong) / key.size);
    }

    if (type === "enum") {
        const key = (Array.isArray(q[3]) ? q[3] : list(q[3])).map(alternatives).filter(a => a.length);
        const given = asList(studentAnswer).map(normAnswer).filter(Boolean);
        if (!key.length || !given.length) return 0;
        if (q[7]) {
            let hit = 0;
            key.forEach((alts, i) => { if (given[i] && alts.includes(given[i])) hit++; });
            return hit / key.length;
        }
        const used = new Array(key.length).fill(false);
        let hit = 0;
        given.forEach(item => {
            const at = key.findIndex((alts, i) => !used[i] && alts.includes(item));
            if (at >= 0) { used[at] = true; hit++; }
        });
        return hit / key.length;
    }

    if (type === "order") {
        const key = enumItems(q[3]);
        const given = asList(studentAnswer).map(normAnswer);
        if (!key.length) return 0;
        let hit = 0;
        key.forEach((item, i) => { if (given[i] === item) hit++; });
        if (m.mode === "all") return hit === key.length ? 1 : 0;
        return hit / key.length;
    }

    if (type === "match") {
        const pairs = pairsOf(q);
        const given = asList(studentAnswer).map(normAnswer);
        if (!pairs.length) return 0;
        let hit = 0;
        pairs.forEach((p, i) => { if (given[i] && given[i] === normAnswer(p[1])) hit++; });
        return hit / pairs.length;
    }

    if (type === "num") {
        const want = parseNumber(q[3]);
        const got = parseNumber(Array.isArray(studentAnswer) ? studentAnswer[0] : studentAnswer);
        if (want === null || got === null) return 0;
        const tol = Math.max(0, Number(m.tol) || 0);
        return Math.abs(got - want) <= tol + 1e-9 ? 1 : 0;
    }

    const answer = normAnswer(Array.isArray(studentAnswer) ? studentAnswer[0] : studentAnswer);
    if (answer === "") return 0;
    if (type === "id") return alternatives(q[3]).includes(answer) ? 1 : 0;
    return answer === normAnswer(q[3]) ? 1 : 0;   // mc, tf
}

// Points earned by one answer. mark: the lecturer's points for an essay (null until marked).
export function gradeQuestion(q, studentAnswer, mark = null) {
    const pts = questionPoints(q);
    if (questionType(q) === "essay") {
        const n = Number(mark);
        return mark === null || mark === undefined || mark === "" || !Number.isFinite(n) ? 0 : round2(Math.min(pts, Math.max(0, n)));
    }
    return round2(gradeFraction(q, studentAnswer) * pts);
}

// Total points of the regular (not bonus) questions, at least 1.
export function examMaxPoints(questions) {
    const total = questions.filter(q => !q[5]).reduce((sum, q) => sum + questionPoints(q), 0);
    return total > 0 ? round2(total) : Math.max(1, questions.length);
}

// Indexes of the questions the lecturer has to mark.
export const essayIndexes = (questions) => questions.map((q, i) => (questionType(q) === "essay" ? i : -1)).filter(i => i >= 0);

// answers: array (by question index); marks: { [index]: points } or null.
export function scoreExam(questions, answers, marks) {
    let raw = 0, bonus = 0, pending = 0;
    const markMap = marks && typeof marks === "object" ? marks : {};
    questions.forEach((q, i) => {
        const isEssay = questionType(q) === "essay";
        const mark = isEssay && Object.prototype.hasOwnProperty.call(markMap, i) ? markMap[i] : null;
        if (isEssay && mark === null) pending++;
        const earned = gradeQuestion(q, (answers || [])[i], mark);
        if (q[5]) bonus += earned; else raw += earned;
    });
    return { raw: round2(raw), bonus: round2(bonus), pending };
}

// ---------- What a student is allowed to see ----------

function hashSeed(text) {
    let h = 1779033703 ^ text.length;
    for (let i = 0; i < text.length; i++) {
        h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return () => {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return (h ^= h >>> 16) >>> 0;
    };
}

// Same seed, same order: the exam looks the same every time the student opens it.
export function seededShuffle(items, seed) {
    const next = hashSeed(String(seed));
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = next() % (i + 1);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Every question of the exam without its answers.
export function studentQuestion(q, index, seed) {
    const type = questionType(q);
    const m = meta(q);
    const out = {
        index,
        part: q[0],
        question: q[1],
        choices: type === "mc" || type === "tf" || type === "multi" ? (Array.isArray(q[2]) ? q[2] : []) : [],
        isBonus: Boolean(q[5]),
        type,
        points: questionPoints(q),
        mode: m.mode === "all" ? "all" : "partial",
        ordered: Boolean(q[7]),
        itemCount: type === "enum" || type === "order" ? enumItems(q[3]).length : 0
    };
    if (type === "match") {
        const pairs = pairsOf(q);
        out.lefts = pairs.map(p => String(p[0] ?? ""));
        const seen = new Set();
        const rights = [];
        pairs.map(p => String(p[1] ?? "")).concat(asList(m.extra).map(String)).forEach(r => {
            const k = normAnswer(r);
            if (k && !seen.has(k)) { seen.add(k); rights.push(r); }
        });
        out.rights = seededShuffle(rights, `${seed}:${index}:r`);
    }
    if (type === "order") {
        const key = Array.isArray(q[3]) ? q[3].map(String) : [];
        let items = seededShuffle(key, `${seed}:${index}:o`);
        // never show the answer: if the shuffle left the correct order, rotate by one
        if (items.length > 1 && items.every((it, i) => normAnswer(it) === normAnswer(key[i]))) items = items.slice(1).concat(items[0]);
        out.items = items;
    }
    return out;
}
