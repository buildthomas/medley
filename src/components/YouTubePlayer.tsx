import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import type { Track } from '../types';

let apiReady: Promise<void> | null = null;

function loadIframeApi(): Promise<void> {
  apiReady ??= new Promise((resolve) => {
    if (window.YT?.Player) return resolve();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
  return apiReady;
}

export interface PlayerHandle {
  toggle(): void;
  play(): void;
  elapsed(): number;
  /** Jump to a position, in seconds from the start of the track. */
  seek(elapsed: number): void;
}

interface Props {
  track: Track | null;
  ref?: Ref<PlayerHandle>;
  onEnded(): void;
  /** YouTube error codes: 2 bad id, 5 html5, 100 removed, 101/150 embedding disabled. */
  onError(code: number): void;
  onPlayingChange(playing: boolean): void;
  onProgress(elapsed: number, length: number | null): void;
  /** Resume position for the first load of this track (seconds into the track). */
  resumeAt?: number | null;
  /** Load without playing (after a page refresh, browsers block sound until you click). */
  cueOnly?: boolean;
  volume: number;
  muted: boolean;
  /** The volume was changed inside the YouTube player itself. */
  onVolumeChange(volume: number, muted: boolean): void;
}

export function YouTubePlayer({ track, ref, resumeAt, cueOnly, volume, muted, ...handlers }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const readyRef = useRef(false);
  const trackRef = useRef(track);
  const endedFor = useRef<string | null>(null);
  const cb = useRef(handlers);
  cb.current = handlers;
  trackRef.current = track;
  const resumeRef = useRef(resumeAt);
  resumeRef.current = resumeAt;
  const cueRef = useRef(cueOnly);
  cueRef.current = cueOnly;
  const volumeRef = useRef({ volume, muted });
  volumeRef.current = { volume, muted };
  // What we last told the player, to notice changes made with YouTube's own slider.
  const appliedVolume = useRef<{ volume: number; muted: boolean } | null>(null);

  useImperativeHandle(ref, () => ({
    toggle() {
      const p = playerRef.current;
      if (!p || !readyRef.current) return;
      if (p.getPlayerState() === YT.PlayerState.PLAYING) p.pauseVideo();
      else p.playVideo();
    },
    play() {
      if (playerRef.current && readyRef.current) playerRef.current.playVideo();
    },
    seek(elapsed: number) {
      const p = playerRef.current;
      const t = trackRef.current;
      if (!p || !readyRef.current || !t) return;
      p.seekTo((t.start ?? 0) + Math.max(0, elapsed), true);
    },
    elapsed() {
      const p = playerRef.current;
      const t = trackRef.current;
      if (!p || !readyRef.current || !t) return 0;
      return Math.max(0, p.getCurrentTime() - (t.start ?? 0));
    },
  }));

  function load(t: Track | null) {
    const p = playerRef.current;
    if (!p || !readyRef.current || !t) return;
    endedFor.current = null;
    const args = { videoId: t.videoId, startSeconds: (t.start ?? 0) + (resumeRef.current ?? 0), endSeconds: t.end };
    if (cueRef.current) p.cueVideoById(args);
    else p.loadVideoById(args);
  }

  function applyVolume() {
    const p = playerRef.current;
    if (!p || !readyRef.current) return;
    const v = volumeRef.current;
    p.setVolume(v.volume);
    if (v.muted) p.mute();
    else p.unMute();
    appliedVolume.current = v;
  }

  function finish() {
    const t = trackRef.current;
    if (!t || endedFor.current === t.id) return;
    endedFor.current = t.id;
    cb.current.onEnded();
  }

  useEffect(() => {
    let cancelled = false;
    loadIframeApi().then(() => {
      if (cancelled || !hostRef.current) return;
      const el = document.createElement('div');
      hostRef.current.appendChild(el);
      playerRef.current = new YT.Player(el, {
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            readyRef.current = true;
            // Handy for poking at the player from the console while developing.
            if (import.meta.env.DEV) (window as { __ytPlayer?: YT.Player }).__ytPlayer = playerRef.current ?? undefined;
            applyVolume();
            load(trackRef.current);
          },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.ENDED) finish();
            cb.current.onPlayingChange(e.data === YT.PlayerState.PLAYING);
          },
          onError: (e) => cb.current.onError(e.data as number),
        },
      });
    });

    // Slices of long videos: endSeconds doesn't always fire ENDED, so watch the clock.
    const timer = window.setInterval(() => {
      const p = playerRef.current;
      const t = trackRef.current;
      if (!p || !readyRef.current || !t || typeof p.getCurrentTime !== 'function') return;
      const now = p.getCurrentTime();
      const start = t.start ?? 0;
      const end = t.end ?? (p.getDuration() || null);
      cb.current.onProgress(Math.max(0, now - start), end ? end - start : null);
      if (t.end && now >= t.end - 0.4 && p.getPlayerState() !== YT.PlayerState.BUFFERING) finish();
      const applied = appliedVolume.current;
      if (applied && typeof p.getVolume === 'function') {
        const v = { volume: p.getVolume(), muted: p.isMuted() };
        if (v.volume !== applied.volume || v.muted !== applied.muted) {
          appliedVolume.current = v;
          cb.current.onVolumeChange(v.volume, v.muted);
        }
      }
    }, 500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      playerRef.current?.destroy();
      playerRef.current = null;
      readyRef.current = false;
    };
  }, []);

  useEffect(() => {
    const a = appliedVolume.current;
    if (!a || a.volume !== volume || a.muted !== muted) applyVolume();
  }, [volume, muted]);

  useEffect(() => {
    load(track);
    // Reload only when the actual playable thing changes, not on stat updates.
  }, [track?.id]);

  return <div className="yt-host" ref={hostRef} />;
}
