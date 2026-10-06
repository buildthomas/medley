// Wikipedia infobox images (box art) for a list of article titles.
// Wikipedia rate-limits bursts, so requests are paced and retried with backoff;
// a silently skipped batch once cost us ~90% of covers.

import { userAgent } from './wd.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchBatch(titles, log) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    prop: 'pageimages',
    piprop: 'thumbnail',
    pithumbsize: '400',
    pilicense: 'any', // box art is non-free; without this nothing comes back
    redirects: '1',
    titles: titles.join('|'),
    maxlag: '5',
  });
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { headers: { 'User-Agent': userAgent() } });
      if (res.ok) {
        const body = await res.json();
        if (!body.error) return body.query ?? {};
      }
    } catch {
      /* network hiccup: retry */
    }
    const wait = 2000 * 2 ** attempt;
    log?.(`  Wikipedia busy, retrying in ${wait / 1000}s…`);
    await sleep(wait);
  }
  log?.(`  gave up on a batch of ${titles.length} titles`);
  return {};
}

/** Map of Wikipedia title → cover URL. */
export async function wikiCovers(titles, { log } = {}) {
  const out = new Map();
  const unique = [...new Set(titles)];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const q = await fetchBatch(batch, log);
    // Follow normalisation/redirects back to the title we asked for.
    const alias = new Map();
    for (const n of [...(q.normalized ?? []), ...(q.redirects ?? [])]) alias.set(n.to, n.from);
    for (const p of Object.values(q.pages ?? {})) {
      if (!p.thumbnail) continue;
      const url = p.thumbnail.source.replace(/\?.*$/, '');
      let t = p.title;
      out.set(t, url);
      while (alias.has(t)) out.set((t = alias.get(t)), url);
    }
    if ((i / 50) % 10 === 9) log?.(`  covers ${Math.min(i + 50, unique.length)}/${unique.length}`);
    await sleep(400);
  }
  return out;
}

/** The article title from a Wikipedia URL in a game's links. */
export function wikiTitleOf(game) {
  const url = game.links?.find((l) => l.label === 'Wikipedia')?.url;
  if (!url) return null;
  return decodeURIComponent(url.split('/wiki/')[1] ?? '').replace(/_/g, ' ') || null;
}
