// Enrich the bundled catalog in place (tags, franchise, keywords, covers, store links).
//   node scripts/enrich-catalog.mjs [--limit N] [--out file]
// (npm run catalog already enriches; this re-runs only the enrichment on the existing catalog.)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { enrichGames } from './enrich.mjs';

const args = process.argv.slice(2);
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : new URL('../src/data/catalog.json', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
const games = Number.isFinite(limit) ? catalog.slice(0, limit) : catalog;
await enrichGames(games, { cacheFile: fileURLToPath(new URL('../data/cache/steamspy-tags.json', import.meta.url)) });
writeFileSync(out, JSON.stringify(games));
console.log(`Wrote ${games.length} games → ${out}`);
