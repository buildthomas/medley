// Steam library import: parse whatever the user pastes, then map each game to
// Wikidata (via its Steam app id) so it gets a proper title, year and genres.

import type { CatalogGame } from '../types';
import { loadCatalog } from './catalog';
import { normalize } from './parse';

export interface SteamEntry {
  appid?: number;
  name: string;
  hours?: number;
}

const NOT_A_GAME =
  /soundtrack|dedicated server|\bsdk\b|wallpaper engine|\bdemo\b|playtest|benchmark|test server|\bpts\b|\beditor\b|\btool(s|kit)?\b|redistributable|source filmmaker|steamvr|proton|steamworks|\bserver\b|artbook|\bdlc\b|season pass/i;

// Lines from a copy-pasted Steam "Games" page that aren't game names.
const PAGE_NOISE =
  /hrs? on record|hours? played|total played|last played|achievements?|store page|community hub|view stats|global leaderboards|^manage|^install|^play$|^links$|^stats$|^all games|^recent|^perfect games|^followed|^search|^sort by|^\d+(\.\d+)?\s*(h|hrs?|hours?)?$|^\d+\s*\/\s*\d+$|^games$|^\s*$/i;

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Accepts Steam's games XML, Web API JSON, a pasted "Games" page, or a plain list of names. */
export function parseSteamLibrary(text: string): SteamEntry[] {
  const out: SteamEntry[] = [];

  // 1. steamcommunity.com/my/games/?tab=all&xml=1
  for (const m of text.matchAll(/<game>([\s\S]*?)<\/game>/g)) {
    const block = m[1];
    const appid = Number(block.match(/<appID>(\d+)<\/appID>/)?.[1]);
    const name = block.match(/<name>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/name>/)?.[1];
    const hours = Number(block.match(/<hoursOnRecord>([\d.,]+)<\/hoursOnRecord>/)?.[1]?.replace(/,/g, ''));
    if (name) out.push({ appid: appid || undefined, name: decodeEntities(name.trim()), hours: hours || 0 });
  }

  // 2. Web API / page-source JSON: {"appid":123,"name":"…", "playtime_forever": 456}
  if (!out.length) {
    for (const m of text.matchAll(/"appid"\s*:\s*(\d+)\s*,\s*"name"\s*:\s*"((?:[^"\\]|\\.)*)"(?:[^}]*?"playtime_forever"\s*:\s*(\d+))?/g)) {
      out.push({ appid: Number(m[1]), name: JSON.parse(`"${m[2]}"`), hours: m[3] ? Number(m[3]) / 60 : undefined });
    }
  }

  // 3. Anything else: one game name per line.
  if (!out.length) {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.length < 2 || line.length > 120 || PAGE_NOISE.test(line)) continue;
      out.push({ name: line.replace(/^[-*•\d.)\s]+(?=\D)/, '') });
    }
  }

  const seen = new Set<string>();
  return out
    .filter((e) => !NOT_A_GAME.test(e.name))
    .filter((e) => {
      const key = e.appid ? `a${e.appid}` : `n${normalize(e.name)}`;
      return !seen.has(key) && seen.add(key);
    })
    .sort((a, b) => (b.hours ?? 0) - (a.hours ?? 0));
}

const GENRE_BUCKETS: [string, RegExp][] = [
  ['Metroidvania', /metroidvania/], ['Roguelike', /rogue/], ['Soulslike', /soulslike/], ['JRPG', /japanese role/],
  ['RPG', /role-playing|rpg/], ['Platformer', /platform/], ['Shooter', /shooter|shoot 'em up|bullet hell/],
  ['Fighting', /fighting|beat 'em up|hack and slash/], ['Racing', /racing|kart/],
  ['Sports', /sport|football|soccer|golf|basketball|tennis|skateboard/], ['Strategy', /strategy|tactic|4x|tower defense/],
  ['Simulation', /simulat|management|city-building|farming/], ['Puzzle', /puzzle/], ['Horror', /horror/],
  ['Adventure', /adventure|visual novel|point-and-click/], ['Rhythm', /rhythm|music video game/],
  ['Sandbox', /sandbox|survival|open world/], ['Stealth', /stealth/], ['MMO', /massively multiplayer/], ['Action', /action/],
];

async function wikidataByAppId(appids: number[]): Promise<Map<number, CatalogGame>> {
  const out = new Map<number, CatalogGame>();
  for (let i = 0; i < appids.length; i += 120) {
    const batch = appids.slice(i, i + 120);
    const query = `
      SELECT ?game ?app ?links (SAMPLE(?l) AS ?label) (MIN(?date) AS ?first) (GROUP_CONCAT(DISTINCT ?gl; separator="|") AS ?genres) WHERE {
        VALUES ?app { ${batch.map((a) => `"${a}"`).join(' ')} }
        ?game wdt:P1733 ?app ; wikibase:sitelinks ?links .
        ?game rdfs:label ?l FILTER(LANG(?l) IN ("en", "mul"))
        OPTIONAL { ?game wdt:P577 ?date }
        OPTIONAL { ?game wdt:P136 ?g . ?g rdfs:label ?gl FILTER(LANG(?gl) = "en") }
      } GROUP BY ?game ?app ?links`;
    try {
      const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, {
        headers: { Accept: 'application/sparql-results+json' },
      });
      if (!res.ok) continue;
      const rows = (await res.json()).results.bindings;
      for (const r of rows) {
        const genreLabels = (r.genres?.value ?? '').toLowerCase();
        if ((out.get(Number(r.app.value))?.pop ?? -1) >= Number(r.links.value)) continue;
        out.set(Number(r.app.value), {
          id: r.game.value.split('/').pop(),
          title: r.label.value,
          year: r.first ? Number(r.first.value.slice(0, 4)) : null,
          genres: GENRE_BUCKETS.filter(([, re]) => re.test(genreLabels)).map(([n]) => n),
          series: null,
          composers: [],
          pop: Number(r.links.value),
          steam: Number(r.app.value),
        });
      }
    } catch {
      /* Wikidata unreachable: fall back to plain names below */
    }
  }
  return out;
}

export interface ResolvedSteamGame {
  entry: SteamEntry;
  game: CatalogGame;
  via: 'catalog' | 'wikidata' | 'name';
}

export async function resolveSteamLibrary(entries: SteamEntry[]): Promise<ResolvedSteamGame[]> {
  const { games } = await loadCatalog();
  // Several items can share a Steam id (a game and its DLC); keep the best known.
  const bySteam = new Map<number, CatalogGame>();
  for (const g of games) if (g.steam && (bySteam.get(g.steam)?.pop ?? -1) < g.pop) bySteam.set(g.steam, g);
  const byName = new Map<string, CatalogGame>();
  for (const g of games) {
    const key = normalize(g.title);
    if ((byName.get(key)?.pop ?? -1) < g.pop) byName.set(key, g);
  }

  const out: ResolvedSteamGame[] = [];
  const unresolved: SteamEntry[] = [];
  for (const e of entries) {
    const hit = (e.appid && bySteam.get(e.appid)) || byName.get(normalize(e.name));
    if (hit) out.push({ entry: e, game: hit, via: 'catalog' });
    else unresolved.push(e);
  }

  const wd = await wikidataByAppId(unresolved.filter((e) => e.appid).map((e) => e.appid!));
  for (const e of unresolved) {
    const hit = e.appid ? wd.get(e.appid) : undefined;
    if (hit) out.push({ entry: e, game: hit, via: 'wikidata' });
    else
      out.push({
        entry: e,
        via: 'name',
        game: {
          id: `u:${normalize(e.name).replace(/ /g, '-')}`,
          title: e.name,
          year: null,
          genres: [],
          series: null,
          composers: [],
          pop: 0,
          steam: e.appid,
        },
      });
  }

  // Wikidata sometimes labels the base game oddly ("Vampire Survivors — First Survivaton");
  // Steam's name is the better search term then.
  for (const r of out) {
    const steamName = r.entry.name.replace(/[™®©]/g, '').trim();
    const s = normalize(steamName);
    const w = normalize(r.game.title);
    if (s && w !== s && w.startsWith(s + ' ')) r.game = { ...r.game, title: steamName };
  }

  // Keep the original (playtime) order, one row per game.
  const order = new Map(entries.map((e, i) => [e, i]));
  const seen = new Set<string>();
  return out
    .sort((a, b) => order.get(a.entry)! - order.get(b.entry)!)
    .filter((r) => !seen.has(r.game.id) && seen.add(r.game.id));
}

/** Optional: read the library through the Steam Web API (needs STEAM_API_KEY on the local server). */
export async function fetchOwnedGames(profile: string): Promise<SteamEntry[]> {
  const res = await fetch(`/api/steam/owned?profile=${encodeURIComponent(profile)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return parseSteamLibrary(JSON.stringify(body));
}
