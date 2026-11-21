// Turns the sources workbook (.xlsx) into src/data/sources.json.
//
//   npm run sources -- "/path/to/Collection_of_Sources_in_APA.xlsx"
//
// The workbook itself is never copied into this repo. Only the text of the
// four tabs is. Corrections live in src/data/source-extras.json, so running
// this again never loses them.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const TABS = {
  historical: /historical/i,
  current: /current/i,
  methodology: /method/i,
  ethics: /ethic/i,
};

const file = process.argv[2];
if (!file) {
  console.error('Give the path to the workbook:\n  npm run sources -- "/path/to/workbook.xlsx"');
  process.exit(1);
}

/** Plain text of a cell, whatever Excel stored in it. */
function text(cell) {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((part) => part.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v.hyperlink) return String(v.hyperlink);
    return '';
  }
  return String(v);
}

function link(cell) {
  const v = cell.value;
  if (v && typeof v === 'object' && v.hyperlink) return String(v.hyperlink).trim();
  const match = text(cell).match(/https?:\/\/\S+/);
  return match ? match[0] : '';
}

function slug(value) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "Rankin, T. M., ... (2014)." becomes "rankin-2014". */
function makeId(apa) {
  const lead = apa.split(/[,(]/)[0].replace(/\b[A-Z]\.\s*/g, '').replace(/\.\s*$/, '');
  const year = (apa.match(/\((\d{4})/) || [])[1] || 'nd';
  return `${slug(lead)}-${year}`;
}

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(file);

const sources = [];
const seen = new Map();

for (const [category, pattern] of Object.entries(TABS)) {
  const sheet = workbook.worksheets.find((ws) => pattern.test(ws.name));
  if (!sheet) {
    console.error(`No tab matching ${pattern} was found. Tabs: ${workbook.worksheets.map((ws) => ws.name).join(', ')}`);
    process.exit(1);
  }

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const titleCell = text(row.getCell(2)).trim();
    const apaRaw = text(row.getCell(5)).replace(/\s+/g, ' ').trim();
    if (!titleCell || !apaRaw) return;

    const lines = titleCell.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const authorLine = lines.findLastIndex((line) => /^-\s*/.test(line));
    const authorsRaw = authorLine > 0 ? lines[authorLine].replace(/^-\s*/, '') : '';
    const title = (authorLine > 0 ? lines.slice(0, authorLine) : lines).join(' ').replace(/\s+/g, ' ');

    const summary = text(row.getCell(3))
      .split(/\r?\n/)
      .map((line) => line.replace(/^[\s•\-–]+/, '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    let id = makeId(apaRaw);
    const count = (seen.get(id) || 0) + 1;
    seen.set(id, count);
    if (count > 1) id = `${id}-${count}`;

    sources.push({
      id,
      category,
      n: Number(text(row.getCell(1))) || rowNumber - 1,
      title,
      authorsRaw,
      summary,
      link: link(row.getCell(4)),
      apaRaw,
    });
  });
}

const out = fileURLToPath(new URL('../src/data/sources.json', import.meta.url));
writeFileSync(out, `${JSON.stringify({ sources }, null, 2)}\n`);

const perTab = Object.keys(TABS).map((c) => `${c} ${sources.filter((s) => s.category === c).length}`);
console.log(`Wrote ${sources.length} sources to src/data/sources.json (${perTab.join(', ')}).`);
