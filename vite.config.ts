import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: process.env.VITE_BASE ?? '/trello-matrix/',
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        matrix: resolve(import.meta.dirname, 'matrix.html'),
        proof: resolve(import.meta.dirname, 'proof.html'),
        dev: resolve(import.meta.dirname, 'dev.html'),
      },
    },
  },
});
