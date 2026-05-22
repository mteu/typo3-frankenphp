import {test as setup, expect} from '@playwright/test';
import path from 'node:path';

// Strip a trailing slash once so `new URL('typo3/', BASE_URL)` doesn't
// produce `https://host//typo3/`. The default ends with `/` and the
// old `${BASE_URL}/typo3/` concatenation was double-slashing.
const BASE_URL = (process.env.TYPO3_BASE_URL ?? 'https://localhost:8885/').replace(/\/+$/, '');
// Reuse the canonical env-var names from `vendor/bin/typo3 setup --help`
// so a single export covers both `scripts/setup-typo3.sh` and these tests.
const USER = process.env.TYPO3_SETUP_ADMIN_USERNAME ?? 'admin';
const PASS = process.env.TYPO3_SETUP_ADMIN_PASSWORD ?? 'Password.1';

export const ADMIN_STORAGE = path.resolve(__dirname, '..', 'playwright', '.auth', 'admin.json');

setup('authenticate as admin', async ({page}) => {
    await page.goto(`${BASE_URL}/typo3/`);
    // Wait for the form's hidden __RequestToken before interacting. The
    // login JS handler that copies p_field → userident only attaches
    // once the form is parsed; clicking submit before the page is fully
    // ready posts an empty userident and the server replies with a
    // login-failed page that never redirects to /typo3/main.
    await page.locator('input[name="__RequestToken"]').waitFor({state: 'attached', timeout: 15_000});
    await page.locator('input[name="username"]').fill(USER);
    await page.locator('input[name="p_field"]').fill(PASS);
    // Click the submit button so the TYPO3 login JS handler runs (it copies
    // p_field into the hidden userident field, then submits). Submitting
    // the form directly via JS skips the handler and posts userident empty.
    await page.locator('#t3-login-submit').click();
    // TYPO3 redirects post-login either through /typo3/main (with a redirect
    // query) to the user's last-opened module (/typo3/module/…), or
    // straight to /typo3/module/… — match either. 30 s timeout (was 15 s)
    // gives a cold CI worker headroom; the local happy path hits in <2 s.
    try {
        await page.waitForURL(/\/typo3\/(main|module)/, {timeout: 30_000});
    } catch (err) {
        // Dump enough state to diagnose CI-only failures from the log,
        // without needing the trace.zip artifact. The three known
        // failure modes have distinct fingerprints:
        //   - CSRF state regression → "Validating the security token …"
        //   - Bad credentials / cookie not stored → "Login failed"
        //   - Worker crashed → 500 page / FrankenPHP error string
        const finalUrl = page.url();
        const bodyText = await page.locator('body').innerText().catch(() => '<no body>');
        const snippet = bodyText.slice(0, 800);
        console.error([
            '--- auth.setup login post-mortem ---',
            `final URL: ${finalUrl}`,
            `body (first 800 chars): ${snippet}`,
            `csrf-flash present: ${/Validating the security token of this form has failed/.test(bodyText)}`,
            `login-failed flash present: ${/Login failed/i.test(bodyText)}`,
            '------------------------------------',
        ].join('\n'));
        throw err;
    }
    // Cheap sanity check before persisting state — fail loudly if we're
    // somehow still on the login page despite the redirect.
    await expect(page).not.toHaveURL(/\/typo3\/login/);
    await page.context().storageState({path: ADMIN_STORAGE});
});
