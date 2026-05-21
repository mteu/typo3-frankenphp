import {test, expect} from '@playwright/test';

test('Sites -> Page TSconfig', async ({page}) => {
    await page.goto('/typo3/');
    let contentFrame = page.locator('iframe[name="list_frame"]').contentFrame();

    await page.getByRole('menuitem', {name: 'Page TSconfig'}).click();
    // Select the Camino page (uid=1) in the page tree. The original
    // div.filter({hasText: /^Camino$/}) selector was ambiguous; tree items
    // are <div role="treeitem" data-id="N" title="id=N - Name">.
    await page.locator('[role="treeitem"][data-id="1"]').click();

    await page.locator('iframe[name="list_frame"]').waitFor({state: "attached"})

    // TYPO3 remembers the last sub-view per module per user, so we can't
    // assume which view loads first. Use the Module action dropdown
    // (labelled with the current view name — regex matches any of them)
    // to navigate to each known sub-view explicitly.

    // → Pages containing page TSconfig.
    // First settle on a deterministic H1 (the Camino page tree click above
    // races against any prior worker's UC state). Wait for *any* page
    // TSconfig H1 before opening the Module action — otherwise the
    // dropdown can resolve against a stale iframe DOM under workers > 1.
    await expect(contentFrame.getByRole('heading', {level: 1})).toBeVisible();
    await contentFrame.getByRole('button', {name: /^Module action:/}).click();
    await contentFrame.getByRole('link', {name: 'Pages containing page TSconfig'}).click();
    await expect(contentFrame.getByRole('heading', {level: 1}))
        .toContainText('Pages containing page TSconfig');

    // → Active page TSconfig
    await contentFrame.getByRole('button', {name: /^Module action:/}).click();
    await contentFrame.getByRole('link', {name: 'Active page TSconfig'}).click();
    // Race-safe: assert the H1 changed first, THEN the body content.
    // Under parallel workers the iframe nav lags the click — without this
    // explicit step the body content from the prior "Pages containing
    // page TSconfig" view was still in DOM when the substring check ran.
    await expect(contentFrame.getByRole('heading', {level: 1}))
        .toContainText('Active page TSconfig');
    await expect(contentFrame.locator('body')).toContainText('Constants from site settings');
    // Two "Configuration" tabs (Constants + Setup panels) — pick the first.
    await expect(contentFrame.getByRole('tab', {name: 'Configuration'}).first()).toBeVisible();

    // Expand the Setup panel and look for TCEMAIN — the standard top-level
    // pageTSconfig setup key.
    await contentFrame.locator('#panel-tree-heading-setup').click();
    await expect(contentFrame.getByText('TCEMAIN')).toBeVisible();

    // → Included page TSconfig
    await contentFrame.getByRole('button', {name: /^Module action:/}).click();
    await contentFrame.getByRole('link', {name: 'Included page TSconfig'}).click();
    await expect(contentFrame.locator('#pagetsconfig-includes-setup-tree-body'))
        .toContainText('pageTsConfig-site-camino');
});