// Medley used to run on http://localhost:5173. Browser storage is per origin (host + port), so a
// library saved there is invisible on the new port. While the dev server runs, this tiny server
// keeps answering on the old port:
//   /__medley/transfer   a page that reads the old origin's library and settings and hands them
//                        to the new origin via postMessage (picked up by src/lib/originTransfer.ts,
//                        which loads it in a hidden iframe; same-site, so storage isn't partitioned)
//   anything else        redirects to the same path on the new port (old bookmarks keep working)
// If the old port is taken, it quietly does nothing.

import { createServer } from 'node:http';

export const LEGACY_PORT = 5173;

const page = (newOrigin: string) => `<!doctype html>
<meta charset="utf-8">
<title>Medley transfer</title>
<script>
const NEW_ORIGIN = ${JSON.stringify(newOrigin)};
const TABLES = ['games', 'tracks', 'sources', 'plays', 'meta'];

function readDb(name) {
  return new Promise((resolve) => {
    const req = indexedDB.open(name);
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      const tables = TABLES.filter((t) => db.objectStoreNames.contains(t));
      if (!tables.length) return db.close(), resolve(null);
      const tx = db.transaction(tables, 'readonly');
      const out = {};
      for (const t of tables) tx.objectStore(t).getAll().onsuccess = (e) => (out[t] = e.target.result);
      tx.oncomplete = () => (db.close(), resolve(out));
      tx.onerror = () => (db.close(), resolve(null));
    };
  });
}

async function collect() {
  // Only open databases that exist (opening a missing one would create it).
  const names = new Set((await indexedDB.databases()).map((d) => d.name));
  const libs = [];
  for (const name of ['medley', 'vgm-shuffle']) if (names.has(name)) libs.push(await readDb(name));
  const library = libs.filter((l) => l && l.games && l.games.length).sort((a, b) => b.games.length - a.games.length)[0] ?? null;
  const settings = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    const m = /^(medley|vgm-shuffle):(.+)$/.exec(k);
    if (m && !(m[2] in settings && m[1] === 'vgm-shuffle')) settings[m[2]] = localStorage.getItem(k);
  }
  return { library, settings };
}

addEventListener('message', async (e) => {
  if (e.origin !== NEW_ORIGIN || e.data?.type !== 'medley:transfer-request') return;
  e.source.postMessage({ type: 'medley:transfer', ...(await collect()) }, NEW_ORIGIN);
});
parent.postMessage({ type: 'medley:transfer-ready' }, NEW_ORIGIN);
</script>`;

export function startLegacyOrigin(newPort: number, log: (m: string) => void) {
  if (newPort === LEGACY_PORT) return;
  const newOrigin = `http://localhost:${newPort}`;
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/__medley/transfer')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      // Only the new Medley may frame this page.
      res.setHeader('Content-Security-Policy', `frame-ancestors ${newOrigin}; default-src 'none'; script-src 'unsafe-inline'`);
      return res.end(page(newOrigin));
    }
    res.writeHead(302, { Location: `${newOrigin}${req.url ?? '/'}` });
    res.end();
  });
  server.on('error', () => log(`port ${LEGACY_PORT} is in use; skipping the old-address hand-over`));
  server.listen(LEGACY_PORT, 'localhost', () => log(`old address :${LEGACY_PORT} redirects here and hands over its library`));
  return server;
}
