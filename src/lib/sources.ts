import raw from '../data/sources.json';
import extras from '../data/source-extras.json';
import { CATEGORIES, mergeSources, sortReferences } from './merge-sources.js';

export interface Source {
  id: string;
  category: 'historical' | 'current' | 'methodology' | 'ethics';
  year: number;
  /** Short form for the library row, like "Rankin et al." */
  authors: string;
  title: string;
  summary: string[];
  link: string;
  /** APA 7 entry. *Stars* mark italics. */
  apa: string;
  tag?: string;
  note?: string;
  verified: boolean;
}

const merged = mergeSources(raw.sources, extras) as { published: Source[] };

export { CATEGORIES };

export function getSources(): Source[] {
  return merged.published;
}

export function getSource(id: string): Source {
  const found = merged.published.find((s) => s.id === id);
  if (!found) throw new Error(`Source "${id}" is not in the published library.`);
  return found;
}

export function getReferences(): Source[] {
  return sortReferences(merged.published) as Source[];
}

/** Turns an APA entry with *stars* into safe HTML with <em> and a linked URL. */
export function apaToHtml(apa: string): string {
  const escaped = apa.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
}
