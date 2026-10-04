// Builds the game catalog and curated collections. Used by:
//   - scripts/build-catalog.mjs   (npm run catalog: writes the bundled src/data/*.json)
//   - the dev server's /api/refresh (monthly in-app refresh: writes data/*.json)
//
// Collections:
//   - Nintendo first-party (published by Nintendo / The Pokémon Company), per console
//   - Biggest games per year (2010 → now), by Wikipedia coverage
//   - Most popular indie games per year, by Steam reviews
//
// Sources: Wikidata (SPARQL) and SteamSpy's public "Indie" tag list. No API keys.

import { enrichGames } from './enrich.mjs';

const MIN_LINKS = 12; // base catalog: games with >= this many Wikipedia language editions
const PER_YEAR = 40; // "biggest games" per year
const INDIE_PER_YEAR = 15;
const FIRST_YEAR = 2010;

const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'vgm-shuffle/0.2 (personal hobby project; catalog build)';

const NINTENDO_PUBLISHERS = ['Q8093' /* Nintendo */, 'Q1036616' /* The Pokémon Company */];
// [id, name, Wikidata platform items, launch year]. Games first released before the
// launch year are Virtual Console / Switch Online re-releases and are left out.
const NINTENDO_CONSOLES = [
  ['nes', 'NES / Famicom', ['Q172742', 'Q135321'], 1983],
  ['snes', 'Super Nintendo', ['Q183259'], 1990],
  ['n64', 'Nintendo 64', ['Q184839'], 1996],
  ['gc', 'GameCube', ['Q182172'], 2001],
  ['wii', 'Wii', ['Q8079'], 2006],
  ['wiiu', 'Wii U', ['Q56942'], 2012],
  ['switch', 'Switch', ['Q19610114'], 2017],
  ['switch2', 'Switch 2', ['Q122761124'], 2025],
  ['gb', 'Game Boy', ['Q186437'], 1989],
  ['gbc', 'Game Boy Color', ['Q203992'], 1998],
  ['gba', 'Game Boy Advance', ['Q188642'], 2001],
  ['ds', 'Nintendo DS', ['Q170323', 'Q637178'], 2004],
  ['3ds', 'Nintendo 3DS', ['Q203597', 'Q17679679'], 2011],
];

async function sparql(query) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/sparql-results+json',
        'User-Agent': UA,
      },
      body: new URLSearchParams({ query }),
    });
    if (res.ok) return (await res.json()).results.bindings;
    console.warn(`  SPARQL ${res.status}, retrying…`);
    await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
  }
  throw new Error('SPARQL failed repeatedly');
}

const qid = (uri) => uri.split('/').pop();

// Wikidata genre labels are very granular; fold them into broad buckets.
const GENRE_BUCKETS = [
  ['Metroidvania', /metroidvania/],
  ['Roguelike', /rogue/],
  ['Soulslike', /soulslike/],
  ['JRPG', /japanese role/],
  ['RPG', /role-playing|rpg/],
  ['Platformer', /platform/],
  ['Shooter', /shooter|shoot 'em up|shoot-'em-up|bullet hell/],
  ['Fighting', /fighting|beat 'em up|hack and slash/],
  ['Racing', /racing|kart/],
  ['Sports', /sport|football|soccer|golf|basketball|tennis|skateboard|baseball|hockey/],
  ['Strategy', /strategy|tactic|4x|tower defense|real-time|turn-based/],
  ['Simulation', /simulat|management|life sim|city-building|farming|god game/],
  ['Puzzle', /puzzle|tile-matching/],
  ['Horror', /horror/],
  ['Adventure', /adventure|visual novel|point-and-click|interactive fiction/],
  ['Rhythm', /rhythm|music video game|dance/],
  ['Sandbox', /sandbox|survival|open world/],
  ['Stealth', /stealth/],
  ['MMO', /massively multiplayer|mmo/],
  ['Party', /party/],
  ['Action', /action/],
];

function bucketGenres(labels) {
  const out = new Set();
  for (const raw of labels) {
    const l = raw.toLowerCase();
    for (const [name, re] of GENRE_BUCKETS) if (re.test(l)) out.add(name);
  }
  return [...out];
}

// Many items carry their English name only as a language-neutral "mul" label.
const label = (item, out) => `
      OPTIONAL { ${item} rdfs:label ${out}En FILTER(LANG(${out}En) = "en") }
      OPTIONAL { ${item} rdfs:label ${out}Mul FILTER(LANG(${out}Mul) = "mul") }
      BIND(COALESCE(${out}En, ${out}Mul) AS ${out})`;

/**
 * @param {object} [opts]
 * @param {(msg: string) => void} [opts.log]
 * @param {boolean} [opts.enrich] add covers/tags/keywords/links (slow the first time: SteamSpy ~1 req/s)
 * @param {string} [opts.cacheFile] where to cache Steam keywords between builds
 */
export async function buildCatalog({ log = console.log, enrich = true, cacheFile } = {}) {
  const THIS_YEAR = new Date().getFullYear();
  const pop = new Map(); // qid -> sitelinks

  // 1. Base catalog --------------------------------------------------------------
  log(`Base catalog: games with >= ${MIN_LINKS} sitelinks…`);
  for (const r of await sparql(`
    SELECT ?game ?links WHERE {
      ?game wdt:P31 wd:Q7889 ; wikibase:sitelinks ?links .
      FILTER(?links >= ${MIN_LINKS})
    }`))
    pop.set(qid(r.game.value), Number(r.links.value));
  log(`  ${pop.size}`);

  // 2. Nintendo first-party per console ------------------------------------------
  log('Nintendo first-party…');
  const consoleOf = new Map(NINTENDO_CONSOLES.flatMap(([id, , qids]) => qids.map((q) => [q, id])));
  const nintendo = new Map(NINTENDO_CONSOLES.map(([id]) => [id, new Set()]));
  for (const r of await sparql(`
    SELECT DISTINCT ?game ?platform ?links WHERE {
      VALUES ?pub { ${NINTENDO_PUBLISHERS.map((q) => 'wd:' + q).join(' ')} }
      VALUES ?platform { ${[...consoleOf.keys()].map((q) => 'wd:' + q).join(' ')} }
      ?game wdt:P31 wd:Q7889 ; wdt:P123 ?pub ; wdt:P400 ?platform ; wikibase:sitelinks ?links .
      FILTER(?links >= 4)
    }`)) {
    const id = qid(r.game.value);
    nintendo.get(consoleOf.get(qid(r.platform.value))).add(id);
    pop.set(id, Number(r.links.value));
  }
  log(`  ${new Set([...nintendo.values()].flatMap((s) => [...s])).size} games`);

  // 3. Biggest games per year ----------------------------------------------------
  log(`Biggest games per year ${FIRST_YEAR}–${THIS_YEAR}…`);
  const firstYear = new Map();
  for (const r of await sparql(`
    SELECT ?game ?links (MIN(?date) AS ?first) WHERE {
      ?game wdt:P31 wd:Q7889 ; wikibase:sitelinks ?links ; wdt:P577 ?date .
      FILTER(?links >= 8)
    } GROUP BY ?game ?links`)) {
    const y = Number(r.first.value.slice(0, 4));
    if (y < FIRST_YEAR || y > THIS_YEAR) continue;
    firstYear.set(qid(r.game.value), { y, links: Number(r.links.value) });
  }
  const years = new Map();
  for (let y = FIRST_YEAR; y <= THIS_YEAR; y++) {
    const ids = [...firstYear]
      .filter(([, v]) => v.y === y)
      .sort((a, b) => b[1].links - a[1].links)
      .slice(0, PER_YEAR)
      .map(([id, v]) => {
        pop.set(id, v.links);
        return id;
      });
    years.set(y, ids);
  }

  // 4. Popular indie games per year (SteamSpy "Indie" tag → Wikidata via Steam app id) --
  log('Indie games (SteamSpy)…');
  const spy = Object.values(
    await (await fetch('https://steamspy.com/api.php?request=tag&tag=Indie', { headers: { 'User-Agent': UA } })).json(),
  )
    .filter((g) => g.positive >= 1500)
    .sort((a, b) => b.positive - a.positive);
  log(`  ${spy.length} indie apps with >= 1500 positive reviews`);
  const indieRows = [];
  for (let i = 0; i < spy.length; i += 300) {
    const batch = spy.slice(i, i + 300);
    const rows = await sparql(`
      SELECT ?game ?app ?links (MIN(?date) AS ?first) WHERE {
        VALUES ?app { ${batch.map((g) => `"${g.appid}"`).join(' ')} }
        ?game wdt:P1733 ?app ; wdt:P31 wd:Q7889 ; wikibase:sitelinks ?links ; wdt:P577 ?date .
      } GROUP BY ?game ?app ?links`);
    const positive = new Map(batch.map((g) => [String(g.appid), g.positive]));
    for (const r of rows)
      indieRows.push({
        id: qid(r.game.value),
        y: Number(r.first.value.slice(0, 4)),
        links: Number(r.links.value),
        positive: positive.get(r.app.value) ?? 0,
      });
  }
  const indie = new Map();
  for (let y = FIRST_YEAR; y <= THIS_YEAR; y++) {
    const seen = new Set();
    const ids = indieRows
      .filter((r) => r.y === y && !seen.has(r.id) && seen.add(r.id))
      .sort((a, b) => b.positive - a.positive)
      .slice(0, INDIE_PER_YEAR)
      .map((r) => {
        pop.set(r.id, Math.max(pop.get(r.id) ?? 0, r.links));
        return r.id;
      });
    indie.set(y, ids);
  }

  // 5. Details for everything ------------------------------------------------------
  const ids = [...pop.keys()];
  log(`Fetching details for ${ids.length} games…`);
  const games = new Map();
  const BATCH = 200;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const rows = await sparql(`
      SELECT ?game ?label ?date ?genreLabel ?seriesLabel ?composerLabel ?steam WHERE {
        VALUES ?game { ${batch.map((id) => 'wd:' + id).join(' ')} }
        ${label('?game', '?label')}
        OPTIONAL { ?game wdt:P577 ?date }
        OPTIONAL { ?game wdt:P1733 ?steam }
        OPTIONAL { ?game wdt:P136 ?g . ${label('?g', '?genreLabel')} }
        OPTIONAL { ?game wdt:P179 ?s . ${label('?s', '?seriesLabel')} }
        OPTIONAL { ?game wdt:P86 ?c . ${label('?c', '?composerLabel')} }
      }`);
    for (const r of rows) {
      if (!r.label) continue;
      const id = qid(r.game.value);
      let g = games.get(id);
      if (!g) {
        g = { id, title: r.label.value, year: null, genreLabels: new Set(), series: null, composers: new Set(), steam: null };
        games.set(id, g);
      }
      if (r.date) {
        const y = Number(r.date.value.slice(0, 4));
        if (y > 1950 && (!g.year || y < g.year)) g.year = y;
      }
      if (r.steam && !g.steam) g.steam = Number(r.steam.value) || null;
      if (r.genreLabel) g.genreLabels.add(r.genreLabel.value);
      if (r.seriesLabel && !g.series) g.series = r.seriesLabel.value;
      if (r.composerLabel) g.composers.add(r.composerLabel.value);
    }
  }

  const catalog = [...games.values()]
    .map((g) => ({
      id: g.id,
      title: g.title,
      year: g.year,
      genres: bucketGenres(g.genreLabels),
      series: g.series,
      composers: [...g.composers].slice(0, 4),
      pop: pop.get(g.id) ?? 0,
      ...(g.steam ? { steam: g.steam } : {}),
    }))
    .sort((a, b) => b.pop - a.pop);

  const known = (list) => list.filter((id) => games.has(id));
  const byPop = (list) => known(list).sort((a, b) => (pop.get(b) ?? 0) - (pop.get(a) ?? 0));

  // Covers, tags, keywords, store links (see enrich.mjs). Steam keywords are cached across builds.
  if (enrich) await enrichGames(catalog, { log, cacheFile });

  // "My games" is not part of the build: it's personal config (config/my-games.json),
  // served by the local server and merged in by the client (src/lib/catalog.ts).
  const collections = {
    generatedAt: new Date().toISOString(), // full timestamp: the client prefers the newest copy
    groups: [
      {
        id: 'nintendo',
        title: 'Nintendo first-party',
        description: 'Published by Nintendo or The Pokémon Company, including games made by partner studios.',
        lists: NINTENDO_CONSOLES.map(([id, title, , launch]) => ({
          id: `nin-${id}`,
          title,
          ids: byPop([...nintendo.get(id)].filter((g) => (games.get(g)?.year ?? launch) >= launch)),
        })),
      },
      {
        id: 'years',
        title: 'Biggest games by year',
        description: `The ${PER_YEAR} most widely covered games released each year (Wikipedia language editions).`,
        lists: [...years].reverse().map(([y, list]) => ({ id: `year-${y}`, title: String(y), ids: known(list) })),
      },
      {
        id: 'indie',
        title: 'Popular indie games by year',
        description: `The ${INDIE_PER_YEAR} indie games with the most positive Steam reviews from each year.`,
        lists: [...indie].reverse().map(([y, list]) => ({ id: `indie-${y}`, title: String(y), ids: known(list) })),
      },
    ],
  };
  return { catalog, collections };
}
