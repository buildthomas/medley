// Films and TV series with notable soundtracks, from Wikidata.
//
// Which works: films/series with enough Wikipedia coverage (sitelinks) that have a credited
// composer, plus every film from the big animation/musical studios (Disney, Pixar, DreamWorks,
// Sony Animation, Illumination) and musicals. Japanese animated films are left to the anime
// builder (AniList) so they aren't listed twice.

import { bucket, datePart, inBatches, label, qid, sparql, values } from './wd.mjs';
import { wikiCovers } from './wiki-covers.mjs';

const FILM_CLASSES = ['Q11424', 'Q202866', 'Q29168811']; // film, animated film, animated feature film
const SHORTS = ['Q24862', 'Q17517379']; // short film, animated short film
const SERIES_CLASSES = ['Q5398426', 'Q581714', 'Q1259759', 'Q526877', 'Q117467246'];
const ANIME_SERIES = 'Q63952888';
const JAPAN = 'Q17';
const MUSICAL_FILM = 'Q842256';

// [list id, label, Wikidata production companies]. Order matters: a film is listed under the
// first studio it matches, and Walt Disney Pictures (on many Pixar/Disney Animation films too)
// comes last as the catch-all for live action and other Disney titles.
const STUDIOS = [
  ['disney-animation', 'Walt Disney Animation Studios', ['Q1047410']],
  ['pixar', 'Pixar', ['Q127552']],
  ['dreamworks', 'DreamWorks Animation', ['Q500088']],
  ['sony-animation', 'Sony Pictures Animation', ['Q1416835']],
  ['illumination', 'Illumination', ['Q1189512']],
  ['disney-live', 'More Disney (live action & others)', ['Q191224']],
];

const GENRES = [
  ['Animation', /animat|cartoon/],
  ['Musical', /musical/],
  ['Superhero', /superhero/],
  ['Science fiction', /science fiction|sci-fi|cyberpunk|space/],
  ['Fantasy', /fantasy|fairy tale/],
  ['Action', /action|martial arts/],
  ['Adventure', /adventure/],
  ['Comedy', /comedy|sitcom/],
  ['Drama', /drama/],
  ['Romance', /romance|romantic/],
  ['Horror', /horror/],
  ['Thriller', /thriller|suspense/],
  ['Crime', /crime|heist|gangster/],
  ['Family', /family|children/],
  ['War', /war film|war drama|military/],
  ['Western', /western/],
  ['Mystery', /mystery|detective/],
  ['Documentary', /documentary/],
  ['Biographical', /biograph/],
];

async function collectIds(log) {
  const pop = new Map();
  const kind = new Map();
  const studioOf = new Map(); // id -> list id
  const musicals = new Set();
  const add = (rows, k) => {
    for (const r of rows) {
      const id = qid(r.w.value);
      pop.set(id, Math.max(pop.get(id) ?? 0, Number(r.links.value)));
      kind.set(id, k);
    }
  };

  log('Films with a credited composer…');
  add(
    await sparql(
      `SELECT DISTINCT ?w ?links WHERE {
        VALUES ?cls { ${values(FILM_CLASSES)} } ?w wdt:P31 ?cls ; wikibase:sitelinks ?links .
        FILTER(?links >= 40) FILTER EXISTS { ?w wdt:P86 [] }
        FILTER NOT EXISTS { VALUES ?sh { ${values(SHORTS)} } ?w wdt:P31 ?sh }
      }`,
      { log },
    ),
    'film',
  );

  log('Studio films (Disney, Pixar, DreamWorks, Sony, Illumination)…');
  for (const [listId, , companies] of STUDIOS) {
    const rows = await sparql(
      `SELECT DISTINCT ?w ?links WHERE {
        VALUES ?co { ${values(companies)} } VALUES ?cls { ${values(FILM_CLASSES)} }
        ?w wdt:P31 ?cls ; wdt:P272 ?co ; wikibase:sitelinks ?links . FILTER(?links >= 15)
        FILTER NOT EXISTS { VALUES ?sh { ${values(SHORTS)} } ?w wdt:P31 ?sh }
      }`,
      { log },
    );
    add(rows, 'film');
    for (const r of rows) if (!studioOf.has(qid(r.w.value))) studioOf.set(qid(r.w.value), listId);
  }

  log('Musicals…');
  const musicalRows = await sparql(
    `SELECT DISTINCT ?w ?links WHERE {
      VALUES ?cls { ${values(FILM_CLASSES)} } ?w wdt:P31 ?cls ; wdt:P136 wd:${MUSICAL_FILM} ; wikibase:sitelinks ?links .
      FILTER(?links >= 15)
    }`,
    { log },
  );
  add(musicalRows, 'film');
  for (const r of musicalRows) musicals.add(qid(r.w.value));

  log('TV series…');
  add(
    await sparql(
      `SELECT DISTINCT ?w ?links WHERE {
        VALUES ?cls { ${values(SERIES_CLASSES)} } ?w wdt:P31 ?cls ; wikibase:sitelinks ?links .
        FILTER(?links >= 25) FILTER NOT EXISTS { ?w wdt:P31 wd:${ANIME_SERIES} }
      }`,
      { log },
    ),
    'series',
  );
  return { pop, kind, studioOf, musicals };
}

export async function buildScreen({ log = console.log } = {}) {
  const { pop, kind, studioOf, musicals } = await collectIds(log);
  const ids = [...pop.keys()];
  log(`Details for ${ids.length} films and series…`);
  const works = new Map();
  const get = (id) => {
    let w = works.get(id);
    if (!w) {
      w = { id, genres: new Set(), composers: new Set(), studios: new Set(), networks: new Set(), countries: new Set(), directors: new Set() };
      works.set(id, w);
    }
    return w;
  };
  await inBatches(
    ids,
    120,
    (batch) => `
      SELECT ?w ?label ?date ?prec ?genre ?composer ?series ?franchise ?studio ?network ?country ?director ?imdb ?wiki ?jpAnimated WHERE {
        VALUES ?w { ${values(batch)} }
        ${label('?w', '?label')}
        OPTIONAL { ?w p:P577/psv:P577 [ wikibase:timeValue ?date ; wikibase:timePrecision ?prec ] }
        OPTIONAL { ?w wdt:P136 ?g . ${label('?g', '?genre')} }
        OPTIONAL { ?w wdt:P86 ?c . ${label('?c', '?composer')} }
        OPTIONAL { ?w wdt:P179 ?s . ${label('?s', '?series')} }
        OPTIONAL { ?w wdt:P8345 ?fr . ${label('?fr', '?franchise')} }
        OPTIONAL { ?w wdt:P272 ?st . ${label('?st', '?studio')} }
        OPTIONAL { ?w wdt:P449 ?n . ${label('?n', '?network')} }
        OPTIONAL { ?w wdt:P495 ?co . ${label('?co', '?country')} }
        OPTIONAL { ?w wdt:P57 ?d . ${label('?d', '?director')} }
        OPTIONAL { ?w wdt:P345 ?imdb }
        OPTIONAL { ?a schema:about ?w ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?wiki }
        BIND(EXISTS { ?w wdt:P31 wd:Q20650540 } || EXISTS { ?w wdt:P495 wd:${JAPAN} . VALUES ?ac { wd:Q202866 wd:Q29168811 } ?w wdt:P31 ?ac } AS ?jpAnimated)
      }`,
    (r) => {
      if (!r.label) return;
      const w = get(qid(r.w.value));
      w.title ??= r.label.value;
      if (r.date) {
        const v = r.date.value;
        const y = Number(v.slice(0, 4));
        if (y > 1900 && (!w.first || v < w.first.value)) w.first = { value: v, prec: Number(r.prec?.value ?? 9) };
      }
      if (r.genre) w.genres.add(r.genre.value);
      if (r.composer) w.composers.add(r.composer.value);
      if (r.series) w.series ??= r.series.value;
      if (r.franchise) w.franchise ??= r.franchise.value.replace(/\s*\((media )?franchise\)$/i, '');
      if (r.studio) w.studios.add(r.studio.value);
      if (r.network) w.networks.add(r.network.value);
      if (r.country) w.countries.add(r.country.value);
      if (r.director) w.directors.add(r.director.value);
      if (r.imdb) w.imdb ??= r.imdb.value;
      if (r.wiki) w.wiki ??= r.wiki.value;
      if (r.jpAnimated?.value === 'true') w.jpAnimated = true;
    },
    { log, label: 'details' },
  );

  log('Posters (Wikipedia)…');
  const posters = await wikiCovers([...works.values()].filter((w) => w.wiki).map((w) => w.wiki), { log });

  const items = [...works.values()]
    .filter((w) => w.title && !w.jpAnimated)
    .map((w) => {
      const k = kind.get(w.id);
      const genres = bucket(w.genres, GENRES);
      const disney = [...w.studios].some((s) => /disney|pixar/i.test(s));
      const keywords = [
        ...(musicals.has(w.id) || genres.includes('Musical') ? ['Musical'] : []),
        ...(disney ? ['Disney'] : []),
        ...[...w.genres].map((g) => g.replace(/ (film|television series|series)$/i, '')).slice(0, 8),
      ];
      return {
        id: w.id,
        kind: k,
        title: w.title,
        year: w.first ? Number(w.first.value.slice(0, 4)) : null,
        ...(w.first && datePart(w.first.value, w.first.prec) ? { date: datePart(w.first.value, w.first.prec) } : {}),
        genres,
        series: w.series ?? null,
        ...(w.franchise ? { franchise: w.franchise } : {}),
        composers: [...w.composers].slice(0, 4),
        pop: pop.get(w.id) ?? 0,
        tags: {
          ...(w.studios.size ? { studio: [...w.studios].slice(0, 4) } : {}),
          ...(w.networks.size ? { network: [...w.networks].slice(0, 3) } : {}),
          ...(w.countries.size ? { country: [...w.countries].slice(0, 3) } : {}),
          ...(w.directors.size ? { developer: [...w.directors].slice(0, 3) } : {}),
          ...(w.genres.size ? { genre: [...w.genres].map((g) => g.charAt(0).toUpperCase() + g.slice(1)).slice(0, 8) } : {}),
        },
        ...(keywords.length ? { keywords: [...new Set(keywords)] } : {}),
        ...(w.wiki && posters.get(w.wiki) ? { covers: [posters.get(w.wiki)] } : {}),
        links: [
          ...(w.imdb ? [{ label: 'IMDb', url: `https://www.imdb.com/title/${w.imdb}/` }] : []),
          ...(w.wiki ? [{ label: 'Wikipedia', url: `https://en.wikipedia.org/wiki/${encodeURIComponent(w.wiki.replace(/ /g, '_'))}` }] : []),
        ],
      };
    })
    .sort((a, b) => b.pop - a.pop);

  const byId = new Map(items.map((i) => [i.id, i]));
  const top = (pred, n) => items.filter(pred).slice(0, n).map((i) => i.id);
  const films = (i) => i.kind === 'film';
  const decade = (from, to) => (i) => films(i) && i.year && i.year >= from && i.year < to;

  const groups = [
    {
      id: 'studios',
      domain: 'screen',
      title: 'Disney, Pixar & animation studios',
      description: 'Every notable film from the big animation and family-musical studios.',
      lists: STUDIOS.map(([id, title]) => ({
        id: `studio-${id}`,
        title,
        ids: [...studioOf].filter(([w, l]) => l === id && byId.has(w)).map(([w]) => w).sort((a, b) => byId.get(b).pop - byId.get(a).pop),
      })),
    },
    {
      id: 'films',
      domain: 'screen',
      title: 'Film soundtracks',
      description: 'The most widely covered films with a credited composer, by decade, plus musicals and superhero films.',
      lists: [
        { id: 'films-musicals', title: 'Musicals', ids: top((i) => films(i) && i.keywords?.includes('Musical'), 60) },
        { id: 'films-superhero', title: 'Superhero', ids: top((i) => films(i) && i.genres.includes('Superhero'), 40) },
        { id: 'films-2020s', title: '2020s', ids: top(decade(2020, 2100), 40) },
        { id: 'films-2010s', title: '2010s', ids: top(decade(2010, 2020), 40) },
        { id: 'films-2000s', title: '2000s', ids: top(decade(2000, 2010), 40) },
        { id: 'films-1990s', title: '1990s', ids: top(decade(1990, 2000), 40) },
        { id: 'films-classics', title: 'Before 1990', ids: top(decade(1900, 1990), 40) },
      ],
    },
    {
      id: 'series',
      domain: 'screen',
      title: 'TV series',
      description: 'The most widely covered TV and streaming series.',
      lists: [
        { id: 'series-top', title: 'Most popular', ids: top((i) => i.kind === 'series' && !i.genres.includes('Animation'), 60) },
        { id: 'series-animated', title: 'Animated series', ids: top((i) => i.kind === 'series' && i.genres.includes('Animation'), 40) },
      ],
    },
  ];
  log(`Screen: ${items.filter(films).length} films, ${items.filter((i) => i.kind === 'series').length} series`);
  return { items, groups };
}
