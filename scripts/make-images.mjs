// Makes the small images in public/: the PNG icons and the share image (og.png).
//
//   node scripts/make-images.mjs
//
// Run it again if the site title in src/data/site.json changes.
// The icons need only "sharp". The share image is drawn in a real browser, so it
// needs Playwright (npm i -D playwright && npx playwright install chromium).
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const site = JSON.parse(await readFile(new URL('../src/data/site.json', import.meta.url), 'utf8'));
const out = (name) => new URL(`../public/${name}`, import.meta.url);

// ---- icons ---------------------------------------------------------------
const favicon = await readFile(out('favicon.svg'));
await sharp(favicon, { density: 300 }).resize(32, 32).png().toFile(out('favicon-32.png').pathname);
// Phones round the corners themselves, so this one is a full square.
const square = favicon.toString().replace('rx="7"', 'rx="0"');
await sharp(Buffer.from(square), { density: 600 }).resize(180, 180).png().toFile(out('apple-touch-icon.png').pathname);
console.log('Made favicon-32.png and apple-touch-icon.png');

// ---- share image ---------------------------------------------------------
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.log('Skipped og.png: Playwright is not installed (see the note at the top of this file).');
  process.exit(0);
}

const font = (await readFile(require.resolve('@fontsource-variable/geist/files/geist-latin-wght-normal.woff2'))).toString('base64');
const words = site.title.split(' ');
const half = Math.ceil(words.length / 2);
const lines = [words.slice(0, half).join(' '), words.slice(half).join(' ')];

const beads = (y, shift) =>
  Array.from({ length: 14 }, (_, i) => `<rect x="${-60 + shift + i * 104}" y="${y}" width="96" height="38" rx="19"/>`).join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Geist;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;background:#000000;color:#f3f2ec;font-family:Geist,sans-serif;position:relative;overflow:hidden}
.top{position:absolute;left:72px;top:60px;display:flex;align-items:center;gap:14px;font-size:26px;font-weight:500;letter-spacing:-.01em}
.top span{color:#8f8d84;font-weight:400}
.top svg{width:30px;height:27px}
h1{position:absolute;left:68px;top:150px;font-size:118px;line-height:.95;letter-spacing:-.055em;font-weight:400}
h1 span{display:block}
p{position:absolute;left:72px;top:400px;width:860px;font-size:29px;line-height:1.35;letter-spacing:-.02em;color:#bdbbb1}
.wall{position:absolute;left:0;bottom:0;width:1200px;height:110px}
</style></head><body>
<div class="top">
  <svg viewBox="0 0 20 18"><clipPath id="c"><rect width="20" height="18"/></clipPath><g clip-path="url(#c)" fill="#f3f2ec"><rect width="20" height="2.5" rx="1.25" fill="#8db86f"/><rect y="5" width="9" height="5" rx="2.5"/><rect x="11" y="5" width="9" height="5" rx="2.5"/><rect x="-4.5" y="12" width="9" height="5" rx="2.5"/><rect x="5.5" y="12" width="9" height="5" rx="2.5"/><rect x="15.5" y="12" width="9" height="5" rx="2.5"/></g></svg>
  ${site.name} <span>· ${site.course}</span>
</div>
<h1><span>${lines[0]}</span><span>${lines[1]}</span></h1>
<p>${site.description}</p>
<svg class="wall" viewBox="0 0 1200 110">
  <rect x="0" y="14" width="1200" height="34" fill="#65944a"/>
  <g fill="#1d1b18" stroke="rgba(243,242,236,.4)" stroke-width="1.5">${beads(30, 0)}${beads(70, -52)}${beads(110, 0)}</g>
  <line x1="0" y1="14" x2="1200" y2="14" stroke="#8db86f" stroke-width="3"/>
</svg>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
const png = await page.screenshot({ type: 'png' });
await browser.close();
await writeFile(out('og.png'), await sharp(png).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer());
console.log('Made og.png');
