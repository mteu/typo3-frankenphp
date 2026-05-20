import {test as setup, expect} from '@playwright/test';
import path from 'node:path';

const BASE_URL = process.env.TYPO3_BASE_URL ?? 'https://localhost:8885';
// Reuse the canonical env-var names from `vendor/bin/typo3 setup --help`
// so a single export covers both `scripts/setup-typo3.sh` and these tests.
const USER = process.env.TYPO3_SETUP_ADMIN_USERNAME ?? 'admin';
const PASS = process.env.TYPO3_SETUP_ADMIN_PASSWORD ?? 'Password.1';

export const ADMIN_STORAGE = path.resolve(__dirname, '..', 'playwright', '.auth', 'admin.json');

setup('authenticate as admin', async ({page}) => {
    await page.goto(`${BASE_URL}/typo3/`);
    await page.locator('input[name="username"]').fill(USER);
    await page.locator('input[name="p_field"]').fill(PASS);
    // Click the submit button so the TYPO3 login JS handler runs (it copies
    // p_field into the hidden userident field, then submits). Submitting
    // the form directly via JS skips the handler and posts userident empty.
    await page.locator('#t3-login-submit').click();
    // TYPO3 redirects post-login either through /typo3/main (with a redirect
    // query) to the user's last-opened module (/typo3/module/…), or
    // straight to /typo3/module/… — match either.
    await page.waitForURL(/\/typo3\/(main|module)/, {timeout: 15_000});
    // Cheap sanity check before persisting state — fail loudly if we're
    // somehow still on the login page despite the redirect.
    await expect(page).not.toHaveURL(/\/typo3\/login/);
    await page.context().storageState({path: ADMIN_STORAGE});
});
