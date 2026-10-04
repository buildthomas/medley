// Medley companion: a small always-on-top window showing what Medley is playing, with
// play/pause, previous, next and like. It talks to the Medley server's relay
// (server/remote.ts) over plain HTTP: server-sent events in, small POSTs out. All networking
// happens here in the main process; the window itself has no network or Node access.
//
//   npm run companion                         (from the repo root; first: npm run companion:install)
//   npm run companion -- --connect=<code>     (code from Medley → Add link → Desktop companion)
//
// Dev flags: --demo (fake track, no server), --screenshot=<file.png> (capture and quit).

import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}`))?.split('=').slice(1).join('=') ?? null;
const hasFlag = (name) => process.argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const DEMO = hasFlag('demo');
const COMMANDS = new Set(['toggle', 'next', 'prev', 'like']);
const KEY = /^[A-Za-z0-9_-]{20,64}$/;

// ---- settings (in the OS's app-data folder, never next to the code) -------------------------
// MEDLEY_COMPANION_PROFILE=<dir> keeps a separate profile (e.g. one per Medley server).
if (process.env.MEDLEY_COMPANION_PROFILE) app.setPath('userData', process.env.MEDLEY_COMPANION_PROFILE);
const configFile = () => join(app.getPath('userData'), 'companion.json');
let config = { url: null, key: null, onTop: true, x: null, y: null };
function loadConfig() {
  try {
    if (existsSync(configFile())) config = { ...config, ...JSON.parse(readFileSync(configFile(), 'utf8')) };
  } catch {
    /* start fresh */
  }
}
const saveConfig = () => writeFileSync(configFile(), JSON.stringify(config, null, 2));

/** "http://localhost:5173#k3y…" → { url, key }, or null. */
function parseCode(code) {
  const [url, key] = String(code ?? '').trim().split('#');
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol) || !KEY.test(key ?? '')) return null;
    return { url: u.origin, key };
  } catch {
    return null;
  }
}

// ---- window & tray -----------------------------------------------------------------------------
let win = null;
let tray = null;
const icon = nativeImage.createFromPath(join(here, 'icon.png'));
const send = (channel, data) => win?.webContents.send(channel, data);

function createWindow() {
  win = new BrowserWindow({
    width: 420,
    height: 124,
    ...(config.x != null && config.y != null ? { x: config.x, y: config.y } : {}),
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: config.onTop,
    backgroundColor: '#14111d',
    title: 'Medley',
    icon,
    show: false,
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.setAlwaysOnTop(config.onTop, 'floating');
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(join(here, 'index.html'));
  win.once('ready-to-show', () => {
    if (!hasFlag('screenshot')) win.show();
  });
  win.on('moved', () => {
    [config.x, config.y] = win.getPosition();
    saveConfig();
  });
  win.on('closed', () => (win = null));
  win.webContents.on('did-finish-load', () => {
    send('pinned', config.onTop);
    const shot = flag('screenshot');
    if (shot)
      setTimeout(async () => {
        writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
        app.quit();
      }, 2000);
    if (DEMO) return demo();
    connect();
  });
}

function setOnTop(on) {
  config.onTop = on;
  saveConfig();
  win?.setAlwaysOnTop(on, 'floating');
  send('pinned', on);
  buildTrayMenu();
}

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: win?.isVisible() ? 'Hide' : 'Show', click: () => (win?.isVisible() ? win.hide() : win?.show()) },
      { label: 'Always on top', type: 'checkbox', checked: config.onTop, click: (i) => setOnTop(i.checked) },
      { type: 'separator' },
      { label: 'Open Medley', enabled: !!config.url, click: () => config.url && shell.openExternal(config.url) },
      { label: 'Change connection…', click: () => { win?.show(); send('status', { state: 'setup', url: config.url }); } },
      { type: 'separator' },
      { label: 'Quit', role: 'quit' },
    ]),
  );
}

// ---- connection to the relay -------------------------------------------------------------------
let controller = null;
let backoff = 1000;
let retryTimer = null;

async function connect() {
  controller?.abort();
  clearTimeout(retryTimer);
  if (!config.url || !config.key) return send('status', { state: 'setup', url: config.url });
  const ctl = (controller = new AbortController());
  send('status', { state: 'connecting', url: config.url });
  try {
    const res = await fetch(`${config.url}/api/remote/events?role=companion&key=${encodeURIComponent(config.key)}`, {
      signal: ctl.signal,
      headers: { Accept: 'text/event-stream' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    send('status', { state: 'connected', url: config.url });
    backoff = 1000;
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value.replace(/\r\n/g, '\n');
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        let name = 'message';
        const data = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) name = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        }
        if (!data.length) continue;
        try {
          if (name === 'state') send('state', JSON.parse(data.join('\n')));
          else if (name === 'presence') send('presence', JSON.parse(data.join('\n')));
        } catch {
          /* ignore a malformed event */
        }
      }
    }
    throw new Error('Connection closed');
  } catch (e) {
    if (ctl.signal.aborted) return;
    send('status', { state: 'offline', url: config.url, error: e.cause?.code ?? e.message });
    retryTimer = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30_000);
  }
}

async function command(cmd) {
  if (!COMMANDS.has(cmd)) return { ok: false };
  if (DEMO) return { ok: true };
  if (!config.url || !config.key) return { ok: false, error: 'Not connected' };
  try {
    const res = await fetch(`${config.url}/api/remote/command?key=${encodeURIComponent(config.key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd }),
    });
    const { apps } = await res.json();
    return { ok: res.ok && apps > 0, error: apps ? undefined : 'Medley isn’t open in a browser' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function demo() {
  send('status', { state: 'connected', url: 'http://localhost:5173' });
  send('presence', { apps: 1 });
  send('state', {
    title: 'Bonka Bonka',
    work: 'Egg Hunt 2018: The Great Yolktales',
    kind: 'game',
    artist: null,
    cover: null,
    playing: true,
    liked: true,
    position: 42,
    at: Date.now(),
    length: 116,
    next: 'Time to Fly · Egg Hunt 2018',
  });
}

// ---- app lifecycle -----------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_e, argv) => {
    const code = argv.find((a) => a.startsWith('--connect='))?.slice(10);
    const parsed = code && parseCode(code);
    if (parsed) {
      Object.assign(config, parsed);
      saveConfig();
      connect();
    }
    win?.show();
    win?.focus();
  });

  app.whenReady().then(() => {
    loadConfig();
    const parsed = parseCode(flag('connect'));
    if (parsed) {
      Object.assign(config, parsed);
      saveConfig();
    }
    ipcMain.handle('command', (_e, cmd) => command(cmd));
    ipcMain.handle('connect', (_e, code) => {
      const p = parseCode(code);
      if (!p) return { ok: false, error: 'That doesn’t look like a Medley connection code.' };
      Object.assign(config, p);
      saveConfig();
      connect();
      buildTrayMenu();
      return { ok: true };
    });
    ipcMain.on('window', (_e, action) => {
      if (action === 'minimize') win?.minimize();
      else if (action === 'close') app.quit();
      else if (action === 'pin') setOnTop(!config.onTop);
      else if (action === 'open' && config.url) shell.openExternal(config.url);
      else if (action === 'setup') send('status', { state: 'setup', url: config.url });
      else if (action === 'reconnect') connect();
    });

    createWindow();
    if (!DEMO) {
      tray = new Tray(icon.resize({ width: 16, height: 16 }));
      tray.setToolTip('Medley');
      tray.on('click', () => (win?.isVisible() ? win.focus() : win?.show()));
      buildTrayMenu();
    }
  });
  app.on('window-all-closed', () => app.quit());
}
