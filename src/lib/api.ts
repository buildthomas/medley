// Client for the local /api/* YouTube metadata endpoints (server/plugin.ts).

export interface PlaylistHit {
  kind: 'playlist';
  id: string;
  title: string;
  channel: string;
  videoCount: number | null;
}
export interface VideoHit {
  kind: 'video';
  id: string;
  title: string;
  channel: string;
  channelId?: string;
  duration: number | null;
}
export interface PlaylistData {
  id: string;
  title: string;
  channel: string;
  items: { videoId: string; title: string; duration: number | null; channel?: string }[];
}
export interface VideoData {
  id: string;
  title: string;
  channel: string;
  channelId?: string;
  duration: number | null;
  description: string;
}

/** Base URL of the local API: empty in the browser; set by scripts/import-headless.ts in Node. */
export function apiUrl(path: string) {
  return ((globalThis as { __MEDLEY_API_BASE__?: string }).__MEDLEY_API_BASE__ ?? '') + path;
}

async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path));
  } catch {
    throw new Error('Could not reach the local server. Is `npm run dev` running?');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const searchPlaylists = (q: string) =>
  get<PlaylistHit[]>(`/api/search?type=playlist&q=${encodeURIComponent(q)}`);
export const searchVideos = (q: string) => get<VideoHit[]>(`/api/search?type=video&q=${encodeURIComponent(q)}`);
export const fetchPlaylist = (id: string) => get<PlaylistData>(`/api/playlist?id=${encodeURIComponent(id)}`);
export const fetchVideo = (id: string) => get<VideoData>(`/api/video?id=${encodeURIComponent(id)}`);

export type ParsedLink = { kind: 'playlist' | 'video'; id: string };

/** Accepts playlist/video URLs in any common form, or bare IDs. */
export function parseYouTubeLink(input: string): ParsedLink | null {
  const s = input.trim();
  if (!s) return null;
  if (/^(PL|OLAK5uy_|UU|FL|RD|LL)[\w-]{10,}$/.test(s)) return { kind: 'playlist', id: s };
  if (/^[\w-]{11}$/.test(s)) return { kind: 'video', id: s };
  let url: URL;
  try {
    url = new URL(s.startsWith('http') ? s : `https://${s}`);
  } catch {
    return null;
  }
  const list = url.searchParams.get('list');
  // A watch URL inside a playlist → import the playlist (more useful).
  if (list && !list.startsWith('RD')) return { kind: 'playlist', id: list };
  const v = url.searchParams.get('v');
  if (v) return { kind: 'video', id: v };
  if (url.hostname.endsWith('youtu.be')) {
    const id = url.pathname.slice(1);
    if (id) return { kind: 'video', id };
  }
  const shorts = url.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/);
  if (shorts) return { kind: 'video', id: shorts[1] };
  return null;
}
