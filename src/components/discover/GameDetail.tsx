import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import { franchiseOf } from '../../lib/catalog';
import { autoAddGame, findCandidates, replaceSource, type Candidate } from '../../lib/importer';
import type { CatalogGame, GameTags } from '../../types';
import type { Session } from '../../useSession';
import { formatTime } from '../ui';
import { Cover } from './Cover';

export type FacetKind = keyof GameTags | 'keyword' | 'franchise' | 'composer';

const TAG_GROUPS: [keyof GameTags, string][] = [
  ['genre', 'Genres'],
  ['platform', 'Platforms'],
  ['mode', 'Modes'],
  ['theme', 'Themes & setting'],
];

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sorted = useMemo(
    () => tracks.slice().sort((a, b) => a.sourceId.localeCompare(b.sourceId) || (a.start ?? 0) - (b.start ?? 0)),
    [tracks],
  );
  const franchise = franchiseOf(game);
  const people = [
    game.tags?.developer?.length && `by ${game.tags.developer.slice(0, 2).join(', ')}`,
    game.tags?.publisher?.length && `published by ${game.tags.publisher.slice(0, 2).join(', ')}`,
  ].filter(Boolean);

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

  const playRandom = () => {
    const ok = tracks.filter((t) => !t.banned && !t.unavailable);
    if (ok.length) session.playNow(ok[Math.floor(Math.random() * ok.length)].id);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <article className="detail" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={game.title}>
        <button className="detail-close icon-round" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <div className="detail-hero">
          <Cover game={game} className="detail-cover" />
          <div className="detail-info">
            {franchise && (
              <button className="eyebrow link" onClick={() => onFacet('franchise', franchise)}>
                {franchise}
              </button>
            )}
            <h1>{game.title}</h1>
            <p className="muted">
              {[game.year, ...people].filter(Boolean).join(' · ')}
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
                  <button className="primary" onClick={playRandom}>
                    ▶ Play a track
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => run(async () => setCandidates(candidates ? null : await findCandidates(game)))}
                  >
                    {candidates ? 'Hide sources' : 'Change source'}
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
                    {busy ? 'Searching…' : '+ Add soundtrack'}
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
            {sources.length > 0 && (
              <p className="muted small">
                From{' '}
                {sources.map((s, i) => (
                  <span key={s.id}>
                    {i > 0 && ', '}
                    <a
                      href={s.kind === 'playlist' ? `https://www.youtube.com/playlist?list=${s.id}` : `https://www.youtube.com/watch?v=${s.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {s.title}
                    </a>
                    {s.channel && ` (${s.channel})`}
                  </span>
                ))}
              </p>
            )}
            <ol className="detail-tracklist">
              {sorted.map((t) => (
                <li key={t.id} className={t.banned || t.unavailable ? 'excluded' : ''}>
                  <button className="icon" disabled={t.unavailable} onClick={() => session.playNow(t.id)} title="Play">
                    ▶
                  </button>
                  <span className="truncate">{t.title}</span>
                  <span className="muted tabular">{formatTime(t.duration)}</span>
                  {t.liked && <span className="liked">♥</span>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </article>
    </div>
  );
}
