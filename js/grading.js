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

// answers: array (by question index); marks: { [index]: points } or null;
// adjustments: { [index]: "credit" | "drop" } set by the lecturer after the exam.
//   credit = every student gets full points for the question; drop = the question is not counted and the
//   rest of the exam is scaled up to the same maximum (scale). Final score = (raw + bonus) * scale.
export function scoreExam(questions, answers, marks, adjustments) {
    let raw = 0, bonus = 0, pending = 0, dropped = 0;
    const markMap = marks && typeof marks === "object" ? marks : {};
    const adj = adjustments && typeof adjustments === "object" ? adjustments : {};
    questions.forEach((q, i) => {
        const a = adj[i];
        if (a === "drop") { if (!q[5]) dropped += questionPoints(q); return; }
        const isEssay = questionType(q) === "essay";
        let earned;
        if (a === "credit") {
            earned = questionPoints(q);
        } else {
            const mark = isEssay && Object.prototype.hasOwnProperty.call(markMap, i) ? markMap[i] : null;
            if (isEssay && mark === null) pending++;
            earned = gradeQuestion(q, (answers || [])[i], mark);
        }
        if (q[5]) bonus += earned; else raw += earned;
    });
    const max = examMaxPoints(questions);
    const scale = dropped > 0 && max - dropped > 0 ? max / (max - dropped) : 1;
    return { raw: round2(raw), bonus: round2(bonus), pending, scale };
}

// Final score of one student: scaled, never above the maximum.
export const finalScoreOf = (scored, maxScore) => Math.min(maxScore, round2((scored.raw + scored.bonus) * scored.scale));

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

// ---------- Results analysis ----------

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

// Statistics of one question over the submitted answers.
// answers: one student answer per entry; marks: the lecturer's essay mark per entry (or null).
export function questionStats(q, index, answers, marks) {
    const type = questionType(q);
    const points = questionPoints(q);
    const n = answers.length;
    const out = { index, part: q[0], question: q[1], type, points, isBonus: Boolean(q[5]), submitted: n };

    const earned = answers.map((a, i) => gradeQuestion(q, a, marks ? marks[i] : null));
    const answeredCount = answers.filter(a => (Array.isArray(a) ? a.some(x => String(x).trim()) : String(a ?? "").trim() !== "")).length;
    out.answered = answeredCount;

    if (type === "essay") {
        const marked = (marks || []).filter(m => m !== null && m !== undefined);
        out.marked = marked.length;
        out.avgPct = marked.length ? pct(marked.reduce((s, m) => s + Math.min(points, Number(m) || 0), 0), marked.length * points) : null;
        out.fullPct = null;
        return out;
    }

    out.avgPct = pct(earned.reduce((s, v) => s + v, 0), n * points);
    out.fullPct = pct(earned.filter(v => v >= points - 1e-9).length, n);

    if (type === "mc" || type === "tf" || type === "multi") {
        const choices = Array.isArray(q[2]) ? q[2] : [];
        const key = type === "multi" ? new Set(enumItems(q[3])) : new Set([normAnswer(q[3])]);
        const counts = choices.map(() => 0);
        answers.forEach(a => {
            const picked = new Set(asList(a).map(normAnswer));
            choices.forEach((c, i) => { if (picked.has(normAnswer(c))) counts[i]++; });
        });
        out.options = choices.map((c, i) => ({ text: String(c), count: counts[i], pct: pct(counts[i], n), correct: key.has(normAnswer(c)) }));
    } else if (type === "id" || type === "num") {
        const tally = new Map();
        answers.forEach((a, i) => {
            const text = String(Array.isArray(a) ? a[0] : a ?? "").trim();
            if (!text || earned[i] >= points - 1e-9) return;
            const k = normAnswer(text);
            const cur = tally.get(k) || { text, count: 0 };
            cur.count++;
            tally.set(k, cur);
        });
        out.commonWrong = [...tally.values()].sort((a, b) => b.count - a.count).slice(0, 3);
    } else if (type === "match") {
        const pairs = pairsOf(q);
        out.parts = pairs.map((p, i) => ({
            label: `${p[0]} → ${p[1]}`,
            pct: pct(answers.filter(a => asList(a).map(normAnswer)[i] === normAnswer(p[1])).length, n)
        }));
    } else if (type === "order") {
        const key = enumItems(q[3]);
        out.parts = key.map((item, i) => ({
            label: `${i + 1}. ${q[3][i]}`,
            pct: pct(answers.filter(a => asList(a).map(normAnswer)[i] === item).length, n)
        }));
    }
    return out;
}

const median = (sorted) => {
    if (!sorted.length) return null;
    const m = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
};

// Class summary from the final scores. scores: [{score, max}]
export function scoreSummary(scores, passPercent = 60) {
    const pcts = scores.map(s => (s.max > 0 ? (s.score / s.max) * 100 : 0));
    const sorted = pcts.slice().sort((a, b) => a - b);
    const buckets = new Array(10).fill(0);
    pcts.forEach(p => { buckets[Math.min(9, Math.max(0, Math.floor(p / 10)))]++; });
    const mean = pcts.length ? pcts.reduce((s, v) => s + v, 0) / pcts.length : null;
    const r1 = (v) => (v === null ? null : Math.round(v * 10) / 10);
    return {
        count: pcts.length,
        mean: r1(mean),
        median: r1(median(sorted)),
        high: r1(sorted.length ? sorted[sorted.length - 1] : null),
        low: r1(sorted.length ? sorted[0] : null),
        passPercent,
        passRate: pcts.length ? r1((pcts.filter(p => p >= passPercent).length / pcts.length) * 100) : null,
        buckets
    };
}


// ---------- Item analysis ----------
// For every question that is not an essay: difficulty (share of the points students earned) and discrimination
// (how much better the top 27% of students did than the bottom 27%), plus flags worth a second look.
export function itemAnalysis(questions, answerSets, markSets) {
    const n = answerSets.length;
    const earned = answerSets.map((answers, s) => questions.map((q, i) => {
        const m = markSets[s] || {};
        return gradeQuestion(q, answers[i], Object.prototype.hasOwnProperty.call(m, i) ? m[i] : null);
    }));
    const totals = earned.map(row => row.reduce((a, b) => a + b, 0));
    const order = totals.map((t, i) => i).sort((a, b) => totals[b] - totals[a]);
    const k = Math.max(1, Math.round(n * 0.27));
    const upper = order.slice(0, k), lower = order.slice(n - k);
    return questions.map((q, i) => {
        if (questionType(q) === "essay" || n === 0) return { difficulty: null, discrimination: null, flags: [] };
        const pts = questionPoints(q);
        const frac = (rows) => (rows.length ? rows.reduce((s, r) => s + earned[r][i] / pts, 0) / rows.length : 0);
        const difficulty = round2(earned.reduce((s, row) => s + row[i] / pts, 0) / n);
        const disc = n >= 8 ? round2(frac(upper) - frac(lower)) : null;
        const flags = [];
        if (difficulty < 0.2) flags.push("hard");
        if (difficulty > 0.95 && n >= 5) flags.push("easy");
        if (disc !== null && disc < 0) flags.push("negative");
        else if (disc !== null && disc < 0.2 && difficulty <= 0.95) flags.push("weak");
        return { difficulty, discrimination: disc, flags };
    });
}

// One question as the student sees it in a review: their answer, the right answer, and what they earned.
export function reviewQuestion(q, index, answer, mark) {
    const type = questionType(q);
    const m = meta(q);
    let correct = null;
    if (type === "mc" || type === "tf" || type === "id" || type === "num") correct = String(q[3] ?? "");
    else if (type === "multi" || type === "enum" || type === "order") correct = asList(q[3]).map(String);
    else if (type === "match") correct = pairsOf(q).map(p => `${p[0]} → ${p[1]}`);
    return {
        index,
        part: q[0],
        question: q[1],
        type,
        choices: Array.isArray(q[2]) ? q[2].map(String) : [],
        isBonus: Boolean(q[5]),
        points: questionPoints(q),
        earned: gradeQuestion(q, answer, mark),
        answer: Array.isArray(answer) ? answer.map(String) : String(answer ?? ""),
        correct,
        ordered: Boolean(q[7]),
        explanation: String(q[4] ?? ""),
        marked: type === "essay" ? mark !== null && mark !== undefined : true
    };
}
