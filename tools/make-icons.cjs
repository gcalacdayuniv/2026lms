// Draws the built-in app icon (js/pwa.js drawIcon) to icons/*.png for the static manifest.webmanifest.
// Run from the repo root after changing the drawing: node tools/make-icons.cjs
// To use a different logo, just replace the three PNGs in icons/ (192x192, 512x512, 512x512 maskable).
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8129'], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1000));
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('http://localhost:8129/index.html');
  const out = await p.evaluate(async () => {
    const m = await import('/js/pwa.js');
    return { 'icon-192.png': m.drawIcon(192, false), 'icon-512.png': m.drawIcon(512, false), 'icon-maskable-512.png': m.drawIcon(512, true) };
  });
  fs.mkdirSync('icons', { recursive: true });
  for (const [name, url] of Object.entries(out)) fs.writeFileSync(`icons/${name}`, Buffer.from(url.split(',')[1], 'base64'));
  await b.close(); srv.kill();
  console.log('wrote', Object.keys(out).join(', '));
})();
