import {test, expect} from '@playwright/test';

const PASS = process.env.TYPO3_SETUP_ADMIN_PASSWORD ?? 'Password.1';

/**
 * Same install-tool session-handoff regression as system-maintenance.spec.ts,
 * but for the Settings module. They share BackendModuleController; if the
 * fix in Classes/Middleware/PreserveNativeSessionCookies regresses, all
 * three Admin Tools entry points (Maintenance, Settings, Upgrade) fail.
 */
test('Settings module: no "Install Tool session expired" message', async ({page}) => {
    test.setTimeout(60_000);
    await page.goto('/typo3/main');
    await page.locator('#modulemenu a[data-moduleroute-identifier]').first()
        .waitFor({state: 'attached', timeout: 30_000});

    await page.locator('#modulemenu a[data-moduleroute-identifier="system_settings"]').click();
    if (/\/typo3\/sudo-mode\//.test(page.url())) {
        await page.locator('input[name="password"]').fill(PASS);
        await page.locator('input[name="password"]').press('Enter');
        await page.waitForURL((u) => !u.pathname.includes('/sudo-mode/'), {timeout: 30_000});
    }
    await page.waitForLoadState('networkidle', {timeout: 30_000}).catch(() => {});
    await page.waitForTimeout(2000);

    await expect(
        page.locator('iframe[name="list_frame"]').contentFrame()
            .getByText('The Install Tool session')
    ).toHaveCount(0);
});
