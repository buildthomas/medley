// Relay between the web app (the player) and the desktop companion (companion/).
//
// Both sides know a random channel key (made by the app, shown as a connection code). The app
// publishes "now playing" state; companions receive it as server-sent events and send
// commands back (play/pause, next, previous, like), which the app receives as events too.
//
//   GET  /api/remote/events?key=&role=app|companion   SSE stream ("state" or "command" events)
//   POST /api/remote/state?key=     {…now playing}    app → companions; replies { companions }
//   POST /api/remote/command?key=   { cmd }           companion → app; replies { apps }
//
// Nothing is stored on disk; a channel lives in memory while someone's connected. The key is
// the only credential (128 bits), so these routes skip the site password (server/serve.ts).

import type { IncomingMessage, ServerResponse } from 'node:http';

const KEY = /^[A-Za-z0-9_-]{20,64}$/;
const COMMANDS = new Set(['toggle', 'play', 'pause', 'next', 'prev', 'like']);
const MAX_BODY = 16 * 1024;

interface Channel {
  state: string | null; // last published state, JSON
  apps: Set<ServerResponse>;
  companions: Set<ServerResponse>;
  touched: number;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const event = (res: ServerResponse, name: string, data: string) => res.write(`event: ${name}\ndata: ${data}\n\n`);

export function createRemote() {
  const channels = new Map<string, Channel>();
  const channel = (key: string) => {
    let c = channels.get(key);
    if (!c) channels.set(key, (c = { state: null, apps: new Set(), companions: new Set(), touched: Date.now() }));
    c.touched = Date.now();
    return c;
  };

  // Keep streams alive through proxies, and forget idle channels.
  setInterval(() => {
    for (const [key, c] of channels) {
      for (const res of [...c.apps, ...c.companions]) res.write(': ping\n\n');
      if (!c.apps.size && !c.companions.size && Date.now() - c.touched > 24 * 60 * 60 * 1000) channels.delete(key);
    }
  }, 25_000).unref();

  async function handle(req: IncomingMessage, res: ServerResponse, url: URL) {
    const json = (code: number, data: unknown) => {
      res.statusCode = code;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(data));
    };
    const key = url.searchParams.get('key') ?? '';
    if (!KEY.test(key)) return json(400, { error: 'Missing or malformed key' });
    const c = channel(key);

    try {
      switch (url.pathname) {
        case '/api/remote/events': {
          const role = url.searchParams.get('role') === 'app' ? 'app' : 'companion';
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-store',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no', // nginx: don't buffer the stream
          });
          res.write('retry: 3000\n\n');
          const set = role === 'app' ? c.apps : c.companions;
          set.add(res);
          if (role === 'companion') {
            event(res, 'state', c.state ?? 'null');
            // Ask the app for fresh state (position etc.) now that someone's watching.
            for (const app of c.apps) event(app, 'command', JSON.stringify({ cmd: 'hello' }));
          }
          for (const companion of c.companions) event(companion, 'presence', JSON.stringify({ apps: c.apps.size }));
          req.on('close', () => {
            set.delete(res);
            c.touched = Date.now();
            if (role === 'app') for (const companion of c.companions) event(companion, 'presence', JSON.stringify({ apps: c.apps.size }));
          });
          return;
        }
        case '/api/remote/state': {
          if (req.method !== 'POST') return json(405, { error: 'Use POST' });
          const body = await readBody(req);
          JSON.parse(body); // must be valid JSON
          c.state = body;
          for (const companion of c.companions) event(companion, 'state', body);
          return json(200, { companions: c.companions.size });
        }
        case '/api/remote/command': {
          if (req.method !== 'POST') return json(405, { error: 'Use POST' });
          const { cmd } = JSON.parse(await readBody(req)) as { cmd?: string };
          if (!cmd || !COMMANDS.has(cmd)) return json(400, { error: 'Unknown command' });
          for (const app of c.apps) event(app, 'command', JSON.stringify({ cmd }));
          return json(200, { apps: c.apps.size });
        }
        default:
          return json(404, { error: 'Unknown endpoint' });
      }
    } catch (e) {
      json(400, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { handle };
}
