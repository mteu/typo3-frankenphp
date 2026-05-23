import {test, expect, FrameLocator} from '@playwright/test';

/**
 * Open the "Module action:" dropdown in the iframe and click the named
 * sub-view link. The dropdown can race-close and the click can land as a
 * no-op (dropdown closed before the event registered, stale link from a
 * mid-flight re-render, etc.). Retry the open+click pair until the iframe
 * actually shows the requested sub-view — verifying delivery alone isn't
 * enough; we need to verify navigation happened. The sub-view name is a
 * substring of the resulting H1 in all three sub-views.
 */
async function switchSubView(frame: FrameLocator, linkName: string): Promise<void> {
    await expect(async () => {
        await frame.getByRole('button', {name: /^Module action:/}).click();
        await frame.getByRole('link', {name: linkName}).click({timeout: 3_000});
        await expect(frame.getByRole('heading', {level: 1}))
            .toContainText(linkName, {timeout: 5_000});
    }).toPass({timeout: 30_000});
}

test('Sites -> Page TSconfig', async ({page}) => {
    await page.goto('/typo3/');
    let contentFrame = page.locator('iframe[name="list_frame"]').contentFrame();

    await page.getByRole('menuitem', {name: 'Page TSconfig'}).click();
    // Select the Camino page (uid=1) in the page tree. The page tree
    // component can briefly render two identical treeitems during init
    // (visible tree + hidden drawer copy); .first() picks one — both
    // target the same UI state.
    await page.getByRole('treeitem', {name: 'Camino'}).first().click();

    await page.locator('iframe[name="list_frame"]').waitFor({state: "attached"})

    // TYPO3 remembers the last sub-view per module per user, so we can't
    // assume which view loads first. Use the Module action dropdown
    // (labelled with the current view name — regex matches any of them)
    // to navigate to each known sub-view explicitly.

    // Settle on the Camino-specific breadcrumb (the page-tree click above
    // races against any prior worker's UC state). The H1 isn't suitable —
    // only the "Included page TSconfig" sub-view names the page; the other
    // two sub-views (Pages containing…, Active page TSconfig) have
    // page-agnostic H1s. The breadcrumb always reflects the selected page.
    await expect(contentFrame.getByRole('navigation', {name: 'Breadcrumb'}))
        .toContainText('Camino');

    // → Pages containing page TSconfig
    await switchSubView(contentFrame, 'Pages containing page TSconfig');

    // → Active page TSconfig
    await switchSubView(contentFrame, 'Active page TSconfig');
    await expect(contentFrame.locator('body')).toContainText('Constants from site settings');
    // Two "Configuration" tabs (Constants + Setup panels) — pick the first.
    await expect(contentFrame.getByRole('tab', {name: 'Configuration'}).first()).toBeVisible();

    // Expand the Setup panel and look for TCEMAIN — the standard top-level
    // pageTSconfig setup key.
    await contentFrame.locator('#panel-tree-heading-setup').click();
    await expect(contentFrame.getByText('TCEMAIN')).toBeVisible();

    // → Included page TSconfig
    await switchSubView(contentFrame, 'Included page TSconfig');
    await expect(contentFrame.locator('#pagetsconfig-includes-setup-tree-body'))
        .toContainText('pageTsConfig-site-camino');
});