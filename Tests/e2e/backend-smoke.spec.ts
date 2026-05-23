import {test, expect} from '@playwright/test';

const PASS = process.env.TYPO3_SETUP_ADMIN_PASSWORD ?? 'Password.1';

test('stored session opens the backend without bouncing to /typo3/login', async ({page}) => {
    const response = await page.goto('/typo3/main');
    // /typo3/main redirects to the user's last-opened module
    // (e.g. /typo3/module/web/layout). The actual auth assertion is just:
    // we got a 200 and we are NOT on the login page.
    expect(response?.status()).toBe(200);
    await expect(page).not.toHaveURL(/\/typo3\/login/);
});

test('See every module', async ({page}) => {
    await page.goto('/typo3/main');

    // The module menu is rendered via JS; on slower engines (webkit) it
    // isn't in the DOM yet right after goto. Wait for the first leaf link
    // to attach before discovery.
    await page.locator('#modulemenu a[data-moduleroute-identifier]').first()
        .waitFor({state: 'attached', timeout: 15_000});

    // Discover modules
    const modules = await page.locator('#modulemenu a[data-moduleroute-identifier]').evaluateAll(
        (els) => els.map((el) => ({
            id:   el.getAttribute('data-moduleroute-identifier') ?? '',
            href: (el as HTMLAnchorElement).href,
            name: el.querySelector('.modulemenu-name')?.textContent?.trim() ?? '',
        })),
    );

    // Guard against a future refactor changing the selector — if discovery
    // returns nothing, the rest of the test is a silent no-op.
    expect(modules.length, 'side menu should expose at least one module')
        .toBeGreaterThan(0);

    for (const mod of modules) {
        await test.step(`${mod.name} (${mod.id})`, async () => {
            const response = await page.goto(mod.href);
            expect(response?.status(), `HTTP status for ${mod.id}`).toBeLessThan(400);

            // Modules under /typo3/sudo-mode/ require the admin to re-enter
            // their password before exposing the actual module.
            if (/\/typo3\/sudo-mode\//.test(page.url())) {
                await page.locator('input[name="password"]').fill(PASS);
                await page.locator('input[name="password"]').press('Enter');
                await page.waitForURL((url) => !url.pathname.includes('/sudo-mode/'),
                    {timeout: 10_000});
            }

            await expect(page, `module ${mod.id} should not bounce to login`)
                .not.toHaveURL(/\/typo3\/login/);
            // Some modules require an in-backend referrer. Direct navigation
            // to /typo3/module/<id> is wrapped in the BE shell at
            // /typo3/main (with or without ?redirect=<id>&referrer-refresh=…)
            // and the module loads into an iframe. The user's default
            // landing module (typically web_layout) ends up at bare
            // /typo3/main with no query string at all. All three URL shapes
            // count as a successful landing.
            await expect(page, `module ${mod.id} should land in /typo3/module/`)
                .toHaveURL(/\/typo3\/(module|sudo-mode|main(\?|#|$))/);
        });
    }
});
