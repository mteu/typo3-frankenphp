import { test, expect } from '@playwright/test';

test('Sites -> TypoScript', async ({ page }) => {
    await page.goto('/typo3/');
    let contentFrame = page.locator('iframe[name="list_frame"]').contentFrame();

    await page.getByRole('menuitem', { name: 'TypoScript' }).click();
    // Select the Camino page (uid=1) in the page tree. Without this the iframe
    // loads with id=0 → "Installed Extensions" view, which has no
    // "Module action: TypoScript" dropdown. Page-tree items are
    // <div role="treeitem" data-id="N" title="id=N - Name">.
    await page.locator('[role="treeitem"][data-id="1"]').click();
    await expect(contentFrame.getByRole('heading', { name: 'TypoScript Overview' })).toBeVisible();
    await contentFrame.getByRole('button', { name: 'Module action: TypoScript' }).click();
    await expect(contentFrame.getByRole('link', { name: 'TypoScript Overview' })).toBeVisible();

    await contentFrame.getByRole('link', { name: 'Constant Editor' }).click();
    await expect(contentFrame.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();

    await contentFrame.getByRole('button', { name: 'Module action: Constant Editor' }).click();
    await expect(contentFrame.getByRole('link', { name: 'TypoScript Overview' })).toBeVisible();

    await contentFrame.getByRole('link', { name: 'Edit TypoScript Record' }).click();
    await expect(contentFrame.getByText('TypoScript settings have been')).toBeVisible();
    await contentFrame.getByRole('button', { name: 'Module action: Edit' }).click();
    await expect(contentFrame.getByRole('link', { name: 'TypoScript Overview' })).toBeVisible();

    await contentFrame.getByRole('link', { name: 'Active TypoScript' }).click();
    // The Active TypoScript view has two "Configuration" tabs (one in the
    // Constants panel, one in the Setup panel) — first() resolves the
    // strict-mode ambiguity. The matching tabpanels are unnamed (their
    // accessible name is the TypoScript content); assert on the tab itself.
    await expect(contentFrame.getByRole('tab', { name: 'Configuration' }).first()).toBeVisible();

    // Setup panel: top-level TypoScript setup keys (config, lib, page, …).
    await contentFrame.locator('#panel-tree-heading-setup').click();
    await expect(contentFrame.getByRole('link', { name: 'config', exact: true })).toBeVisible();
    await expect(contentFrame.getByRole('link', { name: 'page', exact: true })).toBeVisible();

    // Constants panel: the *sources* of constants — site-set identifiers.
    await contentFrame.locator('#panel-tree-heading-constant').click();
    await expect(contentFrame.getByRole('link', { name: 'camino', exact: true })).toBeVisible();
    await expect(contentFrame.getByRole('link', { name: 'seo_sitemap', exact: true })).toBeVisible();
    await contentFrame.getByRole('button', { name: 'Module action: Active' }).click();
    await expect(contentFrame.getByRole('link', { name: 'TypoScript Overview' })).toBeVisible();

    await contentFrame.getByRole('link', { name: 'Included TypoScript' }).click();
    await expect(contentFrame.locator('#template-analyzer-constants-tree-body')).toBeVisible();

    await expect(contentFrame.locator('#template-analyzer-constants-tree-body').getByText('[site:camino] Camino')).toBeVisible();
    await expect(contentFrame.locator('#template-analyzer-setup-tree-body').getByText('[site:camino] Camino')).toBeVisible();
});