// Tests for what the site says and shows: no claim bigger than the work behind it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const json = async (name) => JSON.parse(await readFile(new URL(`../src/data/${name}.json`, import.meta.url), 'utf8'));
const research = await json('research');
const process = await json('process');
const home = await json('home');
const extras = await json('source-extras');

test('the source library does not claim more than was done', () => {
  const held = Object.keys(extras.unconfirmed).length + Object.keys(extras.exclude).length;
  if (held === 0) return; // nothing is held back any more, so "every source" would be true
  assert.doesNotMatch(research.library.heading, /every source/i, 'some sources are held back, so it is not every source');
  assert.doesNotMatch(research.lead, /every source/i);
  assert.doesNotMatch(research.library.intro, /all of them were checked/i, 'not every summary line was checked');
});

test('the parts table adds up and labels its total honestly', () => {
  const { rows, total, extra } = process.plan.counts;
  const sum = rows.reduce((n, row) => n + Number(row[3]), 0);
  assert.equal(sum, Number(total[3]), 'the total row is the sum of the rows above it');
  assert.ok(Number(extra[3]) > 0);
  // Spare bars and tweezers are printed but are not data, so the total is a count of parts.
  assert.doesNotMatch(total[0], /data set/i);
});

test('the bend-rig step on the timeline has a real date or no date', () => {
  const rig = process.timeline.items.find((item) => /rig/i.test(item.text));
  if (!rig) return;
  // The month alone was a guess. Leave it empty, or give the day it happened.
  assert.match(rig.when, /^$|\b\d{1,2}, \d{4}$/, 'use a full date like "Nov 14, 2026", or leave "when" empty');
});

test('the Fleischer statistic is worded the way the paper reports it', () => {
  const stat = home.why.stats.find((item) => item.source === 'fleischer-2020');
  if (!stat) return; // the statistic was swapped for another one
  // The paper's sentence is about the median weight of the samples, with a maximum of 8.3%.
  assert.equal(stat.value, 8.3);
  assert.match(stat.text, /median/i);
});

test('the site icon shows the green seal line', async () => {
  for (const file of ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png']) {
    const { data, info } = await sharp(new URL(`../public/${file}`, import.meta.url).pathname, { density: 300 })
      .resize(64, 64)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let green = 0;
    for (let y = 0; y < info.height / 2; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const i = (y * info.width + x) * info.channels;
        if (data[i + 1] > data[i] + 30 && data[i + 1] > data[i + 2] + 30) green += 1;
      }
    }
    assert.ok(green > 20, `${file} has ${green} green pixels in its top half`);
  }
});
