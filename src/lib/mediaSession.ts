// Hardware media keys (headset / keyboard next, previous, play/pause) and the OS
// "now playing" panel.
//
// The sound comes from YouTube's cross-origin iframe, so by default the browser routes
// media keys to *that* frame, and the embedded player ignores next/previous. Chrome
// routes media keys to the top-level page instead when the page itself is playing
// media, so we loop a silent <audio> element while music plays and register
// navigator.mediaSession handlers here.

import { useEffect, useRef } from 'react';

let silent: HTMLAudioElement | null = null;

/** A 1-second silent WAV, generated once (no asset file needed). */
function silentAudio(): HTMLAudioElement {
  if (silent) return silent;
  const rate = 8000;
  const samples = rate;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples * 2, true);
  silent = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
  silent.loop = true;
  return silent;
}

export interface MediaSessionInfo {
  title: string | null;
  game: string | null;
  composers: string[];
  cover: string | null;
  playing: boolean;
}

export interface MediaSessionActions {
  play(): void;
  pause(): void;
  next(): void;
  previous(): void;
}

export function useMediaSession(info: MediaSessionInfo, actions: MediaSessionActions) {
  const act = useRef(actions);
  act.current = actions;
  const supported = typeof navigator !== 'undefined' && 'mediaSession' in navigator;

  // Handlers are registered once; they call whatever the latest actions are.
  useEffect(() => {
    if (!supported) return;
    const set = (a: MediaSessionAction, fn: (() => void) | null) => {
      try {
        navigator.mediaSession.setActionHandler(a, fn);
      } catch {
        /* action not supported by this browser */
      }
    };
    set('play', () => act.current.play());
    set('pause', () => act.current.pause());
    set('nexttrack', () => act.current.next());
    set('previoustrack', () => act.current.previous());
    return () => {
      for (const a of ['play', 'pause', 'nexttrack', 'previoustrack'] as MediaSessionAction[]) set(a, null);
    };
  }, [supported]);

  // Keep the silent element's state in step with the real player.
  useEffect(() => {
    const audio = silentAudio();
    if (info.playing) {
      // Allowed after any click on the page; if it's refused, media keys just fall back to YouTube's frame.
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
    if (supported) navigator.mediaSession.playbackState = info.title ? (info.playing ? 'playing' : 'paused') : 'none';
  }, [info.playing, info.title, supported]);

  useEffect(() => {
    if (!supported || !info.title) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: info.title,
      artist: info.game ?? '',
      album: info.composers.join(', '),
      artwork: info.cover ? [{ src: info.cover, sizes: '600x900' }] : [],
    });
  }, [supported, info.title, info.game, info.cover, info.composers.join('|')]);
}
