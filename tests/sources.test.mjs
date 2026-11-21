// Checks the source library data before it reaches the site.
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeSources, CATEGORIES } from '../src/lib/merge-sources.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const raw = read('../src/data/sources.json');
const extras = read('../src/data/source-extras.json');
const { published, held } = mergeSources(raw.sources, extras);

const BANNED = /steriliz|sterilis|\bsterile\b/i;

test('the workbook was converted', () => {
  assert.ok(raw.sources.length >= 40, `only ${raw.sources.length} rows found`);
  for (const row of raw.sources) {
    assert.ok(row.id && row.title && row.apaRaw, `row is missing fields: ${JSON.stringify(row).slice(0, 80)}`);
  }
});

test('source ids are unique', () => {
  const ids = [...published, ...held].map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every published source has been checked and is complete', () => {
  assert.ok(published.length > 0);
  for (const s of published) {
    assert.equal(s.verified, true, `${s.id} is published but has no checked entry in source-extras.json`);
    assert.ok(CATEGORIES.some((c) => c.id === s.category), `${s.id}: unknown category ${s.category}`);
    assert.ok(Number.isInteger(s.year) && s.year > 1900 && s.year < 2100, `${s.id}: bad year`);
    assert.ok(s.authors && s.authors.length > 1, `${s.id}: no author`);
    assert.ok(s.title && s.title.length > 5, `${s.id}: no title`);
    assert.ok(/^https:\/\//.test(s.link), `${s.id}: link must start with https://`);
    assert.ok(s.summary.length >= 2, `${s.id}: needs at least two summary points`);
    assert.ok(s.apa.includes(`(${s.year}`), `${s.id}: APA entry should contain (${s.year}`);
    assert.equal((s.apa.match(/\*/g) || []).length % 2, 0, `${s.id}: unbalanced * in APA entry`);
  }
});

test('held-back sources are not published', () => {
  const publishedIds = new Set(published.map((s) => s.id));
  for (const id of [...Object.keys(extras.exclude), ...Object.keys(extras.unconfirmed)]) {
    assert.ok(!publishedIds.has(id), `${id} should be held back`);
  }
});

test('every id in source-extras.json matches a workbook row', () => {
  const rawIds = new Set(raw.sources.map((s) => s.id));
  for (const key of ['exclude', 'unconfirmed', 'overrides']) {
    for (const id of Object.keys(extras[key])) {
      assert.ok(rawIds.has(id), `${key}: "${id}" is not in sources.json`);
    }
  }
});

test('summaries and notes use "disinfection" wording and make no absolute claims', () => {
  for (const s of published) {
    const text = [...s.summary, s.note || '', s.authors].join(' ');
    assert.ok(!BANNED.test(text), `${s.id}: summary uses a banned word`);
    assert.ok(!/no research exists/i.test(text), `${s.id}: "no research exists"`);
  }
});
