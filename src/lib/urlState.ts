// Playback state in the URL (?tab=…&track=…&t=…) so a refresh, restart or
// bookmark reopens the same song at the same spot. The up-next queue and back
// history live in localStorage (too long for a URL); both are conveniences,
// so everything works without them.

export interface UrlState {
  tab?: string;
  track?: string;
  t?: number;
}

export function readUrlState(): UrlState {
  const p = new URLSearchParams(window.location.search);
  const t = Number(p.get('t'));
  return {
    tab: p.get('tab') ?? undefined,
    track: p.get('track') ?? undefined,
    t: Number.isFinite(t) && t > 0 ? t : undefined,
  };
}

let pending: UrlState = {};
let timer: number | null = null;

/** Merge into the URL without adding history entries. Batched so frequent position updates are cheap. */
export function writeUrlState(patch: UrlState) {
  pending = { ...pending, ...patch };
  if (timer != null) return;
  timer = window.setTimeout(() => {
    timer = null;
    const p = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(pending)) {
      if (v === undefined || v === null || v === '' || (k === 't' && !v)) p.delete(k);
      else p.set(k, String(v));
    }
    pending = {};
    const qs = p.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`)
      window.history.replaceState(null, '', url);
  }, 300);
}

const QUEUE_KEY = 'medley:session';

export interface SavedSession {
  queue: string[];
  back: string[];
  /** An explicit play order (e.g. a whole soundtrack) that runs before shuffle resumes. */
  program?: Program | null;
}

export interface Program {
  label: string;
  ids: string[];
}

export function loadSavedSession(): SavedSession {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return {
        queue: Array.isArray(s.queue) ? s.queue : [],
        back: Array.isArray(s.back) ? s.back : [],
        program: s.program && Array.isArray(s.program.ids) ? s.program : null,
      };
    }
  } catch {
    /* storage unavailable */
  }
  return { queue: [], back: [] };
}

export function saveSession(s: SavedSession) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

const VOLUME_KEY = 'medley:volume';

export function loadVolume(): { volume: number; muted: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? 'null');
    if (v && typeof v.volume === 'number') return { volume: Math.max(0, Math.min(100, v.volume)), muted: !!v.muted };
  } catch {
    /* ignore */
  }
  return { volume: 70, muted: false };
}

export function saveVolume(v: { volume: number; muted: boolean }) {
  try {
    localStorage.setItem(VOLUME_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}
