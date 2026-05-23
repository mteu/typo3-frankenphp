<?php

declare(strict_types=1);

namespace Ochorocho\FrankenPhp\Worker;

use Ochorocho\FrankenPhp\Event\WorkerRequestStartingEvent;
use Psr\Container\ContainerInterface;
use Psr\EventDispatcher\EventDispatcherInterface;
use TYPO3\CMS\Backend\Backend\ToolbarItems\SystemInformationToolbarItem;
use TYPO3\CMS\Backend\Template\Components\ButtonBar;
use TYPO3\CMS\Backend\Template\Components\DocHeaderComponent;
use TYPO3\CMS\Backend\Template\Components\MenuRegistry;
use TYPO3\CMS\Backend\Toolbar\InformationStatus;
use TYPO3\CMS\Core\Context\Context;
use TYPO3\CMS\Core\Context\UserAspect;
use TYPO3\CMS\Core\Context\WorkspaceAspect;
use TYPO3\CMS\Core\Database\ConnectionPool;
use TYPO3\CMS\Core\FormProtection\FormProtectionFactory;
use TYPO3\CMS\Core\Messaging\FlashMessageService;
use TYPO3\CMS\Core\MetaTag\MetaTagManagerRegistry;
use TYPO3\CMS\Core\Page\AssetCollector;
use TYPO3\CMS\Core\Page\PageRenderer;
use TYPO3\CMS\Core\Utility\GeneralUtility;

/**
 * Captures TYPO3 singleton state immediately after Bootstrap::init() and
 * restores it at the start of every worker request.
 *
 * Background: DI-managed singletons (PageRenderer, AssetCollector,
 * MetaTagManagerRegistry, FlashMessageService, Context) accumulate state
 * across requests in worker mode. GeneralUtility::resetSingletonInstances()
 * only clears the makeInstance cache, not DI singletons.
 *
 * The snapshot-and-restore pattern uses TYPO3's public getState/updateState
 * APIs where available, with a small Closure::bind shim for
 * FlashMessageService whose queues field is private.
 */
final class StateSnapshotService
{
    public function capture(ContainerInterface $container): WorkerStateSnapshot
    {
        return new WorkerStateSnapshot(
            pageRendererState: $container->get(PageRenderer::class)->getState(),
            assetCollectorState: $container->get(AssetCollector::class)->getState(),
            metaTagRegistryState: $container->get(MetaTagManagerRegistry::class)->getState(),
        );
    }

    public function restore(WorkerStateSnapshot $snapshot, ContainerInterface $container): void
    {
        // Stale process-level state must die before any TYPO3 code runs.
        $this->resetProcessState();
        $this->resetGlobals();
        GeneralUtility::flushInternalRuntimeCaches();

        // Targeted cache.runtime invalidation. Two backend services cache
        // page-bound data under fixed keys (no page UID), and PHP-FPM clears
        // cache.runtime at process death so they assume the data is always
        // current. In worker mode the cache survives and clicking page B in
        // the page tree returns page A's still-cached content elements.
        //
        // Flushing all of cache.runtime breaks the login flow (something in
        // the auth/SiteFinder/LocalizationFactory chain relies on data
        // populated at boot), so remove just the offending keys.
        //
        //   - ContentFetcher_fetchedContentRecords
        //     (cms-backend/View/BackendLayout/ContentFetcher.php)
        //   - backend-layout-view-selected-backend-layouts
        //   - backend-layout-view-selected-combined-identifiers
        //     (cms-backend/View/BackendLayoutView.php)
        if ($container->has('cache.runtime')) {
            $runtimeCache = $container->get('cache.runtime');
            foreach ([
                'ContentFetcher_fetchedContentRecords',
                'backend-layout-view-selected-backend-layouts',
                'backend-layout-view-selected-combined-identifiers',
            ] as $key) {
                $runtimeCache->remove($key);
            }
        }

        // Context aspects: middleware re-populates per request but if a previous
        // request crashed mid-flight, stale aspects can reach PageRenderer and
        // produce undefined-$GLOBALS access errors.
        //
        // We deliberately do NOT reset the `security` aspect here.
        // `RequestTokenMiddleware::__construct(Context)` caches its own
        // references to both the SecurityAspect AND the NoncePool at
        // worker boot. Any reset that replaces those instances — or
        // even mutates them at the wrong moment — leaves the middleware
        // operating on a detached state: the nonce minted into the
        // form's `__RequestToken` JWT (`kid` field) no longer exists
        // in the pool that the middleware reads from on the next
        // request, so `RequestToken::fromHashSignedJwt()` throws
        // "Could not reconstitute request token", the middleware
        // sets `receivedRequestToken=false`, and the auth flow renders
        // the generic "Your login attempt did not succeed" page.
        //
        // The middleware re-populates the NoncePool from the incoming
        // request cookies in `resolveNoncePool()` and purges old items
        // in `purge()` — so cross-request leakage of the pool itself
        // is already handled by core. The only cleanup we need is the
        // `receivedRequestToken` value, which the middleware overwrites
        // unconditionally in `process()` on every request.
        $context = $container->get(Context::class);
        $context->setAspect('backend.user', new UserAspect(null));
        $context->setAspect('frontend.user', new UserAspect(null));
        $context->setAspect('workspace', new WorkspaceAspect(0));

        // FormProtectionFactory caches BackendFormProtection / FrontendForm-
        // Protection instances in `cache.runtime` keyed ONLY by type
        // ('backend' / 'frontend' / 'installtool') — not by user or session.
        // In worker mode the cache survives across requests, so the first
        // request's cached instance carries that session's $sessionToken;
        // any subsequent request from a DIFFERENT user/session reads back
        // the same instance and tries to validate its tokens against the
        // wrong session secret → "Validating the security token of this
        // form has failed." This reproduces reliably when Playwright runs
        // multiple browser projects in parallel or k6 hammers the worker.
        //
        // Closure::bind grants access to the protected `runtimeCache` field
        // and protected `getIdentifierForType()` method.
        // FormProtectionFactory cache is cleared in cleanupAfterRequest(),
        // not here — see that method for the timing reason.

        // DI singletons with public state APIs.
        $container->get(PageRenderer::class)->updateState($snapshot->pageRendererState);
        $container->get(AssetCollector::class)->updateState($snapshot->assetCollectorState);
        $container->get(MetaTagManagerRegistry::class)->updateState($snapshot->metaTagRegistryState);

        // FlashMessageService has no public reset; the queues are a private property.
        $flashMessageService = $container->get(FlashMessageService::class);
        \Closure::bind(static function () use ($flashMessageService): void {
            $flashMessageService->flashMessageQueues = [];
        }, null, FlashMessageService::class)();

        // Backend DocHeaderComponent and its sub-components (ButtonBar,
        // MenuRegistry) are #[Autoconfigure(public: true)] services — Symfony
        // DI makes them shared by default, so the same instance is reused
        // across worker requests. ButtonBar->buttons[] accumulates: every
        // controller call to
        // $view->getDocHeaderComponent()->getButtonBar()->addButton() appends, and
        // nothing clears the array between requests. Result: View / Edit / Cache /
        // Reload / Share buttons appear once after request 1, twice after request 2,
        // etc., visually breaking the doc-header layout after a few navigations.
        //
        // Reset the mutable state on the shared instances back to post-boot defaults.
        // All fields here are protected/private; Closure::bind grants access without
        // forcing TYPO3 Core to add public reset methods.
        if ($container->has(DocHeaderComponent::class)) {
            $docHeader = $container->get(DocHeaderComponent::class);
            \Closure::bind(static function () use ($docHeader): void {
                // Re-instantiate the ButtonBar (matches what the constructor does).
                $docHeader->buttonBar = GeneralUtility::makeInstance(ButtonBar::class);
                // breadcrumbContext is the only render-state on DocHeader v14
                // (the legacy $metaInformation property is deprecated, @internal,
                // and not read by docHeaderContent() — leaving it alone).
                $docHeader->breadcrumbContext = null;
                $docHeader->enabled = true;
                $docHeader->languageSelector = null;
                $docHeader->automaticShortcutButton = null;
                $docHeader->automaticReloadButton = true;
            }, null, DocHeaderComponent::class)();

            // MenuRegistry is constructor-injected into DocHeaderComponent as a
            // readonly property, and the class has no #[Autoconfigure(public: true)]
            // — so $container->has(MenuRegistry::class) is false and the readonly
            // can't be re-assigned with the makeInstance trick we use for
            // ButtonBar. Reach the live instance via the public
            // getMenuRegistry() and clear its protected $menus[] array directly.
            // Without this, every backend module's addMenu() call leaks into
            // subsequent requests — visible as ghost "Module action" dropdowns
            // (e.g. Extension Manager's "Installed Extensions" appearing on
            // Page TSconfig).
            $menuRegistry = $docHeader->getMenuRegistry();
            \Closure::bind(static function () use ($menuRegistry): void {
                $menuRegistry->menus = [];
            }, null, MenuRegistry::class)();
        }
        if ($container->has(ButtonBar::class)) {
            $buttonBar = $container->get(ButtonBar::class);
            \Closure::bind(static function () use ($buttonBar): void {
                $buttonBar->buttons = [];
            }, null, ButtonBar::class)();
        }

        // SystemInformationToolbarItem — same shared-singleton accumulation as
        // DocHeaderComponent. Its #[Autoconfigure(public: true)] makes the instance
        // shared, and getDropDown() → collectInformation() appends to
        // $systemInformation[] on every call. After N requests every entry
        // (TYPO3 Version, Web Server, PHP Version, Database, etc.) appears N times
        // in the toolbar dropdown. The badge severity also stays at its highest
        // historical value rather than reflecting the current request.
        if ($container->has(SystemInformationToolbarItem::class)) {
            $systemInfo = $container->get(SystemInformationToolbarItem::class);
            \Closure::bind(static function () use ($systemInfo): void {
                $systemInfo->systemInformation = [];
                $systemInfo->systemMessages = [];
                $systemInfo->systemMessageTotalCount = 0;
                $systemInfo->highestSeverity = InformationStatus::INFO;
                $systemInfo->severityBadgeClass = '';
            }, null, SystemInformationToolbarItem::class)();
        }

        // Doctrine connections cached statically per table — close them so the
        // next request gets fresh connections (avoids "MySQL has gone away").
        $container->get(ConnectionPool::class)->resetConnections();

        // Let downstream extensions reset their own state.
        if ($container->has(EventDispatcherInterface::class)) {
            $container->get(EventDispatcherInterface::class)
                ->dispatch(new WorkerRequestStartingEvent($container));
        }
    }

    private function resetProcessState(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
        $_SESSION = [];
    }

    /**
     * Called by worker.php in the `finally` block after each request finishes,
     * BEFORE the next request's restore() runs. This is the right moment to
     * drop per-request caches — the response has already been emitted, so any
     * lingering references the request was holding (BFP instances pointing at
     * the just-served BE_USER) can safely go away.
     *
     * We can't do this in restore() at the start of the next request because
     * restore() runs *before* TYPO3 boots BE_USER → and BFP::createForType('backend')
     * stashes references into the cache as a side effect of LoginController and
     * UriBuilder; if restore() evicts that entry mid-request the entry can be
     * re-created with a transitional state (newly-created session, ses_data still
     * empty before persistSessionToken's DB write has settled) that doesn't
     * match the session row the next request reads back from DB. The visible
     * symptom is a post-login redirect loop /typo3/main?token=… → /typo3/login,
     * each iteration adding a "Validating the security token of this form has
     * failed" flash to the session — until Playwright's "navigate too many
     * redirects" timeout fires.
     */
    public function cleanupAfterRequest(ContainerInterface $container): void
    {
        // FormProtectionFactory caches BackendFormProtection / FrontendForm-
        // Protection instances in `cache.runtime` keyed ONLY by type — not by
        // user or session. In worker mode the cache survives across requests,
        // so the first request's cached BFP carries that session's $sessionToken,
        // and any subsequent request from a DIFFERENT user/session reads back
        // the same instance and validates its tokens against the wrong session
        // secret → "Validating the security token of this form has failed."
        //
        // Closure::bind grants access to the protected `runtimeCache` field
        // and protected `getIdentifierForType()` method.
        if ($container->has(FormProtectionFactory::class)) {
            $formProtectionFactory = $container->get(FormProtectionFactory::class);
            \Closure::bind(static function () use ($formProtectionFactory): void {
                foreach (['installtool', 'frontend', 'backend', 'disabled'] as $type) {
                    $formProtectionFactory->runtimeCache->remove(
                        $formProtectionFactory->getIdentifierForType($type),
                    );
                }
            }, null, FormProtectionFactory::class)();
        }
    }

    private function resetGlobals(): void
    {
        // Cleared by Bootstrap normally; unset so a stale TYPO3_REQUEST does
        // not leak into ServerRequestFactory::fromGlobals().
        unset($GLOBALS['BE_USER'], $GLOBALS['LANG'], $GLOBALS['TYPO3_REQUEST']);

        // SystemEnvironmentBuilder::run() sets these once at boot. In worker
        // mode they freeze at the worker start time; refresh per request so
        // TYPO3's "now" matches reality.
        $now = time();
        $GLOBALS['EXEC_TIME'] = $now;
        $GLOBALS['ACCESS_TIME'] = $now - $now % 60;
        $GLOBALS['SIM_EXEC_TIME'] = $GLOBALS['EXEC_TIME'];
        $GLOBALS['SIM_ACCESS_TIME'] = $GLOBALS['ACCESS_TIME'];

        // NOTE: $GLOBALS['T3_SERVICES'] is intentionally NOT reset here.
        // It is a process-lifetime service registry populated once at
        // Bootstrap::init() via ExtensionManagementUtility::addService()
        // calls in sysext ext_localconf.php files. Wiping it per request
        // erases the auth/scheduler/etc service registrations and silently
        // breaks login (no service of type "auth" found → AuthenticationService
        // never runs → user always sees "Your login attempt did not succeed").
    }
}
