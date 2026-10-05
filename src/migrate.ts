// One-time move from the pre-Medley storage names, so an existing library and settings carry
// over after the rename: IndexedDB "vgm-shuffle" → "medley", localStorage "vgm-shuffle:*" →
// "medley:*". Runs before the app renders (main.tsx). The old copies are left in place as a
// backup; nothing is deleted.

import Dexie from 'dexie';
import { db, defineSchema } from './db';

const LEGACY = 'vgm-shuffle';
const DONE_KEY = 'medley:migrated';
const TABLES = ['games', 'tracks', 'sources', 'plays', 'meta'] as const;

function migrateSettings() {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(`${LEGACY}:`)) keys.push(k);
  }
  for (const k of keys) {
    const next = `medley:${k.slice(LEGACY.length + 1)}`;
    if (localStorage.getItem(next) == null) localStorage.setItem(next, localStorage.getItem(k)!);
  }
}

async function migrateLibrary() {
  if (!(await Dexie.exists(LEGACY))) return;
  if (await db.games.count()) return; // the new database already has a library
  const old = new Dexie(LEGACY);
  defineSchema(old);
  try {
    const rows = await Promise.all(TABLES.map((t) => old.table(t).toArray()));
    // All or nothing, so an interrupted copy is simply redone on the next load.
    await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
      for (const [i, t] of TABLES.entries()) await db.table(t).bulkPut(rows[i]);
    });
    console.info(`Medley: moved your library (${rows[0].length} titles, ${rows[1].length} tracks) to the new storage.`);
  } finally {
    old.close();
  }
}

export async function migrateLegacyStorage() {
  let done = false;
  try {
    done = !!localStorage.getItem(DONE_KEY);
    if (!done) migrateSettings();
  } catch {
    /* storage unavailable: still try the library */
  }
  if (done) return;
  await migrateLibrary();
  try {
    localStorage.setItem(DONE_KEY, '1');
  } catch {
    /* fine: the library check is cheap and idempotent */
  }
}
