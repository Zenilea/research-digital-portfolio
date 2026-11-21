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

import { BASE } from '../site.config.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const sources = JSON.parse(await readFile(path.join(root, 'src/data/sources.json'), 'utf8'));
const extras = JSON.parse(await readFile(path.join(root, 'src/data/source-extras.json'), 'utf8'));
const { mergeSources } = await import('../src/lib/merge-sources.js');
const published = mergeSources(sources.sources, extras).published;

const PAGES = ['/', '/ideation/', '/about/'];
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

// How it works, Research and Process are hidden for now (their files start with "_").
// Their tests come back on their own as soon as a page is built again.
const pageSkip = (pagePath) =>
  skip || (existsSync(path.join(dist, pagePath, 'index.html')) ? false : `${pagePath} is hidden for now`);

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

test('Research: the filter chips show one category at a time', { skip: pageSkip('/research/') }, async () => {
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

test('Research: a link to one source opens that row', { skip: pageSkip('/research/') }, async () => {
  const { page, close } = await open('/research/#src-rankin-2014');
  assert.equal(await page.locator('#src-rankin-2014').evaluate((el) => el.open), true);
  await close();
});

test('Research: every row opens with the keyboard', { skip: pageSkip('/research/') }, async () => {
  const { page, close } = await open('/research/');
  const summary = page.locator('details.src summary').first();
  await summary.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('details.src').first().evaluate((el) => el.open), true);
  await close();
});

test('Process: the sub-nav marks the section being read', { skip: pageSkip('/process/') }, async () => {
  const { page, close } = await open('/process/');
  await page.evaluate(() => {
    const top = document.getElementById('plan').getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + 200, behavior: 'instant' });
  });
  await page.waitForFunction(() => document.querySelector('.subnav a[href="#plan"]').getAttribute('aria-current') === 'true');
  assert.equal(await page.locator('.subnav a[aria-current]').count(), 1);
  await close();
});

test('Process: says there are no results yet', { skip: pageSkip('/process/') }, async () => {
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

// ---- Found by the whole-site review ----------------------------------------

const SHORT_SCREENS = [
  [320, 568],
  [375, 548],
  [1366, 600],
  [1920, 600],
];

for (const [width, height] of SHORT_SCREENS) {
  test(`Home at ${width}x${height}: the "not results" label is never cut off`, { skip }, async () => {
    const { page, close } = await open('/', { width, height });
    const story = page.locator('[data-story]');
    const top = await story.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    const length = await story.evaluate((el) => el.offsetHeight);
    for (const part of [0.05, 0.3, 0.55, 0.8]) {
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), top + length * part);
      await page.waitForTimeout(700);
      const seen = await page.evaluate(() => {
        const story = document.querySelector('[data-story]');
        if (!story.classList.contains('is-live')) return { pinned: false };
        const pin = story.querySelector('.story__pin').getBoundingClientRect();
        const inside = (el) => {
          const box = el.getBoundingClientRect();
          return box.height > 0 && box.top >= pin.top - 1 && box.bottom <= Math.min(pin.bottom, window.innerHeight) + 1;
        };
        const active = story.querySelector('[data-story-step].is-active');
        return {
          pinned: true,
          label: inside(story.querySelector('.not-results')),
          text: inside(active.querySelector('.story__text')),
          drawing: active.querySelector('svg').getBoundingClientRect().height,
        };
      });
      if (!seen.pinned) continue; // a plain list: the label sits in the page like any other line
      assert.ok(seen.label, `label is cut off at ${Math.round(part * 100)}% of the story`);
      assert.ok(seen.text, `step text is cut off at ${Math.round(part * 100)}% of the story`);
      assert.ok(seen.drawing >= 100, `the drawing is only ${Math.round(seen.drawing)}px tall`);
    }
    await close();
  });
}

test('Home: turning a phone sideways never leaves the story pinned and cut off', { skip }, async () => {
  const { page, close } = await open('/', { width: 390, height: 844 });
  const story = page.locator('[data-story]');
  assert.ok(await story.evaluate((el) => el.classList.contains('is-live')), 'pinned on a tall phone');
  await page.evaluate(() => {
    const el = document.querySelector('[data-story]');
    window.scrollTo({ top: el.offsetTop + el.offsetHeight * 0.4, behavior: 'instant' });
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(600);
  const ok = await page.evaluate(() => {
    const el = document.querySelector('[data-story]');
    if (!el.classList.contains('is-live')) return true;
    const pin = el.querySelector('.story__pin');
    return pin.scrollHeight <= pin.clientHeight + 1;
  });
  assert.ok(ok, 'after rotating, the story is either a plain list or fits its pinned frame');
  await close();
});

test('Research: titles in the reference list are set in a real italic', { skip: pageSkip('/research/') }, async () => {
  const { page, close } = await open('/research/');
  await page.locator('#references').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(async () => {
    const em = document.querySelector('#references em');
    await document.fonts.load(`italic 16px ${getComputedStyle(em).fontFamily}`);
    return {
      style: getComputedStyle(em).fontStyle,
      italicFaceLoaded: [...document.fonts].some((face) => face.style === 'italic' && face.status === 'loaded'),
    };
  });
  assert.equal(result.style, 'italic');
  assert.ok(result.italicFaceLoaded, 'an italic font file is loaded for the titles');
  await close();
});

test('Research: a link to a source works even when a filter is hiding it', { skip: pageSkip('/research/') }, async () => {
  const { page, close } = await open('/research/');
  const target = published.find((source) => source.category !== 'ethics');
  await page.locator('[data-filter="ethics"]').click();
  await page.evaluate((id) => {
    window.location.hash = `#src-${id}`;
  }, target.id);
  const row = page.locator(`#src-${target.id}`);
  await page.waitForFunction((id) => document.getElementById(`src-${id}`).open, target.id);
  assert.ok(await row.isVisible(), 'the row is shown');
  assert.equal(await page.locator('[data-filter="all"]').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('[data-filter-status]').innerText(), new RegExp(`Showing ${published.length} of`));
  await close();
});

test('If the script file fails to load, the phone menu and the pages still work', { skip }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const page = await ctx.newPage();
  await page.route('**/_astro/*.js', (route) => route.abort());
  await page.goto(`${origin}${BASE}/ideation/`, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  assert.ok(await page.locator('.nav__links a').first().isVisible(), 'nav links are shown without the script');
  assert.ok(!(await page.locator('[data-nav-toggle]').isVisible()), 'the dead Menu button is hidden');
  assert.equal(await hiddenReveals(page), 0);
  await ctx.close();
});

test('Research: without the script file, filter chips that cannot work are hidden', { skip: pageSkip('/research/') }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const page = await ctx.newPage();
  await page.route('**/_astro/*.js', (route) => route.abort());
  await page.goto(`${origin}${BASE}/research/`, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  assert.ok(!(await page.locator('[data-filter]').first().isVisible()));
  await ctx.close();
});

test('How it works: the two "measure" headings have their own ids', { skip: pageSkip('/how-it-works/') }, async () => {
  const { page, close } = await open('/how-it-works/');
  const repeated = await page.evaluate(() => {
    const seen = new Set();
    return [...document.querySelectorAll('[id]')].map((el) => el.id).filter((id) => seen.size === seen.add(id).size);
  });
  assert.deepEqual(repeated, []);
  await close();
});

// ---- Ideation, About and the black theme ------------------------------------

test('Every page is on a true black background', { skip }, async () => {
  for (const pagePath of PAGES) {
    const { page, close } = await open(pagePath);
    const colors = await page.evaluate(() => [getComputedStyle(document.documentElement).backgroundColor, getComputedStyle(document.body).backgroundColor]);
    assert.deepEqual(colors, ['rgb(0, 0, 0)', 'rgb(0, 0, 0)'], `${pagePath} background`);
    await close();
  }
});

test('The menu lists only the pages that are built', { skip }, async () => {
  const { page, close } = await open('/');
  const links = await page.locator('.nav__links a').evaluateAll((els) => els.map((a) => a.textContent.trim()));
  assert.deepEqual(links, ['Home', 'Ideation', 'About me']);
  await close();
});

test('Ideation: the chapter list marks the chapter being read', { skip }, async () => {
  const { page, close } = await open('/ideation/');
  await page.evaluate(() => {
    const top = document.getElementById('problem').getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + 100, behavior: 'instant' });
  });
  await page.waitForFunction(() => document.querySelector('.rail a[href="#problem"]').getAttribute('aria-current') === 'true');
  assert.equal(await page.locator('.rail a[aria-current]').count(), 1);
  await close();
});

test('Ideation: every chapter link leads to a chapter on the page', { skip }, async () => {
  const { page, close } = await open('/ideation/');
  const missing = await page.evaluate(() =>
    [...document.querySelectorAll('.rail a')].map((a) => a.hash.slice(1)).filter((id) => !document.getElementById(id)),
  );
  assert.deepEqual(missing, []);
  assert.equal(await page.locator('.rail a').count(), 6);
  await close();
});

test('Ideation: the idea drawings are labelled as ideas, not results', { skip }, async () => {
  for (const width of [375, 1440]) {
    const { page, close } = await open('/ideation/', { width });
    assert.equal(await page.locator('svg.cs').count(), 2);
    const label = page.locator('.dg .not-results');
    await label.scrollIntoViewIfNeeded();
    assert.equal(await label.innerText(), 'Illustration of the idea, not results.');
    assert.ok(await label.isVisible());
    await close();
  }
});

test('Ideation: the idea map shows all six early ideas, and none overlap on a wide screen', { skip }, async () => {
  const { page, close } = await open('/ideation/', { width: 1024 });
  const boxes = await page.locator('.map__nodes li, .map__center').evaluateAll((els) =>
    els.map((el) => {
      const b = el.getBoundingClientRect();
      return { l: b.left, r: b.right, t: b.top, b: b.bottom };
    }),
  );
  assert.equal(boxes.length, 7);
  const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) assert.ok(!hit(boxes[i], boxes[j]), `boxes ${i} and ${j} overlap`);
  }
  const map = await page.locator('.map__box').evaluate((el) => el.getBoundingClientRect());
  for (const b of boxes) assert.ok(b.t >= map.top && b.b <= map.bottom && b.l >= map.left && b.r <= map.right, 'a box sticks out of the map');
  await close();
});

test('Ideation: the heat scale labels never overlap', { skip }, async () => {
  for (const width of [375, 640, 768, 1024, 1440]) {
    const { page, close } = await open('/ideation/', { width });
    const boxes = await page.locator('.scale__mark').evaluateAll((els) =>
      els.map((el) => {
        const b = el.getBoundingClientRect();
        return { l: b.left, r: b.right, t: b.top, b: b.bottom };
      }),
    );
    const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) assert.ok(!hit(boxes[i], boxes[j]), `labels ${i} and ${j} overlap at ${width}px`);
    }
    const card = await page.locator('.scale').evaluate((el) => el.getBoundingClientRect());
    for (const b of boxes) assert.ok(b.l >= card.left && b.r <= card.right, `a label sticks out of the card at ${width}px`);
    await close();
  }
});

test('About: the project card links to Ideation and Home', { skip }, async () => {
  const { page, close } = await open('/about/');
  const hrefs = await page.locator('.proj__actions a').evaluateAll((els) => els.map((a) => a.getAttribute('href')));
  assert.deepEqual(hrefs, [`${BASE}/ideation/`, `${BASE}/`]);
  await close();
});

test('About: my email is shown as a working mail link, and fits on a small phone', { skip }, async () => {
  const site = JSON.parse(await readFile(path.join(root, 'src/data/site.json'), 'utf8'));
  for (const width of [320, 1440]) {
    const { page, close } = await open('/about/', { width });
    const link = page.locator('.contact__email');
    assert.equal(await link.getAttribute('href'), `mailto:${site.email}`);
    assert.match(await link.innerText(), new RegExp(site.email.replace(/[.+]/g, '\\$&')));
    const box = await link.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, `the address fits the screen at ${width}px`);
    await close();
  }
});
