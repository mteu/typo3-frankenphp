import {test, expect} from '@playwright/test';

// Regression test for the worker-mode MenuRegistry leak:
// visiting Extension Manager registered a "Module action: Installed Extensions"
// dropdown into the SHARED MenuRegistry instance held by the singleton
// DocHeaderComponent. Subsequent module renders saw the EM menu still there
// and emitted a second, ghost "Module action" dropdown alongside the
// legitimate one. Fixed in StateSnapshotService by clearing MenuRegistry's
// $menus[] via the DocHeader getter on every worker request.
test('Module action dropdown does not leak across module switches', async ({page}) => {
    // Seed the shared MenuRegistry with Extension Manager's menus.
    await page.goto('/typo3/module/system/extensionmanager');
    await page.waitForLoadState('networkidle');

    // Switch to Page TSconfig (a different module that registers its own
    // Module action dropdown). With the leak in place, both EM's and PTC's
    // dropdowns appear; with the fix, only PTC's.
    await page.goto('/typo3/module/pagetsconfig?id=1');
    const cf = page.locator('iframe[name="list_frame"]').contentFrame();

    await expect(cf.getByRole('button', {name: /^Module action:/})).toHaveCount(1);
    await expect(cf.getByRole('button', {name: 'Module action: Installed Extensions'}))
        .toHaveCount(0);
});
