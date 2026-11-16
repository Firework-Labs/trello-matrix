import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { buildInputs } from './build-inputs.ts';

export default defineConfig(({ mode }) => ({
  test: { include: ['tests/**/*.test.ts'] },   // e2e/*.spec.ts belongs to Playwright
  base: process.env.VITE_BASE ?? '/trello-matrix/',
  build: {
    rollupOptions: {
      // proof.html is part of the site only when the build is made with VITE_PROOF=1 (see build-inputs.ts).
      input: buildInputs(import.meta.dirname, loadEnv(mode, import.meta.dirname, 'VITE_')),
    },
  },
}));
