// "Pop out": a small always-on-top window with the current track and controls, using the
// Document Picture-in-Picture API (Chrome/Edge 116+). Audio keeps playing from the YouTube
// player in the main tab; this window only shows info and sends commands back.
//
// React events don't cross documents through a portal, so the window gets its own React root
// that we re-render whenever the playback state changes.

import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
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

export const pipSupported = () => typeof window !== 'undefined' && 'documentPictureInPicture' in window;

export interface PopOutState {
  title: string | null;
  work: string | null;
  artist?: string | null;
  cover: string | null;
  playing: boolean;
  liked: boolean;
  elapsed: number;
  length: number | null;
}

export interface PopOutActions {
  toggle(): void;
  next(): void;
  prev(): void;
  like(): void;
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
        <div className="pip-bar">
          <div style={{ width: `${pct}%` }} />
        </div>
        <div className="pip-controls">
          <button onClick={actions.prev} title="Previous">⏮</button>
          <button className="pip-play" onClick={actions.toggle} title="Play/pause">
            {state.playing ? '❚❚' : '▶'}
          </button>
          <button onClick={actions.next} title="Next">⏭</button>
          <button className={state.liked ? 'liked' : ''} onClick={actions.like} title="Like">
            {state.liked ? '♥' : '♡'}
          </button>
          <span className="pip-time">
            {formatTime(state.elapsed)} / {formatTime(state.length)}
          </span>
        </div>
      </div>
    </div>
  );
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
  };

  async function popOut() {
    if (!window.documentPictureInPicture) return;
    if (winRef.current) {
      winRef.current.close();
      return;
    }
    const win = await window.documentPictureInPicture.requestWindow({ width: 360, height: 132 });
    copyStyles(win.document);
    win.document.title = 'Now playing';
    win.document.body.className = 'pip-body-root';
    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    rootRef.current = createRoot(container);
    winRef.current = win;
    setOpen(true);
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
