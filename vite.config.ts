import { defineConfig } from 'vite';
import { alphaTab } from '@coderline/alphatab-vite';

// base './' damit die Seite unter https://<user>.github.io/<repo>/ funktioniert
export default defineConfig({
  base: './',
  plugins: [alphaTab()],
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  worker: { format: 'es' },
});
