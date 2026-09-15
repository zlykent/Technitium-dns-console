import { defineConfig, devices } from '@playwright/test'
import { E2E, E2E_PORT } from './tests/e2e/env'

/**
 * E2E configuration.
 *
 * The suite drives a production build of this console against a *real*
 * Technitium server, which dictates most of what is below:
 *
 *  - `workers: 1` and `fullyParallel: false`. Two workers creating and deleting
 *    zones on the same server would interleave, and one spec's cleanup could
 *    remove another's fixture.
 *  - A `webServer` that starts `next start`. Testing the dev build would mean
 *    testing a bundler configuration nobody ships.
 *  - `globalSetup`/`globalTeardown` for a single login and for sweeping
 *    `e2e-*` zones the run may have orphaned.
 *
 * Run `pnpm build` first; `next start` refuses to serve a missing `.next`.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts$/,
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',

  use: {
    baseURL: E2E.baseUrl,
    storageState: E2E.storageState,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Engine coverage without paying for it twice: the smoke pass over every
      // route is where a Gecko-specific layout or storage difference shows up.
      name: 'firefox-smoke',
      use: { ...devices['Desktop Firefox'] },
      testMatch: /navigation\.spec\.ts$/,
    },
  ],

  webServer: {
    command: `pnpm exec next start -p ${E2E_PORT}`,
    url: E2E.baseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    // The login page seeds #server from TECHNITIUM_API_URL (.env.local), while
    // the suite authenticates against E2E_DNS_URL. Point the app under test at
    // the same server or the two disagree the moment E2E_DNS_URL is overridden.
    env: { TECHNITIUM_API_URL: E2E.dnsUrl },
  },
})
