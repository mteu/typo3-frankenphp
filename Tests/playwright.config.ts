import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  /* Tests within the same file run serially (each file is one TYPO3 backend
   * "user session" doing heavy iframe navigation). Files across projects
   * still parallelize via `workers` below. */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry once locally, twice on CI: the dev sandbox (SQLite + 2-worker
   * FrankenPHP) is genuinely flaky under sequential iframe-heavy load —
   * timeouts on page-tree fetchData / modulemenu hydration are environment
   * noise, not test bugs. */
  retries: process.env.CI ? 2 : 1,
  /* Cap workers at 1: the dev sandbox runs SQLite + 2-worker FrankenPHP.
   * Three browser projects hammering the backend in parallel (each driving
   * many iframe navigations) overloads the worker pool and produces flaky
   * results. Serial execution costs ~30 s for the full 3-browser suite,
   * which is fine for a dev loop; override with `--workers=N` if your
   * stack can handle more. */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL: process.env.TYPO3_BASE_URL ?? 'https://localhost:8885',
    // The dev server uses Caddy's `tls internal` (self-signed cert).
    ignoreHTTPSErrors: true,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    // Logs in once and persists session state to playwright/.auth/admin.json.
    // Browser projects below depend on this, so each test starts authenticated.
    // Concurrent logins against the dev sandbox (single admin user, 2-worker
    // FrankenPHP, SQLite session table) are unreliable — keep this serial.
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },

    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/admin.json' },
      dependencies: ['setup'],
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], storageState: 'playwright/.auth/admin.json' },
      dependencies: ['setup'],
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], storageState: 'playwright/.auth/admin.json' },
      dependencies: ['setup'],
    },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
