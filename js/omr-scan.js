// js/omr-scan.js
// Reads a photo of a printed answer sheet (see omr-sheet.js) and works out which circles are shaded.
// Pure JavaScript, no libraries. Steps:
//   1. grey image -> black/white image that copes with shadows (adaptive threshold)
//   2. find the 4 square corner markers (the big top-left one tells which way is up)
//   3. build a perspective map from sheet millimetres to photo pixels
//   4. measure how dark each circle's centre is and pick the shaded one per question
import { MULTI_BASE } from './scan-codes.js';
import { FRAME, BUBBLE_D, STU_BUBBLE_D, answerRows, studentCols, setBubbles } from './omr-sheet.js';

const MAX_SIDE = 1600;     // the photo is shrunk to this size before reading
const MARK_MIN = 0.40;     // share of dark pixels in a circle that counts as shaded
const CLEAR_GAP = 0.30;    // when two circles are shaded, the darker one must lead by this much
const SAMPLE_R = 1.25;     // mm, sampled radius inside a circle (stays clear of the printed ring)
const SHIFT = 0.5;         // mm, the circle centre is searched +/- this much to forgive small errors

// Answer codes
export const BLANK = -1;
export const MULTIPLE = -2;

export const toGray = (rgba, w, h) => {
    const g = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) {
        g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
    }
    return g;
};

// 1 = dark. A pixel is dark when it is clearly darker than the average around it.
export const adaptiveBinary = (gray, w, h) => {
    const W = w + 1;
    const integral = new Uint32Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
        let row = 0;
        for (let x = 0; x < w; x++) {
            row += gray[y * w + x];
            integral[(y + 1) * W + x + 1] = integral[y * W + x + 1] + row;
        }
    }
    const half = Math.max(8, Math.round(Math.min(w, h) / 14));
    const bin = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        const y0 = Math.max(0, y - half);
        const y1 = Math.min(h, y + half + 1);
        for (let x = 0; x < w; x++) {
            const x0 = Math.max(0, x - half);
            const x1 = Math.min(w, x + half + 1);
            const sum = integral[y1 * W + x1] - integral[y0 * W + x1] - integral[y1 * W + x0] + integral[y0 * W + x0];
            const mean = sum / ((x1 - x0) * (y1 - y0));
            if (gray[y * w + x] < mean * 0.82) bin[y * w + x] = 1;
        }
    }
    return bin;
};

// Connected groups of dark pixels (4-neighbour flood fill, no recursion).
export const findBlobs = (bin, w, h) => {
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    const blobs = [];
    for (let s = 0; s < w * h; s++) {
        if (!bin[s] || seen[s]) continue;
        let sp = 0;
        stack[sp++] = s;
        seen[s] = 1;
        let area = 0, minX = w, maxX = 0, minY = h, maxY = 0, sx = 0, sy = 0;
        while (sp) {
            const p = stack[--sp];
            const x = p % w;
            const y = (p - x) / w;
            area++; sx += x; sy += y;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (x > 0 && bin[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
            if (x < w - 1 && bin[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
            if (y > 0 && bin[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
            if (y < h - 1 && bin[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
        }
        if (area >= 30) blobs.push({ area, minX, maxX, minY, maxY, cx: sx / area, cy: sy / area });
    }
    return blobs;
};

// Returns the 4 marker centres in sheet order [top-left, top-right, bottom-right, bottom-left], or null.
export const findMarkers = (blobs, w, h) => {
    const solid = blobs.filter(b => {
        const bw = b.maxX - b.minX + 1;
        const bh = b.maxY - b.minY + 1;
        const asp = bw / bh;
        const fill = b.area / (bw * bh);
        const touchesEdge = b.minX <= 0 || b.minY <= 0 || b.maxX >= w - 1 || b.maxY >= h - 1;
        return !touchesEdge && asp > 0.5 && asp < 2 && fill > 0.45 &&
            b.area > w * h * 0.0003 && b.area < w * h * 0.06;
    });
    if (solid.length < 4) return null;

    const maxArea = Math.max(...solid.map(b => b.area));
    const big = solid.filter(b => b.area >= maxArea * 0.3);
    if (big.length < 4) return null;

    const pick = (score) => big.reduce((best, b) => (score(b) > score(best) ? b : best), big[0]);
    const corners = [
        pick(b => -(b.cx + b.cy)),
        pick(b => b.cx - b.cy),
        pick(b => b.cx + b.cy),
        pick(b => -(b.cx - b.cy))
    ];
    if (new Set(corners).size !== 4) return null;

    const mx = corners.reduce((a, b) => a + b.cx, 0) / 4;
    const my = corners.reduce((a, b) => a + b.cy, 0) / 4;
    corners.sort((a, b) => Math.atan2(a.cy - my, a.cx - mx) - Math.atan2(b.cy - my, b.cx - mx));

    // The largest marker is the top-left one: turn the list so it comes first.
    let start = 0;
    corners.forEach((b, i) => { if (b.area > corners[start].area) start = i; });
    const ordered = [0, 1, 2, 3].map(i => corners[(start + i) % 4]);

    const dist = (a, b) => Math.hypot(a.cx - b.cx, a.cy - b.cy);
    const ratio = dist(ordered[0], ordered[1]) / dist(ordered[1], ordered[2]);
    if (!(ratio > 0.5 && ratio < 1.0)) return null;   // the sheet is 180 x 240 (0.75)

    return ordered.map(b => [b.cx, b.cy]);
};

// Perspective map from src[4] points to dst[4] points (3x3 matrix as 9 numbers), or null.
export const solveHomography = (src, dst) => {
    const A = [];
    for (let i = 0; i < 4; i++) {
        const [x, y] = src[i];
        const [X, Y] = dst[i];
        A.push([x, y, 1, 0, 0, 0, -x * X, -y * X, X]);
        A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y, Y]);
    }
    for (let c = 0; c < 8; c++) {
        let p = c;
        for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
        if (Math.abs(A[p][c]) < 1e-12) return null;
        [A[c], A[p]] = [A[p], A[c]];
        for (let r = 0; r < 8; r++) {
            if (r === c) continue;
            const f = A[r][c] / A[c][c];
            for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
        }
    }
    const H = A.map((row, i) => row[8] / row[i]);
    H.push(1);
    return H;
};

export const applyH = (H, u, v) => {
    const d = H[6] * u + H[7] * v + 1;
    return [(H[0] * u + H[1] * v + H[2]) / d, (H[3] * u + H[4] * v + H[5]) / d];
};

const darkFraction = (bin, w, h, cx, cy, r) => {
    const r2 = r * r;
    let dark = 0, total = 0;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
            const dx = x - cx, dy = y - cy;
            if (dx * dx + dy * dy > r2) continue;
            total++;
            if (x >= 0 && y >= 0 && x < w && y < h) dark += bin[y * w + x];
        }
    }
    return total ? dark / total : 0;
};

const bubbleFill = (bin, w, h, H, u, v) => {
    const [x0, y0] = applyH(H, u, v);
    const [x1, y1] = applyH(H, u + 1, v);
    const r = SAMPLE_R * Math.hypot(x1 - x0, y1 - y0);
    let best = 0;
    for (const du of [-SHIFT, 0, SHIFT]) {
        for (const dv of [-SHIFT, 0, SHIFT]) {
            const [x, y] = applyH(H, u + du, v + dv);
            best = Math.max(best, darkFraction(bin, w, h, x, y, r));
        }
    }
    return best;
};

// Index of the shaded circle, BLANK (-1) or MULTIPLE (-2).
export const pickMark = (fills) => {
    const over = fills.map((f, i) => ({ f, i })).filter(o => o.f >= MARK_MIN).sort((a, b) => b.f - a.f);
    if (over.length === 0) return BLANK;
    if (over.length === 1) return over[0].i;
    return over[0].f - over[1].f >= CLEAR_GAP ? over[0].i : MULTIPLE;
};

// Answers from the circle fills. multiRows[i] = true when question i accepts several circles (multiple answer):
// then every shaded circle counts and the answer is MULTI_BASE + mask (BLANK when none is shaded).
export const readAnswers = (fills, multiRows = null) => fills.map((f, i) => {
    if (multiRows && multiRows[i]) {
        let mask = 0;
        f.forEach((v, k) => { if (v >= MARK_MIN) mask |= 1 << k; });
        return mask ? MULTI_BASE + mask : BLANK;
    }
    return pickMark(f);
});

// Reads a grey image. n = number of questions, c = choices per question.
export const decodeGray = (gray, w, h, n, c, sets = 0) => {
    const bin = adaptiveBinary(gray, w, h);
    const markers = findMarkers(findBlobs(bin, w, h), w, h);
    if (!markers) {
        return { ok: false, error: 'Could not find the 4 corner markers. Keep the whole sheet in view, flat, and well lit.' };
    }
    const frame = [[0, 0], [FRAME.w, 0], [FRAME.w, FRAME.h], [0, FRAME.h]];
    const H = solveHomography(frame, markers);
    if (!H) return { ok: false, error: 'The sheet position could not be worked out. Take the photo again.' };

    const studentFills = studentCols(sets).map(col => col.bubbles.map(b => bubbleFill(bin, w, h, H, b.u, b.v)));
    const digits = studentFills.map(pickMark);
    const d = digits.map(x => (x >= 0 ? String(x) : '?'));
    const studentNo = `${d[0]}${d[1]}-${d[2]}${d[3]}${d[4]}${d[5]}`;

    // n can be the list of answer cells of a mixed-type sheet (see scan-items.js) instead of a number of questions
    const cells = Array.isArray(n) ? n : null;
    const fills = (cells ? answerRows(cells, sets) : answerRows(n, c, sets)).map(r => r.bubbles.map(b => bubbleFill(bin, w, h, H, b.u, b.v)));
    const answers = readAnswers(fills, cells ? cells.map(x => x[0] === 'm') : null);

    // Which printed exam set was shaded (index, BLANK or MULTIPLE). Sheets without a SET row read as blank.
    const setFills = setBubbles().map(b => bubbleFill(bin, w, h, H, b.u, b.v));
    const setPick = pickMark(setFills);

    return { ok: true, w, h, H, markers, studentFills, studentDigits: digits, studentNo, fills, answers, setFills, setPick, cells, sets };
};

// Quick check used by the live camera: the 4 marker centres, or null. Cheap enough to run on a small frame.
export const detectMarkers = (gray, w, h) => findMarkers(findBlobs(adaptiveBinary(gray, w, h), w, h), w, h);

export const meanBrightness = (gray) => {
    let sum = 0;
    for (let i = 0; i < gray.length; i += 7) sum += gray[i];
    return sum / Math.ceil(gray.length / 7);
};

// Reads any drawable (image, canvas or live <video>) of size sw x sh.
// Adds result.canvas (the shrunken picture) for the preview.
export const scanSource = (source, sw, sh, n, c, sets = 0) => {
    const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, w, h);

    const gray = toGray(ctx.getImageData(0, 0, w, h).data, w, h);
    const result = decodeGray(gray, w, h, n, c, sets);
    result.canvas = canvas;
    return result;
};

// Reads a photo file.
export const scanImage = async (file, n, c, sets = 0) => {
    let bmp;
    try {
        bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
        bmp = await createImageBitmap(file);
    }
    const result = scanSource(bmp, bmp.width, bmp.height, n, c, sets);
    if (bmp.close) bmp.close();
    return result;
};

// Draws the reading on top of the photo: green = correct, red = wrong or double, blue = the right answer.
// key[i] is the correct choice index (or -1 when there is no key).
export const drawOverlay = (result, answers, key, digits) => {
    const canvas = result.canvas;
    if (!canvas || !result.ok) return;
    const ctx = canvas.getContext('2d');
    const [ax, ay] = applyH(result.H, 0, 0);
    const [bx, by] = applyH(result.H, 1, 0);
    const pxPerMm = Math.hypot(bx - ax, by - ay);

    const ring = (u, v, color, width = 3, d = BUBBLE_D) => {
        const [x, y] = applyH(result.H, u, v);
        ctx.beginPath();
        ctx.arc(x, y, (d / 2) * 1.15 * pxPerMm, 0, Math.PI * 2);
        ctx.lineWidth = width;
        ctx.strokeStyle = color;
        ctx.stroke();
    };

    result.markers.forEach(([x, y]) => {
        ctx.fillStyle = '#06b6d4';
        ctx.fillRect(x - 5, y - 5, 10, 10);
    });

    studentCols(result.sets || 0).forEach((col, i) => {
        const dg = digits ? digits[i] : result.studentDigits[i];
        if (dg >= 0) ring(col.bubbles[dg].u, col.bubbles[dg].v, '#16a34a', 2, STU_BUBBLE_D);
    });

    if (result.setPick >= 0) { const sb = setBubbles()[result.setPick]; ring(sb.u, sb.v, '#7c3aed', 2); }

    (result.cells ? answerRows(result.cells, result.sets || 0) : answerRows(answers.length, result.fills[0] ? result.fills[0].length : 0, result.sets || 0)).forEach(row => {
        const a = answers[row.q];
        const k = key ? key[row.q] : -1;
        if (a >= MULTI_BASE) {
            // multiple answer: green circles are right, red are extra, blue are the ones that were missed
            const keyMask = k >= MULTI_BASE ? k - MULTI_BASE : 0;
            row.bubbles.forEach(b => {
                const on = (a - MULTI_BASE) & (1 << b.k), want = keyMask & (1 << b.k);
                if (on) ring(b.u, b.v, want ? '#16a34a' : '#dc2626');
                else if (want) ring(b.u, b.v, '#2563eb', 2);
            });
            return;
        }
        if (a === MULTIPLE) {
            row.bubbles.forEach(b => ring(b.u, b.v, '#dc2626', 2));
        } else if (a >= 0) {
            ring(row.bubbles[a].u, row.bubbles[a].v, k < 0 || a === k ? '#16a34a' : '#dc2626');
        }
        if (k >= 0 && k < MULTI_BASE && a !== k && row.bubbles[k]) ring(row.bubbles[k].u, row.bubbles[k].v, '#2563eb', 2);
    });
};
