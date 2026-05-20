# Playwright tests

End-to-end tests against the FrankenPHP dev sandbox at `Build/`.

## Prerequisites

1. The dev sandbox must be set up: `scripts/setup-typo3.sh` (from the repo root).
2. FrankenPHP must be running and reachable at `https://localhost:8885/`:
   ```
   cd Build && frankenphp run -c Caddyfile -e .env
   ```
3. First-time only — install Node deps and Playwright's browser binaries:
   ```
   cd Tests && npm install && npm run test:install
   ```

## Run

From `Tests/`:

| Command                 | What it does                                             |
|-------------------------|----------------------------------------------------------|
| `npm test`              | All tests in all 3 browsers (chromium, firefox, webkit). |
| `npm run test:chromium` | Just chromium — fastest feedback loop.                   |
| `npm run test:ui`       | Playwright UI mode: watch, time-travel, picker.          |
| `npm run test:headed`   | Visible browser windows.                                 |
| `npm run test:debug`    | Playwright Inspector — step through.                     |
| `npm run test:report`   | Open the last HTML report.                               |
| `npm run test:codegen`  | Open Playwright Codegen, already logged in at `/typo3/main` — record actions to scaffold a new spec. Requires `playwright/.auth/admin.json` (run `npm test` once if missing). |

All flags pass through, e.g. `npm test -- --grep "backend"`.

## Auth state

`e2e/auth.setup.ts` is a `setup` project that logs in once via the TYPO3
login form at `/typo3/` and persists session cookies + localStorage to
`playwright/.auth/admin.json`. Every browser project depends on `setup` and
loads that file via `storageState`, so every test starts already
authenticated — just `await page.goto('/typo3/main')`.

The state file is reused across runs. To force a fresh login (e.g. after
changing the admin password), delete it:

```
rm -rf playwright/.auth/
```

## Environment overrides

These default to values matching `scripts/setup-typo3.sh`:

| Variable | Default | Used by |
| --- | --- | --- |
| `TYPO3_BASE_URL` | `https://localhost:8885` | `playwright.config.ts` `baseURL`, `auth.setup.ts` |
| `TYPO3_SETUP_ADMIN_USERNAME` | `admin` | `auth.setup.ts` |
| `TYPO3_SETUP_ADMIN_PASSWORD` | `Password.1` | `auth.setup.ts` |

The admin-username/password env-var names mirror those documented by
`vendor/bin/typo3 setup --help`, so a single export covers both the setup
script and these tests.

## Adding tests

Drop new specs into `e2e/`, importing from `@playwright/test`:

```ts
import {test, expect} from '@playwright/test';

test('something useful', async ({page}) => {
    await page.goto('/typo3/main');
    // ...
});
```

The shared `storageState` from `playwright.config.ts` means you don't need
to log in manually. Reference `e2e/backend-smoke.spec.ts` as a template.
