import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.journey.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15 * 60 * 1000,
  expect: { timeout: 60 * 1000 },
  reporter: 'list',
  outputDir: './test-results/first-journey',
  preserveOutput: 'never',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    headless: true,
    screenshot: 'off',
    video: 'off',
    trace: 'off',
  },
});
