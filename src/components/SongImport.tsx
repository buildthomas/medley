import { useState } from 'react';
import { parseYouTubeLink, searchVideos, type VideoHit } from '../lib/api';
import { addSong, parseSongVideo, type ParsedSong } from '../lib/importers/artist';
import { formatTime } from './ui';

/** Add one song: from a YouTube link, or by searching. It's filed under its artist. */
export function SongImport() {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [hits, setHits] = useState<VideoHit[] | null>(null);
  const [song, setSong] = useState<ParsedSong | null>(null);

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

  const find = () =>
    run(async () => {
      setMessage(null);
      setSong(null);
      const link = parseYouTubeLink(input);
      if (link?.kind === 'video') {
        setHits(null);
        setSong(await parseSongVideo(link.id));
      } else {
        setHits((await searchVideos(input)).filter((h) => (h.duration ?? 0) >= 60 && (h.duration ?? 0) <= 900).slice(0, 10));
      }
    });

  const save = () =>
    run(async () => {
      if (!song) return;
      const r = await addSong(song);
      setMessage(r.added ? `Added “${song.song}” to ${r.artist.title}.` : `“${song.song}” was already in your library.`);
      setSong(null);
      setHits(null);
      setInput('');
    });

  return (
    <section className="card">
      <h2>Add a song</h2>
      <p className="muted">
        Paste a YouTube link to a song, or search for one. It's filed under its artist, who gets added to your library if
        needed.
      </p>
      <div className="toolbar">
        <input
          className="search grow"
          placeholder="https://youtu.be/…  or  “Yoasobi Idol”"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && input.trim() && find()}
        />
        <button disabled={busy || !input.trim()} onClick={find}>
          {busy ? 'Looking…' : 'Find'}
        </button>
      </div>

      {hits && !song && (
        <ul className="candidates">
          {hits.map((h) => (
            <li key={h.id}>
              <a href={`https://www.youtube.com/watch?v=${h.id}`} target="_blank" rel="noreferrer">
                {h.title}
              </a>
              <span className="muted small">
                {h.channel} · {formatTime(h.duration)}
              </span>
              <button className="small-btn" disabled={busy} onClick={() => run(async () => setSong(await parseSongVideo(h.id)))}>
                Pick
              </button>
            </li>
          ))}
          {!hits.length && <li className="muted">No songs found.</li>}
        </ul>
      )}

      {song && (
        <div className="song-preview">
          <label>
            Song
            <input value={song.song} onChange={(e) => setSong({ ...song, song: e.target.value })} />
          </label>
          <label>
            Artist
            <input value={song.artist} onChange={(e) => setSong({ ...song, artist: e.target.value })} />
          </label>
          <label>
            Featuring
            <input
              value={song.featuring.join(', ')}
              placeholder="optional"
              onChange={(e) => setSong({ ...song, featuring: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            />
          </label>
          <div className="row-actions">
            <button className="primary" disabled={busy || !song.song.trim() || !song.artist.trim()} onClick={save}>
              Add to {song.artist || 'artist'}
            </button>
            <button onClick={() => setSong(null)}>Cancel</button>
            <span className="muted small">{formatTime(song.duration)}</span>
          </div>
        </div>
      )}
      {error && <div className="notice err">{error}</div>}
      {message && <div className="notice ok">{message}</div>}
    </section>
  );
}
