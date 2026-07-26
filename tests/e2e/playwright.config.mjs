import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /current-safety-version\.spec\.mjs/,
  outputDir: '../../test-results/current-safety-version',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  retries: 1,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: '../../playwright-report/current-safety-version', open: 'never' }]
  ],
  use: {
    baseURL: process.env.BASELINE_URL || 'https://new-hub-artres.pages.dev',
    browserName: 'chromium',
    colorScheme: 'light',
    locale: 'pt-BR',
    timezoneId: 'America/Recife',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'desktop-1366',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1366, height: 768 }
      }
    },
    {
      name: 'mobile-390',
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        viewport: { width: 390, height: 844 }
      }
    }
  ]
});
