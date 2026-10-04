// npm run catalog: rebuild the bundled catalog and collections in src/data/.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from './catalog-builder.mjs';

const { catalog, collections } = await buildCatalog({
  cacheFile: fileURLToPath(new URL('../data/cache/steamspy-tags.json', import.meta.url)),
});
writeFileSync(new URL('../src/data/catalog.json', import.meta.url), JSON.stringify(catalog));
writeFileSync(new URL('../src/data/collections.json', import.meta.url), JSON.stringify(collections));
console.log(`Wrote ${catalog.length} games to src/data/catalog.json`);
for (const g of collections.groups)
  console.log(`  ${g.title}: ${g.lists.map((l) => `${l.title} ${l.ids.length}`).join(', ')}`);
