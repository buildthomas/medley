// Navigation between Medley's pages (see docs/ux.md for the model).
//
// Tabs (Discover, Listen, Library, Add link, Home) are the base. On top of any tab, the title
// page and the track page open as overlays that stack: a track page over its title's page, a
// title page over a track. The stack lives in the URL (?open=title:Q123|track:abc) with real
// history entries, so the browser's back button (and Android's) closes the top page and every
// page can be linked to.
//
//   openTitle(id)            a game, anime, film, series or artist
//   openTrack(id)            one track in the library
//   openTag(kind, value)     Discover, filtered by a composer, studio, genre, series, …
//   goTab(tab)               switch tab (closes overlays)

import { useSyncExternalStore } from 'react';
import { requestDiscover } from './intents';

export type Page = { type: 'title'; id: string } | { type: 'track'; id: string };
export type Tab = 'home' | 'discover' | 'listen' | 'library' | 'add';

const PARAM = 'open';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function parse(search: string): Page[] {
  const raw = new URLSearchParams(search).get(PARAM);
  if (!raw) return [];
  return raw
    .split('|')
    .map((part) => {
      const i = part.indexOf(':');
      const type = part.slice(0, i);
      const id = part.slice(i + 1);
      return (type === 'title' || type === 'track') && id ? ({ type, id } as Page) : null;
    })
    .filter((p): p is Page => !!p);
}

function urlFor(pages: Page[]) {
  const p = new URLSearchParams(location.search);
  if (pages.length) p.set(PARAM, pages.map((x) => `${x.type}:${x.id}`).join('|'));
  else p.delete(PARAM);
  const qs = p.toString();
  return `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`;
}

let stack: Page[] = typeof location === 'undefined' ? [] : parse(location.search);
let pushed = 0; // history entries we added (so closing can go back instead of piling up)

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    stack = parse(location.search);
    pushed = Math.max(0, Math.min(pushed - 1, stack.length));
    emit();
  });
}

function push(page: Page) {
  const top = stack.at(-1);
  if (top && top.type === page.type && top.id === page.id) return;
  // Opening a page that's already further down the stack goes back to it instead of looping.
  const existing = stack.findIndex((p) => p.type === page.type && p.id === page.id);
  stack = existing >= 0 ? stack.slice(0, existing + 1) : [...stack, page];
  history.pushState(null, '', urlFor(stack));
  pushed++;
  emit();
}

export const openTitle = (id: string) => push({ type: 'title', id });
export const openTrack = (id: string) => push({ type: 'track', id });

/** Close the top page (like the back button). */
export function closeTop() {
  if (!stack.length) return;
  if (pushed > 0) history.back(); // popstate updates the stack
  else {
    stack = stack.slice(0, -1);
    history.replaceState(null, '', urlFor(stack));
    emit();
  }
}

/** Close every overlay (switching tabs, following a tag). */
export function closeAll() {
  if (!stack.length) return;
  stack = [];
  history.replaceState(null, '', urlFor(stack));
  pushed = 0;
  emit();
}

// The App registers how to switch tabs.
let tabHandler: ((tab: Tab) => void) | null = null;
export const setTabHandler = (fn: (tab: Tab) => void) => {
  tabHandler = fn;
};
export function goTab(tab: Tab) {
  closeAll();
  tabHandler?.(tab);
}

/** Discover, filtered by a tag (composer, studio, genre, franchise, keyword, …). */
export function openTag(kind: string, value: string) {
  requestDiscover(value, [], { kind, value });
  goTab('discover');
}

export function usePages(): Page[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => stack,
  );
}
