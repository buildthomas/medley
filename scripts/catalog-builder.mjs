// Builds the game catalog and curated collections. Used by:
//   - scripts/build-catalog.mjs   (npm run catalog: writes the bundled src/data/*.json)
//   - the server's weekly refresh (server/api.ts: writes the data dir, see scripts/paths.mjs)
//
// Collections:
//   - Nintendo first-party (published by Nintendo / The Pokémon Company), per console
//   - Biggest games per year (2010 → now), by Wikipedia coverage
//   - Most popular indie games per year, by Steam reviews
//
// Sources: Wikidata (SPARQL) and SteamSpy's public "Indie" tag list. No API keys.

import { enrichGames } from './enrich.mjs';
import { inBatches, sparql as wdSparql, userAgent, values } from './wd.mjs';

const MIN_LINKS = 12; // base catalog: games with >= this many Wikipedia language editions
const PER_YEAR = 40; // "biggest games" per year
const INDIE_PER_YEAR = 15;
const FIRST_YEAR = 2010;


// What counts as a game. Plain "video game" (Q7889) misses whole families of notable titles:
// paired releases (Fire Emblem Fates, Zelda: Oracle of Seasons/Ages, NieR), compilations,
// remasters/reboots, expansions with their own soundtracks, and Roblox experiences.
const GAME_CLASSES = ['Q7889', 'Q116809654', 'Q16070115', 'Q65963104', 'Q111223304', 'Q209163', 'Q113574332'];
const CANCELLED = 'Q61475894';
/** SPARQL snippet binding ?game to anything of a game class (and not cancelled). */
const isGame = (v = '?game') =>
  `VALUES ?gcls { ${GAME_CLASSES.map((q) => 'wd:' + q).join(' ')} } ${v} wdt:P31 ?gcls .
   FILTER NOT EXISTS { ${v} wdt:P31 wd:${CANCELLED} }`;

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

// Retries network errors and responses cut off mid-stream (see gotchas).
const sparql = (query) => wdSparql(query, { log: console.warn });

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
/**
 * @param {object} [opts]
 * @param {{ id: string, pop?: number }[]} [opts.keep] the previous catalog: every game in it stays
 *   (unless Wikidata deleted it), so a rebuild never drops a game someone already has in their
 *   library just because it slipped under a cut-off (Mixtape, 9 sitelinks, fell off a year list).
 */
export async function buildCatalog({ log = console.log, enrich = true, cacheFile, keep = [] } = {}) {
  const THIS_YEAR = new Date().getFullYear();
  const pop = new Map(); // qid -> sitelinks

  // 1. Base catalog --------------------------------------------------------------
  log(`Base catalog: games with >= ${MIN_LINKS} sitelinks…`);
  for (const r of await sparql(`
    SELECT ?game ?links WHERE {
      ${isGame()}
      ?game wikibase:sitelinks ?links .
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
      ${isGame()}
      ?game wdt:P123 ?pub ; wdt:P400 ?platform ; wikibase:sitelinks ?links .
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
      ${isGame()}
      ?game wikibase:sitelinks ?links ; wdt:P577 ?date .
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
    await (await fetch('https://steamspy.com/api.php?request=tag&tag=Indie', { headers: { 'User-Agent': userAgent() } })).json(),
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
        ${isGame()}
        ?game wdt:P1733 ?app ; wikibase:sitelinks ?links ; wdt:P577 ?date .
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

  // 4b. Steam favourites: every indie game with >= 1500 positive reviews, not only each year's
  // top 15. Well-loved indie games often have few Wikipedia editions (Shantae sequels: 10).
  for (const r of indieRows) pop.set(r.id, Math.max(pop.get(r.id) ?? 0, r.links));
  log(`  ${new Set(indieRows.map((r) => r.id)).size} indie games kept`);

  // 4c. Everything from the previous catalog stays (see `keep`).
  let kept = 0;
  for (const g of keep) {
    if (!/^Q\d+$/.test(g.id) || pop.has(g.id)) continue;
    pop.set(g.id, g.pop ?? 0);
    kept++;
  }
  if (kept) log(`  ${kept} games kept from the previous catalog`);

  // 5. Details for everything ------------------------------------------------------
  const games = new Map();
  const seriesIds = new Set(); // every series (P179) a catalog game belongs to
  const details = async (ids) => {
  const BATCH = 200;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const rows = await sparql(`
      SELECT ?game ?label ?date ?prec ?genreLabel ?s ?seriesLabel ?composerLabel ?steam WHERE {
        VALUES ?game { ${batch.map((id) => 'wd:' + id).join(' ')} }
        ${label('?game', '?label')}
        # Every release that isn't deprecated: a delayed game keeps its old targets, deprecated
        # (GTA VI's "2025"), and taking the earliest of those made it look released.
        OPTIONAL {
          ?game p:P577 ?rel .
          ?rel psv:P577 [ wikibase:timeValue ?date ; wikibase:timePrecision ?prec ] ; wikibase:rank ?rank .
          FILTER(?rank != wikibase:DeprecatedRank)
        }
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
        g = { id, title: r.label.value, year: null, first: null, genreLabels: new Set(), series: null, composers: new Set(), steam: null };
        games.set(id, g);
      }
      if (r.date) {
        const y = Number(r.date.value.slice(0, 4));
        if (y > 1950 && (!g.year || y < g.year)) g.year = y;
        // Earliest release, with its precision: 11 = day, 10 = month, 9 = year.
        if (y > 1950 && (!g.first || r.date.value < g.first.value)) g.first = { value: r.date.value, prec: Number(r.prec?.value ?? 9) };
      }
      if (r.steam && !g.steam) g.steam = Number(r.steam.value) || null;
      if (r.genreLabel) g.genreLabels.add(r.genreLabel.value);
      if (r.seriesLabel && !g.series) g.series = r.seriesLabel.value;
      if (r.s) seriesIds.add(qid(r.s.value));
      if (r.composerLabel) g.composers.add(r.composerLabel.value);
    }
  }
  };
  log(`Fetching details for ${pop.size} games…`);
  await details([...pop.keys()]);

  // 5b. Series completion: once one game of a series is in, its other games are too (down to 3
  // Wikipedia editions), so a series isn't missing its lesser-covered entries (the Shantae
  // sequels have 10). Series come from the details above: asking Wikidata for "the series of
  // these games" directly makes it scan every series there is (a 400 MB answer).
  log(`Completing ${seriesIds.size} series…`);
  const added = [];
  await inBatches(
    [...seriesIds],
    40,
    (batch) => `
      SELECT ?game ?links WHERE {
        VALUES ?series { ${values(batch)} }
        ?game wdt:P179 ?series .
        ${isGame()}
        ?game wikibase:sitelinks ?links .
        FILTER(?links >= 3)
      }`,
    (r) => {
      const id = qid(r.game.value);
      if (pop.has(id)) return;
      pop.set(id, Number(r.links.value));
      added.push(id);
    },
    { log: console.warn, label: 'series' },
  );
  log(`  ${added.length} more games`);
  await details(added);

  // English aliases ("FF7R", "Pirate's Curse"): searched and matched like the title.
  const aliases = new Map();
  await inBatches(
    [...games.keys()],
    300,
    (batch) => `SELECT ?game ?alias WHERE { VALUES ?game { ${values(batch)} } ?game skos:altLabel ?alias . FILTER(LANG(?alias) = "en") }`,
    (r) => {
      const id = qid(r.game.value);
      const a = r.alias.value.trim();
      if (a.length < 2 || a.length > 80) return;
      const list = aliases.get(id) ?? [];
      if (list.length < 6 && !list.includes(a)) aliases.set(id, [...list, a]);
    },
    { log: console.warn },
  );

  const catalog = [...games.values()]
    .map((g) => ({
      id: g.id,
      title: g.title,
      ...(aliases.get(g.id)?.length ? { altTitles: aliases.get(g.id).filter((a) => a !== g.title) } : {}),
      year: g.year,
      ...(g.first && g.first.prec >= 10 ? { date: g.first.value.slice(0, g.first.prec >= 11 ? 10 : 7) } : {}),
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

  // "My games" is not part of the build: it's personal config (my-games.json in the config dir),
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
