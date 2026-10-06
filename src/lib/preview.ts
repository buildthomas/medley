// The GitHub Pages preview (`npm run build:pages`): the same app without its server. Browsing,
// the demo library and playback work; anything that reads YouTube (adding music, refreshes,
// playlist sync) needs the server and is off. Locally PREVIEW is false and nothing changes.

declare const __MEDLEY_PREVIEW__: boolean | undefined;

export const PREVIEW = typeof __MEDLEY_PREVIEW__ !== 'undefined' && __MEDLEY_PREVIEW__;

export const PREVIEW_ONLY_MESSAGE =
  'Adding music needs Medley’s own server, so it’s off in this preview. Install Medley to add anything you like.';

/** Where people install Medley from (the README's Get started). */
export const INSTALL_URL = 'https://github.com/buildthomas/medley#get-started';

/** The local install's address: where "Move to my local Medley" sends your preview library. */
export const LOCAL_ORIGIN = 'http://localhost:32123';

/**
 * The preview's first visit starts with a demo library (src/data/demo-library.json, built by
 * scripts/build-demo.ts), so there's music to play without a server. Once only: emptying the
 * library later doesn't bring it back.
 */
export async function seedDemoLibrary() {
  if (!PREVIEW) return;
  try {
    if (localStorage.getItem('medley:demo-seeded')) return;
    localStorage.setItem('medley:demo-seeded', '1');
  } catch {
    return;
  }
  const { db, importLibrary } = await import('../db');
  if (await db.games.count()) return;
  const { default: data } = await import('../data/demo-library.json');
  await importLibrary(JSON.stringify(data));
}
