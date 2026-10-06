import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, deleteGame } from '../../db';
import { franchiseOf } from '../../lib/catalog';
import { coverCredit } from '../../lib/credits';
import { albumOrder, ensurePositions } from '../../lib/trackOrder';
import { autoAddGame, findCandidates, findVersionCandidates, importVersion, replaceSource, type Candidate } from '../../lib/importer';
import { gamePlatforms } from '../../lib/platforms';
import { kindLabel, kindOf } from '../../lib/kinds';
import { importAnime, useAnimeScope, type AnimeScope } from '../../lib/importers/anime';
import type { AnimeTheme, CatalogGame, GameTags, Source, Track } from '../../types';
import { AnimeScopePicker } from '../AnimeScopePicker';
import type { Session } from '../../useSession';
import { Cover } from './Cover';
import { TrackRow } from '../TrackRow';

export type FacetKind = keyof GameTags | 'keyword' | 'franchise' | 'composer';

const TAG_GROUPS: [keyof GameTags, string][] = [
  ['genre', 'Genres'],
  ['platform', 'Platforms'],
  ['studio', 'Studios'],
  ['network', 'Network'],
  ['format', 'Format'],
  ['mode', 'Modes'],
  ['theme', 'Themes & setting'],
  ['country', 'Country'],
];

const THEME_LABEL = { OP: 'Opening', ED: 'Ending', IN: 'Insert song' } as const;
const ANIME_ADD_LABEL: Record<AnimeScope, string> = {
  all: '+ Add OP/ED & soundtrack',
  songs: '+ Add songs (no OST)',
  oped: '+ Add OPs & EDs',
  op: '+ Add openings',
};
const themeId = (th: AnimeTheme) => th.type + (th.seq ?? '') + th.song;

export function GameDetail({
  game,
  session,
  onClose,
  onFacet,
}: {
  game: CatalogGame;
  session: Session;
  onClose(): void;
  onFacet(kind: FacetKind, value: string): void;
}) {
  const tracks = useLiveQuery(() => db.tracks.where('gameId').equals(game.id).toArray(), [game.id], []);
  const sources = useLiveQuery(() => db.sources.filter((s) => s.gameIds.includes(game.id)).toArray(), [game.id], []);
  const inLibrary = tracks.length > 0;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const animeScope = useAnimeScope();
  const [addingTheme, setAddingTheme] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sorted = useMemo(() => albumOrder(tracks, sources), [tracks, sources]);
  // Older imports don't know their playlist positions yet: fill them in now (lib/trackOrder.ts).
  useEffect(() => {
    void ensurePositions(game.id);
  }, [game.id]);
  const franchise = franchiseOf(game);
  const credit = coverCredit(game);
  const kind = kindOf(game);
  const dev = game.tags?.developer?.slice(0, 2).join(', ');
  const pub = game.tags?.publisher?.slice(0, 2).join(', ');
  // The credit line under the title, worded per kind of work.
  const people = [
    kindLabel(kind).one !== 'game' && kindLabel(kind).one.replace(/^./, (c) => c.toUpperCase()),
    game.year,
    dev && (kind === 'film' ? `directed by ${dev}` : `by ${dev}`),
    pub && `published by ${pub}`,
  ].filter(Boolean);
  // Which of the anime's songs are in the library already.
  const themeTrack = (th: AnimeTheme) =>
    tracks.find((t) => t.role === (th.type === 'IN' ? 'insert' : th.type.toLowerCase()) && t.title === th.song);
  const missingThemes = (game.themes ?? []).filter((th) => !themeTrack(th));
  async function addTheme(th: AnimeTheme) {
    setAddingTheme(themeId(th));
    setMessage(null);
    try {
      const r = await importAnime(game, { themes: [th] });
      setMessage(r.added ? `Added “${th.song}”.` : `“${th.song}” is already in your library.`);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setAddingTheme(null);
    }
  }
  const playLabel = kind === 'anime' ? 'songs & soundtrack' : 'soundtrack';

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // The whole soundtrack, in album order (or shuffled), then back to the regular shuffle.
  const playable = sorted.filter((t) => !t.banned && !t.unavailable);
  const playAll = (shuffle: boolean) =>
    session.playProgram(game.title, playable.map((t) => t.id), { shuffle });

  async function remove() {
    if (!confirm(`Remove ${game.title} and its ${tracks.length} tracks from your library?`)) return;
    await deleteGame(game.id);
    setMessage('Removed from your library.');
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <article className="detail" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={game.title}>
        <button className="detail-close icon-round" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <div className="detail-hero">
          <figure className="detail-figure">
            <Cover game={game} className="detail-cover" />
            {credit && (
              <figcaption className="cover-credit">
                {credit.href ? (
                  <a href={credit.href} target="_blank" rel="noreferrer">
                    {credit.text}
                  </a>
                ) : (
                  credit.text
                )}
                {credit.licenseHref && (
                  <>
                    {' '}
                    <a href={credit.licenseHref} target="_blank" rel="noreferrer" title="License">
                      ⓘ
                    </a>
                  </>
                )}
              </figcaption>
            )}
          </figure>
          <div className="detail-info">
            {franchise && (
              <button className="eyebrow link" onClick={() => onFacet('franchise', franchise)}>
                {franchise}
              </button>
            )}
            <h1>{game.title}</h1>
            <p className="muted">
              {people.join(' · ')}
            </p>
            {game.composers.length > 0 && (
              <p className="composers">
                ♪{' '}
                {game.composers.map((c, i) => (
                  <span key={c}>
                    {i > 0 && ', '}
                    <button className="link inline-link" onClick={() => onFacet('composer', c)}>
                      {c}
                    </button>
                  </span>
                ))}
              </p>
            )}

            <div className="detail-actions">
              {inLibrary ? (
                <>
                  <button className="primary" onClick={() => playAll(false)} title="Play every track in album order, then back to shuffle">
                    ▶ Play {playLabel}
                  </button>
                  <button onClick={() => playAll(true)} title="Play every track in random order, then back to shuffle">
                    ⤮ Shuffle
                  </button>
                                      <button
                      disabled={busy}
                      onClick={() => run(async () => setCandidates(candidates ? null : await findCandidates(game)))}
                    >
                      {candidates ? 'Hide sources' : 'Change source'}
                    </button>
                  {kind === 'anime' && missingThemes.length > 0 && (
                    <button
                      disabled={busy}
                      title="Find the openings, endings and insert songs you don't have yet"
                      onClick={() =>
                        run(async () => {
                          const r = await importAnime(game, { scope: 'songs' });
                          setMessage(`Added ${r.added} songs.`);
                        })
                      }
                    >
                      {busy ? 'Searching…' : `+ Add ${missingThemes.length} missing song${missingThemes.length === 1 ? '' : 's'}`}
                    </button>
                  )}
                  <button className="danger" onClick={remove} title="Remove this title and its tracks from your library">
                    Remove
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const r = await autoAddGame(game);
                        setMessage(`Added ${r.added} tracks from “${r.sourceTitle}”.`);
                      })
                    }
                  >
                    {busy ? 'Searching…' : kind === 'anime' ? ANIME_ADD_LABEL[animeScope] : '+ Add soundtrack'}
                  </button>
                                      <button disabled={busy} onClick={() => run(async () => setCandidates(await findCandidates(game)))}>
                      Pick a source
                    </button>
                </>
              )}
              {game.links?.map((l) => (
                <a key={l.url} className="store-link" href={l.url} target="_blank" rel="noreferrer">
                  {l.label} ↗
                </a>
              ))}
            </div>
            {kind === 'anime' && !inLibrary && game.themes?.length ? <AnimeScopePicker label="Add" /> : null}
            {message && <p className="small">{message}</p>}

            {candidates && (
              <ul className="candidates">
                {candidates.slice(0, 8).map((c) => (
                  <li key={c.hit.id}>
                    <a href={`https://www.youtube.com/playlist?list=${c.hit.id}`} target="_blank" rel="noreferrer">
                      {c.hit.title}
                    </a>
                    <span className="muted small">
                      {c.hit.channel} · {c.hit.videoCount ?? '?'} videos
                    </span>
                    <button
                      className="small-btn"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const r = sources[0]
                            ? await replaceSource(game, sources[0].id, c.hit)
                            : await autoAddGame(game, c.hit);
                          setMessage(`Now using “${r.sourceTitle}” (${r.added} tracks).`);
                          setCandidates(null);
                        })
                      }
                    >
                      Use this
                    </button>
                  </li>
                ))}
                {!candidates.length && <li className="muted">No matching playlists found.</li>}
              </ul>
            )}
          </div>
        </div>

        <div className="detail-body">
          <div className="detail-tags">
            {TAG_GROUPS.map(([kind, label]) =>
              game.tags?.[kind]?.length ? (
                <div key={kind} className="tag-group">
                  <h3>{label}</h3>
                  <div className="pill-row">
                    {game.tags[kind]!.map((v) => (
                      <button key={v} className="pill" onClick={() => onFacet(kind, v)}>
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null,
            )}
            {game.themes?.length ? (
              <div className="tag-group">
                <h3>Openings & endings</h3>
                <ol className="theme-list">
                  {game.themes.map((th) => {
                    const track = themeTrack(th);
                    return (
                      <li key={themeId(th)} className={track ? 'has-track' : ''}>
                        <span className="theme-tag">
                          {th.type}
                          {th.seq ?? ''}
                        </span>
                        <span className="truncate" title={THEME_LABEL[th.type]}>
                          <b>{th.song}</b>
                          {th.artists.length > 0 && <span className="muted"> · {th.artists.join(', ')}</span>}
                        </span>
                        {track ? (
                          <button className="icon" onClick={() => session.playNow(track.id)} title="Play">
                            ▶
                          </button>
                        ) : (
                          <button
                            className="icon"
                            disabled={addingTheme != null}
                            onClick={() => addTheme(th)}
                            title={`Add just this ${THEME_LABEL[th.type].toLowerCase()}${th.episodes ? ` (episodes ${th.episodes})` : ''}`}
                          >
                            {addingTheme === themeId(th) ? '…' : '+'}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            ) : null}
            {game.keywords?.length ? (
              <div className="tag-group keywords">
                <h3>Keywords</h3>
                <p>
                  {game.keywords.map((k, i) => (
                    <span key={k}>
                      {i > 0 && ', '}
                      <button className="link inline-link" onClick={() => onFacet('keyword', k)}>
                        {k.toLowerCase()}
                      </button>
                    </span>
                  ))}
                </p>
              </div>
            ) : null}
          </div>

          <div className="detail-tracks">
            <h3>
              Soundtrack {inLibrary && <span className="muted">· {tracks.length} tracks</span>}
            </h3>
            {!inLibrary && <p className="muted">Not in your library yet.</p>}
            <Soundtrack game={game} sorted={sorted} sources={sources} session={session} showArtist />
            {kind === 'game' && inLibrary && <AddVersion game={game} sources={sources} />}
          </div>
        </div>
      </article>
    </div>
  );
}

const sourceUrl = (s: Source) =>
  s.kind === 'playlist' ? `https://www.youtube.com/playlist?list=${s.id}` : s.kind === 'video' ? `https://www.youtube.com/watch?v=${s.id}` : null;

/**
 * A title's tracks, grouped by where they came from when there's more than one source: a game's
 * platform versions ("PC", "GBA"), an anime's songs vs its score, a film's score vs songs album.
 */
function Soundtrack({
  game,
  sorted,
  sources,
  session,
  showArtist,
}: {
  game: CatalogGame;
  sorted: Track[];
  sources: Source[];
  session: Session;
  showArtist: boolean;
}) {
  const groups = sources
    .slice()
    .sort((a, b) => a.importedAt - b.importedAt)
    .map((s) => ({ source: s, tracks: sorted.filter((t) => t.sourceId === s.id) }))
    .filter((g) => g.tracks.length);
  const row = (t: Track) => <TrackRow key={t.id} track={t} showArtist={showArtist} onPlay={() => session.playNow(t.id)} />;

  if (groups.length <= 1) {
    const s = groups[0]?.source;
    const url = s && sourceUrl(s);
    return (
      <>
        {s && (
          <p className="muted small">
            From {url ? <a href={url} target="_blank" rel="noreferrer">{s.title}</a> : s.title}
            {s.channel && ` (${s.channel})`}
          </p>
        )}
        <ol className="track-list">{sorted.map(row)}</ol>
      </>
    );
  }

  async function removeVersion(s: Source, count: number) {
    if (!confirm(`Remove “${s.label ?? s.title}” (${count} tracks) from ${game.title}?`)) return;
    await db.transaction('rw', db.tracks, db.sources, async () => {
      await db.tracks.where('sourceId').equals(s.id).filter((t) => t.gameId === game.id).delete();
      const rest = s.gameIds.filter((id) => id !== game.id);
      if (rest.length) await db.sources.update(s.id, { gameIds: rest });
      else await db.sources.delete(s.id);
    });
  }

  return (
    <div className="versions">
      {groups.map(({ source: s, tracks }) => {
        const url = sourceUrl(s);
        const playable = tracks.filter((t) => !t.banned && !t.unavailable).map((t) => t.id);
        return (
          <section key={s.id} className="version">
            <header className="version-head">
              <h4>{s.label ? `${s.label} version` : s.title}</h4>
              <span className="muted small truncate">
                {s.label && (url ? <a href={url} target="_blank" rel="noreferrer">{s.title}</a> : s.title)}
                {s.label ? ' · ' : ''}
                {tracks.length} tracks
              </span>
              <span className="spacer" />
              {playable.length > 0 && (
                <button className="small-btn" onClick={() => session.playProgram(`${game.title}: ${s.label ?? s.title}`, playable)}>
                  ▶ Play
                </button>
              )}
              <button className="link small" onClick={() => removeVersion(s, tracks.length)} title="Remove these tracks from this title">
                remove
              </button>
            </header>
            <ol className="track-list">{tracks.map(row)}</ol>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Many 2000s multi-platform games were different games per platform, with different music:
 * add another platform's soundtrack as its own version.
 */
function AddVersion({ game, sources }: { game: CatalogGame; sources: Source[] }) {
  const covered = new Set(sources.flatMap((s) => (s.label ? s.label.split(' / ') : [])));
  const platforms = gamePlatforms(game.tags?.platform).filter((p) => !covered.has(p));
  const [platform, setPlatform] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [named, setNamed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (platforms.length < 1 || gamePlatforms(game.tags?.platform).length < 2) return null;

  async function pick(p: string) {
    setPlatform(p);
    setCandidates(null);
    setMessage(null);
    setBusy(true);
    try {
      const found = await findVersionCandidates(game, p, sources.map((s) => s.id));
      setCandidates(found.candidates);
      setNamed(found.named);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="add-version">
      <p className="muted small">
        Different music on another platform? Add that version:{' '}
        {platforms.map((p) => (
          <button key={p} className={`chip ${platform === p ? 'on' : ''}`} disabled={busy} onClick={() => pick(p)}>
            {p}
          </button>
        ))}
      </p>
      {busy && <p className="muted small">Searching…</p>}
      {candidates && !named && candidates.length > 0 && (
        <p className="muted small">No playlist names the {platform} version. These game soundtracks don't say which version they are:</p>
      )}
      {candidates && (
        <ul className="candidates">
          {candidates.slice(0, 6).map((c) => (
            <li key={c.hit.id}>
              <a href={`https://www.youtube.com/playlist?list=${c.hit.id}`} target="_blank" rel="noreferrer">
                {c.hit.title}
              </a>
              <span className="muted small">
                {c.hit.channel} · {c.hit.videoCount ?? '?'} videos
              </span>
              <button
                className="small-btn"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const n = await importVersion(game, c.hit, named ? undefined : platform ?? undefined).catch(() => 0);
                  setBusy(false);
                  setCandidates(null);
                  setMessage(n ? `Added the ${platform} version (${n} tracks).` : 'Nothing new in that playlist.');
                }}
              >
                Add
              </button>
            </li>
          ))}
          {!candidates.length && <li className="muted">No {platform} soundtrack found on YouTube.</li>}
        </ul>
      )}
      {message && <p className="small">{message}</p>}
    </div>
  );
}
