# TYPO3 FrankenPHP integration

Provides one CLI command that generates everything needed to run TYPO3 under FrankenPHP:

```
vendor/bin/typo3 frankenphp:init
# or without prompts:
vendor/bin/typo3 frankenphp:init --no-interaction
# overwrite existing files:
vendor/bin/typo3 frankenphp:init --no-interaction --force
```

Composer also runs the command automatically on package install / update / `dump-autoload` via the TYPO3 installer-scripts mechanism, so users who don't touch the CLI still get a working setup. Without `--force`, the command preserves files that already exist (warns instead of overwriting), so a `composer update` won't clobber a hand-edited `Caddyfile`, `.env`, or `public/worker.php`.

## Diagnostics

The TYPO3 backend's **System Information** dropdown (the info icon in the topbar) shows a **Worker Mode** row — `Enabled` when the current request is being served by the long-running FrankenPHP worker, `Disabled` when served by per-request PHP execution (e.g. the install-tool recovery URL via `/index.php`). The row icon is the FrankenPHP mascot (the skeleton elephant from `frankenphp.dev`). Use it to quickly verify that requests you expect to hit the worker actually do.

**The files:**

  * Worker entrypoint: `public/worker.php` — long-running FrankenPHP worker for the full backend + frontend (`HttpApplication`).
  * Webserver config: `Caddyfile` — routes `?__typo3_install` queries to canonical `public/index.php` (which TYPO3 ships and which handles `Bootstrap::init($failsafe=true)` internally), and everything else through the worker.
  * Environment config: `.env`

The install-tool recovery URL needs `Bootstrap::init` with `$failsafe=true` so the container exposes `InstallApplication` — mutually exclusive with the worker's always-on `HttpApplication` boot. Rather than shipping a duplicate entry-point, the Caddyfile routes those requests to TYPO3's existing canonical `public/index.php`, which already implements that branch. `index.php` is not registered as a FrankenPHP worker, so requests reach it as standard per-request PHP execution.

**Install:**

```
cd packages/
git clone git@github.com:ochorocho/typo3-frankenphp.git frankenphp
composer req ochorocho/frankenphp:@dev
```

## Install Tool access

Two URLs reach the TYPO3 Install Tool, each routed differently:

  * **`https://your-host/typo3/install`** — preferred for normal maintenance. Goes through the worker via the standard backend route. Requires a logged-in admin backend session.
  * **`https://your-host/?__typo3_install`** — recovery URL. Caddy routes this to TYPO3's canonical `public/index.php` (which boots with `$failsafe=true` and runs `InstallApplication`). Works without backend login but requires the unlock file `public/typo3conf/ENABLE_INSTALL_TOOL` (create via `touch public/typo3conf/ENABLE_INSTALL_TOOL`; auto-removed after one hour). Also accepts the standard controller-routing query parameters, e.g. `?__typo3_install&install[controller]=maintenance`.

If you ever change the Caddyfile manually and forget to keep the `@typo3_install` matcher, the recovery URL will 404 — `vendor/bin/typo3 frankenphp:init --force --no-interaction` regenerates a working config.

### Action URLs are AJAX-only

URLs that carry both `install[controller]=…` and `install[action]=…` (anything other than `install[controller]=layout`) are designed for the install tool's own JS to call via `XMLHttpRequest`. They return a JSON envelope `{success: true, html: '…', buttons: [...]}` for the JS to inject into a modal. Pasting such a URL into a browser address bar shows the raw JSON, not a usable page.

To avoid that confusion, the Caddyfile's `@install_browser_ajax` matcher detects browser top-level navigation (`Sec-Fetch-Mode: navigate` + `Sec-Fetch-Dest: document`, without `X-Requested-With: XMLHttpRequest`) to `?__typo3_install&install[action]=…` URLs and redirects (302) to the install tool dashboard at `/?__typo3_install`. From there, click into the relevant tile (Maintenance, Settings, Upgrade, Environment). The redirect is a Caddyfile-level concern; no extra PHP entry-point is involved.

For long-running maintenance like the reference index, the CLI alternative is usually preferable — the install tool's own UI literally points at this:

```bash
vendor/bin/typo3 referenceindex:update -c   # check only
vendor/bin/typo3 referenceindex:update      # rebuild
```