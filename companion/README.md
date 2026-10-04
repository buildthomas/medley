# Medley companion

An always-on-top now-playing window for Medley: cover, title, what's next, progress, and
play/pause, back, skip, like. Electron, kept in its own folder so the web app has no desktop
dependencies.

```bash
npm install   # or, from the repo root: npm run companion:install
npm start     # or: npm run companion
```

Paste the connection code from Medley (**Add link → Desktop companion**) the first time.

- `main.mjs`: window, tray, settings, and all networking (SSE from `/api/remote/events`,
  POST `/api/remote/command`). See `server/remote.ts` for the relay.
- `preload.cjs`: the only bridge into the window (`window.medley`).
- `index.html`, `renderer.js`, `style.css`: the UI (no network, no Node; strict CSP).
- `make-icon.mjs`: draws `icon.png` from the logo geometry (`npm run icon`).

Flags: `--connect=<code>`, `--demo` (fake track, no server), `--screenshot=<file.png>` (capture
the window after 2 s and quit; handy for checking UI changes). `MEDLEY_COMPANION_PROFILE=<dir>`
uses a separate settings folder.
