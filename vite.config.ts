import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] },   // e2e/*.spec.ts belongs to Playwright
  base: process.env.VITE_BASE ?? '/trello-matrix/',
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        matrix: resolve(import.meta.dirname, 'matrix.html'),
        'oauth-callback': resolve(import.meta.dirname, 'oauth-callback.html'),
        proof: resolve(import.meta.dirname, 'proof.html'),
        dev: resolve(import.meta.dirname, 'dev.html'),
      },
    },
  },
});
