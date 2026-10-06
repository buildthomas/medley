// Builds src/data/demo-library.json: the library the GitHub Pages preview starts with, so it can
// play music without a server. Imports a fixed list of well-known titles with the app's own
// importer (in memory), then saves them in the backup format (games, tracks, sources; no plays).
//
//   npx tsx scripts/build-demo.ts        (needs `npm run dev` running)
//
// Rerun it now and then: YouTube videos disappear over time.

import 'fake-indexeddb/auto';
import { writeFileSync } from 'node:fs';

(globalThis as { __MEDLEY_API_BASE__?: string }).__MEDLEY_API_BASE__ = process.env.MEDLEY_URL ?? 'http://localhost:32123';

const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/lib/catalog.ts');
const { autoAddGame } = await import('../src/lib/importer.ts');
const { kindOf } = await import('../src/lib/kinds.ts');

/** A spread across the three worlds: indie and blockbuster games, anime, films. */
const DEMO: [title: string, kind: string][] = [
  ['Hollow Knight', 'game'],
  ['Celeste', 'game'],
  ['Hades', 'game'],
  ['Undertale', 'game'],
  ['Stardew Valley', 'game'],
  ['Ori and the Blind Forest', 'game'],
  ['The Legend of Zelda: Breath of the Wild', 'game'],
  ['Persona 5', 'game'],
  ['Super Mario Odyssey', 'game'],
  ['Frieren: Beyond Journey’s End', 'anime'],
  ['Spy x Family', 'anime'],
  ['Attack on Titan', 'anime'],
  ['Moana', 'film'],
  ['Encanto', 'film'],
  ['Spider-Man: Across the Spider-Verse', 'film'],
];

const { games } = await loadCatalog();
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'");
for (const [title, kind] of DEMO) {
  const w = games.filter((g) => norm(g.title) === norm(title) && kindOf(g) === kind).sort((a, b) => b.pop - a.pop)[0];
  if (!w) {
    console.warn(`(not in the catalog: ${title})`);
    continue;
  }
  try {
    const r = await autoAddGame(w);
    console.log(`${w.title}: ${r.added} tracks from ${r.sourceTitle}`);
  } catch (e) {
    console.warn(`${w.title}: ${(e as Error).message}`);
  }
}

const [g, t, s] = await Promise.all([db.games.toArray(), db.tracks.toArray(), db.sources.toArray()]);
const out = new URL('../src/data/demo-library.json', import.meta.url);
writeFileSync(out, JSON.stringify({ version: 1, exportedAt: Date.now(), games: g, tracks: t, sources: s }));
console.log(`\n${g.length} titles, ${t.length} tracks → src/data/demo-library.json`);
process.exit(0);
