// The web app's side of the desktop companion (companion/, relay in server/remote.ts).
//
// When enabled, the player publishes "now playing" (on changes, plus a position re-sync every
// 15 s while a companion is watching) and listens for commands. The channel key is random and
// stays in this browser; the connection code shown in Add link is `<site URL>#<key>`.

import { useEffect, useRef, useSyncExternalStore } from 'react';

const KEY = 'vgm-shuffle:remote';

interface RemoteSettings {
  enabled: boolean;
  key: string;
}

export interface RemoteState {
  title: string | null;
  work: string | null;
  kind: string | null;
  artist: string | null;
  cover: string | null;
  playing: boolean;
  liked: boolean;
  /** Seconds into the track at `at` (ms timestamp); the companion extrapolates from there. */
  position: number;
  at: number;
  length: number | null;
  next: string | null;
}

export interface RemoteActions {
  toggle(): void;
  next(): void;
  prev(): void;
  like(): void;
}

const newKey = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

let settings: RemoteSettings = { enabled: false, key: '' };
try {
  settings = { ...settings, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
} catch {
  /* storage unavailable */
}
let companions = 0; // how many companions were watching at the last publish
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function save(next: RemoteSettings) {
  settings = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
  emit();
}

export function setRemoteEnabled(enabled: boolean) {
  save({ enabled, key: settings.key || newKey() });
}

/** New code; companions using the old one are disconnected. */
export function resetRemoteKey() {
  save({ ...settings, key: newKey() });
}

export const connectionCode = (key: string) => `${location.origin}#${key}`;

let snapshot = { ...settings, companions };
export function useRemoteSettings() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => {
      if (snapshot.enabled !== settings.enabled || snapshot.key !== settings.key || snapshot.companions !== companions)
        snapshot = { ...settings, companions };
      return snapshot;
    },
  );
}

/** Publish playback state to companions and obey their commands (ListenView). */
export function useRemote(state: RemoteState, actions: RemoteActions) {
  const { enabled, key } = useRemoteSettings();
  const stateRef = useRef(state);
  stateRef.current = state;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // Commands from companions.
  useEffect(() => {
    if (!enabled || !key) return;
    const source = new EventSource(`/api/remote/events?role=app&key=${encodeURIComponent(key)}`);
    source.addEventListener('command', (e) => {
      const { cmd } = JSON.parse((e as MessageEvent).data) as { cmd: string };
      const a = actionsRef.current;
      if (cmd === 'hello') void publish(key, stateRef.current);
      else if (cmd === 'toggle') a.toggle();
      else if (cmd === 'play' && !stateRef.current.playing) a.toggle();
      else if (cmd === 'pause' && stateRef.current.playing) a.toggle();
      else if (cmd === 'next') a.next();
      else if (cmd === 'prev') a.prev();
      else if (cmd === 'like') a.like();
    });
    return () => source.close();
  }, [enabled, key]);

  // State: whenever something visible changes (not on every progress tick).
  const signature = [state.title, state.work, state.playing, state.liked, state.length, state.next, state.cover].join('|');
  useEffect(() => {
    if (!enabled || !key) return;
    const t = setTimeout(() => void publish(key, stateRef.current), 250);
    return () => clearTimeout(t);
  }, [enabled, key, signature]);

  // Position drift correction while playing (only if someone's watching).
  useEffect(() => {
    if (!enabled || !key || !state.playing) return;
    const t = setInterval(() => companions > 0 && void publish(key, stateRef.current), 15_000);
    return () => clearInterval(t);
  }, [enabled, key, state.playing]);
}

async function publish(key: string, state: RemoteState) {
  try {
    const res = await fetch(`/api/remote/state?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...state, at: Date.now() }),
    });
    const n = res.ok ? ((await res.json()) as { companions: number }).companions : 0;
    if (n !== companions) {
      companions = n;
      emit();
    }
  } catch {
    /* server unreachable; next change retries */
  }
}
