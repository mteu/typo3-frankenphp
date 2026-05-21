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
  /* Retry up to 2× both locally and on CI. With workers > 1 the dev
   * sandbox sees concurrent TYPO3 session mutation across browser
   * projects (chromium / firefox / webkit all reuse the same admin
   * storageState, so they share one server-side session and clobber each
   * other's UC for "last selected sub-view" in modules like Page
   * TSconfig). 2 retries gets the flaky tests across without masking
   * deterministic breakage. */
  retries: 2,
  /* Parallel workers — one per browser project (chromium / firefox /
   * webkit) so each browser's specs run serially against the shared
   * 2-worker FrankenPHP / SQLite backend. workers > 3 saturates the
   * backend (page-tree fetchData queues > 90 s); workers < 3 forces
   * cross-browser serialization for no benefit. Override with
   * `--workers=N` if your stack tolerates more (or needs less). */
  workers: 3,
  /* Per-assertion timeout. Default 5 s is too tight under concurrent
   * iframe-heavy load — backend navigations queue at FrankenPHP's
   * 2-worker pool. 15 s eliminates spurious "element not found" flakes
   * without masking real bugs. */
  expect: {timeout: 15_000},
  /* Per-test overall timeout. Default 30 s is also too tight under
   * workers > 1: each iframe-heavy spec does many sequential nav steps
   * and the queue depth grows with concurrency. 90 s gives the slowest
   * specs (backend-smoke iterates every module) headroom; genuinely
   * hung tests still fail loudly. */
  timeout: 90_000,
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
