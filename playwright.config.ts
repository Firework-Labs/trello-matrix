import { defineConfig } from '@playwright/test';

const PORT = 5173;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}/trello-matrix/`,
    viewport: { width: 1400, height: 850 },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/trello-matrix/dev.html`,
    reuseExistingServer: !process.env.CI,
  },
});
