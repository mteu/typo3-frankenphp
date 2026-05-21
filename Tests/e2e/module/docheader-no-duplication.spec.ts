import {test, expect} from '@playwright/test';

/**
 * Regression: under FrankenPHP worker mode, DocHeaderComponent is a shared
 * Symfony-DI singleton and its ButtonBar->buttons[] array accumulates across
 * requests. Every controller call to addButton() appends without anything
 * clearing the array between requests, so by the third backend navigation
 * View / Edit / Cache / Reload / Share buttons appear three times in the
 * doc-header toolbar.
 *
 * Fix lives in Classes/Worker/StateSnapshotService.php — re-instantiates the
 * ButtonBar from the DocHeader plus clears the shared ButtonBar instance's
 * $buttons via Closure::bind on every worker request.
 *
 * This test navigates into three different modules in sequence and asserts
 * a canonical docheader button ("Clear cache for this page") appears exactly
 * once on the final view — without the reset it would have triplicated.
 */
test('docheader buttons do not duplicate after several page-tree navigations', async ({page}) => {
    test.setTimeout(60_000);
    await page.goto('/typo3/main');
    await page.locator('#modulemenu a[data-moduleroute-identifier]').first()
        .waitFor({state: 'attached', timeout: 15_000});
    await page.locator('#modulemenu a[data-moduleroute-identifier="web_layout"]').click();

    const cf = page.locator('iframe[name="list_frame"]').contentFrame();

    // Expand Camino subtree so child pages are clickable.
    const caminoNode = page.locator('[role="treeitem"][data-id="1"]');
    await caminoNode.waitFor({state: 'attached', timeout: 15_000});
    if ((await caminoNode.getAttribute('aria-expanded')) !== 'true') {
        await caminoNode.locator('.node-toggle').click();
    }
    await page.locator('[role="treeitem"][data-id="5"]').waitFor({state: 'attached', timeout: 10_000});

    // Three page-tree clicks → three Layout-module controller requests →
    // three calls to addButton('Clear cache for this page') on the shared
    // ButtonBar. Without the reset, count would be 3 on the final view.
    for (const id of ['1', '5', '7']) {
        await page.locator(`[role="treeitem"][data-id="${id}"]`).click();
        await cf.locator('button[title="Clear cache for this page"]').first()
            .waitFor({state: 'visible', timeout: 15_000});
    }

    await expect(cf.locator('button[title="Clear cache for this page"]')).toHaveCount(1);
});
