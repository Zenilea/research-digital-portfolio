// Checks the built site (dist/) before it is published.
//
//   npm run build && npm run check
//
// It fails the build if a page breaks one of the site's rules:
//   - the word "sterilization" (or "sterile", "sterilant", any word built on
//     "steril" except "sterility") used anywhere outside other people's wording
//     (source titles, the literature review, the reference list)
//   - the phrase "no research exists"
//   - an email address or phone number on a page, or a mailto: or tel: link
//   - an image without alt text
//   - a link that skips the base path or points at a page or section that is not there
//   - a new-tab link without rel="noopener"
//   - two elements with the same id
//   - a page without a title, description, canonical link or share image
//   - an idea diagram without the "not results" label
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';

import { SITE, BASE } from '../site.config.mjs';

export { SITE, BASE };

// Any word built on "steril" (sterilize, sterilise, sterile, sterilant, unsterile,
// misspellings too). "Sterility" is allowed: the site says the study is not about it.
const BANNED = /steril(?!ity\b)/i;
const NO_RESEARCH = /no research exists/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i;
const PHONE = /(?<![\d./-])\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?![\d./-])/;
// Signs that a value failed to render. The plain word "undefined" in a sentence is fine.
const PLACEHOLDER = /: undefined\b|\bundefined (of|undefined)\b|\[object Object\]|lorem ipsum/i;
// Exact capitals only, so the surnames Nan and Todo in a reference are left alone.
const PLACEHOLDER_EXACT = /\bNaN\b|\bTODO\b/;
const EMPTY_VALUE = /^(undefined|null|NaN)$/;
const IDEA_LABEL = /Illustration of the idea, not results\./;

// Attributes that hold web addresses or code, not words a visitor reads.
const NOT_WORDS = new Set(['href', 'src', 'srcset', 'class', 'style', 'd', 'points', 'viewbox', 'id', 'for']);

const attr = (node, name) => node.attrs?.find((a) => a.name === name)?.value;
const hasAttr = (node, name) => Boolean(node.attrs?.some((a) => a.name === name));

/** Every element and text node, with whether it sits inside other people's wording. */
function* walk(node, quoted = false) {
  const isQuoted = quoted || hasAttr(node, 'data-source-wording');
  yield { node, quoted: isQuoted };
  if (node.nodeName === 'script' || node.nodeName === 'style') return;
  for (const child of node.childNodes ?? []) yield* walk(child, isQuoted);
  if (node.content) yield* walk(node.content, isQuoted);
}

/** The ids on a page, for checking links like /research/#gap. */
export function collectIds(html) {
  const ids = new Set();
  for (const { node } of walk(parse(html))) {
    const id = attr(node, 'id');
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Check one built page.
 * @param {string} html
 * @param {{ file: string, exists?: (urlPath: string) => boolean, hasId?: (urlPath: string, id: string) => boolean }} options
 * @returns {string[]} problems, empty when the page is fine
 */
export function checkHtml(html, { file, exists = () => true, hasId = () => true }) {
  const problems = [];
  const fail = (message) => problems.push(`${file}: ${message}`);
  const doc = parse(html);

  const ids = new Set();
  const text = [];
  const links = [];
  let title = '';
  let lang;
  const meta = {};
  let canonical;
  let hasIdeaDiagram = false;

  for (const { node, quoted } of walk(doc)) {
    if (node.nodeName === '#text') {
      const value = node.value;
      if (node.parentNode?.nodeName === 'title') title += value;
      text.push(value);
      if (!quoted && BANNED.test(value)) fail(`banned word in text: "${value.trim().slice(0, 80)}"`);
      if (EMPTY_VALUE.test(value.trim())) fail(`placeholder text on the page: "${value.trim()}"`);
      // One piece of text at a time, so three numbers in a table row are not read as a phone number.
      const phone = value.match(PHONE);
      if (phone) fail(`phone number on the page: ${phone[0]}`);
      continue;
    }
    if (!node.attrs) continue;

    const id = attr(node, 'id');
    if (id) {
      if (ids.has(id)) fail(`duplicate id "${id}"`);
      ids.add(id);
    }
    if (node.nodeName === 'html') lang = attr(node, 'lang');
    if (node.nodeName === 'meta') {
      const key = attr(node, 'name') ?? attr(node, 'property');
      if (key) meta[key] = attr(node, 'content') ?? '';
    }
    if (node.nodeName === 'link' && attr(node, 'rel') === 'canonical') canonical = attr(node, 'href');
    if (node.nodeName === 'svg' && /(^|\s)cs(\s|$)/.test(attr(node, 'class') ?? '')) hasIdeaDiagram = true;

    for (const { name, value } of node.attrs) {
      if (NOT_WORDS.has(name) || name.startsWith('data-astro')) continue;
      if (!quoted && BANNED.test(value)) fail(`banned word in ${name}="${value.slice(0, 80)}"`);
      if (NO_RESEARCH.test(value)) fail(`"no research exists" in ${name}`);
    }

    if (node.nodeName === 'img' && !hasAttr(node, 'alt')) fail(`image has no alt: ${attr(node, 'src')}`);

    if (node.nodeName === 'a' && attr(node, 'target') === '_blank') {
      if (!/\bnoopener\b/.test(attr(node, 'rel') ?? '')) fail(`new-tab link needs rel="noopener": ${attr(node, 'href')}`);
    }

    const href = attr(node, 'href') ?? '';
    if (/^mailto:/i.test(href)) fail(`email address in a link: ${href}`);
    if (/^(tel|sms):/i.test(href)) fail(`phone number in a link: ${href}`);

    for (const name of ['href', 'src']) {
      const value = attr(node, name);
      if (value !== undefined) links.push(value);
    }
    const srcset = attr(node, 'srcset');
    if (srcset) for (const part of srcset.split(',')) links.push(part.trim().split(/\s+/)[0]);
  }

  // Links inside the site.
  for (const link of links) {
    if (link.startsWith('#')) {
      const id = decodeURIComponent(link.slice(1));
      if (id && !ids.has(id)) fail(`link to "${link}" but there is no element with id "${id}" on this page`);
      continue;
    }
    if (!link.startsWith('/') || link.startsWith('//')) continue;
    if (link !== BASE && !link.startsWith(`${BASE}/`)) {
      fail(`link "${link}" is missing the base path ${BASE}/`);
      continue;
    }
    const [urlPath, hash] = link.split('#');
    const clean = urlPath.split('?')[0];
    if (!exists(clean)) {
      fail(`link "${link}" points at a file that does not exist`);
      continue;
    }
    if (hash && !hasId(clean, decodeURIComponent(hash))) {
      fail(`link "${link}" but there is no element with id "${hash}" on that page`);
    }
  }

  // Words on the page.
  const words = text.join(' ').replace(/\s+/g, ' ');
  if (NO_RESEARCH.test(words)) fail('the phrase "no research exists" is on the page');
  const email = words.match(EMAIL);
  if (email) fail(`email address on the page: ${email[0]}`);
  const placeholder = words.match(PLACEHOLDER) ?? words.match(PLACEHOLDER_EXACT);
  if (placeholder) fail(`placeholder text on the page: "${placeholder[0]}"`);
  if (hasIdeaDiagram && !IDEA_LABEL.test(words)) {
    fail('an idea diagram is on the page without the label "Illustration of the idea, not results."');
  }

  // Page basics.
  if (!lang) fail('<html> has no lang');
  if (!title.trim()) fail('page has no <title>');
  const description = meta.description ?? '';
  if (!description.trim()) fail('page has no meta description');
  else if (description.length > 200) fail(`meta description is ${description.length} characters (keep it under 200)`);
  if (!canonical?.startsWith(`${SITE}${BASE}/`)) fail('page has no canonical link to the live site');
  if (!meta['og:title']) fail('page has no og:title');
  const shareImage = meta['og:image'];
  if (!shareImage?.startsWith(`${SITE}${BASE}/`)) fail('page has no og:image with a full address');
  else if (!exists(shareImage.slice(SITE.length))) fail(`og:image "${shareImage}" points at a file that does not exist`);

  return problems;
}

async function listHtml(dir, prefix = '') {
  const files = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await listHtml(dir, relative)));
    else if (entry.name.endsWith('.html')) files.push(relative);
  }
  return files;
}

/** Check every page in a built site. */
export async function checkDist(dir) {
  const files = (await listHtml(dir)).sort();
  const pages = new Map();
  for (const file of files) pages.set(file, await readFile(path.join(dir, file), 'utf8'));

  const toFile = (urlPath) => {
    const relative = decodeURIComponent(urlPath.slice(BASE.length)).replace(/^\//, '');
    return relative === '' || relative.endsWith('/') ? `${relative}index.html` : relative;
  };
  const exists = (urlPath) => existsSync(path.join(dir, toFile(urlPath)));
  const idCache = new Map();
  const hasId = (urlPath, id) => {
    const file = toFile(urlPath);
    if (!pages.has(file)) return true; // not a page (an image, a font)
    if (!idCache.has(file)) idCache.set(file, collectIds(pages.get(file)));
    return idCache.get(file).has(id);
  };

  const problems = [];
  const titles = new Map();
  for (const [file, html] of pages) {
    problems.push(...checkHtml(html, { file, exists, hasId }));
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
    if (title) {
      if (titles.has(title)) problems.push(`${file}: same <title> as ${titles.get(title)}`);
      else titles.set(title, file);
    }
  }
  return { pages: files.length, problems };
}

// Run from the command line.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dist = path.resolve(process.argv[2] ?? 'dist');
  if (!existsSync(dist)) {
    console.error(`No ${dist} folder. Run "npm run build" first.`);
    process.exit(1);
  }
  const { pages, problems } = await checkDist(dist);
  if (problems.length) {
    console.error(`Site check failed: ${problems.length} problem(s) in ${pages} page(s).\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`Site check passed: ${pages} pages, no problems.`);
}
