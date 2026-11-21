// Joins the raw workbook rows (sources.json) with the hand-checked details
// (source-extras.json). Plain JavaScript so the tests can run it directly.

export const CATEGORIES = [
  { id: 'historical', label: 'Historical' },
  { id: 'current', label: 'Current scholarly' },
  { id: 'methodology', label: 'Methodology' },
  { id: 'ethics', label: 'Ethics' },
];

/** A workbook row with nothing checked yet. It still shows, as typed. */
function fromRow(row) {
  const year = Number((row.apaRaw.match(/\((\d{4})/) || [])[1]) || 0;
  return {
    id: row.id,
    category: row.category,
    year,
    authors: row.authorsRaw || row.apaRaw.split('(')[0].trim(),
    title: row.title,
    summary: row.summary,
    link: row.link,
    apa: row.apaRaw,
    verified: false,
  };
}

export function mergeSources(rows, extras) {
  const published = [];
  const held = [];

  for (const row of rows) {
    const reason = extras.exclude[row.id] || extras.unconfirmed[row.id];
    if (reason) {
      held.push({ id: row.id, title: row.title, reason, kind: extras.exclude[row.id] ? 'excluded' : 'unconfirmed' });
      continue;
    }
    const checked = extras.overrides[row.id];
    published.push(checked ? { ...fromRow(row), ...checked, id: row.id, verified: true } : fromRow(row));
  }

  for (const extra of extras.added) published.push({ ...extra, verified: true });

  published.sort((a, b) => a.year - b.year || a.authors.localeCompare(b.authors, 'en'));
  return { published, held };
}

/** Reference-list order: alphabetical by the APA entry, ignoring the italics stars. */
export function sortReferences(sources) {
  const key = (s) => s.apa.replace(/\*/g, '').toLowerCase();
  return [...sources].sort((a, b) => key(a).localeCompare(key(b), 'en'));
}
