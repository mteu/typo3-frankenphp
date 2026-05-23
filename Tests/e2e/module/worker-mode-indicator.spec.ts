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

    const trigger = page.locator('button').filter({hasText: 'System Information'}).first();
    // Drill structurally into the Worker Mode row inside the System
    // Information dropdown — the markup is `<th>Worker Mode</th><td>Enabled</td>`.
    // This is robust to:
    //   - the dropdown taking a moment to render (toBeVisible waits),
    //   - leading/trailing whitespace inside the cells (textContent in the
    //     TYPO3 backend is e.g. "\n    Enabled\n", which trips up regex
    //     anchors against `getByText(regex)`),
    //   - the listener appending a debug suffix to the value
    //     ("Enabled ---- 2"), because toContainText is a substring match,
    //   - rejecting "Disabled" since "Disabled" does not contain "Enabled".
    const value = page.locator('th[data-type="title"]:has-text("Worker Mode") + td[data-type="value"]');
    // The toolbar dropdown can race-close on the initial click (button JS
    // not fully bound, focus-blur quirks). Retry open + visibility check
    // until the dropdown actually stays open. Each toPass iteration toggles
    // the trigger, so an unlucky close becomes a re-open on the next pass.
    await expect(async () => {
        await trigger.click();
        await expect(value).toBeVisible({timeout: 3_000});
    }).toPass({timeout: 30_000});
    await expect(value).toContainText('Enabled');
});
