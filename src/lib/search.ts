// Fast fuzzy-ish search over game titles.
//
// Every query word must match some word of the game (any order), by:
//   exact word > word prefix ("won" → "wonder") > initials ("botw", "ff7") > one typo (≥4 letters).
// Title matches outrank matches on series / franchise / composer / developer.
// Words are tokenised once per catalog load, so a search is a quick linear scan.

import type { CatalogGame } from '../types';
import { normalize } from './parse';

interface Entry<T> {
  item: T;
  title: string[];
  initials: string;
  other: string[];
  pop: number;
}

export interface SearchIndex<T> {
  entries: Entry<T>[];
}

const words = (s: string | null | undefined) => (s ? normalize(s).split(' ').filter(Boolean) : []);

export function buildIndex<T>(
  items: T[],
  fields: (item: T) => { title: string; other?: (string | null | undefined)[]; pop?: number },
): SearchIndex<T> {
  return {
    entries: items.map((item) => {
      const f = fields(item);
      const title = words(f.title);
      return {
        item,
        title,
        initials: title.map((w) => (/^\d+$/.test(w) ? w : w[0])).join(''),
        other: (f.other ?? []).flatMap(words),
        pop: f.pop ?? 0,
      };
    }),
  };
}

export function gameIndex(games: CatalogGame[]) {
  return buildIndex(games, (g) => ({
    title: g.title,
    other: [g.series, g.franchise, ...g.composers, ...(g.tags?.developer ?? [])],
    pop: g.pop,
  }));
}

/** True if a and b differ by at most one insert, delete, substitution or adjacent swap. */
function oneEdit(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diff: number[] = [];
    for (let k = 0; k < a.length && diff.length < 3; k++) if (a[k] !== b[k]) diff.push(k);
    if (diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]) return true;
  }
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function tokenScore(tok: string, e: Entry<unknown>, fuzzy: boolean): number {
  let best = 0;
  for (const w of e.title) {
    if (w === tok) return 6;
    if (w.startsWith(tok)) best = Math.max(best, 4);
  }
  if (best) return best;
  if (tok.length >= 2 && e.initials.includes(tok)) return tok.length >= 3 ? 4 : 2;
  for (const w of e.other) {
    if (w === tok) best = Math.max(best, 2);
    else if (w.startsWith(tok)) best = Math.max(best, 1.5);
  }
  if (best) return best;
  if (fuzzy && tok.length >= 4) {
    for (const w of e.title) if (oneEdit(tok, w) || (w.length > tok.length && oneEdit(tok, w.slice(0, tok.length)))) return 1.5;
    for (const w of e.other) if (oneEdit(tok, w)) return 0.75;
  }
  return 0;
}

function run<T>(index: SearchIndex<T>, toks: string[], fuzzy: boolean) {
  const out: { item: T; score: number }[] = [];
  for (const e of index.entries) {
    let score = 0;
    for (const t of toks) {
      const s = tokenScore(t, e, fuzzy);
      if (!s) {
        score = 0;
        break;
      }
      score += s;
    }
    if (!score) continue;
    // Prefer titles that start with the query and that have few extra words.
    if (e.title[0]?.startsWith(toks[0])) score += 2;
    score -= Math.max(0, e.title.length - toks.length) * 0.15;
    out.push({ item: e.item, score: score + Math.log10(1 + e.pop) * 0.5 });
  }
  return out;
}

/** Matching items, best first. Typos are only tried when nothing matches exactly. */
export function search<T>(index: SearchIndex<T>, query: string): T[] {
  const toks = words(query);
  if (!toks.length) return index.entries.map((e) => e.item);
  let hits = run(index, toks, false);
  if (!hits.length) hits = run(index, toks, true);
  return hits.sort((a, b) => b.score - a.score).map((h) => h.item);
}
