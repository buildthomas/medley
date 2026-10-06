// Import quality check: imports a fixed sample of works with the app's own importer (in an
// in-memory database, never your library) and records what each import picked: the source, how
// many tracks, which tracks were skipped as fan remixes/covers. Then shows what changed since the
// previous run, so a ranking tweak's side effects are visible at a glance.
//
//   npm run eval:imports                      everything (~90 works; a few minutes on a warm cache)
//   npm run eval:imports -- --quick           only the known-tricky works (REGRESSIONS below)
//   npm run eval:imports -- --only "Helltaker,RuneScape"
//   npm run eval:imports -- --against <file>  compare with a specific earlier run
//
// Needs `npm run dev` (YouTube is read through its /api, and cached there, so reruns are quick and
// both sides of a comparison see the same search results). Runs are saved in Medley's data folder
// (eval/), not the repo: YouTube's answers drift, so a committed baseline would go stale.

import 'fake-indexeddb/auto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { medleyPaths } from './paths.mjs';

(globalThis as { __MEDLEY_API_BASE__?: string }).__MEDLEY_API_BASE__ = process.env.MEDLEY_URL ?? 'http://localhost:32123';

const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/lib/catalog.ts');
const { autoAddGame, draftFromLink } = await import('../src/lib/importer.ts');
const { kindOf } = await import('../src/lib/kinds.ts');
import type { CatalogGame } from '../src/types.ts';

/** Works that went wrong before, with what "right" looks like. Add one whenever a fix lands. */
const REGRESSIONS: [title: string, kind: string, expect: string][] = [
  ['RuneScape', 'game', 'the in-game soundtrack (not fan music videos or the Orchestral Collection)'],
  ['Helltaker', 'game', "Mittsies' official upload, no fan remixes"],
  ['Castlevania: Symphony of the Night', 'game', 'its OST ("Symphony" is in the name, not an arrangement)'],
  ['Roblox', 'game', 'Roblox music, not "Roblox 3008"'],
  ['Mafia', 'game', 'the first game\'s OST'],
  ['Harry Potter and the Chamber of Secrets', 'game', 'game soundtracks per platform, not the film score'],
  ["Shantae and the Pirate's Curse", 'game', 'its OST'],
  ['Tetris', 'game', 'Tetris versions only, not Tetris Worlds or Tetris Effect'],
  ['Final Fantasy VII Remake', 'game', 'the Remake OST, not the 1997 one'],
  ['League of Legends', 'game', "the official channel's soundtrack, Riot's own remixes kept"],
  ['Chainsaw Man', 'anime', 'KICK BACK as the original, not a live version'],
  ['Rascal Does Not Dream of Bunny Girl Senpai', 'anime', 'Kimi no Sei original, not an English cover'],
  ['Demon Slayer: Kimetsu no Yaiba', 'anime', 'OP and EDs labelled'],
  ['Moana', 'film', 'the 2016 film, not a sequel'],
];

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

interface Result {
  id: string;
  title: string;
  kind: string;
  sources: string[];
  tracks: number;
  sung: number;
  roles?: string;
  /** Anime: which song fills each OP/ED slot ("OP1 KICK BACK"), so a switch to a live take shows. */
  themes?: string[];
  skipped: string[];
  error?: string;
  expect?: string;
}

const { games } = await loadCatalog();
const byTitle = (title: string, kind: string) =>
  games.filter((g) => g.title.toLowerCase() === title.toLowerCase() && kindOf(g) === kind).sort((a, b) => b.pop - a.pop)[0];
const top = (kind: string, n: number, skip = 0) =>
  games.filter((g) => kindOf(g) === kind && !g.id.startsWith('u:')).sort((a, b) => b.pop - a.pop).slice(skip, skip + n);

const expectations = new Map<string, string>();
let sample: CatalogGame[] = [];
for (const [title, kind, expect] of REGRESSIONS) {
  const w = byTitle(title, kind);
  if (w) {
    sample.push(w);
    expectations.set(w.id, expect);
  } else console.warn(`(not in the catalog: ${title})`);
}
if (!flag('--quick')) {
  // Popular works of every kind, plus some mid-popularity games: where most imports happen.
  sample.push(...top('game', 40), ...top('game', 12, 800), ...top('film', 10), ...top('series', 6), ...top('anime', 6));
}
const only = value('--only')?.split(',').map((s) => s.trim().toLowerCase());
if (only) sample = games.filter((g) => only.includes(g.title.toLowerCase()));
sample = [...new Map(sample.map((g) => [g.id, g])).values()];

async function evaluate(w: CatalogGame): Promise<Result> {
  await Promise.all(db.tables.map((t) => t.clear()));
  const base = { id: w.id, title: w.title, kind: kindOf(w), ...(expectations.has(w.id) ? { expect: expectations.get(w.id) } : {}) };
  try {
    await autoAddGame(w);
  } catch (e) {
    return { ...base, sources: [], tracks: 0, sung: 0, skipped: [], error: (e as Error).message };
  }
  const tracks = await db.tracks.where('gameId').equals(w.id).toArray();
  const sources = await db.sources.toArray();
  const skipped: string[] = [];
  // Which tracks of each playlist/video source were left out as derivative.
  for (const s of sources.filter((s) => s.kind === 'playlist' || (s.kind === 'video' && kindOf(w) !== 'anime'))) {
    try {
      const d = await draftFromLink({ kind: s.kind as 'playlist' | 'video', id: s.id }, w);
      skipped.push(...d.groups.flatMap((g) => g.tracks.filter((t) => !t.include).map((t) => t.rawTitle)));
    } catch {
      /* the source itself is what matters */
    }
  }
  const themeTracks = tracks.filter((t) => t.role === 'op' || t.role === 'ed');
  const slot = (t: (typeof tracks)[number]) => `${t.role!.toUpperCase()}${t.seq ?? ''}`;
  const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
  const roles = themeTracks.map(slot).sort(natural);
  const themes = themeTracks.map((t) => `${slot(t)} ${t.title} [${t.videoId}]`).sort(natural);
  return {
    ...base,
    sources: sources.map((s) => `${s.title} (${s.channel}${s.label ? `, ${s.label}` : ''})`).sort(),
    tracks: tracks.length,
    sung: tracks.filter((t) => t.vocal).length,
    ...(roles.length ? { roles: roles.join(' '), themes } : {}),
    skipped: skipped.sort(),
  };
}

const dir = join(medleyPaths().dataDir, 'eval');
mkdirSync(dir, { recursive: true });
const latest = join(dir, 'imports-latest.json');
const againstFile = value('--against') ?? (existsSync(latest) ? latest : null);
const previous = new Map<string, Result>(
  againstFile ? (JSON.parse(readFileSync(againstFile, 'utf8')).results as Result[]).map((r) => [r.id, r]) : [],
);

console.log(`Evaluating ${sample.length} works${againstFile ? `, compared with ${againstFile}` : ''}…\n`);
const results: Result[] = [];
const changes: string[] = [];
for (const [i, w] of sample.entries()) {
  const r = await evaluate(w);
  results.push(r);
  const p = previous.get(r.id);
  const what: string[] = [];
  if (p) {
    if (p.sources.join() !== r.sources.join()) what.push(`source: ${p.sources.join(' + ') || '(none)'}\n      →  ${r.sources.join(' + ') || '(none)'}`);
    if (p.tracks !== r.tracks) what.push(`tracks ${p.tracks} → ${r.tracks}`);
    if (p.sung !== r.sung) what.push(`sung ${p.sung} → ${r.sung}`);
    if ((p.roles ?? '') !== (r.roles ?? '')) what.push(`OP/ED ${p.roles ?? '-'} → ${r.roles ?? '-'}`);
    const themeChanges = (r.themes ?? []).filter((t) => !(p.themes ?? []).includes(t));
    if (themeChanges.length) what.push(`songs now: ${themeChanges.join(' | ')}`);
    const nowSkipped = r.skipped.filter((s) => !p.skipped.includes(s));
    const unskipped = p.skipped.filter((s) => !r.skipped.includes(s));
    if (nowSkipped.length) what.push(`newly skipped: ${nowSkipped.join(' | ')}`);
    if (unskipped.length) what.push(`no longer skipped: ${unskipped.join(' | ')}`);
    if ((p.error ?? '') !== (r.error ?? '')) what.push(`error: ${p.error ?? '-'} → ${r.error ?? '-'}`);
  }
  const line = `[${i + 1}/${sample.length}] ${r.title} (${r.kind}): ${r.error ? `ERROR ${r.error}` : `${r.tracks} tracks from ${r.sources.join(' + ')}`}`;
  console.log(line);
  if (r.skipped.length && !p) console.log(`      skipped: ${r.skipped.join(' | ')}`);
  if (what.length) {
    for (const w of what) console.log(`   ⚑ ${w}`);
    changes.push(`${r.title} (${r.kind})\n   ${what.join('\n   ')}`);
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
writeFileSync(join(dir, `imports-${stamp}.json`), JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 1));
// "Latest" keeps every work's most recent result, so a partial run (--only, --quick) doesn't
// make the next full run lose its comparison for everything else.
const kept = existsSync(latest) ? (JSON.parse(readFileSync(latest, 'utf8')).results as Result[]) : [];
const merged = new Map(kept.map((r) => [r.id, r]));
for (const r of results) merged.set(r.id, r);
writeFileSync(latest, JSON.stringify({ ranAt: new Date().toISOString(), results: [...merged.values()] }, null, 1));

const errors = results.filter((r) => r.error);
console.log(`\n${results.length} works · ${results.reduce((n, r) => n + r.tracks, 0)} tracks · ${results.reduce((n, r) => n + r.skipped.length, 0)} skipped · ${errors.length} errors`);
if (previous.size) console.log(changes.length ? `\n${changes.length} changed since the previous run:\n\n${changes.join('\n\n')}` : '\nNothing changed since the previous run.');
console.log(`\nSaved to ${join(dir, `imports-${stamp}.json`)}`);
const tricky = results.filter((r) => r.expect);
if (tricky.length) {
  console.log('\nCheck the known-tricky works by eye:');
  for (const r of tricky) console.log(`  ${r.title}: expect ${r.expect}\n      got ${r.error ? `ERROR ${r.error}` : r.sources.join(' + ')}${r.roles ? ` · ${r.roles}` : ''}`);
}
process.exit(0);
