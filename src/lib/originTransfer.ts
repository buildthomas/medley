// Picks up a library left behind at Medley's old address (http://localhost:5173) after the move
// to :32123. Browser storage is per origin, so the new address starts empty; the dev server
// still answers on the old port with a hand-over page (server/legacy-origin.ts) that we load in
// a hidden iframe. Runs once, before the app renders, only when this library is empty.

import { db } from '../db';

const OLD_ORIGIN = 'http://localhost:5173';
const DONE_KEY = 'medley:origin-transfer';
const TABLES = ['games', 'tracks', 'sources', 'plays', 'meta'] as const;

interface Payload {
  library: Partial<Record<(typeof TABLES)[number], unknown[]>> | null;
  settings: Record<string, string>;
}

function ask(timeoutMs: number): Promise<Payload | null> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.src = `${OLD_ORIGIN}/__medley/transfer`;
    const finish = (result: Payload | null) => {
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      frame.remove();
      resolve(result);
    };
    // Waiting for "ready" is short (the page is tiny); collecting a big library can take longer.
    let timer = setTimeout(() => finish(null), timeoutMs);
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== OLD_ORIGIN) return;
      if (e.data?.type === 'medley:transfer-ready') {
        clearTimeout(timer);
        timer = setTimeout(() => finish(null), 30_000);
        frame.contentWindow?.postMessage({ type: 'medley:transfer-request' }, OLD_ORIGIN);
      } else if (e.data?.type === 'medley:transfer') finish(e.data as Payload);
    };
    addEventListener('message', onMessage);
    document.body.appendChild(frame);
  });
}

export async function transferFromOldOrigin() {
  if (location.origin === OLD_ORIGIN || location.hostname !== 'localhost') return;
  try {
    if (localStorage.getItem(DONE_KEY)) return;
  } catch {
    return; // no storage to mark it done in: don't probe on every load
  }
  if (await db.games.count()) return localStorage.setItem(DONE_KEY, 'has-library');

  const payload = await ask(1500);
  if (!payload) return; // old address not being served right now; try again next time

  for (const [key, value] of Object.entries(payload.settings ?? {})) {
    if (localStorage.getItem(`medley:${key}`) == null) localStorage.setItem(`medley:${key}`, value);
  }
  const lib = payload.library;
  if (lib?.games?.length) {
    await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
      for (const t of TABLES) if (lib[t]?.length) await db.table(t).bulkPut(lib[t]!);
    });
    console.info(`Medley: brought over your library from ${OLD_ORIGIN} (${lib.games.length} titles).`);
  }
  localStorage.setItem(DONE_KEY, lib?.games?.length ? 'transferred' : 'nothing-to-transfer');
}
