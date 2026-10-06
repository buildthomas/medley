// Enriches catalog entries with everything the Discover page shows:
//   tags      platforms, game modes, full genre list, themes/setting, developer, publisher (Wikidata)
//   franchise media franchise (Wikidata), falling back to series
//   keywords  Steam user tags (SteamSpy), cached on disk because SteamSpy allows ~1 request/second
//   covers    portrait cover candidates, best first: Steam library art, Wikipedia infobox image
//   links     where to get the game: Steam, GOG, Epic, Nintendo eShop, PlayStation Store, itch.io, Wikipedia
// No API keys needed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { wikiCovers } from './wiki-covers.mjs';
import { sparql as wdSparql, userAgent } from './wd.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retries network errors and responses cut off mid-stream (see gotchas).
const sparql = (query) => wdSparql(query, { log: console.warn });

const TAG_PROPS = {
  P400: 'platform',
  P404: 'mode',
  P136: 'genre',
  P921: 'theme',
  P840: 'theme',
  P178: 'developer',
  P123: 'publisher',
  P8345: 'franchise',
};

const LINK_PROPS = {
  P1733: ['Steam', (v) => `https://store.steampowered.com/app/${v}/`],
  P2725: ['GOG', (v) => `https://www.gog.com/${v}`],
  P6278: ['Epic Games', (v) => `https://store.epicgames.com/p/${v}`],
  P8084: ['Nintendo eShop', (v) => `https://www.nintendo.com/us/store/products/${v}/`],
  P5944: ['PlayStation Store', (v) => `https://store.playstation.com/en-us/product/${v}`],
  P7294: ['itch.io', (v) => v],
};

const LINK_ORDER = ['Roblox', 'Steam', 'GOG', 'Epic Games', 'Nintendo eShop', 'PlayStation Store', 'itch.io', 'Wikipedia'];
export const linkRank = (label) => (LINK_ORDER.includes(label) ? LINK_ORDER.indexOf(label) : LINK_ORDER.length - 1);

// Shorter, familiar platform names.
const PLATFORM_NAMES = {
  'Microsoft Windows': 'PC',
  'Xbox Series X and Series S': 'Xbox Series X|S',
  'Super Nintendo Entertainment System': 'SNES',
  'Nintendo Entertainment System': 'NES',
  'Family Computer': 'NES',
  'Nintendo GameCube': 'GameCube',
  'PlayStation': 'PlayStation',
  'Sega Mega Drive': 'Mega Drive / Genesis',
  'Sega Genesis': 'Mega Drive / Genesis',
  'Classic Mac OS': 'Mac',
  macOS: 'Mac',
  'Android': 'Android',
  'iOS': 'iOS',
  'Linux': 'Linux',
};
const SKIP_PLATFORMS = /^(arcade video game|cloud gaming|web browser|virtual reality|Xbox Cloud Gaming|GeForce Now|Amazon Luna|Super NES Classic Edition|NES Classic Edition|PlayStation Classic|iPadOS|tvOS|Windows Phone|Ouya|N-Gage.*)$/i;

const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export async function enrichGames(games, { log = console.log, cacheFile } = {}) {
  const byId = new Map(games.map((g) => [g.id, g]));
  const ids = games.filter((g) => /^Q\d+$/.test(g.id)).map((g) => g.id);
  for (const g of games) {
    g.tags ??= {};
    g.links ??= [];
    g.covers ??= [];
  }

  // 1. Tags + franchise ---------------------------------------------------------------
  log(`Tags for ${ids.length} games…`);
  const propValues = Object.keys(TAG_PROPS).map((p) => `(wdt:${p} "${p}")`).join(' ');
  for (let i = 0; i < ids.length; i += 150) {
    const batch = ids.slice(i, i + 150);
    const rows = await sparql(`
      SELECT ?game ?prop ?valLabel WHERE {
        VALUES ?game { ${batch.map((id) => 'wd:' + id).join(' ')} }
        VALUES (?wdt ?prop) { ${propValues} }
        ?game ?wdt ?val .
        OPTIONAL { ?val rdfs:label ?en FILTER(LANG(?en) = "en") }
        OPTIONAL { ?val rdfs:label ?mul FILTER(LANG(?mul) = "mul") }
        BIND(COALESCE(?en, ?mul) AS ?valLabel)
        FILTER(BOUND(?valLabel))
      }`);
    for (const r of rows) {
      const g = byId.get(r.game.value.split('/').pop());
      const kind = TAG_PROPS[r.prop.value];
      let v = r.valLabel.value;
      if (kind === 'franchise') {
        g.franchise ??= v.replace(/\s*\((media )?franchise\)$/i, '');
        continue;
      }
      if (kind === 'platform') {
        if (SKIP_PLATFORMS.test(v)) continue;
        v = PLATFORM_NAMES[v] ?? v;
      }
      if (kind === 'genre' && /^video game (with|featuring|about|based)/i.test(v)) continue;
      if (kind === 'genre' || kind === 'theme' || kind === 'mode') v = titleCase(v.replace(/ video game$/i, ''));
      const list = (g.tags[kind] ??= []);
      if (!list.includes(v)) list.push(v);
    }
  }

  // 2. Store links + English Wikipedia article ------------------------------------------
  log('Store links…');
  const linkValues = Object.keys(LINK_PROPS).map((p) => `(wdt:${p} "${p}")`).join(' ');
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const rows = await sparql(`
      SELECT ?game ?prop ?val ?wiki WHERE {
        VALUES ?game { ${batch.map((id) => 'wd:' + id).join(' ')} }
        {
          VALUES (?wdt ?prop) { ${linkValues} }
          ?game ?wdt ?val .
        } UNION {
          ?article schema:about ?game ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?wiki .
        }
      }`);
    for (const r of rows) {
      const g = byId.get(r.game.value.split('/').pop());
      if (r.wiki) {
        g.wiki = r.wiki.value;
        continue;
      }
      const [label, url] = LINK_PROPS[r.prop.value];
      if (!g.links.some((l) => l.label === label)) g.links.push({ label, url: url(r.val.value) });
    }
  }
  for (const g of games) {
    if (g.wiki && !g.links.some((l) => l.label === 'Wikipedia'))
      g.links.push({ label: 'Wikipedia', url: `https://en.wikipedia.org/wiki/${encodeURIComponent(g.wiki.replace(/ /g, '_'))}` });
  }

  // 3. Covers: Steam portrait art first, Wikipedia infobox image as fallback -----------------
  log('Covers…');
  const thumbByTitle = await wikiCovers(
    games.filter((g) => g.wiki).map((g) => g.wiki),
    { log },
  );
  for (const g of games) if (g.wiki && thumbByTitle.has(g.wiki)) g.wikiCover = thumbByTitle.get(g.wiki);
  for (const g of games) {
    const covers = [];
    if (g.steam) covers.push(`https://cdn.cloudflare.steamstatic.com/steam/apps/${g.steam}/library_600x900.jpg`);
    if (g.wikiCover) covers.push(g.wikiCover);
    for (const c of g.covers) if (!covers.includes(c)) covers.push(c);
    g.covers = covers;
    delete g.wikiCover;
  }

  // 3b. Roblox games: game icon as cover, game page as link (icon URLs expire, so re-fetched each build).
  const roblox = games.filter((g) => g.roblox?.universeId);
  if (roblox.length) {
    const res = await fetch(
      `https://thumbnails.roblox.com/v1/games/icons?universeIds=${roblox.map((g) => g.roblox.universeId).join(',')}&size=512x512&format=Png&isCircular=false`,
    ).catch(() => null);
    const icons = new Map(((await res?.json().catch(() => null))?.data ?? []).map((d) => [d.targetId, d.imageUrl]));
    for (const g of roblox) {
      const icon = icons.get(g.roblox.universeId);
      if (icon) g.covers = [icon, ...g.covers.filter((c) => !c.includes('rbxcdn.com'))];
      if (!g.links.some((l) => l.label === 'Roblox'))
        g.links.unshift({ label: 'Roblox', url: `https://www.roblox.com/games/${g.roblox.placeId}` });
    }
  }

  // 4. Keywords: Steam user tags via SteamSpy (cached; ~1 request/second) -----------------------
  const cache = cacheFile && existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
  const steamGames = games.filter((g) => g.steam);
  const missing = steamGames.filter((g) => !(g.steam in cache));
  log(`Steam tags: ${steamGames.length - missing.length} cached, ${missing.length} to fetch (~${Math.ceil(missing.length / 60)} min)…`);
  let n = 0;
  for (const g of missing) {
    try {
      const res = await fetch(`https://steamspy.com/api.php?request=appdetails&appid=${g.steam}`, { headers: { 'User-Agent': userAgent() } });
      const data = res.ok ? await res.json() : null;
      const tags = data?.tags && !Array.isArray(data.tags) ? data.tags : {};
      cache[g.steam] = Object.entries(tags)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([t]) => t);
    } catch {
      /* leave uncached; retried next build */
    }
    if (++n % 100 === 0 && cacheFile) {
      mkdirSync(dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(cache));
      log(`  ${n}/${missing.length}`);
    }
    await sleep(1050);
  }
  if (cacheFile) {
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(cache));
  }
  for (const g of steamGames) if (cache[g.steam]?.length) g.keywords = cache[g.steam];

  // Most useful link first: the player and Library show only the first one.
  for (const g of games) g.links.sort((a, b) => linkRank(a.label) - linkRank(b.label));

  // Drop empty containers to keep the JSON small.
  for (const g of games) {
    for (const k of Object.keys(g.tags)) if (!g.tags[k].length) delete g.tags[k];
    if (!Object.keys(g.tags).length) delete g.tags;
    if (!g.links.length) delete g.links;
    if (!g.covers.length) delete g.covers;
    delete g.wiki;
  }
  return games;
}
