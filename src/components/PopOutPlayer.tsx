// "Pop out": a small always-on-top window with the current track and controls, using the
// Document Picture-in-Picture API (Chrome/Edge 116+). Audio keeps playing from the YouTube
// player in the main tab; this window only shows info and sends commands back.
//
// React events don't cross documents through a portal, so the window gets its own React root
// that we re-render whenever the playback state changes.

import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HeartIcon, LoopIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, ShuffleIcon } from './icons';
import { formatTime } from './ui';

interface PipWindowApi {
  requestWindow(opts: { width: number; height: number }): Promise<Window>;
  window: Window | null;
}
declare global {
  interface Window {
    documentPictureInPicture?: PipWindowApi;
  }
}

// Desktop only: on phones and tablets the OS's lock-screen / notification media controls (fed by
// lib/mediaSession.ts) are the native equivalent.
export const pipSupported = () =>
  typeof window !== 'undefined' && 'documentPictureInPicture' in window && !matchMedia('(pointer: coarse)').matches;

export interface PopOutState {
  title: string | null;
  work: string | null;
  artist?: string | null;
  cover: string | null;
  playing: boolean;
  liked: boolean;
  elapsed: number;
  length: number | null;
  /** While playing a soundtrack or other set (not the radio): "x/y" and its modes. */
  program: { label: string; position: string; shuffle: boolean; loop: boolean } | null;
}

export interface PopOutActions {
  toggle(): void;
  next(): void;
  prev(): void;
  like(): void;
  shuffle(): void;
  loop(): void;
}

function MiniPlayer({ state, actions }: { state: PopOutState; actions: PopOutActions }) {
  const pct = state.length ? Math.min(100, (100 * state.elapsed) / state.length) : 0;
  return (
    <div className="pip">
      {state.cover ? <img className="pip-cover" src={state.cover} alt="" referrerPolicy="no-referrer" /> : <div className="pip-cover" />}
      <div className="pip-body">
        <div className="pip-work">{state.work ?? 'Nothing playing'}</div>
        <div className="pip-title">{state.title ?? 'Press play in the main window'}</div>
        {state.artist && <div className="pip-artist">{state.artist}</div>}
        <div className="pip-progress">
          <div className="pip-bar">
            <div style={{ width: `${pct}%` }} />
          </div>
          <span className="pip-time">
            {formatTime(state.elapsed)} / {formatTime(state.length)}
          </span>
        </div>
        <div className="pip-controls">
          <button onClick={actions.prev} title="Previous" aria-label="Previous">
            <PrevIcon size={15} />
          </button>
          <button className="pip-play" onClick={actions.toggle} title="Play/pause" aria-label={state.playing ? 'Pause' : 'Play'}>
            {state.playing ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
          </button>
          <button onClick={actions.next} title="Next" aria-label="Next">
            <NextIcon size={15} />
          </button>
          <button className={state.liked ? 'liked' : ''} onClick={actions.like} title="Like" aria-label="Like">
            <HeartIcon size={14} filled={state.liked} />
          </button>
          {state.program && (
            <>
              <button
                className={state.program.shuffle ? 'liked' : ''}
                aria-pressed={state.program.shuffle}
                onClick={actions.shuffle}
                title={state.program.shuffle ? `Shuffling ${state.program.label}` : `Shuffle ${state.program.label}`}
              >
                <ShuffleIcon size={15} />
              </button>
              <button
                className={state.program.loop ? 'liked' : ''}
                aria-pressed={state.program.loop}
                onClick={actions.loop}
                title={state.program.loop ? `Looping ${state.program.label}` : `Loop ${state.program.label}`}
              >
                <LoopIcon size={15} />
              </button>
              <span className="pip-pos" title={`Track ${state.program.position} in ${state.program.label}`}>
                {state.program.position}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const WIDTH = 360;
const HEIGHT = 132;

/**
 * Browsers always let people resize a Picture-in-Picture window (there's no option to turn it
 * off). We snap it back to its size where the browser allows that, and otherwise the card keeps
 * its fixed size, centred (styles.css .pip).
 */
function keepSize(win: Window) {
  let timer = 0;
  win.addEventListener('resize', () => {
    win.clearTimeout(timer);
    timer = win.setTimeout(() => {
      if (win.innerWidth === WIDTH && win.innerHeight === HEIGHT) return;
      try {
        win.resizeTo(WIDTH + (win.outerWidth - win.innerWidth), HEIGHT + (win.outerHeight - win.innerHeight));
      } catch {
        /* not allowed without a user gesture in some browsers */
      }
    }, 150);
  });
}

/** Copies the app's stylesheets (and theme) into the pop-out window. */
function copyStyles(target: Document) {
  for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) target.head.appendChild(node.cloneNode(true));
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme) target.documentElement.setAttribute('data-theme', theme);
}

export function usePopOut(state: PopOutState, actions: PopOutActions) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<Root | null>(null);
  const winRef = useRef<Window | null>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const stable: PopOutActions = {
    toggle: () => actionsRef.current.toggle(),
    next: () => actionsRef.current.next(),
    prev: () => actionsRef.current.prev(),
    like: () => actionsRef.current.like(),
    shuffle: () => actionsRef.current.shuffle(),
    loop: () => actionsRef.current.loop(),
  };

  async function popOut() {
    if (!window.documentPictureInPicture) return;
    if (winRef.current) {
      winRef.current.close();
      return;
    }
    let win: Window;
    try {
      win = await window.documentPictureInPicture.requestWindow({ width: WIDTH, height: HEIGHT });
    } catch (e) {
      // e.g. embedded browsers that can't open windows; nothing to do but not crash.
      console.warn('Pop-out window not available here:', e);
      return;
    }
    copyStyles(win.document);
    win.document.title = 'Now playing';
    win.document.body.className = 'pip-body-root';
    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    rootRef.current = createRoot(container);
    winRef.current = win;
    setOpen(true);
    keepSize(win);
    win.addEventListener('pagehide', () => {
      rootRef.current?.unmount();
      rootRef.current = null;
      winRef.current = null;
      setOpen(false);
    });
  }

  useEffect(() => {
    rootRef.current?.render(<MiniPlayer state={state} actions={stable} />);
  });

  useEffect(() => () => winRef.current?.close(), []);

  return { open, popOut };
}
