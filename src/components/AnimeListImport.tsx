import { useMemo, useState } from 'react';
import { runBulk } from '../lib/bulk';
import { franchiseOf, isUpcoming, useCatalog } from '../lib/catalog';
import { scopeInfo, useAnimeScope } from '../lib/importers/anime';
import { buildIndex, search } from '../lib/search';
import type { CatalogGame } from '../types';
import { AnimeScopePicker } from './AnimeScopePicker';

const NOUN = { all: 'everything', songs: 'all songs', oped: 'OPs & EDs', op: 'openings' } as const;

interface Row {
  line: string;
  options: CatalogGame[]; // best matches, best first
  pick: string | null; // chosen id, null = skip this line
}

/**
 * "Add anime openings": paste a list of anime (one per line, e.g. everything you've watched),
 * check the matches, and import just their openings (or OPs & EDs, songs, everything).
 */
export function AnimeListImport() {
  const cat = useCatalog();
  const scope = scopeInfo(useAnimeScope());
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [allSeasons, setAllSeasons] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const anime = useMemo(() => (cat?.games ?? []).filter((g) => g.kind === 'anime'), [cat]);
  const index = useMemo(
    () => buildIndex(anime, (g) => ({ title: g.title, other: [...(g.altTitles ?? []), g.franchise], pop: g.pop })),
    [anime],
  );

  function match() {
    setMessage(null);
    const lines = [...new Set(text.split(/\r?\n|;/).map((l) => l.replace(/^\s*[-*•\d.)]+\s*/, '').trim()).filter(Boolean))];
    setRows(
      lines.map((line) => {
        const options = search(index, line).slice(0, 6);
        return { line, options, pick: options[0]?.id ?? null };
      }),
    );
  }

  // The chosen titles, plus their other seasons/films when "every season" is on.
  const chosen = useMemo(() => {
    if (!rows || !cat) return [];
    const picked = rows.map((r) => (r.pick ? cat.byId.get(r.pick) : undefined)).filter((g): g is CatalogGame => !!g);
    const out = new Map(picked.map((g) => [g.id, g]));
    if (allSeasons) {
      const franchises = new Set(picked.map((g) => franchiseOf(g)).filter(Boolean));
      for (const g of anime) if (franchises.has(franchiseOf(g))) out.set(g.id, g);
    }
    return [...out.values()].filter((g) => !isUpcoming(g) && (g.themes?.length || scope.ost));
  }, [rows, cat, allSeasons, anime, scope.ost]);

  function start() {
    runBulk(`${scope.label}: ${chosen.length} anime`, chosen, { topUp: true });
    setMessage(`Importing ${scope.hint.toLowerCase()} of ${chosen.length} anime in the background.`);
    setRows(null);
    setText('');
  }

  const setPick = (i: number, pick: string | null) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, pick } : r)));

  return (
    <section className="card">
      <h2>Add anime openings</h2>
      <p className="muted">
        Paste a list of anime, one per line (e.g. everything you've watched). You can import just the openings, the openings
        and endings, all songs, or everything including the soundtrack. Single songs can also be added from an anime's page.
      </p>
      <textarea
        rows={5}
        placeholder={'Frieren\nAttack on Titan\nYour Name\nOshi no Ko'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row-actions">
        <button disabled={!text.trim() || !cat} onClick={match}>
          {cat ? 'Find these anime' : 'Loading catalog…'}
        </button>
        <AnimeScopePicker label="Import" />
      </div>

      {rows && (
        <>
          <ul className="anime-matches">
            {rows.map((r, i) => (
              <li key={r.line}>
                <span className="muted truncate" title={r.line}>
                  {r.line}
                </span>
                {r.options.length ? (
                  <select value={r.pick ?? ''} onChange={(e) => setPick(i, e.target.value || null)}>
                    {r.options.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.title} {g.year ? `(${g.year})` : ''} · {g.themes?.length ?? 0} songs
                      </option>
                    ))}
                    <option value="">Skip</option>
                  </select>
                ) : (
                  <span className="err small">not in the anime catalog</span>
                )}
              </li>
            ))}
          </ul>
          <div className="row-actions">
            <label className="check small" title="Also every other season and film of the same series">
              <input type="checkbox" checked={allSeasons} onChange={(e) => setAllSeasons(e.target.checked)} /> Include every season
            </label>
            <button className="primary" disabled={!chosen.length} onClick={start}>
              Import {NOUN[scope.id]} from {chosen.length} anime
            </button>
          </div>
        </>
      )}
      {message && <div className="notice ok">{message}</div>}
    </section>
  );
}
