import {test, expect} from '@playwright/test';

/**
 * The `?__typo3_install` recovery URL must route to per-request /index.php
 * (failsafe bootstrap that exposes InstallApplication), NOT through the
 * worker. The Caddyfile's @typo3_install matcher implements this; without
 * the matcher the worker would receive the request, fail to switch from
 * its always-on HttpApplication to a failsafe InstallApplication, and the
 * recovery path would be broken — defeating the project's documented escape
 * hatch for cases where the worker boot itself is broken.
 *
 * This test confirms the route still works by navigating an unauthenticated
 * context to /?__typo3_install and asserting the install tool's failsafe
 * page renders (either the enable-file form or the install-tool login).
 * Critically: this test uses storageState: undefined so the worker's
 * authenticated routes wouldn't apply anyway.
 */
test.use({storageState: {cookies: [], origins: []}});

test('?__typo3_install routes to per-request failsafe boot', async ({page}) => {
    test.setTimeout(60_000);
    await page.goto('/?__typo3_install');

    // The failsafe install tool serves one of two pages depending on whether
    // public/typo3conf/ENABLE_INSTALL_TOOL exists. Either is fine — both
    // prove the route landed on InstallApplication.
    await expect(
        page.getByText(
            /Install Tool|Create the file|ENABLE_INSTALL_TOOL|password/i
        ).first()
    ).toBeVisible({timeout: 15_000});

    // The backend shell ("Module Menu") absolutely must NOT appear — that
    // would mean the request was served by the worker's HttpApplication.
    await expect(page.locator('#modulemenu')).toHaveCount(0);
});
