// Invite-only sign-in for a hosted Medley. Off unless configured, so `npm run dev` (and a local
// `npm run serve`) never ask for anything.
//
// Configure either or both:
//   <config dir>/invites.json   [{ "name": "Sam", "code": "long-random-code", "admin": true }, …]
//   MEDLEY_PASSWORD             one shared code (signs in as "guest")
//
// Signing in (POST /api/session { code }) sets an HttpOnly, signed cookie good for 180 days.
// Removing someone from invites.json, or changing their code, signs them out everywhere. The
// cookie is signed with MEDLEY_SECRET, or a random secret kept in the data dir.
//
// Only /api/* is gated: the page and its assets are public code (and can live on a CDN); what
// needs protecting is the server's API (YouTube reading, catalog refresh, personal config).

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

interface Invite {
  name: string;
  code: string;
  admin?: boolean;
}
export interface User {
  name: string;
  admin: boolean;
}

const COOKIE = 'medley_session';
const MAX_AGE = 180 * 24 * 60 * 60; // seconds
const sha256 = (s: string) => createHash('sha256').update(s).digest();
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export interface AuthOptions {
  configDir: string;
  dataDir: string;
  password?: string;
  secret?: string;
  /** Trust X-Forwarded-Proto / X-Forwarded-For from a reverse proxy. */
  trustProxy?: boolean;
  /** Never ask for sign-in (the dev server). */
  disabled?: boolean;
  log?: (m: string) => void;
}

export function createAuth(opts: AuthOptions) {
  const invitesFile = join(opts.configDir, 'invites.json');
  let cache: { mtime: number; invites: Invite[] } | null = null;

  /** Invites from the config dir (re-read when the file changes) plus the shared password. */
  function invites(): Invite[] {
    let fromFile: Invite[] = [];
    if (existsSync(invitesFile)) {
      const mtime = statSync(invitesFile).mtimeMs;
      if (!cache || cache.mtime !== mtime) {
        try {
          const raw = JSON.parse(readFileSync(invitesFile, 'utf8'));
          cache = { mtime, invites: (Array.isArray(raw) ? raw : []).filter((i) => i?.name && typeof i.code === 'string' && i.code.length >= 8) };
        } catch {
          opts.log?.(`${invitesFile} is not valid JSON; ignoring it`);
          cache = { mtime, invites: [] };
        }
      }
      fromFile = cache.invites;
    }
    return opts.password ? [...fromFile, { name: 'guest', code: opts.password }] : fromFile;
  }

  const enabled = () => !opts.disabled && invites().length > 0;

  // Signing secret: env, else generated once (when first needed) and kept private in the data dir.
  let secret: string | null = opts.secret ?? null;
  const getSecret = () => {
    if (secret) return secret;
    const file = join(opts.dataDir, 'session-secret');
    if (existsSync(file)) return (secret = readFileSync(file, 'utf8').trim());
    secret = randomBytes(32).toString('hex');
    writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  };
  const sign = (payload: string) => createHmac('sha256', getSecret()).update(payload).digest('base64url');
  // A short fingerprint of the invite's code: changing the code invalidates its sessions.
  const fingerprint = (code: string) => sha256(code).toString('base64url').slice(0, 10);

  function issue(res: ServerResponse, invite: Invite, secure: boolean) {
    const payload = b64url(JSON.stringify({ n: invite.name, f: fingerprint(invite.code), e: Date.now() + MAX_AGE * 1000 }));
    res.setHeader('Set-Cookie', `${COOKIE}=${payload}.${sign(payload)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
  }

  function userFrom(req: IncomingMessage): User | null {
    const raw = (req.headers.cookie ?? '')
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    if (!raw) return null;
    const [payload, sig] = raw.split('.');
    if (!payload || !sig) return null;
    const expected = Buffer.from(sign(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const { n, f, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (typeof e !== 'number' || e < Date.now()) return null;
      const invite = invites().find((i) => i.name === n && fingerprint(i.code) === f);
      return invite ? { name: invite.name, admin: !!invite.admin } : null;
    } catch {
      return null;
    }
  }

  const isSecure = (req: IncomingMessage) =>
    !!(req.socket as { encrypted?: boolean }).encrypted || (!!opts.trustProxy && req.headers['x-forwarded-proto'] === 'https');
  const clientIp = (req: IncomingMessage) =>
    (opts.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket.remoteAddress || '';

  // Sign-in attempts: 10 per 10 minutes per IP.
  const attempts = new Map<string, number[]>();
  function tooManyAttempts(ip: string) {
    const now = Date.now();
    const recent = (attempts.get(ip) ?? []).filter((t) => now - t < 10 * 60 * 1000);
    recent.push(now);
    attempts.set(ip, recent);
    if (attempts.size > 10_000) attempts.clear();
    return recent.length > 10;
  }

  function findInvite(code: string): Invite | null {
    const given = sha256(code);
    let match: Invite | null = null;
    for (const i of invites()) if (timingSafeEqual(sha256(i.code), given)) match = i; // check all: constant time
    return match;
  }

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (c: Buffer) => {
        body += c;
        if (body.length > 4096) req.destroy();
      });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  const json = (res: ServerResponse, code: number, data: unknown) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(data));
  };

  /**
   * Handles /api/session and gates the rest of /api/*. Returns the signed-in user (or a local
   * "owner" when sign-in is off), or null after answering the request itself.
   */
  async function gate(req: IncomingMessage, res: ServerResponse, path: string): Promise<User | null> {
    const on = enabled();
    if (path === '/api/session') {
      if (req.method === 'GET') {
        const user = on ? userFrom(req) : null;
        json(res, 200, { required: on, user: user?.name ?? null });
      } else if (req.method === 'POST') {
        if (!on) return json(res, 200, { required: false, user: null }), null;
        if (tooManyAttempts(clientIp(req))) return json(res, 429, { error: 'Too many attempts. Try again in a few minutes.' }), null;
        let code = '';
        try {
          code = String(JSON.parse(await readBody(req)).code ?? '');
        } catch {
          /* fall through: empty code */
        }
        const invite = code ? findInvite(code) : null;
        if (!invite) return json(res, 401, { error: 'That code didn’t work.' }), null;
        issue(res, invite, isSecure(req));
        opts.log?.(`signed in: ${invite.name}`);
        json(res, 200, { required: true, user: invite.name });
      } else if (req.method === 'DELETE') {
        res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
        json(res, 200, { ok: true });
      } else json(res, 405, { error: 'Method not allowed' });
      return null;
    }
    if (!on) return { name: 'owner', admin: true };
    const user = userFrom(req);
    if (!user) return json(res, 401, { error: 'Sign in required' }), null;
    return user;
  }

  return { gate, enabled, clientIp };
}

export type Auth = ReturnType<typeof createAuth>;
