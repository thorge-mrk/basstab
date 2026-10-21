import { defineConfig } from 'vite';
import { alphaTab } from '@coderline/alphatab-vite';
import { resolve } from 'node:path';

// base './' damit die Seite unter https://<user>.github.io/<repo>/ funktioniert
export default defineConfig({
  base: './',
  plugins: [alphaTab()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        tool: resolve(import.meta.dirname, 'tool/index.html'),
      },
    },
  },
  worker: { format: 'es' },
});
