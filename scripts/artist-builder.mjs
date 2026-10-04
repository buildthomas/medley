// Music artists: a pre-warmed catalog of popular singers, rappers, bands and groups from
// Wikidata, ranked by Wikipedia coverage and grouped into broad genres. Anyone not in here
// is found on the fly (MusicBrainz search, see server/artists.ts).

import { bucket, commonsThumb, datePart, inBatches, label, qid, sparql, values } from './wd.mjs';
import { wikiCovers } from './wiki-covers.mjs';

const MIN_LINKS = 45;
// Occupations for people: singer, rapper, singer-songwriter, musician, DJ, record producer.
const OCCUPATIONS = ['Q177220', 'Q2252262', 'Q488205', 'Q639669', 'Q130857', 'Q183945'];
// Classes for groups: band, musical group, boy band, girl group, duo, rock band, K-pop idol group.
const GROUP_CLASSES = ['Q215380', 'Q2088357', 'Q216337', 'Q641066', 'Q9212979', 'Q5741069', 'Q105453097'];

export const ARTIST_GENRES = [
  // Word boundaries matter: "folk-pop" must not count as K-pop, "trap" not as rap.
  ['K-pop', /\bk-pop\b|korean pop|korean idol/],
  ['J-pop', /\bj-pop\b|japanese pop|anison|anime song|\bj-rock\b|visual kei|city pop/],
  ['Latin', /latin|reggaeton|salsa|bachata|cumbia|sertanejo|regional mexican|\bbanda\b|merengue/],
  ['Hip hop', /\bhip[ -]hop\b|\brap\b|\btrap\b|\bdrill\b|\bgrime\b|gangsta/],
  ['R&B & soul', /\br&b\b|rhythm and blues|\bsoul\b|\bfunk\b|motown/],
  ['Electronic', /electronic|\bhouse\b|techno|\bedm\b|dance music|dubstep|trance|synth|drum and bass|\belectro\b/],
  ['Metal', /\bmetal\b|metalcore/],
  ['Punk', /\bpunk\b|\bemo\b/],
  ['Rock', /\brock\b/],
  ['Indie & alternative', /\bindie\b|alternative/],
  ['Pop', /\bpop\b/],
  ['Country', /country|americana|bluegrass/],
  ['Folk', /\bfolk\b|singer-songwriter/],
  ['Jazz', /jazz|\bswing\b|bebop/],
  ['Blues', /blues/],
  ['Classical', /classical|opera|baroque|symphon/],
  ['Reggae', /reggae|dancehall|\bska\b/],
  ['Film & game music', /film score|soundtrack|video game music|film music/],
];

export async function buildArtists({ log = console.log } = {}) {
  log(`Artists with >= ${MIN_LINKS} sitelinks…`);
  const pop = new Map();
  const type = new Map();
  // One query per occupation: "musician" alone covers hundreds of thousands of people, and a
  // combined query times out on the public endpoint.
  for (const occ of OCCUPATIONS) {
    for (const r of await sparql(
      `SELECT DISTINCT ?a ?links WHERE {
        ?a wdt:P106 wd:${occ} ; wikibase:sitelinks ?links .
        FILTER(?links >= ${MIN_LINKS})
        ?a wdt:P31 wd:Q5 .
      }`,
      { log },
    )) {
      pop.set(qid(r.a.value), Number(r.links.value));
      type.set(qid(r.a.value), 'person');
    }
  }
  for (const r of await sparql(
    `SELECT DISTINCT ?a ?links WHERE {
      VALUES ?cls { ${values(GROUP_CLASSES)} } ?a wdt:P31 ?cls ; wikibase:sitelinks ?links .
      FILTER(?links >= ${Math.round(MIN_LINKS * 0.8)})
    }`,
    { log },
  )) {
    pop.set(qid(r.a.value), Number(r.links.value));
    type.set(qid(r.a.value), 'group');
  }
  const ids = [...pop.keys()];
  log(`  ${ids.length} artists; details…`);

  const artists = new Map();
  const get = (id) => {
    let a = artists.get(id);
    if (!a) {
      a = { id, genres: new Set(), labels: new Set() };
      artists.set(id, a);
    }
    return a;
  };
  await inBatches(
    ids,
    150,
    (batch) => `
      SELECT ?a ?label ?genre ?country ?since ?sincePrec ?image ?yt ?spotify ?site ?recLabel ?wiki WHERE {
        VALUES ?a { ${values(batch)} }
        ${label('?a', '?label')}
        OPTIONAL { ?a wdt:P136 ?g . ${label('?g', '?genre')} }
        OPTIONAL { { ?a wdt:P495 ?c } UNION { ?a wdt:P27 ?c } ${label('?c', '?country')} }
        OPTIONAL { { ?a p:P2031/psv:P2031 [ wikibase:timeValue ?since ; wikibase:timePrecision ?sincePrec ] }
                   UNION { ?a p:P571/psv:P571 [ wikibase:timeValue ?since ; wikibase:timePrecision ?sincePrec ] } }
        OPTIONAL { ?a wdt:P18 ?image }
        OPTIONAL { ?a wdt:P2397 ?yt }
        OPTIONAL { ?a wdt:P1902 ?spotify }
        OPTIONAL { ?a wdt:P856 ?site }
        OPTIONAL { ?a wdt:P264 ?l . ${label('?l', '?recLabel')} }
        OPTIONAL { ?w schema:about ?a ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?wiki }
      }`,
    (r) => {
      if (!r.label) return;
      const a = get(qid(r.a.value));
      a.title ??= r.label.value;
      if (r.genre) a.genres.add(r.genre.value);
      if (r.country) a.country ??= r.country.value;
      if (r.since) {
        const y = Number(r.since.value.slice(0, 4));
        if (y > 1900 && (!a.since || y < a.since)) a.since = y;
      }
      if (r.image) a.image ??= r.image.value;
      if (r.yt) a.yt ??= r.yt.value;
      if (r.spotify) a.spotify ??= r.spotify.value;
      if (r.site) a.site ??= r.site.value;
      if (r.recLabel) a.labels.add(r.recLabel.value);
      if (r.wiki) a.wiki ??= r.wiki.value;
    },
    { log, label: 'artists' },
  );

  // Artists without a free Commons photo: fall back to the Wikipedia infobox image.
  const noPhoto = [...artists.values()].filter((a) => !a.image && a.wiki);
  log(`Photos: ${artists.size - noPhoto.length} from Commons, looking up ${noPhoto.length} on Wikipedia…`);
  const wikiImages = await wikiCovers(noPhoto.map((a) => a.wiki), { log });

  // Only real recording artists: a music genre plus a Spotify id, record label or YouTube channel.
  // (Plenty of famous people have "singer" among their occupations: da Vinci, Chaplin, …)
  const items = [...artists.values()]
    .filter((a) => a.title && a.genres.size && (a.spotify || a.labels.size || a.yt))
    .map((a) => {
      const genres = bucket(a.genres, ARTIST_GENRES);
      const cover = a.image ? commonsThumb(a.image) : a.wiki ? wikiImages.get(a.wiki) : null;
      return {
        id: a.id,
        kind: 'artist',
        title: a.title,
        year: a.since ?? null,
        genres: genres.length ? genres : ['Other'],
        genreShare: Object.fromEntries(genres.map((g) => [g, [...a.genres].filter((l) => bucket([l], ARTIST_GENRES).includes(g)).length / a.genres.size])),
        series: null,
        composers: [],
        pop: pop.get(a.id) ?? 0,
        artist: { ...(a.country ? { country: a.country } : {}), ...(a.since ? { since: a.since } : {}), type: type.get(a.id) },
        tags: {
          genre: [...a.genres].map((g) => g.charAt(0).toUpperCase() + g.slice(1)).slice(0, 8),
          ...(a.country ? { country: [a.country] } : {}),
          ...(a.labels.size ? { publisher: [...a.labels].slice(0, 3) } : {}),
        },
        ...(cover ? { covers: [cover] } : {}),
        links: [
          ...(a.yt ? [{ label: 'YouTube', url: `https://www.youtube.com/channel/${a.yt}` }] : []),
          ...(a.spotify ? [{ label: 'Spotify', url: `https://open.spotify.com/artist/${a.spotify}` }] : []),
          ...(a.site ? [{ label: 'Website', url: a.site }] : []),
          ...(a.wiki ? [{ label: 'Wikipedia', url: `https://en.wikipedia.org/wiki/${encodeURIComponent(a.wiki.replace(/ /g, '_'))}` }] : []),
        ],
        ...(a.yt ? { ytChannel: a.yt } : {}),
      };
    })
    .sort((a, b) => b.pop - a.pop);

  const top = (pred, n) => items.filter(pred).slice(0, n).map((i) => i.id);
  // Genre lists favour artists for whom the genre is a big part of their profile, so a pop
  // star with one rap feature doesn't lead the hip hop list.
  const topIn = (g, n) =>
    items
      .filter((i) => (i.genreShare[g] ?? 0) >= 0.25)
      .sort((a, b) => b.pop * (0.4 + b.genreShare[g]) - a.pop * (0.4 + a.genreShare[g]))
      .slice(0, n)
      .map((i) => i.id);
  const groups = [
    {
      id: 'artists',
      domain: 'artist',
      title: 'Popular artists',
      description: 'The most widely covered artists and bands, overall and per genre. Search finds anyone else.',
      lists: [
        { id: 'artists-top', title: 'Most popular', ids: top(() => true, 60) },
        ...ARTIST_GENRES.map(([g]) => ({ id: `artists-${g.toLowerCase().replace(/[^a-z]+/g, '-')}`, title: g, ids: topIn(g, 40) })).filter(
          (l) => l.ids.length >= 5,
        ),
      ],
    },
  ];
  for (const i of items) delete i.genreShare; // build-time only
  log(`Artists: ${items.length}`);
  return { items, groups };
}
