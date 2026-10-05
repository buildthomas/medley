// Try the importer on one title without touching your library: runs the app's own import code
// against an in-memory database and prints what it would add. Needs `npm run dev` running.
//
//   npx tsx scripts/try-import.ts import anime frieren
//   npx tsx scripts/try-import.ts import film "spider-man: across"
//   npx tsx scripts/try-import.ts candidates film moana      (ranked playlists + vocal share)
//   npx tsx scripts/try-import.ts songs anime chainsaw man   (each OP/ED's top YouTube candidates + scores)
//
// kind: game | film | series | anime | artist. The title is a case-insensitive substring;
// the most popular match wins.

import 'fake-indexeddb/auto';

const [mode, kind, ...rest] = process.argv.slice(2);
const query = rest.join(' ');
if (!['import', 'candidates', 'songs'].includes(mode) || !kind || !query) {
  console.log('Usage: npx tsx scripts/try-import.ts import|candidates|songs <kind> <title>');
  process.exit(1);
}
(globalThis as { __MEDLEY_API_BASE__?: string }).__MEDLEY_API_BASE__ = process.env.MEDLEY_URL ?? 'http://localhost:32123';

const { db } = await import('../src/db.ts');
const { loadCatalog } = await import('../src/lib/catalog.ts');
const { autoAddGame, draftFromLink, findCandidates } = await import('../src/lib/importer.ts');
const { normalize } = await import('../src/lib/parse.ts');

const { games } = await loadCatalog();
const work = games
  .filter((g) => (g.kind ?? 'game') === kind && normalize(g.title).includes(normalize(query)))
  .sort((a, b) => b.pop - a.pop)[0];
if (!work) {
  console.log(`No ${kind} matching “${query}” in the catalog.`);
  process.exit(1);
}
console.log(`${work.title} (${work.year ?? '?'}) · ${work.id}`);

if (mode === 'songs') {
  const { rankThemeVideos } = await import('../src/lib/importers/anime.ts');
  for (const theme of work.themes ?? []) {
    console.log(`
${theme.type}${theme.seq ?? ''} "${theme.song}" by ${theme.artists.join(', ')}`);
    try {
      for (const { hit, score } of (await rankThemeVideos(theme, work)).slice(0, 4))
        console.log(`  ${score.toFixed(1).padStart(6)} | ${hit.title} [${hit.channel}, ${hit.duration ?? '?'}s]`);
    } catch (e) {
      console.log(`  couldn't search: ${(e as Error).message}`);
    }
  }
} else if (mode === 'candidates') {
  for (const c of (await findCandidates(work)).slice(0, 8)) {
    const line = `${c.score.toFixed(1).padStart(5)} | ${c.hit.title} (${c.hit.videoCount ?? '?'} videos, ${c.hit.channel})`;
    try {
      const tracks = (await draftFromLink({ kind: 'playlist', id: c.hit.id }, work)).groups.flatMap((g) => g.tracks);
      console.log(`${line} · vocal ${tracks.filter((t) => t.vocal).length}/${tracks.length}`);
    } catch (e) {
      console.log(`${line} · couldn't read: ${(e as Error).message}`);
    }
  }
} else {
  const started = Date.now();
  const r = await autoAddGame(work);
  const tracks = await db.tracks.where('gameId').equals(work.id).toArray();
  console.log(`+${r.added} in ${Math.round((Date.now() - started) / 1000)}s from ${r.sourceTitle}`);
  for (const t of tracks)
    console.log(`  ${(t.role ?? '-').padEnd(6)}${String(t.seq ?? '').padEnd(3)}${t.vocal ? '♪' : ' '} ${t.title}${t.artist ? ` — ${t.artist}` : ''} [${t.duration ?? '?'}s]`);
  console.log(`${tracks.length} tracks, ${tracks.filter((t) => t.vocal).length} vocal`);
}
process.exit(0);
