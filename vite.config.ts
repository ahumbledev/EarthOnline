import { defineConfig } from 'vite';
import { minigameInternalPlugin } from './scripts/vite-minigames.mjs';
export default defineConfig({
  plugins: [minigameInternalPlugin()],
  server: { proxy: { '/presence': { target: 'ws://127.0.0.1:4174', ws: true } } },
  preview: { proxy: { '/presence': { target: 'ws://127.0.0.1:4174', ws: true } } },
  build: { target: 'es2022' },
});
