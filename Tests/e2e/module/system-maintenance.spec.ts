import {test, expect} from '@playwright/test';

const PASS = process.env.TYPO3_SETUP_ADMIN_PASSWORD ?? 'Password.1';

// Regression: under FrankenPHP worker mode the install tool's session is
// written to $_SESSION by Build/cms-install/Classes/Controller/BackendModuleController
// (sets ['authorized'] / ['isBackendSession']) and then a redirect goes out.
// In PHP-FPM the runtime auto-commits the session at request shutdown;
// FrankenPHP workers do NOT — so without an explicit session_write_close in
// worker.php, the install tool's per-request AJAX channel (routed by the
// Caddyfile to /index.php in failsafe boot) reads an empty session file and
// 403s, which router.js handleAjaxError renders as
// "The Install Tool session expired. Please reload the backend and try again."
// across every BackendModuleController-backed module: Maintenance, Settings,
// Upgrade. Fix lives in Resources/Private/Php/worker.php (the install-tool
// session_write_close in the request handler's finally block).
test('Maintenance: no "Install Tool session expired" message', async ({page}) => {
    await page.goto('/typo3/main');
    await page.locator('#modulemenu a[data-moduleroute-identifier]').first()
        .waitFor({state: 'attached', timeout: 15_000});

    await page.locator('#modulemenu a[data-moduleroute-identifier="system_maintenance"]').click();
    // The sudo prompt only appears the first time the user enters an Admin
    // Tools module (the grant is cached for the session lifetime). When
    // earlier specs already triggered Maintenance, sudo is silent here.
    if (/\/typo3\/sudo-mode\//.test(page.url())) {
        await page.locator('input[name="password"]').fill(PASS);
        await page.locator('input[name="password"]').press('Enter');
        await page.waitForURL((u) => !u.pathname.includes('/sudo-mode/'), {timeout: 15_000});
    }
    // Give the router.js AJAX chain time to settle.
    await page.waitForLoadState('networkidle', {timeout: 15_000}).catch(() => {});
    await page.waitForTimeout(2000);

    // The error from router.js handleAjaxError() must not appear anywhere.
    await expect(page.locator('iframe[name="list_frame"]').contentFrame().getByText('The Install Tool session')).toHaveCount(0);
});
