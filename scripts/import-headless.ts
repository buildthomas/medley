// Bulk-import collections without a browser, using the app's own import code
// against an in-memory IndexedDB, and save the result as a library backup that
// can be restored in any browser (Add link → Backup → Restore from file).
//
// Needs the dev server running (npm run dev) for YouTube access.
//
//   npx tsx scripts/import-headless.ts [--groups mine,nintendo,years,indie] [--starter]
//                                      [--out vgm-library.json] [--concurrency 6] [--retry-failed] [--fix-foreign]
//
// Re-running with the same --out resumes: games already in the file are skipped.

import 'fake-indexeddb/auto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const GROUPS = opt('groups', 'mine,nintendo,years,indie').split(',');
const OUT = opt('out', 'vgm-library.json');
const CONCURRENCY = Number(opt('concurrency', '6'));
(globalThis as { __VGM_API_BASE__?: string }).__VGM_API_BASE__ = opt('api', 'http://localhost:5173');

const { db, exportLibrary, importLibrary, setMeta, getMeta } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/lib/catalog.ts');
const { autoAddGame, foreignTitleRatio, preferEnglishSource } = await import('../src/lib/importer.ts');
const { starterGames } = await import('../src/lib/starter.ts');
type CatalogGame = import('../src/types.ts').CatalogGame;

if (existsSync(OUT)) {
  await importLibrary(readFileSync(OUT, 'utf8'));
  console.log(`Resuming from ${OUT}: ${await db.games.count()} games already imported`);
}

const { games, byId, collections } = await loadCatalog();
const wanted = new Map<string, CatalogGame>();
for (const group of collections.groups.filter((g) => GROUPS.includes(g.id)))
  for (const id of group.lists.flatMap((l) => l.ids)) {
    const g = byId.get(id);
    if (g) wanted.set(id, g);
  }
if (args.includes('--starter')) for (const g of starterGames(games)) wanted.set(g.id, g);

const have = new Set(await db.games.toCollection().primaryKeys());
// Games that found no source last time are skipped unless --retry-failed.
const failedBefore = new Set(args.includes('--retry-failed') ? [] : await getMeta<string[]>('headlessFailed', []));
const todo = [...wanted.values()].filter((g) => !have.has(g.id) && !failedBefore.has(g.title));
console.log(`${wanted.size} games wanted, ${todo.length} to import (concurrency ${CONCURRENCY})`);

const failed: { title: string; reason: string }[] = [];
let done = 0;
let added = 0;
const started = Date.now();

async function checkpoint() {
  await setMeta('headlessFailed', [...failedBefore, ...failed.map((f) => f.title)]);
  writeFileSync(OUT, await exportLibrary());
}

async function worker() {
  while (todo.length) {
    const game = todo.shift()!;
    try {
      const r = await autoAddGame(game);
      if (r.added) added++;
    } catch (e) {
      failed.push({ title: game.title, reason: (e as Error).message });
    }
    done++;
    if (done % 10 === 0) {
      const rate = (Date.now() - started) / done / 1000;
      console.log(
        `${done} done · ${added} added · ${failed.length} not found · ~${Math.round((todo.length * rate) / 60)} min left`,
      );
    }
    if (done % 50 === 0) await checkpoint();
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

// --fix-foreign: swap sources whose track names are mostly Japanese/Chinese/Korean for English ones.
if (args.includes('--fix-foreign')) {
  for (const g of await db.games.toArray()) {
    const titles = (await db.tracks.where('gameId').equals(g.id).toArray()).map((t) => t.title);
    if (foreignTitleRatio(titles) <= 0.5) continue;
    const meta = byId.get(g.id) ?? { ...g, franchise: g.franchise ?? undefined, pop: 0 };
    try {
      const used = await preferEnglishSource(meta);
      console.log(`${g.title}: ${used ? `switched to “${used}”` : 'no English source found'}`);
    } catch (e) {
      console.log(`${g.title}: ${(e as Error).message}`);
    }
  }
}

// Same bookkeeping the app's "Add all" + start-up jobs keep, so the monthly
// update continues from here after the backup is restored.
const subs = new Set(await getMeta<string[]>('subscriptions', ['mine']));
for (const g of GROUPS) subs.add(g);
await setMeta('subscriptions', [...subs]);
await setMeta('seenCollectionIds', [...new Set(collections.groups.flatMap((g) => g.lists.flatMap((l) => l.ids)))]);
await setMeta('myGamesImported', collections.groups.find((g) => g.id === 'mine')?.lists.flatMap((l) => l.ids) ?? []);
if (!(await getMeta<number>('lastRefreshAt', 0))) await setMeta('lastRefreshAt', Date.now());
await checkpoint();

console.log(
  `\nDone: ${await db.games.count()} games, ${await db.tracks.count()} tracks → ${OUT}` +
    (failed.length ? `\nNo source found for ${failed.length}: ${failed.map((f) => f.title).join(' · ')}` : ''),
);
process.exit(0);
