// npm run catalog: rebuild the bundled catalogs in src/data/ (games, films & series, anime,
// artists, collections). `--only games,anime` limits it to some domains; the collections file
// keeps the other domains' groups from the previous build.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAll, keepMissingGroups } from './build-all.mjs';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : undefined;
const dir = new URL('../src/data/', import.meta.url);

const files = await buildAll({
  only,
  cacheFile: fileURLToPath(new URL('../data/cache/steamspy-tags.json', import.meta.url)),
});

// Domains skipped by --only (or that failed) keep their previous collection groups.
const prevFile = new URL('collections.json', dir);
keepMissingGroups(files, existsSync(prevFile) ? JSON.parse(readFileSync(prevFile, 'utf8')) : null);

for (const [name, data] of Object.entries(files)) {
  writeFileSync(new URL(`${name}.json`, dir), JSON.stringify(data));
  console.log(`Wrote src/data/${name}.json (${Array.isArray(data) ? `${data.length} entries` : `${data.groups.length} groups`})`);
}
