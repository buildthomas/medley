// Small shared helpers for the catalog builders: Wikidata SPARQL, labels, Commons images.

export const UA = 'medley/0.4 (personal hobby project; catalog build; https://github.com/buildthomas)';
const ENDPOINT = 'https://query.wikidata.org/sparql';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function sparql(query, { log } = {}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json', 'User-Agent': UA },
      body: new URLSearchParams({ query }),
    }).catch(() => null);
    if (res?.ok) {
      // A query that times out mid-stream still answers 200, with truncated JSON: retry it.
      try {
        return JSON.parse(await res.text()).results.bindings;
      } catch {
        log?.('  SPARQL response cut off (query timeout), retrying…');
        await sleep(3000 * (attempt + 1));
        continue;
      }
    }
    log?.(`  SPARQL ${res?.status ?? 'network error'}, retrying…`);
    await sleep(3000 * (attempt + 1));
  }
  throw new Error('SPARQL failed repeatedly');
}

export const qid = (uri) => uri.split('/').pop();
export const values = (ids) => ids.map((id) => 'wd:' + id).join(' ');

/** Bind `out` to the English label, falling back to the language-neutral "mul" label. */
export const label = (item, out) => `
      OPTIONAL { ${item} rdfs:label ${out}En FILTER(LANG(${out}En) = "en") }
      OPTIONAL { ${item} rdfs:label ${out}Mul FILTER(LANG(${out}Mul) = "mul") }
      BIND(COALESCE(${out}En, ${out}Mul) AS ${out})`;

/** Earliest date with its precision: returns YYYY-MM-DD (day), YYYY-MM (month) or null (year only). */
export function datePart(value, prec) {
  if (!value) return null;
  if (prec >= 11) return value.slice(0, 10);
  if (prec === 10) return value.slice(0, 7);
  return null;
}

/** Wikimedia Commons file → a ~400px thumbnail URL (free images, e.g. artist photos). */
export const commonsThumb = (fileUrlOrName) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
    decodeURIComponent(String(fileUrlOrName).split('/').pop()),
  )}?width=400`;

/** Fold granular labels into buckets: [[name, regex], …] applied to lower-cased labels. */
export function bucket(labels, buckets) {
  const out = new Set();
  for (const raw of labels) {
    const l = raw.toLowerCase();
    for (const [name, re] of buckets) if (re.test(l)) out.add(name);
  }
  return [...out];
}

/** Details for many items in batches: run `query(batchIds)` and feed rows to `onRow`. */
export async function inBatches(ids, size, query, onRow, { log, label: what = 'items' } = {}) {
  for (let i = 0; i < ids.length; i += size) {
    const batch = ids.slice(i, i + size);
    for (const r of await sparql(query(batch), { log })) onRow(r);
    if ((i / size) % 10 === 9) log?.(`  ${what} ${Math.min(i + size, ids.length)}/${ids.length}`);
  }
}
