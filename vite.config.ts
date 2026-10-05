import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { medleyApi } from './server/plugin.ts';

export default defineConfig({
  plugins: [react(), medleyApi()],
  // 32123: the logo's bar heights. strictPort, because browser storage is per port: drifting
  // to another port would look like an empty library.
  server: { port: 32123, strictPort: true },
  // The game catalog (~600 KB) is its own lazily loaded chunk.
  build: { chunkSizeWarningLimit: 800 },
});
