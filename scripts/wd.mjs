// Small shared helpers for the catalog builders: Wikidata SPARQL, labels, Commons images.

/**
 * The User-Agent for every catalog request (Wikidata, Wikipedia, AniList, AnimeThemes, SteamSpy).
 * Wikimedia asks for a way to reach whoever runs a tool, so set MEDLEY_CONTACT (an email or URL,
 * in .env.local or medley.env) to add yours. Unset, requests carry no personal contact: the code
 * is public, and one person's details shouldn't go out with everyone else's builds.
 */
export function userAgent() {
  const contact = process.env.MEDLEY_CONTACT?.trim();
  return `medley/0.4 (self-hosted music radio; catalog build${contact ? `; ${contact}` : ''})`;
}
const ENDPOINT = 'https://query.wikidata.org/sparql';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function sparql(query, { log } = {}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json', 'User-Agent': userAgent() },
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

/** "https://…/Special:FilePath/Taylor%20Swift.jpg?width=400" or a Commons URL → "Taylor Swift.jpg". */
export const commonsFileName = (fileUrlOrName) =>
  decodeURIComponent(String(fileUrlOrName).split('?')[0].split('/').pop()).replace(/_/g, ' ');

const stripHtml = (s) =>
  String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Photographer and license for Commons files (free licenses usually require crediting both).
 * @param {string[]} files file names ("Taylor Swift.jpg")
 * @returns {Promise<Map<string, { author?: string, license?: string, licenseUrl?: string, source: string }>>}
 */
export async function commonsCredits(files, { log } = {}) {
  const out = new Map();
  const unique = [...new Set(files)];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      prop: 'imageinfo',
      iiprop: 'extmetadata',
      iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl',
      titles: batch.map((f) => `File:${f}`).join('|'),
    }).toString();
    let json = null;
    for (let attempt = 0; attempt < 5 && !json; attempt++) {
      const res = await fetch(url, { headers: { 'User-Agent': userAgent() } }).catch(() => null);
      if (res?.ok) json = await res.json().catch(() => null);
      else await sleep(2000 * (attempt + 1));
    }
    if (!json) {
      log?.(`  Commons credits: batch ${i / 50 + 1} failed, skipping`);
      continue;
    }
    // Commons normalises titles ("File:Taylor_swift.jpg" → "File:Taylor swift.jpg").
    const normalized = new Map((json.query?.normalized ?? []).map((n) => [n.to, n.from]));
    for (const page of json.query?.pages ?? []) {
      const meta = page.imageinfo?.[0]?.extmetadata;
      if (!meta) continue;
      const title = normalized.get(page.title) ?? page.title;
      const name = title.replace(/^File:/, '');
      out.set(name, {
        ...(meta.Artist?.value ? { author: stripHtml(meta.Artist.value).slice(0, 120) } : {}),
        ...(meta.LicenseShortName?.value ? { license: stripHtml(meta.LicenseShortName.value) } : {}),
        ...(meta.LicenseUrl?.value ? { licenseUrl: meta.LicenseUrl.value } : {}),
        source: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
      });
    }
    await sleep(300);
  }
  return out;
}

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
