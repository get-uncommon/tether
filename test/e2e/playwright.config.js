// Real-browser tests: the Astro starter (examples/astro) against Shopify's public demo store.
// npm run e2e   (builds the starter with this checkout of Tether, then runs Chromium, WebKit, Firefox, phone)
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 45000,
  // The demo store's cart API fails now and then for a moment: in CI a failed test runs once more, in a fresh browser
  // context, and a pass on that retry is reported as flaky (the list reporter names it), not hidden. A real bug fails
  // both runs.
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['github']] : 'list',
  use: { baseURL: 'http://127.0.0.1:4399', trace: 'retain-on-failure' },
  webServer: {
    command: 'node test/e2e/serve.mjs',
    url: 'http://127.0.0.1:4399/',
    reuseExistingServer: !process.env['CI'],
    cwd: '../..',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'phone', use: { ...devices['iPhone 14'] } },
  ],
});
