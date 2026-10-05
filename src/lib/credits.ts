// Where a cover image comes from, for the credit line on a title's page. Free Commons photos
// carry photographer + license (catalog `coverCredit`, fetched at build time); other images get
// their source (Steam, AniList, the Wikipedia file page) worked out from the URL.

import type { CatalogGame } from '../types';

export interface Credit {
  /** "Photo: Samuel Wiki · CC BY-SA 2.5" */
  text: string;
  href?: string;
  licenseHref?: string;
}

/** "…/wikipedia/en/thumb/a/ab/Name.jpg/250px-Name.jpg" → { wiki: 'en', file: 'Name.jpg' } */
function wikimediaFile(url: URL) {
  const parts = url.pathname.split('/').filter(Boolean); // wikipedia, en|commons, [thumb], a, ab, Name.jpg, …
  if (parts[0] !== 'wikipedia' || parts.length < 4) return null;
  const thumb = parts[2] === 'thumb';
  const file = parts[thumb ? 5 : 4];
  return file ? { wiki: parts[1], file: decodeURIComponent(file) } : null;
}

export function coverCredit(work: Pick<CatalogGame, 'covers' | 'coverCredit'>): Credit | null {
  const cover = work.covers?.[0];
  if (!cover) return null;
  if (work.coverCredit) {
    const c = work.coverCredit;
    return {
      text: ['Photo', c.author && `: ${c.author}`, c.license && ` · ${c.license}`].filter(Boolean).join(''),
      href: c.source,
      licenseHref: c.licenseUrl,
    };
  }
  let url: URL;
  try {
    url = new URL(cover);
  } catch {
    return null;
  }
  const host = url.hostname;
  if (/steamstatic|steampowered/.test(host)) return { text: 'Cover art via Steam' };
  if (host.endsWith('anilist.co')) return { text: 'Cover art via AniList' };
  if (/rbxcdn|roblox/.test(host)) return { text: 'Icon via Roblox' };
  if (host.endsWith('wikimedia.org')) {
    const f = wikimediaFile(url);
    if (!f) return { text: 'Image via Wikimedia' };
    const commons = f.wiki === 'commons';
    return {
      text: commons ? 'Image via Wikimedia Commons' : 'Cover art via Wikipedia',
      href: `https://${commons ? 'commons.wikimedia.org' : `${f.wiki}.wikipedia.org`}/wiki/File:${encodeURIComponent(f.file)}`,
    };
  }
  return { text: `Image via ${host.replace(/^www\./, '')}` };
}
