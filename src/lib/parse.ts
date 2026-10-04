// Heuristics for turning messy YouTube titles into games and tracks.

import type { CatalogGame } from '../types';

export const TRACK_TYPES: { id: string; label: string; re: RegExp }[] = [
  { id: 'boss', label: 'Boss', re: /\bboss|final (battle|fight|boss)|last battle|showdown|confrontation|vs\.? /i },
  { id: 'battle', label: 'Battle', re: /battle|fight|combat|clash|encounter|skirmish|assault|\bwar\b|duel/i },
  { id: 'town', label: 'Town', re: /\btown|village|\bcity\b|tavern|\binn\b|\bshop|market|harbou?r|\bport\b|castle town|home\b/i },
  { id: 'overworld', label: 'Overworld', re: /overworld|\bfield|world map|plains|journey|travel|\broad\b|map theme|hills|meadow/i },
  { id: 'dungeon', label: 'Dungeon', re: /dungeon|\bcaves?\b|cavern|ruins|tower|temple|labyrinth|depths|crypt|\bmines?\b|sewer|catacomb|fortress|lair/i },
  { id: 'theme', label: 'Main theme', re: /main theme|title|opening|prologue|\bintro\b|overture|prelude/i },
  { id: 'menu', label: 'Menu', re: /\bmenu|file select|game over|continue\?|options|pause/i },
  { id: 'ambient', label: 'Ambient', re: /ambien|\bnight|\brain\b|calm|peace|quiet|lullaby|dream|serene|tranquil|snow|underwater/i },
  { id: 'emotional', label: 'Emotional', re: /\bsad|tears|farewell|goodbye|memor(y|ies)|lament|requiem|sorrow|\bloss\b|elegy|remembrance|melancholy|reunion/i },
  { id: 'victory', label: 'Victory', re: /victory|fanfare|triumph|stage clear|level clear|\bclear!?$/i },
  { id: 'credits', label: 'Credits', re: /credits|ending|epilogue|staff roll|finale/i },
  { id: 'character', label: 'Character', re: /'s theme|’s theme/i },
  { id: 'vocal', label: 'Vocal', re: /\bfeat\.?|\bft\.|vocal|lyrics/i },
  { id: 'arrangement', label: 'Arrangement', re: /remix|\bcover\b|arrange|orchestra(l)? version|piano version|acoustic|lo-?fi|metal version/i },
  { id: 'extended', label: 'Extended', re: /extended|\b\d+\s*(hours?|hrs?)\b|\blooped\b|\bloop\b/i },
];

export function detectTypes(title: string, duration: number | null, isSlice: boolean): string[] {
  const types = TRACK_TYPES.filter((t) => t.re.test(title) && !(isSlice && t.id === 'extended')).map((t) => t.id);
  if (types.includes('boss') && !types.includes('battle')) types.push('battle');
  if (!isSlice && duration && duration > 25 * 60 && !types.includes('extended')) types.push('extended');
  return types;
}

const ROMAN: Record<string, string> = {
  ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9',
  xi: '11', xii: '12', xiii: '13', xiv: '14', xv: '15', xvi: '16',
};

export function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => ROMAN[w] ?? w)
    .join(' ');
}

const NOISE_IN_BRACKETS =
  /\b(ost|o\.s\.t|soundtracks?|hd|hq|1080p?|720p?|4k|full|complete|extended|official|audio|music|album|remaster(ed)?|arranged?|snes|nes|ps\d|psx|xbox( one| 360)?|switch|pc|n64|gamecube|wii u?|genesis|mega drive|gba|nds|3ds|steam|\d{4}|playlist|bgm|video game|track\s*#?\d+)\b/i;

const NOISE_WORDS =
  /\b(the\s+)?(complete|full|official|original|extended|expanded|game|video game|deluxe)?\s*(ost|o\.s\.t\.?|soundtracks?|sound track|score|bgm)\b/gi;

const SEPARATORS = /^[\s\-–—|:~·,+/]+|[\s\-–—|:~·,+/]+$/g;

function stripBrackets(s: string): string {
  return s.replace(/[([【{]([^)\]】}]*)[)\]】}]/g, (m, inner) => (NOISE_IN_BRACKETS.test(inner) ? ' ' : m));
}

export function cleanGameName(raw: string): string {
  let s = stripBrackets(raw);
  s = s.replace(NOISE_WORDS, ' ');
  s = s.replace(/\b(music|playlist|all tracks|full album|\+ ?dlc|dlc)\b/gi, ' ');
  s = s.replace(/\s+/g, ' ').replace(SEPARATORS, '').trim();
  return s || raw.trim();
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DIGIT_TO_ROMAN = Object.fromEntries(Object.entries(ROMAN).map(([r, d]) => [d, r]));

/** "Final Fantasy VII: Remake" → also "Final Fantasy 7: Remake", "Final Fantasy VII", "Remake". */
function nameVariants(names: string[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    if (!n || n.length < 3) continue;
    const forms = [
      n,
      n.normalize('NFKD').replace(/[̀-ͯ]/g, ''), // "Ōkami" → "Okami"
      n.replace(/\b(ii|iii|iv|v|vi|vii|viii|ix|xi|xii|xiii|xiv|xv|xvi)\b/gi, (m) => ROMAN[m.toLowerCase()]),
      n.replace(/\b(\d{1,2})\b/g, (m) => (DIGIT_TO_ROMAN[m] ?? m).toUpperCase()),
    ];
    for (const f of forms) {
      out.add(f);
      for (const part of f.split(/:\s+/)) if (part.length >= 6) out.add(part);
    }
  }
  // Longest first so "Final Fantasy VII" is removed before "Final Fantasy".
  return [...out].sort((a, b) => b.length - a.length);
}

/** Strip game names, composer names, numbering and OST noise from a video title. */
export function cleanTrackTitle(raw: string, names: string[]): string {
  let s = stripBrackets(raw);
  for (const g of nameVariants(names)) {
    s = s.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(g)}(?=$|[^\\p{L}\\p{N}])`, 'giu'), '$1 ');
  }
  s = s.replace(NOISE_WORDS, ' ');
  // Tidy what the removals left behind: "( : Gods & Nightmares)", "()", " - , Vol 1", "Boss - 14".
  s = s
    .replace(/([([【{])[\s:\-–—]+/g, '$1')
    .replace(/\s+([)\]】}])/g, '$1')
    .replace(/[([【{]\s*[)\]】}]/g, ' ')
    .replace(/\s+[-–—]\s*,/g, ',')
    .replace(/\s+[-–—]\s*\d{2,3}\s*$/, '');
  // Peel prefixes repeatedly: "1 - - 01 Title Theme", "Music - Day", "#12. ", "Track 3: "
  for (let prev = ''; prev !== s; ) {
    prev = s;
    s = s.replace(/\s+/g, ' ').replace(SEPARATORS, '').trim();
    s = s.replace(/^(?:track\s*)?#?\d{1,3}(?:-\d{1,3})?(?:\s*[.\-–—:)\]]\s*|\s+)(?=\S)/i, '');
    s = s.replace(/^(?:music|bgm|theme)\s*[-–—:|]\s*/i, '');
  }
  // Only a bracketed remark left ("Medal of Honor (Main Theme)" → "(Main Theme)"):
  // unwrap it, unless it's a bare qualifier like "(Looped)" — then the track is
  // named after the game, so keep the original title.
  if (!/\p{L}/u.test(s.replace(/[([【{][^)\]】}]*[)\]】}]/g, ''))) {
    const inner = s.replace(/[()[\]【】{}]/g, ' ').replace(/\s+/g, ' ').trim();
    if (inner.split(' ').length >= 2) return inner;
    return stripBrackets(raw).replace(/\s+/g, ' ').replace(SEPARATORS, '').trim() || raw.trim();
  }
  return s || raw.trim();
}

const TS = '((?:\\d{1,2}:)?\\d{1,2}:\\d{2})';
const LEADING = new RegExp(`^\\s*(?:\\d{1,3}[.)]\\s*)?[\\[(]?${TS}[\\])]?\\s*[-–—:|.)]*\\s*(.+?)\\s*$`);
const TRAILING = new RegExp(`^\\s*(?:\\d{1,3}[.)]\\s*)?(.+?)\\s*[-–—:|(\\[]*\\s*${TS}[\\])]?\\s*$`);

function toSeconds(ts: string): number {
  return ts.split(':').map(Number).reduce((a, p) => a * 60 + p, 0);
}

export interface Chapter {
  start: number;
  end: number | null;
  title: string;
}

/** Find a tracklist with timestamps in a video description. */
export function parseChapters(description: string, duration: number | null): Chapter[] {
  const found: { start: number; title: string }[] = [];
  for (const line of description.split(/\r?\n/)) {
    const lead = line.match(LEADING);
    if (lead) {
      found.push({ start: toSeconds(lead[1]), title: lead[2] });
      continue;
    }
    const trail = line.match(TRAILING);
    if (trail) found.push({ start: toSeconds(trail[2]), title: trail[1] });
  }
  if (found.length < 3 || found[0].start > 90) return [];
  // Hand-written tracklists contain the odd typo'd timestamp; drop out-of-order
  // entries, but give up if the list is mostly not ascending (not a tracklist).
  const ordered = found.filter((c, i) => i === 0 || c.start > Math.max(...found.slice(0, i).map((x) => x.start)));
  if (ordered.length < 3 || ordered.length < found.length * 0.8) return [];
  if (duration) {
    while (ordered.length && ordered[ordered.length - 1].start >= duration) ordered.pop();
  }
  return ordered.map((c, i) => ({
    start: c.start,
    end: i + 1 < ordered.length ? ordered[i + 1].start : duration,
    title: c.title.replace(SEPARATORS, '').trim() || `Track ${i + 1}`,
  }));
}

const OST_HINT = /\bost\b|o\.s\.t|soundtrack|sound track|\bbgm\b|\bscore\b|\bmusic\b/i;

/** Matches free text against catalog titles; longest match wins. */
export function createCatalogMatcher(catalog: CatalogGame[]) {
  const entries = catalog
    .map((g) => ({ g, n: ` ${normalize(g.title)} ` }))
    .filter((e) => e.n.trim().length >= 3)
    .sort((a, b) => b.n.length - a.n.length || b.g.pop - a.g.pop);

  function match(text: string): CatalogGame | null {
    const t = ` ${normalize(text)} `;
    for (const e of entries) if (t.includes(e.n)) return e.g;
    return null;
  }

  /** Best guess of which game a single video title belongs to. */
  function guessGame(videoTitle: string): { title: string; catalog: CatalogGame | null } {
    const segments = stripBrackets(videoTitle)
      .split(/\s[-–—|~]\s|\s*[|｜]\s*|:\s/)
      .map((s) => s.trim())
      .filter((s) => s && !/^(track\s*)?#?\d{1,3}\.?$/i.test(s)); // skip bare track numbers
    const withHint = segments.find((s) => OST_HINT.test(s));
    // "Persona 5 OST 23" → "Persona 5 OST"
    const candidate = (withHint ?? (segments.length > 1 ? segments[0] : null))?.replace(
      /(ost|soundtrack|bgm)\s+#?\d{1,3}$/i,
      '$1',
    );
    if (candidate) {
      const c = match(candidate);
      if (c) return { title: c.title, catalog: c };
      return { title: cleanGameName(candidate), catalog: null };
    }
    const c = match(videoTitle);
    return c ? { title: c.title, catalog: c } : { title: 'Unsorted', catalog: null };
  }

  return { match, guessGame };
}

export function looksLikeSingleGame(playlistTitle: string): boolean {
  return OST_HINT.test(playlistTitle);
}
