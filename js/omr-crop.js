// js/omr-crop.js
// Straightens a photographed answer sheet ("rect1" layout) and cuts out the row of one question.
// The sheet is warped to its own frame (the 4 corner markers) at RECT_SCALE pixels per frame unit, so the same
// geometry as the printed sheet (omr-sheet.js) tells where every question row is, on any device, later on.
import { FRAME, setBubbles } from './omr-sheet.js';
import { applyH, scanImage } from './omr-scan.js';

export const RECT_SCALE = 5;
export const RECT_LAYOUT = 'rect1';
export const RECT_EXTRA = 10;   // frame units kept below the bottom markers, where essay lines may run (photos straightened before this were cut at the markers)
const JPEG_QUALITY = 0.6;

const loadImage = (url) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('photo'));
    img.src = url;
});

// H maps frame units to pixels of the photo at `url` (the same canvas the sheet was read from).
// Returns a JPEG blob of FRAME.w*RECT_SCALE x (FRAME.h+RECT_EXTRA)*RECT_SCALE pixels.
export const rectify = async (source, H) => {
    // source: URL of the photo, or a canvas / image that already holds it
    const img = typeof source === 'string' ? await loadImage(source) : source;
    const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
    const src = document.createElement('canvas');
    src.width = sw; src.height = sh;
    const sctx = src.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(img, 0, 0);
    const sd = sctx.getImageData(0, 0, sw, sh).data;
    src.width = 0;

    const ow = FRAME.w * RECT_SCALE, oh = (FRAME.h + RECT_EXTRA) * RECT_SCALE;
    const out = document.createElement('canvas');
    out.width = ow; out.height = oh;
    const octx = out.getContext('2d');
    const od = octx.createImageData(ow, oh);
    const o = od.data;
    for (let y = 0; y < oh; y++) {
        for (let x = 0; x < ow; x++) {
            const [px, py] = applyH(H, (x + 0.5) / RECT_SCALE, (y + 0.5) / RECT_SCALE);
            const i = (y * ow + x) * 4;
            const x0 = Math.floor(px - 0.5), y0 = Math.floor(py - 0.5);
            if (x0 < 0 || y0 < 0 || x0 + 1 >= sw || y0 + 1 >= sh) { o[i] = o[i + 1] = o[i + 2] = 255; o[i + 3] = 255; continue; }
            const fx = px - 0.5 - x0, fy = py - 0.5 - y0;
            const a = (y0 * sw + x0) * 4, b = a + 4, c = a + sw * 4, d = c + 4;
            const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
            o[i] = sd[a] * w00 + sd[b] * w10 + sd[c] * w01 + sd[d] * w11;
            o[i + 1] = sd[a + 1] * w00 + sd[b + 1] * w10 + sd[c + 1] * w01 + sd[d + 1] * w11;
            o[i + 2] = sd[a + 2] * w00 + sd[b + 2] * w10 + sd[c + 2] * w01 + sd[d + 2] * w11;
            o[i + 3] = 255;
        }
    }
    octx.putImageData(od, 0, 0);
    const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', JPEG_QUALITY));
    out.width = 0;
    return blob;
};

// The rectangle (in pixels of a "rect1" photo) that holds one question's row: number, key letters and circles.
// row = one entry of answerRows(n, c); c = number of choices.
export const cropBox = (row, c) => {
    const last = row.bubbles[c - 1] ? row.bubbles[c - 1].u : row.u0 + 12;
    const left = Math.max(0, row.u0 - 0.5);
    const right = Math.min(FRAME.w, last + 4.2);
    const top = Math.max(0, row.v - 3.1);
    const bottom = Math.min(FRAME.h, row.v + 3.1);
    return { x: left * RECT_SCALE, y: top * RECT_SCALE, w: (right - left) * RECT_SCALE, h: (bottom - top) * RECT_SCALE };
};

// A question with more than 5 choices has several rows of bubbles (A-E, F-J ...). One strip per row, so the review
// shows every choice of the question: [{x,y,w,h}, ...] in pixels of a "rect1" photo.
// Where the rows really are in the photo. The review cuts each question out at its planned position; when the sheet in the
// photo is a little stretched or bent (or was printed by an older version), a fixed cut slips onto the neighbouring question.
// alignRows finds every row of circles in the photo (it looks for the ring pattern near the planned spot) and returns
// Map(alignKey -> vertical offset in frame units). cropBoxes then cuts at the found position.
const AL = 2;   // pixels per frame unit while searching
export const alignKey = (v, u) => `${Number(v).toFixed(1)}|${Math.round(u)}`;
const bubbleLines = (rows) => {
    const out = [];
    rows.forEach(r => {
        const byV = new Map();
        r.bubbles.forEach(b => { const k = b.v.toFixed(2); if (!byV.has(k)) byV.set(k, { v: b.v, us: [] }); byV.get(k).us.push(b.u); });
        byV.forEach(l => out.push(l));
    });
    return out;
};
const ringChord = (d) => { const f = (r) => Math.sqrt(Math.max(0, r * r - d * d)); return 2 * (f(2.6) - f(2.0)); };
export const alignRows = (bitmap, rows) => {
    const map = new Map();
    try {
        const W = Math.round(FRAME.w * AL), H = Math.round((FRAME.h + RECT_EXTRA) * AL);
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0, W, H);
        const px = ctx.getImageData(0, 0, W, H).data;
        const dark = (x, y) => { const i = (y * W + x) * 4; return 1 - (px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11) / 255; };
        const D = []; for (let d = -3.4; d <= 3.401; d += 0.25) D.push(Number(d.toFixed(2)));
        const T = D.map(ringChord);
        const tMean = T.reduce((a, b) => a + b, 0) / T.length;
        const T0 = T.map(t => t - tMean);
        const tSd = Math.sqrt(T0.reduce((a, b) => a + b * b, 0));
        const lines = bubbleLines(rows);
        const found = (line, lo, hi) => {
            const rowDark = (y) => {            // darkness of one pixel row across all circles of the line
                const yy = Math.round(y * AL);
                if (yy < 0 || yy >= H) return 0;
                let sum = 0;
                for (const u of line.us) {
                    const x0 = Math.max(0, Math.round((u - 2.7) * AL)), x1 = Math.min(W - 1, Math.round((u + 2.7) * AL));
                    for (let x = x0; x <= x1; x++) sum += dark(x, yy);
                }
                return sum;
            };
            let best = null;
            for (let s = lo; s <= hi + 0.001; s += 0.25) {
                const P = D.map(d => rowDark(line.v + s + d));
                const pMean = P.reduce((x, y) => x + y, 0) / P.length;
                let cov = 0, pv = 0;
                P.forEach((q, i) => { cov += (q - pMean) * T0[i]; pv += (q - pMean) * (q - pMean); });
                const r = pv > 0 && tSd > 0 ? cov / (Math.sqrt(pv) * tSd) : 0;
                const score = r - 0.04 * Math.abs(s - (lo + hi) / 2);   // slight preference for the expected spot
                if (!best || score > best.score) best = { r, s, score };
            }
            return best;
        };
        // Top to bottom: a stretched or bent sheet drifts a little more at every row, so each row is searched close to where
        // the rows above it were found (never as far as the next row, which looks the same).
        const groups = [];
        lines.slice().sort((x, y) => x.v - y.v).forEach(l => {
            const g = groups[groups.length - 1];
            if (g && Math.abs(g.v - l.v) < 0.3) g.lines.push(l); else groups.push({ v: l.v, lines: [l] });
        });
        let prev = null, prev2 = null;
        for (const g of groups) {
            let pred = 0;
            if (prev) {
                pred = prev.dy;
                if (prev2 && prev.v > prev2.v) pred += Math.max(-0.12, Math.min(0.12, (prev.dy - prev2.dy) / (prev.v - prev2.v))) * (g.v - prev.v);
            }
            const results = g.lines.map(l => ({ l, f: found(l, pred - 2.5, pred + 2.5) }));
            const good = results.filter(x => x.f && x.f.r > 0.5).map(x => x.f.s).sort((x, y) => x - y);
            const med = good.length ? good[Math.floor(good.length / 2)] : pred;
            const dy = Math.abs(med - pred) <= 0.75 ? pred : med;   // a shift of under 1 unit is noise: the cut has more room than that
            results.forEach(({ l }) => map.set(alignKey(l.v, Math.min(...l.us)), dy));
            prev2 = prev; prev = { v: g.v, dy };
        }
    } catch (e) { /* alignment is a refinement; without it the planned positions are used */ }
    return map;
};

export const cropBoxes = (row, align = null) => {
    const rows = [];
    row.bubbles.forEach(b => {
        let r = rows.find(x => Math.abs(x.v - b.v) < 0.01);
        if (!r) { r = { v: b.v, last: b.u, first: b.u }; rows.push(r); }
        r.last = Math.max(r.last, b.u);
        r.first = Math.min(r.first, b.u);
    });
    rows.sort((a, b) => a.v - b.v);
    const right = Math.min(FRAME.w, Math.max(...rows.map(r => r.last)) + 4.2);
    const left = Math.max(0, row.u0 - 0.5);
    return rows.map((r, i) => {
        const dy = align && align.has(alignKey(r.v, r.first)) ? align.get(alignKey(r.v, r.first)) : 0;
        const top = Math.max(0, r.v + dy - (i === 0 && rows.length === 1 ? 3.1 : 6.0)), bottom = Math.min(FRAME.h + RECT_EXTRA, r.v + dy + (rows.length === 1 ? 3.1 : 3.3));
        return { x: left * RECT_SCALE, y: top * RECT_SCALE, w: (right - left) * RECT_SCALE, h: (bottom - top) * RECT_SCALE };
    });
};

// Written answers of one item (identification / enumeration lines, or an essay block), cut from a "rect1" photo.
// lay = writtenLayout(...) of omr-sheet.js, item = { no, span, type }. One strip per column of lines.
export const writtenBoxes = (lay, item) => {
    const px = (l, t, r, b) => ({ x: Math.max(0, l) * RECT_SCALE, y: Math.max(0, t) * RECT_SCALE, w: (r - l) * RECT_SCALE, h: (b - t) * RECT_SCALE });
    if (item.type === 'essay') {
        const e = lay.essays.find(x => x.no === item.no);
        return e ? [px(8, e.top - 1, 172, e.top + e.h)] : [];
    }
    const mine = lay.lines.filter(l => l.no >= item.no && l.no < item.no + (item.span || 1));
    const cols = [];
    mine.forEach(l => { let c = cols.find(x => Math.abs(x.u0 - l.u0) < 0.01); if (!c) { c = { u0: l.u0, vs: [] }; cols.push(c); } c.vs.push(l.v); });
    return cols.map(c => px(c.u0 - 4.5, Math.min(...c.vs) - 5.5, c.u0 + lay.firstK + lay.lineW, Math.max(...c.vs) + 4));
};

// The SET row (letters and bubbles) of a sheet with several sets.
export const setBox = (count) => {
    const b = setBubbles(count);
    const left = Math.max(0, b[0].u - 14), right = Math.min(FRAME.w, b[b.length - 1].u + 4.2);
    const top = Math.max(0, b[0].v - 7.5), bottom = b[0].v + 3.6;
    return { x: left * RECT_SCALE, y: top * RECT_SCALE, w: (right - left) * RECT_SCALE, h: (bottom - top) * RECT_SCALE };
};

// Draws the strips of one question one under the other into a canvas.
export const drawCrops = (canvas, bitmap, boxes) => {
    const gap = 3;
    const w = Math.round(Math.max(...boxes.map(b => b.w)));
    const h = Math.round(boxes.reduce((t, b) => t + b.h, 0)) + gap * (boxes.length - 1);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    let y = 0;
    boxes.forEach(b => {
        ctx.drawImage(bitmap, b.x, b.y, b.w, b.h, 0, y, Math.round(b.w), Math.round(b.h));
        y += Math.round(b.h) + gap;
    });
};

// Draws one crop into a canvas (the canvas keeps the crop's own pixel size).
export const drawCrop = (canvas, bitmap, box) => {
    canvas.width = Math.round(box.w);
    canvas.height = Math.round(box.h);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, box.x, box.y, box.w, box.h, 0, 0, canvas.width, canvas.height);
};

// Photos saved before the straightened layout existed: find the 4 corner markers again in the stored picture and
// straighten it now. Returns a "rect1" JPEG blob, or null when the sheet cannot be found in the picture.
export const straightenLegacy = async (blob, numQuestions, numChoices, geo = 0) => {
    try {
        const res = await scanImage(blob, numQuestions, numChoices, geo);
        if (!res || !res.ok || !res.H || !res.canvas) return null;
        return await rectify(res.canvas, res.H);
    } catch (e) {
        return null;
    }
};
