import {test, expect} from '@playwright/test';

test('stored session opens the backend without bouncing to /typo3/login', async ({page}) => {
    const response = await page.goto('/typo3/main');
    // /typo3/main redirects to the user's last-opened module
    // (e.g. /typo3/module/web/layout). The actual auth assertion is just:
    // we got a 200 and we are NOT on the login page.
    expect(response?.status()).toBe(200);
    await expect(page).not.toHaveURL(/\/typo3\/login/);
});
