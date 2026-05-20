import { test, expect } from '@playwright/test';

test('Sites -> Setup', async ({ page }) => {
    await page.goto('/typo3/');

    let contentFrame = page.locator('iframe[name="list_frame"]').contentFrame();
    await page.getByRole('menuitem', { name: 'Setup' }).click();
    await expect(contentFrame.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();

    await contentFrame.getByRole('link', { name: 'Edit site configuration' }).click();
    await expect(contentFrame.getByRole('tabpanel', { name: 'General' })).toBeVisible();

    await contentFrame.getByRole('tab', { name: 'Languages' }).click();
    await expect(contentFrame.getByRole('tabpanel', { name: 'Languages' })).toBeVisible();

    await contentFrame.getByRole('tab', { name: 'General' }).click();
    await expect(contentFrame.locator('h1')).toContainText('camino · Site configuration');
    await expect(contentFrame.getByRole('button', { name: 'Module action: Composer' })).not.toBeVisible();
    await expect(contentFrame.getByRole('heading', { name: 'camino · Site configuration' })).toBeVisible();
});