// Dev server integration: serves /api/* (server/api.ts) from `npm run dev`. Production uses
// server/serve.ts instead. Data and personal config live outside the repo (scripts/paths.mjs).

import { loadEnv, type Plugin } from 'vite';
import { medleyPaths } from '../scripts/paths.mjs';
import { createApi, type Handler } from './api.ts';
import { startLegacyOrigin } from './legacy-origin.ts';

export function medleyApi(): Plugin {
  let handle: Handler = (_req, _res, next) => next();
  const log = (m: string) => console.log(`[medley] ${m}`);
  return {
    name: 'medley-api',
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, '');
      const { dataDir, configDir } = medleyPaths({ log });
      log(`data: ${dataDir} · config: ${configDir}`);
      // Locally: no sign-in, refreshes run in this process.
      handle = createApi({ dataDir, configDir, steamKey: env.STEAM_API_KEY || process.env.STEAM_API_KEY, auth: false, refresh: 'inline' }).handle;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => handle(req, res, next));
      // The old address hands its library over (and redirects); closed with each restart.
      const legacy = startLegacyOrigin(server.config.server.port ?? 32123, log);
      server.httpServer?.once('close', () => legacy?.close());
    },
  };
}
