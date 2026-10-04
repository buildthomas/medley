// Keyless YouTube metadata access by reading the JSON YouTube embeds in its
// own pages (ytInitialData / ytInitialPlayerResponse). Runs server-side
// (Vite middleware) because browsers can't fetch youtube.com cross-origin.
//
// YouTube changes this markup now and then, so parsing is deliberately
// structural: walk the whole JSON tree looking for known renderer shapes
// (both the older *Renderer and newer lockupViewModel formats).

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  'Accept-Language': 'en-US,en;q=0.9',
  // Skip the EU cookie-consent interstitial.
  Cookie: 'SOCS=CAI; CONSENT=YES+1',
};

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
export interface PlaylistItem {
  videoId: string;
  title: string;
  duration: number | null;
  /** The uploader of this item: in album playlists that's "Performer - Topic", which tells songs from score. */
  channel?: string;
}
export interface PlaylistData {
  id: string;
  title: string;
  channel: string;
  items: PlaylistItem[];
}
export interface VideoData {
  id: string;
  title: string;
  channel: string;
  channelId?: string;
  duration: number | null;
  description: string;
}

type Json = any;

/** fetch with retries: YouTube occasionally resets connections or rate-limits bursts. */
async function fetchRetry(url: string, init: RequestInit = {}): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 400 * 2 ** attempt + Math.random() * 300));
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`YouTube responded ${res.status}`);
        continue;
      }
      return res;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetchRetry(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`YouTube responded ${res.status}`);
  return res.text();
}

function extractVar(html: string, name: string): Json {
  const marker = `var ${name} = `;
  let start = html.indexOf(marker);
  if (start < 0) {
    // Some pages assign it as window["ytInitialData"] = …
    const alt = html.indexOf(`${name}"] = `);
    if (alt < 0) throw new Error(`Could not find ${name} in page`);
    start = alt + `${name}"] = `.length;
  } else {
    start += marker.length;
  }
  // Scan to the matching closing brace, respecting strings.
  let depth = 0;
  let inStr = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  throw new Error(`Unterminated ${name}`);
}

function walk(node: Json, visit: (key: string, value: Json) => void) {
  if (!node || typeof node !== 'object') return;
  for (const k in node) {
    const v = node[k];
    visit(k, v);
    walk(v, visit);
  }
}

function text(t: Json): string {
  if (!t) return '';
  if (typeof t === 'string') return t;
  if (t.simpleText) return t.simpleText;
  if (t.content) return t.content;
  if (Array.isArray(t.runs)) return t.runs.map((r: Json) => r.text).join('');
  return '';
}

export function parseDuration(s: string | undefined | null): number | null {
  if (!s) return null;
  const parts = s.trim().split(':').map(Number);
  if (parts.some(isNaN)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function lockupBadges(lockup: Json): string[] {
  const out: string[] = [];
  walk(lockup.contentImage, (k, v) => {
    if (k === 'thumbnailBadgeViewModel' && v?.text) out.push(v.text);
  });
  return out;
}

function lockupChannel(lockup: Json): string {
  const rows = lockup.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows;
  return text(rows?.[0]?.metadataParts?.[0]?.text) || '';
}

function lockupChannelId(lockup: Json): string | undefined {
  const rows = lockup.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows;
  return rows?.[0]?.metadataParts?.[0]?.text?.commandRuns?.[0]?.onTap?.innertubeCommand?.browseEndpoint?.browseId;
}

const runsChannelId = (t: Json): string | undefined => t?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;

function lockupTitle(lockup: Json): string {
  return text(lockup.metadata?.lockupMetadataViewModel?.title);
}

const UNAVAILABLE = /^\[(deleted|private) video\]$/i;

function collectVideos(data: Json, into: Map<string, PlaylistItem>) {
  walk(data, (k, v) => {
    if (k === 'playlistVideoRenderer' && v?.videoId) {
      const title = text(v.title);
      if (!UNAVAILABLE.test(title))
        into.set(v.videoId, {
          videoId: v.videoId,
          title,
          duration: v.lengthSeconds ? Number(v.lengthSeconds) : null,
          channel: text(v.shortBylineText) || undefined,
        });
    } else if (k === 'lockupViewModel' && v?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && v.contentId) {
      const title = lockupTitle(v);
      const dur = lockupBadges(v).map(parseDuration).find((d) => d != null) ?? null;
      if (!UNAVAILABLE.test(title)) into.set(v.contentId, { videoId: v.contentId, title, duration: dur, channel: lockupChannel(v) || undefined });
    }
  });
}

function findContinuation(data: Json): string | null {
  let token: string | null = null;
  walk(data, (k, v) => {
    if (!token && k === 'continuationCommand' && v?.token) token = v.token;
  });
  return token;
}

export async function getPlaylist(id: string): Promise<PlaylistData> {
  const html = await fetchHtml(`https://www.youtube.com/playlist?list=${encodeURIComponent(id)}&hl=en`);
  const data = extractVar(html, 'ytInitialData');
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? '2.20260101.00.00';

  let title = '';
  let channel = '';
  walk(data, (k, v) => {
    if (!title && k === 'playlistMetadataRenderer') title = v.title ?? '';
    if (!title && k === 'pageHeaderViewModel') title = text(v.title?.dynamicTextViewModel?.text) || title;
    if (!channel && k === 'playlistHeaderRenderer') channel = text(v.ownerText);
    if (!channel && k === 'avatarStackViewModel') channel = text(v.text).replace(/^by\s+/i, '');
  });
  if (!channel) {
    const owner = html.match(/"ownerText":\{"runs":\[\{"text":"([^"]+)"/);
    channel = owner?.[1] ?? '';
  }

  const items = new Map<string, PlaylistItem>();
  collectVideos(data, items);

  // Pages hold ~100 videos; follow continuation tokens for the rest.
  let token = findContinuation(data);
  for (let page = 0; token && page < 30; page++) {
    const before = items.size;
    const res = await fetchRetry('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: 'US' } },
        continuation: token,
      }),
    });
    if (!res.ok) break;
    const more = await res.json();
    collectVideos(more, items);
    if (items.size === before) break;
    token = findContinuation(more);
  }

  if (!items.size) throw new Error('Playlist is empty, private, or could not be read');
  return { id, title, channel, items: [...items.values()] };
}

export async function getVideo(id: string): Promise<VideoData> {
  const html = await fetchHtml(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}&hl=en`);
  const player = extractVar(html, 'ytInitialPlayerResponse');
  const d = player.videoDetails;
  if (!d) throw new Error(player.playabilityStatus?.reason ?? 'Video unavailable');
  return {
    id,
    title: d.title ?? '',
    channel: d.author ?? '',
    channelId: d.channelId,
    duration: d.lengthSeconds ? Number(d.lengthSeconds) : null,
    description: d.shortDescription ?? '',
  };
}

// sp filters: playlists only / videos only.
const SEARCH_FILTER = { playlist: 'EgIQAw%3D%3D', video: 'EgIQAQ%3D%3D' } as const;

export async function search(query: string, type: 'playlist' | 'video'): Promise<(PlaylistHit | VideoHit)[]> {
  const html = await fetchHtml(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${SEARCH_FILTER[type]}&hl=en`,
  );
  const data = extractVar(html, 'ytInitialData');
  const out: (PlaylistHit | VideoHit)[] = [];
  const seen = new Set<string>();
  walk(data, (k, v) => {
    if (type === 'playlist') {
      if (k === 'lockupViewModel' && v?.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST' && !seen.has(v.contentId)) {
        seen.add(v.contentId);
        const count = lockupBadges(v)
          .map((b) => b.match(/([\d,]+)\s+video/i)?.[1])
          .find(Boolean);
        out.push({
          kind: 'playlist',
          id: v.contentId,
          title: lockupTitle(v),
          channel: lockupChannel(v),
          videoCount: count ? Number(count.replace(/,/g, '')) : null,
        });
      } else if (k === 'playlistRenderer' && v?.playlistId && !seen.has(v.playlistId)) {
        seen.add(v.playlistId);
        out.push({
          kind: 'playlist',
          id: v.playlistId,
          title: text(v.title),
          channel: text(v.shortBylineText),
          videoCount: v.videoCount ? Number(v.videoCount) : null,
        });
      }
    } else {
      if (k === 'videoRenderer' && v?.videoId && !seen.has(v.videoId)) {
        seen.add(v.videoId);
        out.push({
          kind: 'video',
          id: v.videoId,
          title: text(v.title),
          channel: text(v.ownerText) || text(v.longBylineText),
          channelId: runsChannelId(v.ownerText) ?? runsChannelId(v.longBylineText),
          duration: parseDuration(text(v.lengthText)),
        });
      } else if (k === 'lockupViewModel' && v?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && !seen.has(v.contentId)) {
        seen.add(v.contentId);
        out.push({
          kind: 'video',
          id: v.contentId,
          title: lockupTitle(v),
          channel: lockupChannel(v),
          channelId: lockupChannelId(v),
          duration: lockupBadges(v).map(parseDuration).find((d) => d != null) ?? null,
        });
      }
    }
  });
  return out;
}
