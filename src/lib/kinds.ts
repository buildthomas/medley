// Labels for the kinds of works the app plays music from.
import type { TrackRole, WorkKind } from '../types';

export const KINDS: { id: WorkKind; label: string; one: string; icon: string }[] = [
  { id: 'game', label: 'Games', one: 'game', icon: '🎮' },
  { id: 'anime', label: 'Anime', one: 'anime', icon: '🌸' },
  { id: 'film', label: 'Films', one: 'film', icon: '🎬' },
  { id: 'series', label: 'TV series', one: 'series', icon: '📺' },
  { id: 'artist', label: 'Artists', one: 'artist', icon: '🎤' },
];

export const kindOf = (w: { kind?: WorkKind }): WorkKind => w.kind ?? 'game';
export const kindLabel = (k: WorkKind) => KINDS.find((x) => x.id === k)!;

export const ROLES: { id: TrackRole; label: string }[] = [
  { id: 'op', label: 'Openings (OP)' },
  { id: 'ed', label: 'Endings (ED)' },
  { id: 'insert', label: 'Insert songs' },
  { id: 'song', label: 'Songs' },
  { id: 'score', label: 'Score / BGM' },
];

/** "by Team Cherry", "♪ Joe Hisaishi", "YOASOBI": the credit line shown under a work's title. */
export function creditLine(w: { kind?: WorkKind; composers: string[] }): string {
  if (kindOf(w) === 'artist' || !w.composers.length) return '';
  return `♪ ${w.composers.slice(0, 2).join(', ')}`;
}
