import {test, expect} from '@playwright/test';

/**
 * Confirms the FrankenPHP worker-mode diagnostic surface works:
 * Resources/Private/Php/worker.php defines TYPO3_FRANKENPHP_WORKER_MODE = true
 * once per worker process; Classes/EventListener/AddFrankenPhpModeToSystemInformation
 * reads it and renders a "Worker Mode" row (value "Enabled" / "Disabled")
 * in the backend's System Information toolbar dropdown. This is the primary
 * way users tell whether their request was actually served by the worker.
 *
 * If the constant gets renamed, the listener stops firing, or the worker.php
 * template stops defining it, this test fails.
 */
test('System Information shows Worker Mode: Enabled on worker-served requests', async ({page}) => {
    test.setTimeout(60_000);
    await page.goto('/typo3/main');
    await page.locator('#modulemenu a[data-moduleroute-identifier]').first()
        .waitFor({state: 'attached', timeout: 30_000});

    await page.locator('button').filter({hasText: 'System Information'}).first().click();
    // Wait for the System Information dropdown's title row to actually become
    // visible; on webkit in CI the dropdown takes longer than a fixed timeout
    // to render, so `getByText('Worker Mode').toBeVisible()` here doubles as
    // the open-detection signal and lets later assertions race the same row.
    await expect(page.getByText('Worker Mode', {exact: false}).first()).toBeVisible({timeout: 15_000});
    // The listener (Classes/EventListener/AddFrankenPhpModeToSystemInformation.php)
    // emits the value as "Enabled" optionally followed by " ---- <worker count>".
    // Anchor at start with a word boundary so the assertion still works after
    // the debug suffix changes, but doesn't accidentally match "Disabled".
    await expect(page.getByText(/^Enabled\b/).first()).toBeVisible({timeout: 15_000});
});
