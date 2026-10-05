// Labels for the kinds of works the app plays music from.
import type { TrackRole, WorkKind } from '../types';

export const KINDS: { id: WorkKind; label: string; one: string; many: string; icon: string }[] = [
  { id: 'game', label: 'Games', one: 'game', many: 'games', icon: '🎮' },
  { id: 'anime', label: 'Anime', one: 'anime', many: 'anime', icon: '🌸' },
  { id: 'film', label: 'Films', one: 'film', many: 'films', icon: '🎬' },
  { id: 'series', label: 'TV series', one: 'series', many: 'series', icon: '📺' },
];

export const kindOf = (w: { kind?: WorkKind }): WorkKind => w.kind ?? 'game';
// Unknown kinds (artists, from before that domain was removed) read as plain titles.
const OTHER = { id: 'game' as WorkKind, label: 'Other', one: 'title', many: 'titles', icon: '🎵' };
export const kindLabel = (k: WorkKind | string) => KINDS.find((x) => x.id === k) ?? OTHER;

/**
 * "12 films", "1 anime", or "30 titles" when the kinds are mixed. Medley spans games, anime,
 * film & TV, so user-facing text never says "games" unless they're all games.
 */
export function titlesLabel(works: { kind?: WorkKind }[], n = works.length) {
  const kinds = new Set(works.map(kindOf));
  const count = n.toLocaleString();
  if (kinds.size === 1) {
    const k = kindLabel([...kinds][0]);
    return `${count} ${n === 1 ? k.one : k.many}`;
  }
  return `${count} title${n === 1 ? '' : 's'}`;
}

export const ROLES: { id: TrackRole; label: string }[] = [
  { id: 'op', label: 'Openings (OP)' },
  { id: 'ed', label: 'Endings (ED)' },
  { id: 'insert', label: 'Insert songs' },
  { id: 'song', label: 'Songs' },
  { id: 'score', label: 'Score / BGM' },
];

/** "♪ Joe Hisaishi": the credit line shown under a work's title. */
export function creditLine(w: { kind?: WorkKind; composers: string[] }): string {
  if (!w.composers.length) return '';
  return `♪ ${w.composers.slice(0, 2).join(', ')}`;
}
