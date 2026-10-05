import { useEffect, useRef, useState } from 'react';
import { exportLibrary, importLibrary } from '../db';
import { parseYouTubeLink, searchPlaylists, type PlaylistHit } from '../lib/api';
import { loadCatalog } from '../lib/catalog';
import { commitDraft, draftFromLink, type ImportDraft } from '../lib/importer';
import { TRACK_TYPES } from '../lib/parse';
import type { CatalogGame } from '../types';
import { AnimeListImport } from './AnimeListImport';
import { SongImport } from './SongImport';
import { SteamImport } from './SteamImport';
import { formatTime } from './ui';

export function AddView() {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<CatalogGame[]>([]);
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<PlaylistHit[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadCatalog().then((c) => setCatalog(c.games));
  }, []);

  async function open(link: string) {
    const parsed = parseYouTubeLink(link);
    if (!parsed) {
      setError(`Not a YouTube playlist or video link: ${link}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setDraft(await draftFromLink(parsed));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function fetchLinks() {
    const links = input.split(/\s+/).filter(Boolean);
    if (!links.length) return;
    setMessage(null);
    setQueue(links.slice(1));
    setInput('');
    await open(links[0]);
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const added = await commitDraft(draft);
      const games = draft.groups.filter((g) => g.tracks.some((t) => t.include)).length;
      setMessage(`Saved ${added} new tracks across ${games} game${games === 1 ? '' : 's'}.`);
      setDraft(null);
      if (queue.length) {
        const [nextLink, ...rest] = queue;
        setQueue(rest);
        await open(nextLink);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function updateGroup(i: number, patch: Partial<ImportDraft['groups'][number]>) {
    if (!draft) return;
    const groups = draft.groups.slice();
    groups[i] = { ...groups[i], ...patch };
    setDraft({ ...draft, groups });
  }

  function renameGroup(i: number, title: string) {
    const match = catalog.find((c) => c.title.toLowerCase() === title.trim().toLowerCase());
    updateGroup(i, { title, catalogId: match?.id ?? null });
  }

  async function runSearch() {
    if (!search.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setHits(await searchPlaylists(search));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    const blob = new Blob([await exportLibrary()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `medley-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function restore(file: File) {
    try {
      await importLibrary(await file.text());
      setMessage('Backup restored.');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="add">
      <datalist id="catalog-titles">
        {catalog.map((c) => (
          <option key={c.id} value={c.title} />
        ))}
      </datalist>

      {!draft && (
        <>
          <section className="card">
            <h2>Add from a YouTube link</h2>
            <p className="muted">
              Paste one or more playlist or video links. Full-OST videos with a timestamped tracklist in the
              description are split into separate tracks. Playlists that mix several games are grouped per game.
            </p>
            <textarea
              rows={3}
              placeholder="https://www.youtube.com/playlist?list=…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), fetchLinks())}
            />
            <div className="row-actions">
              <button className="primary" disabled={busy || !input.trim()} onClick={fetchLinks}>
                {busy ? 'Reading…' : 'Read link'}
              </button>
            </div>
          </section>

          <section className="card">
            <h2>Search YouTube playlists</h2>
            <div className="toolbar">
              <input
                className="search grow"
                placeholder="e.g. Hollow Knight Silksong OST"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              />
              <button disabled={busy} onClick={runSearch}>
                Search
              </button>
            </div>
            {hits && (
              <ul className="candidates">
                {hits.map((h) => (
                  <li key={h.id}>
                    <a href={`https://www.youtube.com/playlist?list=${h.id}`} target="_blank" rel="noreferrer">
                      {h.title}
                    </a>
                    <span className="muted small">
                      {h.channel} · {h.videoCount ?? '?'} videos
                    </span>
                    <button className="small-btn" disabled={busy} onClick={() => open(h.id)}>
                      Review
                    </button>
                  </li>
                ))}
                {!hits.length && <li className="muted">No playlists found.</li>}
              </ul>
            )}
          </section>

          <SongImport />

          <AnimeListImport />

          <SteamImport />

          <section className="card">
            <h2>Backup</h2>
            <p className="muted">Your library lives in this browser. Export it to move it to another browser or keep a copy.</p>
            <div className="row-actions">
              <button onClick={download}>Export library</button>
              <button onClick={() => fileRef.current?.click()}>Restore from file…</button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                hidden
                onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])}
              />
            </div>
          </section>
        </>
      )}

      {error && <div className="notice err">{error}</div>}
      {message && <div className="notice ok">{message}</div>}

      {draft && (
        <section className="card draft">
          <header className="draft-head">
            <div>
              <h2>Review import</h2>
              <p className="muted">
                {draft.source.kind === 'playlist' ? 'Playlist' : 'Video'} “{draft.source.title}”
                {draft.source.channel && ` by ${draft.source.channel}`}. Check the game name. A name that matches the
                catalog fills in genre, year and composer automatically.
              </p>
            </div>
            <div className="row-actions">
              <button onClick={() => setDraft(null)}>Cancel</button>
              <button className="primary" disabled={busy} onClick={save}>
                Save {draft.groups.reduce((a, g) => a + g.tracks.filter((t) => t.include).length, 0)} tracks
                {queue.length > 0 && ` (${queue.length} more link${queue.length > 1 ? 's' : ''} queued)`}
              </button>
            </div>
          </header>

          {draft.groups.map((g, gi) => (
            <div key={g.key} className="draft-group">
              <div className="draft-game">
                <input list="catalog-titles" value={g.title} onChange={(e) => renameGroup(gi, e.target.value)} />
                <span className={g.catalogId ? 'badge ok' : 'badge'}>
                  {g.catalogId ? 'matched in catalog' : 'custom game'}
                </span>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={g.tracks.every((t) => t.include)}
                    onChange={(e) =>
                      updateGroup(gi, { tracks: g.tracks.map((t) => ({ ...t, include: e.target.checked })) })
                    }
                  />
                  all
                </label>
              </div>
              <table className="draft-tracks">
                <tbody>
                  {g.tracks.map((t, ti) => (
                    <tr key={t.key} className={t.include ? '' : 'excluded'}>
                      <td>
                        <input
                          type="checkbox"
                          checked={t.include}
                          onChange={(e) => {
                            const tracks = g.tracks.slice();
                            tracks[ti] = { ...t, include: e.target.checked };
                            updateGroup(gi, { tracks });
                          }}
                        />
                      </td>
                      <td className="grow">
                        <input
                          className="inline"
                          value={t.title}
                          title={t.rawTitle}
                          onChange={(e) => {
                            const tracks = g.tracks.slice();
                            tracks[ti] = { ...t, title: e.target.value };
                            updateGroup(gi, { tracks });
                          }}
                        />
                      </td>
                      <td className="types">
                        {t.types.map((ty) => (
                          <span key={ty} className="tag">
                            {TRACK_TYPES.find((x) => x.id === ty)?.label ?? ty}
                          </span>
                        ))}
                      </td>
                      <td className="muted tabular">{formatTime(t.duration)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
