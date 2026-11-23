// Prints the real answer sheet (js/omr-sheet.js), shades the student number 12-3456, a SET circle and the first answers,
// turns it into a "phone photo" (perspective, uneven light, noise) and reads it with the real scanner (js/omr-scan.js).
// Also checks sheets printed with another number of sets than the scanner was told (the layout is detected from the photo).
// Run: node tools/tests/omr-check.cjs   (needs: npm i playwright; npx playwright install chromium)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const PORT = 8798;
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
const srv = http.createServer((q, s) => {
    let p = q.url.split('?')[0];
    if (p === '/') { s.writeHead(200, { 'content-type': 'text/html' }); return s.end(`<!doctype html><body><script type=module>
import { buildSheetHtml, studentCols, setBubbles, answerRows, STU_BUBBLE_D, BUBBLE_D } from '/js/omr-sheet.js';
import { scanSource, solveHomography, applyH } from '/js/omr-scan.js';
window.api = { buildSheetHtml, studentCols, setBubbles, answerRows, STU_BUBBLE_D, BUBBLE_D, scanSource, solveHomography, applyH }; window.ready = true;</script>`); }
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); s.end(fs.readFileSync(f));
}).listen(PORT);

const G = (sets) => ({ sets, band: 0, written: [] });
const MC = Array.from({ length: 20 }, (_, i) => ['a', 4, i + 1, 0, 0, '']).concat(Array.from({ length: 10 }, (_, i) => ['t', 2, 21 + i, 0, 0, '']));
// print = how the sheet was printed; scan = what the scanner is told (geo = the sets it assumes)
const CASES = [
    { name: 'plain, 4 sets', print: { n: 30, c: 4, sets: 4 }, scanGeo: G(4), n: 30, c: 4, wantSet: 2 },
    { name: 'plain, no sets', print: { n: 30, c: 4, sets: 0 }, scanGeo: 0, n: 30, c: 4, wantSet: -1 },
    { name: 'plain, 2 sets, 5 choices', print: { n: 40, c: 5, sets: 2 }, scanGeo: G(2), n: 40, c: 5, wantSet: 1 },
    { name: 'mixed, 4 sets', print: { cells: MC, sets: 4, written: [] }, scanGeo: G(4), mixed: true, wantSet: 2 },
    { name: 'mixed, no sets', print: { cells: MC, sets: 0, written: [] }, scanGeo: G(0), mixed: true, wantSet: -1 },
    { name: 'plain printed with no sets, scanner thinks 4', print: { n: 30, c: 4, sets: 0 }, scanGeo: G(4), n: 30, c: 4, wantSet: -1, shift: true },
    { name: 'plain printed with 4 sets, scanner thinks 1', print: { n: 30, c: 4, sets: 4 }, scanGeo: 0, n: 30, c: 4, wantSet: 2, shift: true },
    { name: 'mixed printed with no sets, scanner thinks 4', print: { cells: MC, sets: 0, written: [] }, scanGeo: G(4), mixed: true, wantSet: -1, shift: true },
    { name: 'mixed printed with 4 sets, scanner thinks 1', print: { cells: MC, sets: 4, written: [] }, scanGeo: G(0), mixed: true, wantSet: 2, shift: true },
];

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction('window.ready');
    let fails = 0;
    for (const tilt of [0, 4]) for (const cs of CASES) {
        await page.evaluate(({ cs }) => {
            document.querySelectorAll('iframe').forEach(f => f.remove());
            const html = api.buildSheetHtml(cs.print).replace(/<script>window.onload[\s\S]*?<\/script>/, '');
            const f = document.createElement('iframe');
            f.style.cssText = 'border:0;width:794px;height:1123px;display:block;background:#fff';
            f.srcdoc = html; document.body.appendChild(f);
            return new Promise(r => { f.onload = r; });
        }, { cs });
        // shade 12-3456, one SET circle and the first six answers, at the positions of the layout that was PRINTED
        await page.evaluate(({ cs }) => {
            const d = document.querySelector('iframe').contentDocument;
            const shade = (u, v, dia) => { for (const el of d.querySelectorAll('.b')) { if (Math.abs(parseFloat(el.style.left) - (u - dia / 2)) < 0.05 && Math.abs(parseFloat(el.style.top) - (v - dia / 2)) < 0.05) { el.style.background = '#111'; return; } } };
            const printGeo = { sets: cs.print.sets > 1 ? cs.print.sets : 0, band: 0, written: [] };
            const mixed = !!cs.mixed;
            api.studentCols(printGeo, mixed).forEach((col, i) => { const b = col.bubbles[[1, 2, 3, 4, 5, 6][i]]; shade(b.u, b.v, api.STU_BUBBLE_D); });
            if (cs.print.sets > 1) { const sb = api.setBubbles(cs.print.sets)[Math.min(2, cs.print.sets - 1)]; shade(sb.u, sb.v, api.BUBBLE_D); }
            const rows = mixed ? api.answerRows(cs.print.cells, printGeo) : api.answerRows(cs.n, cs.c, printGeo);
            rows.slice(0, 6).forEach(r => shade(r.bubbles[1].u, r.bubbles[1].v, api.BUBBLE_D));
        }, { cs });
        const buf = await (await page.$('iframe')).screenshot();
        const res = await page.evaluate(async ({ b64, cs, tilt }) => {
            let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
            const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
            const W = 1500, H = 1900, out = document.createElement('canvas'); out.width = W; out.height = H;
            const o = out.getContext('2d', { willReadFrequently: true });
            const src = document.createElement('canvas'); src.width = img.width; src.height = img.height;
            const sc = src.getContext('2d'); sc.drawImage(img, 0, 0); const sd = sc.getImageData(0, 0, img.width, img.height).data;
            const t = tilt;
            const q = [[150 + t * 6, 170 + t * 4], [1330 - t * 5, 120 + t * 2], [1380 - t * 2, 1730 - t * 5], [110 + t * 4, 1790 - t * 3]];
            const Hm = api.solveHomography(q, [[0, 0], [img.width, 0], [img.width, img.height], [0, img.height]]);
            const od = o.createImageData(W, H);
            for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
                const [u, v] = api.applyH(Hm, x, y); const i = (y * W + x) * 4; const lit = 0.78 + 0.22 * (x / W) * (1 - 0.3 * y / H);
                let r = 60, g = 58, b = 55;
                if (u >= 0 && v >= 0 && u < img.width - 1 && v < img.height - 1) { const j = ((v | 0) * img.width + (u | 0)) * 4; r = sd[j]; g = sd[j + 1]; b = sd[j + 2]; }
                const nz = (rnd() - 0.5) * 18;
                od.data[i] = Math.max(0, Math.min(255, r * lit + nz)); od.data[i + 1] = Math.max(0, Math.min(255, g * lit + nz)); od.data[i + 2] = Math.max(0, Math.min(255, b * lit + nz)); od.data[i + 3] = 255;
            }
            o.putImageData(od, 0, 0);
            const r = api.scanSource(out, W, H, cs.mixed ? cs.print.cells : cs.n, cs.mixed ? 0 : cs.c, cs.scanGeo);
            return { ok: r.ok, error: r.error, studentNo: r.studentNo, setPick: r.setPick, answers: (r.answers || []).slice(0, 7), setsPrinted: r.setsPrinted, changed: r.layoutChanged };
        }, { b64: buf.toString('base64'), cs, tilt });
        const good = res.ok && res.studentNo === '12-3456' && res.setPick === cs.wantSet && res.answers.slice(0, 6).every(a => a === 1) && res.answers[6] === -1 && (cs.shift ? res.changed === true : res.changed === false);
        console.log((good ? 'PASS ' : 'FAIL ') + `${cs.name} (tilt ${tilt})` + (good ? '' : ' ' + JSON.stringify(res)));
        if (!good) fails++;
    }
    await browser.close(); srv.close();
    if (errors.length) { console.log('script errors:', errors); fails++; }
    if (fails) { console.log(fails + ' scanner check(s) failed'); process.exit(1); }
    console.log('SCANNER CHECKS PASSED');
})();
