import {test, expect} from '@playwright/test';

/**
 * Same class of regression as page-tree-content.spec.ts but for the Web>List
 * module (data-moduleroute-identifier="records"). ContentFetcher /
 * BackendLayoutView cache keys are page-uid-less so the previous page's
 * record list can leak into the current page's view under worker mode.
 *
 * Fix lives in Classes/Worker/StateSnapshotService.php (cache.runtime key
 * removal). This test exercises the List rendering path too — if the fix
 * happens to address Layout but not List (e.g. List uses a different cache
 * key we missed), this catches it.
 */
test('Web>List record list corresponds to the selected page after page-tree clicks', async ({page}) => {
    test.setTimeout(60_000);
    await page.goto('/typo3/main');
    await page.locator('#modulemenu a[data-moduleroute-identifier]').first()
        .waitFor({state: 'attached', timeout: 30_000});
    await page.locator('#modulemenu a[data-moduleroute-identifier="records"]').click();

    const cf = page.locator('iframe[name="list_frame"]').contentFrame();

    const caminoNode = page.locator('[role="treeitem"][data-id="1"]');
    await caminoNode.waitFor({state: 'attached', timeout: 30_000});
    if ((await caminoNode.getAttribute('aria-expanded')) !== 'true') {
        await caminoNode.locator('.node-toggle').click();
    }
    await page.locator('[role="treeitem"][data-id="5"]').waitFor({state: 'attached', timeout: 10_000});

    // Click FAQs (uid=5) — listing should show its content-element headers.
    await page.locator('[role="treeitem"][data-id="5"]').click();
    await expect(cf.getByText("What is the Pilgrim", {exact: false}).first())
        .toBeVisible({timeout: 30_000});

    // Click Camino Route Comparison (uid=7) — its records appear AND FAQs's
    // must vanish.
    await page.locator('[role="treeitem"][data-id="7"]').click();
    await expect(cf.getByText('Elena Vásquez', {exact: false}).first())
        .toBeVisible({timeout: 30_000});
    await expect(cf.getByText("What is the Pilgrim", {exact: false}))
        .toHaveCount(0);
});
