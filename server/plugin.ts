// Dev server integration: serves /api/* (server/api.ts) from `npm run dev`. Production uses
// server/serve.ts instead. Data and personal config live outside the repo (scripts/paths.mjs).

import { loadEnv, type Plugin } from 'vite';
import { medleyPaths } from '../scripts/paths.mjs';
import { createApi, type Handler } from './api.ts';

export function medleyApi(): Plugin {
  let handle: Handler = (_req, _res, next) => next();
  return {
    name: 'medley-api',
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, '');
      const { dataDir, configDir } = medleyPaths({ log: (m) => console.log(`[medley] ${m}`) });
      console.log(`[medley] data: ${dataDir} · config: ${configDir}`);
      handle = createApi({ dataDir, configDir, steamKey: env.STEAM_API_KEY || process.env.STEAM_API_KEY }).handle;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => handle(req, res, next));
    },
  };
}
