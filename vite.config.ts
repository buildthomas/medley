import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { youtubeApi } from './server/plugin.ts';

export default defineConfig({
  plugins: [react(), youtubeApi()],
  server: { port: 5173 },
  // The game catalog (~600 KB) is its own lazily loaded chunk.
  build: { chunkSizeWarningLimit: 800 },
});
