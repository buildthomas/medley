import { useEffect, useRef, useState } from 'react';
import { db } from '../db';
import { primaryLink, useCatalog } from '../lib/catalog';
import { useMediaSession } from '../lib/mediaSession';
import { pipSupported, usePopOut } from './PopOutPlayer';
import { TRACK_TYPES } from '../lib/parse';
import { Cover } from './discover/Cover';
import { GameDetail } from './discover/GameDetail';
import { requestDiscover } from '../lib/intents';
import type { Session } from '../useSession';
import { loadVolume, saveVolume, writeUrlState } from '../lib/urlState';
import { YouTubePlayer, type PlayerHandle } from './YouTubePlayer';
import { Empty, formatTime } from './ui';

const TYPE_LABEL = new Map(TRACK_TYPES.map((t) => [t.id, t.label]));

export function ListenView({
  session,
  compact,
  goTo,
}: {
  session: Session;
  compact: boolean;
  goTo(tab: 'listen' | 'discover' | 'add'): void;
}) {
  const { current, currentGame, queue, gameMap, trackMap, recentPlays } = session;
  const player = useRef<PlayerHandle>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState<{ t: number; len: number | null }>({ t: 0, len: null });
  const [notice, setNotice] = useState<string | null>(null);
  const cat = useCatalog();
  const catGame = currentGame ? cat?.byId.get(currentGame.id) : undefined;
  // Clicking the title (or cover) of what's playing opens its page right here.
  const [showWork, setShowWork] = useState(false);
  const work = catGame ?? (currentGame ? { ...currentGame, franchise: currentGame.franchise ?? undefined, pop: 0 } : undefined);

  // Lets the header logo dance along (see .logo-mark in styles.css).
  useEffect(() => {
    document.documentElement.toggleAttribute('data-playing', playing);
  }, [playing]);
  const link = primaryLink(catGame);

  const [volume, setVolume] = useState(loadVolume);
  const changeVolume = (v: { volume: number; muted: boolean }) => {
    setVolume(v);
    saveVolume(v);
  };

  // Keep the position in the URL (every couple of seconds) so a refresh resumes here.
  const lastWritten = useRef(-1);
  const onProgress = (t: number, len: number | null) => {
    setProgress({ t, len });
    if (!current || session.resumeAt != null) return;
    const sec = Math.floor(t);
    if (Math.abs(sec - lastWritten.current) >= 2) {
      lastWritten.current = sec;
      writeUrlState({ track: current.id, t: sec });
    }
  };

  const skip = () => session.next({ skipped: true, elapsed: player.current?.elapsed() ?? 0 });

  // Headset / keyboard media keys and the OS now-playing panel.
  useMediaSession(
    {
      title: current?.title ?? null,
      game: currentGame?.title ?? null,
      composers: currentGame?.composers ?? [],
      cover: catGame?.covers?.[0] ?? null,
      playing,
    },
    {
      play: () => (current ? player.current?.play() : session.next()),
      pause: () => player.current?.pause(),
      next: skip,
      previous: session.prev,
    },
  );

  // Always-on-top mini window (Chrome/Edge).
  const popOut = usePopOut(
    {
      title: current?.title ?? null,
      work: currentGame?.title ?? null,
      artist: current?.artist ?? null,
      cover: catGame?.covers?.[0] ?? null,
      playing,
      liked: !!current?.liked,
      elapsed: progress.t,
      length: progress.len,
    },
    {
      toggle: () => (current ? player.current?.toggle() : session.next()),
      next: skip,
      prev: session.prev,
      like: () => current && db.tracks.update(current.id, { liked: !current.liked }),
    },
  );

  // Keyboard: space = play/pause, → / N = skip, ← / P = previous, L = like, B = ban.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === ' ') {
        if (el?.closest('button, a')) return; // let space activate the focused control
        e.preventDefault();
        player.current?.toggle();
      } else if (k === 'arrowright' || k === 'n') skip();
      else if (k === 'arrowleft' || k === 'p') session.prev();
      else if (k === 'l' && current) db.tracks.update(current.id, { liked: !current.liked });
      else if (k === 'b' && current) ban();
      else if (k === 'm') changeVolume({ ...volume, muted: !volume.muted });
      else if ((k === 'arrowup' || k === 'arrowdown') && !compact) {
        e.preventDefault();
        const step = k === 'arrowup' ? 5 : -5;
        changeVolume({ volume: Math.max(0, Math.min(100, volume.volume + step)), muted: false });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function ban() {
    if (!current) return;
    await db.tracks.update(current.id, { banned: true });
    session.next();
  }

  async function onError(code: number) {
    if (!current) return;
    // 100: removed/private, 101/150: owner disabled embedding, 2: bad id.
    if ([2, 100, 101, 150].includes(code)) {
      await db.tracks.update(current.id, { unavailable: true });
      setNotice(`“${current.title}” can't be played here (it was removed or can't be embedded), so it was skipped.`);
      window.setTimeout(() => setNotice(null), 6000);
    }
    session.next();
  }

  if (!session.tracks.length) {
    if (compact) return null;
    return (
      <Empty>
        <h2>Your library is empty</h2>
        <p>Pick games from the catalog and Medley will find their music on YouTube.</p>
        <div className="row-actions center">
          <button className="primary" onClick={() => goTo('discover')}>
            Browse games
          </button>
          <button onClick={() => goTo('add')}>Paste a playlist link</button>
        </div>
      </Empty>
    );
  }

  const recent = recentPlays
    .slice(current && recentPlays[0]?.trackId === current.id ? 1 : 0)
    .slice(0, 8)
    .map((p) => ({ p, t: trackMap.get(p.trackId) }))
    .filter((x) => x.t);

  return (
    <div className="listen">
      <div className="stage">
        <div className="video-frame">
          <YouTubePlayer
            ref={player}
            track={current}
            onEnded={() => session.next()}
            onError={onError}
            onPlayingChange={(p) => {
              setPlaying(p);
              if (p && session.resumeAt != null) session.clearResume();
            }}
            onProgress={onProgress}
            resumeAt={session.resumeAt}
            cueOnly={session.resumeAt != null}
            volume={volume.volume}
            muted={volume.muted}
            onVolumeChange={(v, m) => changeVolume({ volume: v, muted: m })}
          />
          {!current && (
            <button className="start-overlay" onClick={() => session.next()}>
              <span className="play-glyph">▶</span>
              Start shuffle
            </button>
          )}
          {current && session.resumeAt != null && !playing && (
            <button className="start-overlay resume" onClick={() => player.current?.play()}>
              <span className="play-glyph">▶</span>
              Resume “{current.title}”
              {session.resumeAt > 0 && <small>from {formatTime(session.resumeAt)}</small>}
            </button>
          )}
        </div>

        {notice && <div className="notice">{notice}</div>}

        <div className="now">
          <div className="now-row">
            {currentGame && (
              <button className="now-cover-btn" onClick={() => setShowWork(true)} title={`Open ${currentGame.title}`}>
                <Cover
                  game={{ title: currentGame.title, year: currentGame.year, covers: catGame?.covers }}
                  className="now-cover"
                />
              </button>
            )}
            <div className="now-text">
            <div className="now-game">
              {currentGame ? (
                <button className="now-work" onClick={() => setShowWork(true)} title={`Open ${currentGame.title}`}>
                  {currentGame.title}
                </button>
              ) : (
                'Nothing playing'
              )}
              {currentGame?.year && <span className="muted"> · {currentGame.year}</span>}
            </div>
            <div className="now-title">{current?.title ?? 'Press start, or hit N'}</div>
            <div className="now-meta">
              {current?.types.map((t) => (
                <span key={t} className="tag">
                  {TYPE_LABEL.get(t) ?? t}
                </span>
              ))}
              {currentGame?.composers.length ? (
                <span className="muted">♪ {currentGame.composers.slice(0, 2).join(', ')}</span>
              ) : null}
              {link && (
                <a
                  className="store-link small"
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  title={`${currentGame?.title} on ${link.label}`}
                >
                  {link.label === 'Wikipedia' ? 'About the game' : `Get it on ${link.label}`} ↗
                </a>
              )}
            </div>
            </div>
          </div>
          <div className="progress">
            <div
              className="bar seekable"
              title="Click to jump"
              onClick={(e) => {
                if (!progress.len) return;
                const r = e.currentTarget.getBoundingClientRect();
                player.current?.seek(((e.clientX - r.left) / r.width) * progress.len);
              }}
            >
              <div style={{ width: progress.len ? `${Math.min(100, (100 * progress.t) / progress.len)}%` : 0 }} />
            </div>
            <span className="muted tabular">
              {formatTime(progress.t)} / {formatTime(progress.len)}
            </span>
          </div>
        </div>

        <div className="controls">
          <button onClick={session.prev} disabled={!session.canGoBack} title="Previous (←)">
            ⏮
          </button>
          <button className="primary round" onClick={() => (current ? player.current?.toggle() : session.next())} title="Play/pause (space)">
            {playing ? '❚❚' : '▶'}
          </button>
          <button onClick={skip} title="Skip (→)">
            ⏭
          </button>
          <div className="volume">
            <button
              className="icon"
              onClick={() => changeVolume({ ...volume, muted: !volume.muted })}
              title={volume.muted ? 'Unmute (M)' : 'Mute (M)'}
            >
              {volume.muted || volume.volume === 0 ? '🔇' : volume.volume < 40 ? '🔈' : '🔊'}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={volume.muted ? 0 : volume.volume}
              aria-label="Volume"
              title={`Volume ${volume.muted ? 0 : volume.volume}% (↑/↓)`}
              onChange={(e) => changeVolume({ volume: Number(e.target.value), muted: false })}
              onWheel={(e) =>
                changeVolume({ volume: Math.max(0, Math.min(100, volume.volume - Math.sign(e.deltaY) * 5)), muted: false })
              }
              style={{ '--fill': `${volume.muted ? 0 : volume.volume}%` } as React.CSSProperties}
            />
          </div>
          <span className="spacer" />
          <button
            className={current?.liked ? 'liked' : ''}
            disabled={!current}
            onClick={() => current && db.tracks.update(current.id, { liked: !current.liked })}
            title="Like (L): plays more often as Familiarity goes up"
          >
            {current?.liked ? '♥' : '♡'} Like
          </button>
          <button disabled={!current} onClick={ban} title="Never play this track again (B)">
            ⊘ Never
          </button>
          {compact && (
            <button className="expand" onClick={() => goTo('listen')} title="Open the player">
              ⤢
            </button>
          )}
          {pipSupported() && (
            <button
              className={`expand ${popOut.open ? 'liked' : ''}`}
              onClick={popOut.popOut}
              title={popOut.open ? 'Close the floating mini player' : 'Pop out a floating, always-on-top mini player'}
            >
              ⧉
            </button>
          )}
          <button
            className="hide-compact"
            disabled={!currentGame}
            onClick={async () => {
              if (!currentGame) return;
              await db.games.update(currentGame.id, { enabled: false });
              session.next();
            }}
            title="Take this game out of rotation (re-enable it under Games)"
          >
            Pause game
          </button>
        </div>
      </div>

      <div className="side-lists">
        {session.program && (
          <div className="list-card program-card">
            <header>
              <h3>
                Playing: {session.program.label}{' '}
                <span className="muted">· {session.program.tracks.length} left</span>
              </h3>
              <button className="link" onClick={session.stopProgram} title="Back to the shuffle after this track">
                back to shuffle
              </button>
            </header>
            <ol className="tracklist">
              {session.program.tracks.slice(0, 8).map((t) => (
                <li key={t.id} onClick={() => session.playNow(t.id)} title="Play now">
                  <span className="truncate">{t.title}</span>
                  <span className="muted truncate">{gameMap.get(t.gameId)?.title}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        <div className="list-card">
          <header>
            <h3>{session.program ? 'Then the shuffle' : 'Up next'}</h3>
            <button className="link" onClick={session.reroll}>
              reshuffle
            </button>
          </header>
          <ol className="tracklist">
            {queue.map((t) => (
              <li key={t.id} onClick={() => session.playNow(t.id)} title="Play now">
                <span className="truncate">{t.title}</span>
                <span className="muted truncate">{gameMap.get(t.gameId)?.title}</span>
              </li>
            ))}
            {!queue.length && <li className="muted">Nothing matches the current filters.</li>}
          </ol>
        </div>
        {recent.length > 0 && (
          <div className="list-card">
            <header>
              <h3>Recently played</h3>
            </header>
            <ol className="tracklist">
              {recent.map(({ p, t }) => (
                <li key={p.id} onClick={() => session.playNow(t!.id)} title="Play again">
                  <span className="truncate">
                    {p.skipped && <span className="muted">skipped · </span>}
                    {t!.title}
                  </span>
                  <span className="muted truncate">{gameMap.get(t!.gameId)?.title}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        <p className="hint keys">
          <kbd>Space</kbd> play/pause · <kbd>N</kbd> skip · <kbd>P</kbd> back · <kbd>L</kbd> like · <kbd>B</kbd> never · <kbd>↑</kbd><kbd>↓</kbd> volume · <kbd>M</kbd> mute
        </p>
      </div>
      {showWork && work && (
        <GameDetail
          game={work}
          session={session}
          onClose={() => setShowWork(false)}
          onFacet={(kind, value) => {
            // Tags (composer, genre, studio…) browse everything with that tag in Discover.
            setShowWork(false);
            requestDiscover(value, [], { kind, value });
            goTo('discover');
          }}
        />
      )}
    </div>
  );
}
