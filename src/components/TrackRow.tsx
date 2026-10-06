// How a track shows up in any list (a title's tracklist, up next, recently played, search
// results): ▶ to play, the name opens the track's page, its labels, and optionally the title it
// belongs to (which opens that title's page).

import { kindLabel, kindOf } from '../lib/kinds';
import { openTitle, openTrack } from '../lib/nav';
import { TRACK_TYPES } from '../lib/parse';
import { isVocal, lengthOf, LENGTHS } from '../lib/picker';
import type { Game, Track } from '../types';
import { PlayButton } from './ui';
import { formatTime } from './ui';

const TYPE_LABEL = new Map(TRACK_TYPES.map((t) => [t.id, t.label]));

/** "OP1", "ED", "Insert": the role badge for anime songs (none for score/plain songs). */
export function roleBadge(t: Pick<Track, 'role' | 'seq'>) {
  if (!t.role || t.role === 'score' || t.role === 'song') return null;
  return `${t.role === 'insert' ? 'Insert' : t.role.toUpperCase()}${t.seq ?? ''}`;
}

/** The labels a track carries: role, track types, sung, unusual length. */
export function TrackLabels({ track, max = 4 }: { track: Track; max?: number }) {
  const role = roleBadge(track);
  const length = lengthOf(track);
  const lengthLabel = length === 'jingle' || length === 'long' ? LENGTHS.find((l) => l.id === length)?.label.split(' ')[0] : null;
  const types = track.types.filter((t) => t !== 'vocal').slice(0, max);
  return (
    <span className="track-labels">
      {role && <span className="theme-tag">{role}</span>}
      {isVocal(track) && (
        <span className="label-chip vocal" title="Sung">
          ♪
        </span>
      )}
      {types.map((t) => (
        <span key={t} className="label-chip">
          {TYPE_LABEL.get(t) ?? t}
        </span>
      ))}
      {lengthLabel && <span className="label-chip muted">{lengthLabel}</span>}
    </span>
  );
}

export function TrackRow({
  track,
  work,
  showWork,
  showArtist = true,
  onPlay,
  playTitle = 'Play now',
}: {
  track: Track;
  work?: Pick<Game, 'id' | 'title' | 'kind'>;
  /** Show which title it belongs to (lists that mix titles). */
  showWork?: boolean;
  showArtist?: boolean;
  onPlay?(): void;
  playTitle?: string;
}) {
  const excluded = track.banned || track.unavailable;
  return (
    <li className={`track-row ${excluded ? 'excluded' : ''}`}>
      {onPlay && (
        <PlayButton disabled={track.unavailable} onClick={onPlay} label={playTitle} />
      )}
      <span className="track-main">
        <button className="link-plain track-name" onClick={() => openTrack(track.id)} title="Track details">
          {track.title}
        </button>
        <span className="track-sub">
          <TrackLabels track={track} />
          {showArtist && track.artist && <span className="muted truncate">{track.artist}</span>}
          {showWork && work && (
            <button className="link-plain muted truncate" onClick={() => openTitle(work.id)} title={`Open this ${kindLabel(kindOf(work)).one}`}>
              {work.title}
            </button>
          )}
        </span>
      </span>
      <span className="track-end">
        {track.liked && <span className="liked" title="Liked">♥</span>}
        {track.banned && <span className="muted" title="Never played">⊘</span>}
        <span className="muted tabular">{formatTime(track.duration)}</span>
      </span>
    </li>
  );
}
