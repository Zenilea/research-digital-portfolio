// Browser tests. They open the built site (dist/) in a real browser.
//
//   npm run build && npm run test:e2e
//
// They need Playwright. Without it the tests are skipped, not failed.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = '/research-digital-portfolio';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const sources = JSON.parse(await readFile(path.join(root, 'src/data/sources.json'), 'utf8'));
const extras = JSON.parse(await readFile(path.join(root, 'src/data/source-extras.json'), 'utf8'));
const { mergeSources } = await import('../src/lib/merge-sources.js');
const published = mergeSources(sources.sources, extras).published;

const PAGES = ['/', '/how-it-works/', '/research/', '/process/', '/about/'];
const WIDTHS = [375, 768, 1440];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
};

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  // handled below
}
const skip = !chromium ? 'Playwright is not installed' : !existsSync(dist) ? 'run "npm run build" first' : false;

let server;
let browser;
let origin;

before(async () => {
  if (skip) return;
  // A tiny file server that serves dist/ under the same base path as GitHub Pages.
  server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url, 'http://localhost');
    let file = path.join(dist, decodeURIComponent(pathname.slice(BASE.length)));
    if (!pathname.startsWith(BASE) || !file.startsWith(dist)) file = '';
    if (file && existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    const found = file && existsSync(file);
    if (!found) file = path.join(dist, '404.html');
    response.writeHead(found ? 200 : 404, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    response.end(await readFile(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
});

/** Open a page and collect anything that went wrong while it loaded. */
async function open(pagePath, { width = 1440, height = 900, ...context } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, ...context });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('response', (response) => response.status() >= 400 && errors.push(`${response.status()} ${response.url()}`));
  await page.addInitScript(() => {
    window.__cls = 0;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {}
  });
  await page.goto(origin + BASE + pagePath, { waitUntil: 'networkidle' });
  return { page, errors, close: () => ctx.close() };
}

/** Scroll from top to bottom the way a reader would. */
async function scrollThrough(page) {
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = page.viewportSize().height * 0.8;
  for (let y = 0; y <= total; y += step) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
    await page.waitForTimeout(40);
  }
}

/** Elements that are still faded out or collapsed. */
const hiddenReveals = (page) =>
  page.evaluate(
    () => [...document.querySelectorAll('[data-reveal]')].filter((el) => Number(getComputedStyle(el).opacity) < 1).length,
  );

for (const pagePath of PAGES) {
  for (const width of WIDTHS) {
    test(`${pagePath} at ${width}px: no sideways scroll, no errors, no layout shift`, { skip }, async () => {
      const { page, errors, close } = await open(pagePath, { width });
      await scrollThrough(page);
      const size = await page.evaluate(() => ({
        content: document.documentElement.scrollWidth,
        screen: window.innerWidth,
        shift: window.__cls,
      }));
      assert.ok(size.content <= size.screen, `content is ${size.content}px wide on a ${size.screen}px screen`);
      assert.deepEqual(errors, []);
      assert.ok(size.shift < 0.1, `layout shift score ${size.shift.toFixed(3)} (should be under 0.1)`);
      await close();
    });
  }

  test(`${pagePath} without JavaScript: nothing is hidden`, { skip }, async () => {
    const { page, close } = await open(pagePath, { width: 375, javaScriptEnabled: false });
    assert.equal(await hiddenReveals(page), 0);
    assert.ok(await page.locator('.nav__links a').first().isVisible(), 'the nav links show without the menu button');
    assert.ok(!(await page.locator('[data-nav-toggle]').isVisible()), 'the menu button is hidden when it cannot work');
    await close();
  });

  test(`${pagePath} with reduced motion: nothing is hidden and nothing is pinned`, { skip }, async () => {
    const { page, close } = await open(pagePath, { reducedMotion: 'reduce' });
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('motion')), false);
    await scrollThrough(page);
    assert.equal(await hiddenReveals(page), 0);
    assert.equal(await page.locator('.is-live').count(), 0);
    await close();
  });
}

test('Home: the five-step story is a plain list without JavaScript', { skip }, async () => {
  const { page, close } = await open('/', { javaScriptEnabled: false });
  const steps = page.locator('[data-story-step]');
  assert.equal(await steps.count(), 5);
  for (let i = 0; i < 5; i += 1) {
    const box = await steps.nth(i).boundingBox();
    assert.ok(box && box.height > 100, `step ${i + 1} takes up space on the page`);
    assert.equal(await steps.nth(i).evaluate((el) => getComputedStyle(el).opacity), '1');
  }
  assert.ok(await page.getByText('Illustration of the idea, not results.').first().isVisible());
  await close();
});

test('Home: the story pins and steps forward on scroll, and can be skipped', { skip }, async () => {
  const { page, close } = await open('/');
  const story = page.locator('[data-story]');
  assert.ok(await story.evaluate((el) => el.classList.contains('is-live')));
  assert.equal(await page.locator('.story__skip').getAttribute('href'), '#question');
  const middle = await story.evaluate((el) => el.offsetTop + el.offsetHeight * 0.55);
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), middle);
  await page.waitForFunction(() => Number(document.querySelector('[data-story]').dataset.step) >= 3);
  assert.equal(await page.locator('[data-story-step].is-active').count(), 1);
  await close();
});

test('Research: the filter chips show one category at a time', { skip }, async () => {
  const { page, close } = await open('/research/');
  const rows = page.locator('[data-filter-group] [data-cat]');
  assert.equal(await rows.count(), published.length);
  const ethics = published.filter((source) => source.category === 'ethics').length;
  await page.locator('[data-filter="ethics"]').click();
  assert.equal(await page.locator('[data-filter-group] [data-cat]:visible').count(), ethics);
  assert.equal(await page.locator('[data-filter="ethics"]').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('[data-filter-status]').innerText(), new RegExp(`Showing ${ethics} of ${published.length}`));
  await page.locator('[data-filter="all"]').click();
  assert.equal(await page.locator('[data-filter-group] [data-cat]:visible').count(), published.length);
  await close();
});

test('Research: a link to one source opens that row', { skip }, async () => {
  const { page, close } = await open('/research/#src-rankin-2014');
  assert.equal(await page.locator('#src-rankin-2014').evaluate((el) => el.open), true);
  await close();
});

test('Research: every row opens with the keyboard', { skip }, async () => {
  const { page, close } = await open('/research/');
  const summary = page.locator('details.src summary').first();
  await summary.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('details.src').first().evaluate((el) => el.open), true);
  await close();
});

test('Process: the sub-nav marks the section being read', { skip }, async () => {
  const { page, close } = await open('/process/');
  await page.evaluate(() => {
    const top = document.getElementById('plan').getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + 200, behavior: 'instant' });
  });
  await page.waitForFunction(() => document.querySelector('.subnav a[href="#plan"]').getAttribute('aria-current') === 'true');
  assert.equal(await page.locator('.subnav a[aria-current]').count(), 1);
  await close();
});

test('Process: says there are no results yet', { skip }, async () => {
  const { page, close } = await open('/process/');
  assert.ok(await page.getByText("Nothing to show yet. The experiment hasn't run.").isVisible());
  assert.ok(await page.getByText('Example numbers, not data').isVisible());
  await close();
});

test('About: the portrait loads and has alt text', { skip }, async () => {
  const { page, close } = await open('/about/');
  const image = page.locator('.me__photo img');
  assert.ok((await image.getAttribute('alt')).length > 10);
  assert.ok(await image.evaluate((el) => el.complete && el.naturalWidth > 0));
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('theme-cream')), true);
  await close();
});

test('Phone menu opens, closes with Escape, and reports its state', { skip }, async () => {
  const { page, close } = await open('/', { width: 375, height: 800 });
  const toggle = page.locator('[data-nav-toggle]');
  const firstLink = page.locator('.nav__links a').first();
  assert.ok(await toggle.isVisible());
  assert.ok(!(await firstLink.isVisible()));
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.ok(await firstLink.isVisible());
  await page.keyboard.press('Escape');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.ok(!(await firstLink.isVisible()));
  await close();
});

test('Keyboard: the first Tab lands on a visible "Skip to content" link', { skip }, async () => {
  const { page, close } = await open('/');
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    const box = el.getBoundingClientRect();
    return { text: el.textContent.trim(), top: box.top, href: el.getAttribute('href') };
  });
  assert.equal(focused.text, 'Skip to content');
  assert.equal(focused.href, '#main');
  await page.waitForFunction(() => document.activeElement.getBoundingClientRect().top >= 0);
  await close();
});

test('A wrong address shows the 404 page', { skip }, async () => {
  const { page, close } = await open('/nope/');
  assert.ok(await page.getByText("This page isn't here.").isVisible());
  await close();
});
