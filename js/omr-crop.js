// js/omr-crop.js
// Straightens a photographed answer sheet ("rect1" layout) and cuts out the row of one question.
// The sheet is warped to its own frame (the 4 corner markers) at RECT_SCALE pixels per frame unit, so the same
// geometry as the printed sheet (omr-sheet.js) tells where every question row is, on any device, later on.
import { FRAME } from './omr-sheet.js';
import { applyH, scanImage } from './omr-scan.js';

export const RECT_SCALE = 5;
export const RECT_LAYOUT = 'rect1';
const JPEG_QUALITY = 0.6;

const loadImage = (url) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('photo'));
    img.src = url;
});

// H maps frame units to pixels of the photo at `url` (the same canvas the sheet was read from).
// Returns a JPEG blob of FRAME.w*RECT_SCALE x FRAME.h*RECT_SCALE pixels.
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

    const ow = FRAME.w * RECT_SCALE, oh = FRAME.h * RECT_SCALE;
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
export const straightenLegacy = async (blob, numQuestions, numChoices) => {
    try {
        const res = await scanImage(blob, numQuestions, numChoices);
        if (!res || !res.ok || !res.H || !res.canvas) return null;
        return await rectify(res.canvas, res.H);
    } catch (e) {
        return null;
    }
};
