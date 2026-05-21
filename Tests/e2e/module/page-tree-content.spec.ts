import {test, expect} from '@playwright/test';

/**
 * Regression: ContentFetcher (cms-backend/View/BackendLayout/ContentFetcher.php)
 * is a `#[Autoconfigure(public: true)]` singleton that caches the full
 * `tt_content` result set under the FIXED key `ContentFetcher_fetchedContentRecords`
 * in the DI-managed `cache.runtime` service — with no page UID in the key. The
 * sibling `BackendLayoutView` does the same for selected layouts. Under PHP-FPM
 * `cache.runtime` is wiped at process death, so this is harmless. Under
 * FrankenPHP worker mode the cache survives across requests; clicking page B in
 * the page tree returns page A's still-cached content. Fixed by flushing
 * `cache.runtime` per request in `StateSnapshotService::restore()`.
 *
 * This test clicks two pages with disjoint content and asserts the second
 * page's content elements appear AND the first page's do NOT — which is the
 * minimum check that proves cache.runtime is being reset.
 */
test('Web>Layout content elements correspond to the selected page after page-tree clicks', async ({page}) => {
    await page.goto('/typo3/main');
    await page.locator('#modulemenu a[data-moduleroute-identifier]').first()
        .waitFor({state: 'attached', timeout: 15_000});
    await page.locator('#modulemenu a[data-moduleroute-identifier="web_layout"]').click();

    const cf = page.locator('iframe[name="list_frame"]').contentFrame();

    // Page tree is a Lit web component; treeitems appear once the tree's
    // initial fetchData AJAX resolves. Wait for the root node, then expand
    // the Camino subtree so its children (FAQs, Packing List, etc.) are
    // clickable.
    const caminoNode = page.locator('[role="treeitem"][data-id="1"]');
    await caminoNode.waitFor({state: 'attached', timeout: 15_000});
    if ((await caminoNode.getAttribute('aria-expanded')) !== 'true') {
        await caminoNode.locator('.node-toggle').click();
    }
    await page.locator('[role="treeitem"][data-id="5"]').waitFor({state: 'attached', timeout: 10_000});

    // Click FAQs (uid=5). Wait for one of its distinctive content-element
    // headers to appear in the iframe.
    await page.locator('[role="treeitem"][data-id="5"]').click();
    await expect(cf.getByText("What is the Pilgrim", {exact: false}).first())
        .toBeVisible({timeout: 15_000});

    // Click Camino Route Comparison (uid=7). Its content must appear AND
    // FAQs' must vanish — otherwise the runtime cache leaked.
    await page.locator('[role="treeitem"][data-id="7"]').click();
    await expect(cf.getByText('Elena Vásquez', {exact: false}).first())
        .toBeVisible({timeout: 15_000});
    await expect(cf.getByText("What is the Pilgrim", {exact: false}))
        .toHaveCount(0);
});
