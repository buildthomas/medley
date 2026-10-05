// The track page: everything Medley knows about one track, with its labels editable. Opened from
// any track row, the now-playing title, search results and the Library (lib/nav.ts).

import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../db';
import { useCatalog } from '../lib/catalog';
import { kindLabel, kindOf, ROLES } from '../lib/kinds';
import { closeTop, openTitle, replaceTop } from '../lib/nav';
import { parseYouTubeLink, type VideoHit } from '../lib/api';
import { replaceTrackVideo } from '../lib/importer';
import { rankThemeVideos } from '../lib/importers/anime';
import { normalize, TRACK_TYPES } from '../lib/parse';
import { isVocal, lengthOf, LENGTHS } from '../lib/picker';
import type { Track, TrackRole } from '../types';
import type { Session } from '../useSession';
import { Cover } from './discover/Cover';
import { HeartIcon, PlayIcon } from './icons';
import { roleBadge } from './TrackRow';
import { formatTime } from './ui';

const TYPE_LABEL = new Map(TRACK_TYPES.map((t) => [t.id, t.label]));
const when = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export function TrackDetail({ id, session }: { id: string; session: Session }) {
  const track = useLiveQuery(() => db.tracks.get(id), [id]);
  const source = useLiveQuery(() => (track ? db.sources.get(track.sourceId) : undefined), [track?.sourceId]);
  const lastPlay = useLiveQuery(() => db.plays.where('trackId').equals(id).last(), [id]);
  const cat = useCatalog();
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeTop();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (track === undefined) return null; // loading
  const shell = (body: React.ReactNode) => (
    <div className="modal-backdrop" onClick={closeTop}>
      <article className="detail track-page" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={track?.title ?? 'Track'}>
        <button className="detail-close icon-round" onClick={closeTop} aria-label="Close">
          ✕
        </button>
        {body}
      </article>
    </div>
  );
  if (!track) return shell(<p className="muted track-gone">This track isn’t in your library anymore.</p>);

  const work = session.gameMap.get(track.gameId);
  const catWork = cat?.byId.get(track.gameId);
  const kind = work ? kindLabel(kindOf(work)).one : 'title';
  const update = (changes: Partial<Track>) => db.tracks.update(track.id, changes);
  const toggleType = (type: string) =>
    update({ types: track.types.includes(type) ? track.types.filter((t) => t !== type) : [...track.types, type] });
  // Credited artists that are titles in Medley (an artist page) become links.
  const artistLinks = (track.artist ?? '')
    .split(/,\s*|\s+&\s+/)
    .filter(Boolean)
    .map((name) => ({
      name,
      id: cat?.games.find((g) => g.kind === 'artist' && normalize(g.title) === normalize(name))?.id,
    }));
  const length = LENGTHS.find((l) => l.id === lengthOf(track));
  const sliceFrom = track.start != null ? ` · from ${formatTime(track.start)} in the video` : '';
  const youtube = `https://www.youtube.com/watch?v=${track.videoId}${track.start ? `&t=${Math.floor(track.start)}` : ''}`;
  const isCurrent = session.current?.id === track.id;

  return shell(
    <>
      <div className="track-hero">
        {work && (
          <button className="track-cover" onClick={() => openTitle(work.id)} title={`Open ${work.title}`}>
            <Cover game={{ title: work.title, year: work.year, covers: catWork?.covers }} />
          </button>
        )}
        <div className="detail-info">
          <p className="eyebrow">
            Track{work ? ' · from ' : ''}
            {work && (
              <button className="link-plain eyebrow-link" onClick={() => openTitle(work.id)}>
                {work.title}
              </button>
            )}
          </p>
          {renaming ? (
            <input
              className="track-rename"
              autoFocus
              defaultValue={track.title}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== track.title) void update({ title: v, customTitle: true });
                setRenaming(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenaming(false);
              }}
            />
          ) : (
            <h1>
              {track.title}{' '}
              <button className="link small rename-btn" onClick={() => setRenaming(true)} title="Rename">
                ✎
              </button>
            </h1>
          )}
          {artistLinks.length > 0 && (
            <p className="muted">
              {artistLinks.map((a, i) => (
                <span key={a.name}>
                  {i > 0 && ', '}
                  {a.id ? (
                    <button className="link inline-link" onClick={() => openTitle(a.id!)}>
                      {a.name}
                    </button>
                  ) : (
                    a.name
                  )}
                </span>
              ))}
            </p>
          )}
          <div className="detail-actions">
            <button className="primary" disabled={track.unavailable} onClick={() => session.playNow(track.id)}>
              <PlayIcon size={13} /> {isCurrent ? 'Play again' : 'Play now'}
            </button>
            <button className={track.liked ? 'liked' : ''} onClick={() => update({ liked: !track.liked })}>
              <HeartIcon size={13} filled={track.liked} /> {track.liked ? 'Liked' : 'Like'}
            </button>
            <button onClick={() => update({ banned: !track.banned, unavailable: false })} title="Never play it in the shuffle">
              {track.banned ? 'Allow again' : '⊘ Never play'}
            </button>
            <a className="store-link" href={youtube} target="_blank" rel="noreferrer">
              Watch on YouTube ↗
            </a>
          </div>
          {track.unavailable && <p className="err small">YouTube doesn’t allow this video to play here (removed, private or not embeddable).</p>}
        </div>
      </div>

      <div className="track-body">
        <section className="tag-group">
          <h3>Labels</h3>
          <div className="track-edit-row">
            <span className="muted small">Kind</span>
            <select
              value={track.role ?? ''}
              onChange={(e) => update({ role: (e.target.value || undefined) as TrackRole | undefined, ...(e.target.value === 'score' ? { vocal: false } : {}) })}
            >
              <option value="">Not set</option>
              {ROLES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            {(track.role === 'op' || track.role === 'ed') && (
              <label className="small">
                No.{' '}
                <input
                  type="number"
                  min={1}
                  className="seq-input"
                  value={track.seq ?? ''}
                  onChange={(e) => update({ seq: e.target.value ? Number(e.target.value) : null })}
                />
              </label>
            )}
            {roleBadge(track) && <span className="theme-tag">{roleBadge(track)}</span>}
          </div>
          <div className="track-edit-row">
            <span className="muted small">Voice</span>
            <div className="segmented">
              <button className={isVocal(track) ? 'on' : ''} onClick={() => update({ vocal: true })}>
                ♪ Sung
              </button>
              <button className={!isVocal(track) ? 'on' : ''} onClick={() => update({ vocal: false })}>
                Instrumental
              </button>
            </div>
          </div>
          <div className="pill-row">
            {track.types.map((t) => (
              <button key={t} className="pill on" title="Remove this label" onClick={() => toggleType(t)}>
                {TYPE_LABEL.get(t) ?? t} ×
              </button>
            ))}
            <select className="add-tag" value="" onChange={(e) => e.target.value && toggleType(e.target.value)} aria-label="Add a label">
              <option value="">+ label</option>
              {TRACK_TYPES.filter((ty) => !track.types.includes(ty.id)).map((ty) => (
                <option key={ty.id} value={ty.id}>
                  {ty.label}
                </option>
              ))}
            </select>
          </div>
          <p className="muted small">Labels drive the Listen filters (Song type, Voice, Track types, Length).</p>
        </section>

        <OtherVersions track={track} />

        <section className="tag-group">
          <h3>About</h3>
          <dl className="facts">
            <dt>Length</dt>
            <dd>
              {formatTime(track.duration)} · {length?.label}
              {sliceFrom}
            </dd>
            <dt>Played</dt>
            <dd>
              {track.playCount} time{track.playCount === 1 ? '' : 's'}
              {lastPlay ? ` · last ${when(lastPlay.at)}` : ''}
              {track.skipCount ? ` · skipped early ${track.skipCount}×` : ''}
            </dd>
            {work && (
              <>
                <dt>From</dt>
                <dd>
                  <button className="link inline-link" onClick={() => openTitle(work.id)}>
                    {work.title}
                  </button>{' '}
                  <span className="muted">
                    ({kind}
                    {work.year ? `, ${work.year}` : ''})
                  </span>
                  {!work.enabled && <span className="muted"> · paused in rotation</span>}
                </dd>
              </>
            )}
            {source && (
              <>
                <dt>Source</dt>
                <dd>
                  {source.kind === 'search' ? (
                    source.title
                  ) : (
                    <a
                      href={source.kind === 'playlist' ? `https://www.youtube.com/playlist?list=${source.id}` : `https://www.youtube.com/watch?v=${source.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {source.title}
                    </a>
                  )}
                  {source.channel && <span className="muted"> · {source.channel}</span>}
                  <span className="muted"> · added {when(source.importedAt)}</span>
                </dd>
              </>
            )}
          </dl>
        </section>
      </div>
    </>,
  );
}

/**
 * "Wrong video?": swap the video behind the track (a live version instead of the music video,
 * a fan upload, a removed video). Anime songs list the other candidates the importer found;
 * any track can take a pasted YouTube link. Name, labels, likes and plays are kept.
 */
function OtherVersions({ track }: { track: Track }) {
  const cat = useCatalog();
  const [candidates, setCandidates] = useState<{ hit: VideoHit; score: number }[] | null>(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anime = cat?.byId.get(track.gameId);
  const theme =
    anime?.kind === 'anime' && track.role && track.role !== 'score'
      ? anime.themes?.find((th) => normalize(th.song) === normalize(track.title)) ??
        anime.themes?.find((th) => (th.type === 'IN' ? 'insert' : th.type.toLowerCase()) === track.role && (th.seq ?? null) === (track.seq ?? null))
      : undefined;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const use = (videoId: string, duration?: number | null) =>
    run(async () => {
      const id = await replaceTrackVideo(track, videoId, duration);
      replaceTop({ type: 'track', id });
    });

  return (
    <section className="tag-group">
      <h3>Wrong video?</h3>
      <p className="muted small">Swap in another upload (say the music video instead of a live version). The name, labels, likes and plays stay.</p>
      {theme && anime && !candidates && (
        <button disabled={busy} onClick={() => run(async () => setCandidates((await rankThemeVideos(theme, anime)).filter((c) => c.hit.id !== track.videoId).slice(0, 6)))}>
          {busy ? 'Searching…' : 'Find other versions'}
        </button>
      )}
      {candidates && (
        <ul className="candidates">
          {candidates.map(({ hit }) => (
            <li key={hit.id}>
              <a href={`https://www.youtube.com/watch?v=${hit.id}`} target="_blank" rel="noreferrer">
                {hit.title}
              </a>
              <span className="muted small">
                {hit.channel} · {formatTime(hit.duration)}
              </span>
              <button className="small-btn" disabled={busy} onClick={() => use(hit.id, hit.duration)}>
                Use this
              </button>
            </li>
          ))}
          {!candidates.length && <li className="muted">No other versions found.</li>}
        </ul>
      )}
      <div className="toolbar">
        <input className="grow" placeholder="…or paste a YouTube link" value={link} onChange={(e) => setLink(e.target.value)} aria-label="YouTube link" />
        <button
          disabled={busy || !link.trim()}
          onClick={() => {
            const parsed = parseYouTubeLink(link);
            if (parsed?.kind !== 'video') return setError('That isn’t a link to a single YouTube video.');
            void use(parsed.id);
          }}
        >
          Use video
        </button>
      </div>
      {error && <p className="err small">{error}</p>}
    </section>
  );
}
