// Real-browser tests: the Astro starter (examples/astro) against Shopify's public demo store.
// npm run e2e   (builds the starter with this checkout of Tether, then runs Chromium, WebKit, Firefox, phone)
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 45000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4399', trace: 'retain-on-failure' },
  webServer: { command: 'node e2e/serve.mjs', url: 'http://localhost:4399/', reuseExistingServer: !process.env.CI, cwd: '..' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'phone', use: { ...devices['iPhone 14'] } },
  ],
});
