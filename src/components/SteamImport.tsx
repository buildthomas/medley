import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { runBulk } from '../lib/bulk';
import { fetchOwnedGames, parseSteamLibrary, resolveSteamLibrary, type ResolvedSteamGame, type SteamEntry } from '../lib/steam';

const XML_URL = 'https://steamcommunity.com/my/games/?tab=all&xml=1';

export function SteamImport() {
  const [text, setText] = useState('');
  const [profile, setProfile] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ResolvedSteamGame[] | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const libraryIds = useLiveQuery(async () => new Set(await db.games.toCollection().primaryKeys()), [], new Set<string>());

  async function resolve(entries: SteamEntry[]) {
    if (!entries.length) {
      setError("Couldn't find any games in that. Paste the XML page, or one game name per line.");
      return;
    }
    setRows(await resolveSteamLibrary(entries));
    setSkip(new Set());
  }

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

  const toImport = (rows ?? []).filter((r) => !skip.has(r.game.id) && !libraryIds.has(r.game.id));
  const counts = rows && {
    matched: rows.filter((r) => r.via !== 'name').length,
    byName: rows.filter((r) => r.via === 'name').length,
    have: rows.filter((r) => libraryIds.has(r.game.id)).length,
  };

  return (
    <section className="card">
      <h2>Import your Steam library</h2>
      {!rows && (
        <>
          <ol className="steps muted">
            <li>
              While logged into Steam in your browser, open{' '}
              <a href={XML_URL} target="_blank" rel="noreferrer">
                steamcommunity.com/my/games/?tab=all&amp;xml=1
              </a>
              .
            </li>
            <li>
              Select all, copy, and paste it below, or save the page (Ctrl+S) and choose the file. A plain list of game
              names (one per line) works too.
            </li>
          </ol>
          <textarea
            rows={4}
            placeholder="<gamesList> … or one game per line"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row-actions">
            <button className="primary" disabled={busy || !text.trim()} onClick={() => run(() => resolve(parseSteamLibrary(text)))}>
              {busy ? 'Reading…' : 'Read library'}
            </button>
            <button disabled={busy} onClick={() => fileRef.current?.click()}>
              Choose saved file…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xml,.txt,.json,.html,text/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) run(async () => resolve(parseSteamLibrary(await f.text())));
                e.target.value = '';
              }}
            />
          </div>
          <details className="small muted">
            <summary>Or load it with a Steam Web API key</summary>
            <p>
              Put <code>STEAM_API_KEY=…</code> (from steamcommunity.com/dev/apikey) in <code>.env.local</code> in the
              project folder and restart the dev server. Your profile's game details must be public.
            </p>
            <div className="toolbar">
              <input
                className="search grow"
                placeholder="Profile URL, custom name or SteamID64"
                value={profile}
                onChange={(e) => setProfile(e.target.value)}
              />
              <button disabled={busy || !profile.trim()} onClick={() => run(async () => resolve(await fetchOwnedGames(profile)))}>
                Load
              </button>
            </div>
          </details>
        </>
      )}

      {error && <div className="notice err">{error}</div>}

      {rows && counts && (
        <>
          <p>
            Found <b>{rows.length}</b> games: {counts.matched} identified via Wikidata, {counts.byName} by name only
            {counts.have > 0 && `, ${counts.have} already in your library`}. Tools, demos, servers and soundtrack DLC
            were left out. Untick anything you don't want.
          </p>
          <ul className="steam-list">
            {rows.map((r) => {
              const have = libraryIds.has(r.game.id);
              return (
                <li key={r.game.id} className={have ? 'muted' : ''}>
                  <label>
                    <input
                      type="checkbox"
                      disabled={have}
                      checked={have || !skip.has(r.game.id)}
                      onChange={(e) => {
                        const next = new Set(skip);
                        if (e.target.checked) next.delete(r.game.id);
                        else next.add(r.game.id);
                        setSkip(next);
                      }}
                    />
                    <span className="truncate">
                      {r.game.title} {r.game.year && <span className="muted">{r.game.year}</span>}
                    </span>
                    <span className="muted small">
                      {have ? 'in library' : r.entry.hours ? `${Math.round(r.entry.hours)} h` : ''}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="row-actions">
            <button
              className="primary"
              disabled={!toImport.length}
              onClick={() => runBulk('Steam library', toImport.map((r) => r.game))}
            >
              Import soundtracks for {toImport.length} games
            </button>
            <button onClick={() => setRows(null)}>Start over</button>
            <span className="muted small">Runs in the background; progress shows at the top.</span>
          </div>
        </>
      )}
    </section>
  );
}
