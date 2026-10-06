// Sign-in for a hosted, invite-only Medley (server/auth.ts). Locally the server reports that no
// sign-in is required and none of this shows. The session is an HttpOnly cookie, so the app
// only ever learns who's signed in, never the token.

import { useSyncExternalStore } from 'react';
import { PREVIEW } from './preview';

export interface AuthState {
  required: boolean;
  user: string | null;
}

let state: AuthState | null = null;
const listeners = new Set<() => void>();
const set = (next: AuthState) => {
  state = next;
  listeners.forEach((l) => l());
};

export async function checkAuth(): Promise<AuthState> {
  // The preview has no server, so nothing to sign in to.
  if (PREVIEW) return set({ required: false, user: null }), state!;
  try {
    const res = await fetch('/api/session', { cache: 'no-store' });
    if (res.ok) {
      set((await res.json()) as AuthState);
      return state!;
    }
  } catch {
    /* server unreachable: let the app load; its API calls will show errors */
  }
  set({ required: false, user: null });
  return state!;
}

export async function signIn(code: string): Promise<string | null> {
  const res = await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  }).catch(() => null);
  if (!res) return 'Can’t reach the server.';
  const body = (await res.json().catch(() => ({}))) as { error?: string; user?: string };
  if (!res.ok) return body.error ?? 'That code didn’t work.';
  set({ required: true, user: body.user ?? null });
  return null;
}

export async function signOut() {
  await fetch('/api/session', { method: 'DELETE' }).catch(() => null);
  location.reload();
}

export function useAuth() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
