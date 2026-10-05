import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { medleyApi } from './server/plugin.ts';

// Optional CDN for the hashed build assets (JS, CSS, the catalogs), e.g.
//   MEDLEY_ASSET_URL=https://cdn.example.com/medley/ npm run build
// then upload dist/assets/ to that location (see docs/hosting.md). index.html, the manifest and
// icons stay on the app's own origin (the manifest must be same-origin to be installable).
const assetUrl = process.env.MEDLEY_ASSET_URL?.replace(/\/?$/, '/');

export default defineConfig({
  plugins: [react(), medleyApi()],
  // 32123: the logo's bar heights. strictPort, because browser storage is per port: drifting
  // to another port would look like an empty library.
  server: { port: 32123, strictPort: true },
  // The catalogs are large lazily loaded chunks (served compressed: ~1.5 MB total).
  build: { chunkSizeWarningLimit: 4000 },
  experimental: assetUrl
    ? { renderBuiltUrl: (filename, { type }) => (type === 'public' ? `/${filename}` : `${assetUrl}${filename}`) }
    : undefined,
});
