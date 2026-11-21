// Tests for the build check (scripts/check-dist.mjs).
// Each test plants one mistake in a small page and expects the check to catch it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkHtml, BASE, SITE, MY_EMAIL } from '../scripts/check-dist.mjs';

const page = (body, head = '') => `<!doctype html>
<html lang="en">
  <head>
    <title>Process · Adhitya Harisudhakar</title>
    <meta name="description" content="A short description of this page for search results." />
    <link rel="canonical" href="${SITE}${BASE}/process/" />
    <meta property="og:title" content="Process" />
    <meta property="og:image" content="${SITE}${BASE}/og.png" />
    ${head}
  </head>
  <body><main id="main">${body}</main></body>
</html>`;

const run = (html, options = {}) => checkHtml(html, { file: 'process/index.html', ...options });
const has = (problems, text) => problems.some((problem) => problem.includes(text));

test('a clean page has no problems', () => {
  const html = page(`<h1>Process</h1><p>Disinfection with 70% alcohol. This study is not about sterility.</p>
    <a href="${BASE}/research/#gap">Research</a><img src="${BASE}/_astro/a.webp" alt="A bar" />`);
  assert.deepEqual(run(html), []);
});

test('the banned word is caught in text, alt text and meta tags', () => {
  assert.ok(has(run(page('<p>Alcohol sterilization of the bars.</p>')), 'banned word'));
  assert.ok(has(run(page('<p>The tool is sterile.</p>')), 'banned word'));
  assert.ok(has(run(page(`<img src="${BASE}/a.webp" alt="A sterilised bar" />`)), 'banned word'));
  assert.ok(has(run(page('<p>ok</p>', '<meta name="keywords" content="sterilization" />')), 'banned word'));
});

test("the word is allowed inside other people's wording, and in web addresses", () => {
  const html = page(`<ul data-source-wording><li><span>Low-temperature sterilization of PLA</span></li></ul>
    <a href="https://www.cdc.gov/infection-control/hcp/disinfection-sterilization/index.html" rel="noopener">CDC guideline</a>`);
  assert.deepEqual(run(html), []);
});

test('"no research exists" is caught', () => {
  assert.ok(has(run(page('<p>No research exists on this topic.</p>')), 'no research exists'));
});

test('an image without alt text is caught', () => {
  assert.ok(has(run(page(`<img src="${BASE}/a.webp" />`)), 'no alt'));
});

test('a link that skips the base path, or points at nothing, is caught', () => {
  assert.ok(has(run(page('<a href="/research/">Research</a>')), 'base path'));
  const missing = run(page(`<a href="${BASE}/nope/">Nope</a>`), { exists: () => false });
  assert.ok(has(missing, 'does not exist'));
  const noAnchor = run(page(`<a href="${BASE}/research/#gone">Gap</a>`), { hasId: () => false });
  assert.ok(has(noAnchor, 'no element with id'));
  assert.ok(has(run(page('<a href="#nowhere">Jump</a>')), 'no element with id'));
});

test('a new-tab link without rel="noopener" is caught', () => {
  assert.ok(has(run(page('<a href="https://example.org/" target="_blank">Out</a>')), 'noopener'));
});

test('missing page basics are caught', () => {
  const bare = '<!doctype html><html><head></head><body><main><p>Hi</p></main></body></html>';
  const problems = run(bare);
  for (const part of ['lang', '<title>', 'description', 'canonical', 'og:image']) {
    assert.ok(has(problems, part), `expected a problem about ${part}`);
  }
});

test('an email address or phone number is caught', () => {
  assert.ok(has(run(page('<p>Write to someone@example.com</p>')), 'email'));
  assert.ok(has(run(page('<p>Call 555-123-4567</p>')), 'phone'));
  // DOIs and page ranges are not phone numbers.
  assert.deepEqual(run(page('<p>https://doi.org/10.1016/j.jss.2014.02.020, pages 193-196.</p>')), []);
});

test('an idea diagram without its honesty label is caught', () => {
  const diagram = '<svg class="cs cs--2" role="img" aria-label="Liquid seeps into the gaps"></svg>';
  assert.ok(has(run(page(diagram)), 'not results'));
  assert.deepEqual(run(page(`${diagram}<p>Illustration of the idea, not results.</p>`)), []);
});

test('leftover placeholder text is caught', () => {
  assert.ok(has(run(page('<p>Total: undefined</p>')), 'placeholder'));
  assert.ok(has(run(page('<p>Lorem ipsum dolor</p>')), 'placeholder'));
  assert.ok(has(run(page('<p><span>undefined</span> sources</p>')), 'placeholder'));
  // The ordinary word is fine in a sentence.
  assert.deepEqual(run(page('<p>The rules for printing at the point of care are still undefined.</p>')), []);
});

test('a share image that was never made is caught', () => {
  const problems = run(page('<p>Hi</p>'), { exists: (urlPath) => !urlPath.endsWith('/og.png') });
  assert.ok(has(problems, 'og:image'));
});

test('every spelling of the banned word family is caught, but "sterility" is not', () => {
  for (const word of ['sterilant', 'unsterile', 'non-sterile', 'sterilzation', 'Sterilising', 'sterilizer']) {
    assert.ok(has(run(page(`<p>The bars were ${word}.</p>`)), 'banned word'), `expected "${word}" to be caught`);
  }
  assert.deepEqual(run(page('<p>It cannot prove patient safety, sterility, or biocompatibility.</p>')), []);
});

test('a mail or phone link is caught even when the address is not in the text', () => {
  assert.ok(has(run(page('<a href="mailto:someone@example.com">Write to me</a>')), 'email'));
  assert.ok(has(run(page('<a href="tel:+15551234567">Call me</a>')), 'phone'));
});

test('my own email from site.json is allowed in text and in a mail link, but no other address is', () => {
  assert.ok(MY_EMAIL.includes('@'), 'site.json has an email');
  assert.deepEqual(run(page(`<p>Email me at <a href="mailto:${MY_EMAIL}">${MY_EMAIL}</a></p>`)), []);
  assert.ok(has(run(page(`<p>${MY_EMAIL} or someone@example.com</p>`)), 'someone@example.com'));
  assert.ok(has(run(page('<a href="mailto:someone@example.com">Write to me</a>')), 'email'));
});

test('ordinary words and table cells are not mistaken for placeholders or phone numbers', () => {
  assert.deepEqual(run(page('<p>Nan, L., and Todo, M. (2021) tested printed bars.</p>')), []);
  assert.deepEqual(run(page('<table><tr><td>120</td><td>135</td><td>1500</td></tr></table>')), []);
  assert.ok(has(run(page('<p>Call 555 123 4567</p>')), 'phone'));
  assert.ok(has(run(page('<p>Mean: NaN</p>')), 'placeholder'));
});

test('two elements with the same id are caught', () => {
  const problems = run(page('<h2 id="measure-title">Measure</h2><h2 id="measure-title">What gets measured</h2>'));
  assert.ok(has(problems, 'duplicate id "measure-title"'));
});
