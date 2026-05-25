<?php

declare(strict_types=1);

namespace Ochorocho\FrankenPhp\Worker;

use Ochorocho\FrankenPhp\Event\WorkerRequestStartingEvent;
use Psr\Container\ContainerInterface;
use Psr\EventDispatcher\EventDispatcherInterface;
use TYPO3\CMS\Backend\Backend\ToolbarItems\SystemInformationToolbarItem;
use TYPO3\CMS\Backend\Routing\UriBuilder;
use TYPO3\CMS\Backend\Template\Components\ButtonBar;
use TYPO3\CMS\Backend\Template\Components\DocHeaderComponent;
use TYPO3\CMS\Backend\Template\Components\MenuRegistry;
use TYPO3\CMS\Backend\Toolbar\InformationStatus;
use TYPO3\CMS\Core\Context\Context;
use TYPO3\CMS\Core\Context\UserAspect;
use TYPO3\CMS\Core\Context\WorkspaceAspect;
use TYPO3\CMS\Core\Database\ConnectionPool;
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
        // MenuContentObjectFactory holds the TMENU/TMENU_LAYERS/... →
        // class-string map that gets mutated by extensions calling
        // `registerMenuType()`. The map is supposed to be set up once
        // at boot and stay process-stable; we snapshot it post-boot
        // and restore it per request so extensions registering at
        // runtime can't accidentally bleed into other requests.
        $menuFactoryMapping = [];
        if ($container->has(\TYPO3\CMS\Frontend\ContentObject\Menu\MenuContentObjectFactory::class)) {
            $menuFactory = $container->get(\TYPO3\CMS\Frontend\ContentObject\Menu\MenuContentObjectFactory::class);
            $menuFactoryMapping = \Closure::bind(
                static fn(): array => $menuFactory->menuTypeToClassMapping,
                null,
                \TYPO3\CMS\Frontend\ContentObject\Menu\MenuContentObjectFactory::class,
            )();
        }

        return new WorkerStateSnapshot(
            pageRendererState: $container->get(PageRenderer::class)->getState(),
            assetCollectorState: $container->get(AssetCollector::class)->getState(),
            metaTagRegistryState: $container->get(MetaTagManagerRegistry::class)->getState(),
            menuTypeToClassMapping: $menuFactoryMapping,
        );
    }

    public function restore(WorkerStateSnapshot $snapshot, ContainerInterface $container): void
    {
        // Stale process-level state must die before any TYPO3 code runs.
        $this->resetProcessState();
        $this->resetGlobals();
        GeneralUtility::flushInternalRuntimeCaches();

        // Targeted cache.runtime invalidation. Several core services cache
        // user- / page-bound data under fixed keys (no per-user or per-page
        // parameterization), and PHP-FPM clears cache.runtime at process
        // death so they assume the data is always fresh. In worker mode the
        // cache survives and serves stale rows from a previous request.
        //
        // Flushing all of cache.runtime breaks the login flow (something in
        // the auth/SiteFinder/LocalizationFactory chain relies on data
        // populated at boot), so remove just the offending keys.
        //
        //   - ContentFetcher_fetchedContentRecords
        //     (cms-backend/View/BackendLayout/ContentFetcher.php)
        //     Page B's content elements served as Page A's after clicking
        //     in the page tree.
        //   - backend-layout-view-selected-backend-layouts
        //   - backend-layout-view-selected-combined-identifiers
        //     (cms-backend/View/BackendLayoutView.php)
        //     Same pattern as ContentFetcher for selected backend layouts.
        //   - backendUserAuthenticationFileMountRecords
        //     (cms-core/Classes/Authentication/BackendUserAuthentication.php)
        //     File mounts of user A leak to user B when both hit the same
        //     worker — cross-user data exposure.
        //   - generalUtilityXml2Array
        //     (cms-core/Classes/Utility/GeneralUtility.php)
        //     Pure hygiene: unbounded growth across requests for every
        //     distinct XML payload TYPO3 parses (TCA fragments, plugin
        //     settings, FlexForm config).
        //   - formEngineUtilityTsConfigForTableRow
        //     (cms-backend/Classes/Form/Utility/FormEngineUtility.php)
        //     Single key whose payload is an accumulating array<"table:uid",
        //     TSConfig>. Same record in a different workspace would otherwise
        //     reuse the previous request's workspace-specific TSConfig, with
        //     wrong field rendering / validation as a result.
        //   - workspace-service-available-workspaces / -detailed
        //     (cms-workspaces/Classes/Service/WorkspaceService.php)
        //     Cached workspace list keyed WITHOUT user ID — user A
        //     (workspace manager) populates the cache, user B (restricted
        //     editor) hits the cache and sees workspaces they don't have
        //     permission for.
        if ($container->has('cache.runtime')) {
            $runtimeCache = $container->get('cache.runtime');
            foreach ([
                'ContentFetcher_fetchedContentRecords',
                'backend-layout-view-selected-backend-layouts',
                'backend-layout-view-selected-combined-identifiers',
                'backendUserAuthenticationFileMountRecords',
                'generalUtilityXml2Array',
                'formEngineUtilityTsConfigForTableRow',
                'workspace-service-available-workspaces',
                'workspace-service-available-workspaces-detailed',
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

        // FormProtectionFactory cache hygiene is handled upstream by
        // the cms-core patch in Patches/cms-core-form-protection-
        // factory-session-aware-cache.patch (applied via
        // cweagans/composer-patches). That patch keys the BFP
        // `cache.runtime` entry by the backend session identifier in
        // addition to the type, so a cached BackendFormProtection from
        // a different session can no longer be served to the current
        // request. No worker-mode-specific reset is needed here.

        // UriBuilder caches generated URIs in $this->generated keyed by
        // route+parameters+referenceType. The cache key does NOT include
        // the BFP `?token=` value that gets injected into the parameters
        // AFTER lookup, so once a backend route URI is generated for one
        // session, the cached URI carries that session's token value
        // forever. The next request reuses the URI with the stale token
        // and validation fails → /typo3/main → 302 /typo3/login → 303
        // /typo3/main → infinite redirect. UriBuilder implements
        // SingletonInterface so the array survives across requests in
        // worker mode. Clear it so each request rebuilds URIs with the
        // current session's token.
        if ($container->has(UriBuilder::class)) {
            $uriBuilder = $container->get(UriBuilder::class);
            \Closure::bind(static function () use ($uriBuilder): void {
                $uriBuilder->generated = [];
            }, null, UriBuilder::class)();
        }

        // FileNameFilter has a single global `protected static
        // $showHiddenFilesAndFolders` flag that ANY file-tree listing
        // consults. If a privileged user toggled it ON during their
        // request (e.g. via a TCA file context-menu operation), the
        // setting persists in the worker process and the next user —
        // who may not have permission to see hidden files — sees
        // `.htaccess`, dot-files, and `fileadmin/.private/` entries
        // they shouldn't. Reset to the documented default at the
        // start of every request via the public static setter.
        \TYPO3\CMS\Core\Resource\Filter\FileNameFilter::setShowHiddenFilesAndFolders(false);

        // MemorySpool is `SingletonInterface` and queues outbound emails
        // in `$queuedMessages`, flushed in `__destruct()` — which fires
        // only when the worker process dies, not at end of request.
        // Under FrankenPHP that means an email queued by request A and
        // then made un-deliverable (e.g. by an exception before the
        // controlled flush in a Symfony Messenger handler) sits in the
        // spool until eventual worker death; if MAX_REQUESTS=500 that
        // could be hours, and a future flush may send A's message
        // mid-way through B's request with B's logger / language /
        // FROM-address context. Drop the queue at end of each
        // request — production sites that need spool delivery should
        // use Symfony's filesystem spool, not the in-memory fallback.
        if ($container->has(\TYPO3\CMS\Core\Mail\MemorySpool::class)) {
            $spool = $container->get(\TYPO3\CMS\Core\Mail\MemorySpool::class);
            \Closure::bind(static function () use ($spool): void {
                $spool->queuedMessages = [];
            }, null, \TYPO3\CMS\Core\Mail\MemorySpool::class)();
        }

        // Registry is `SingletonInterface` and caches `sys_registry` DB
        // rows in `$entries` per namespace, with `$loadedNamespaces`
        // tracking which namespaces have been hydrated. Under PHP-FPM
        // the cache dies with the process so an out-of-band write to
        // sys_registry (scheduler task, other worker, install-tool
        // maintenance action) is visible on the next request. Under
        // FrankenPHP the cache persists, so subsequent requests on
        // the same worker keep returning the pre-write value for
        // feature flags, install-tool locks, schema version, etc.
        // Drop the in-memory cache at the start of every request;
        // the next access reloads the namespace from DB.
        if ($container->has(\TYPO3\CMS\Core\Registry::class)) {
            $registry = $container->get(\TYPO3\CMS\Core\Registry::class);
            \Closure::bind(static function () use ($registry): void {
                $registry->entries = [];
                $registry->loadedNamespaces = [];
            }, null, \TYPO3\CMS\Core\Registry::class)();
        }

        // Extbase persistence "unit of work" singletons. The class
        // docblock on Session literally calls itself "a stateful-shared
        // service". Extbase Bootstrap.resetSingletons() calls
        // `persistenceManager->persistAll()` at the end of a normal
        // Extbase request, which DOES clear PersistenceManager's
        // $addedObjects/$changedObjects/$removedObjects — but only on
        // the happy path: an exception before persistAll() leaves the
        // pending unit-of-work alive in the singleton, and the next
        // request's persistAll() commits it.
        //
        // Reset defensively at the start of every worker request. This
        // is safe even when no Extbase code ran in the previous request
        // (no-op on empty state) and is the only thing that bounds the
        // cross-request leak for the failure path.
        //   - Session.destroy() is the public API, clears
        //     $identifierMap / $objectMap / $reconstitutedEntities.
        //   - PersistenceManager.$newObjects is NOT cleared by
        //     persistAll() even on the happy path — separate leak.
        //   - Backend's state is set by PersistenceManager.persistAll()
        //     and never re-cleared, so it lingers after commit too.
        if ($container->has(\TYPO3\CMS\Extbase\Persistence\Generic\Session::class)) {
            $container->get(\TYPO3\CMS\Extbase\Persistence\Generic\Session::class)
                ->destroy();
        }
        if ($container->has(\TYPO3\CMS\Extbase\Persistence\Generic\PersistenceManager::class)) {
            $persistenceManager = $container->get(\TYPO3\CMS\Extbase\Persistence\Generic\PersistenceManager::class);
            \Closure::bind(static function () use ($persistenceManager): void {
                $persistenceManager->newObjects = [];
                $persistenceManager->addedObjects = new \TYPO3\CMS\Extbase\Persistence\ObjectStorage();
                $persistenceManager->changedObjects = new \TYPO3\CMS\Extbase\Persistence\ObjectStorage();
                $persistenceManager->removedObjects = new \TYPO3\CMS\Extbase\Persistence\ObjectStorage();
            }, null, \TYPO3\CMS\Extbase\Persistence\Generic\PersistenceManager::class)();
        }
        if ($container->has(\TYPO3\CMS\Extbase\Persistence\Generic\Backend::class)) {
            $extbaseBackend = $container->get(\TYPO3\CMS\Extbase\Persistence\Generic\Backend::class);
            \Closure::bind(static function () use ($extbaseBackend): void {
                $extbaseBackend->aggregateRootObjects = new \TYPO3\CMS\Extbase\Persistence\ObjectStorage();
                $extbaseBackend->deletedEntities = new \TYPO3\CMS\Extbase\Persistence\ObjectStorage();
                $extbaseBackend->changedEntities = new \TYPO3\CMS\Extbase\Persistence\ObjectStorage();
                $extbaseBackend->visitedDuringPersistence = new \TYPO3\CMS\Extbase\Persistence\ObjectStorage();
            }, null, \TYPO3\CMS\Extbase\Persistence\Generic\Backend::class)();
        }

        // Extbase ConfigurationManager caches plugin TypoScript config in
        // `$configuration` and `$feConfigCache`, keyed by extName.pluginName.
        // Two pages rendering the SAME plugin with DIFFERENT TypoScript
        // overrides (e.g. settings.limit) would otherwise see the first
        // page's settings on the second render — wrong list lengths,
        // wrong storage PIDs, etc.
        if ($container->has(\TYPO3\CMS\Extbase\Configuration\ConfigurationManager::class)) {
            $extbaseConfigManager = $container->get(\TYPO3\CMS\Extbase\Configuration\ConfigurationManager::class);
            \Closure::bind(static function () use ($extbaseConfigManager): void {
                $extbaseConfigManager->configuration = [];
                $extbaseConfigManager->feConfigCache = [];
            }, null, \TYPO3\CMS\Extbase\Configuration\ConfigurationManager::class)();
        }

        // Extbase CacheService is `SingletonInterface` and uses a stack
        // (`$cacheTagStack`) + an associated `$clearCacheForTables` array
        // to batch cache-invalidation requests. If a request pushes onto
        // the stack but throws before the matching `clearCachesOfRegisteredPageIds()`
        // pop, the leftover scope is committed in the next request's
        // invalidation — wrong pages cleared, valid caches dropped.
        if ($container->has(\TYPO3\CMS\Extbase\Service\CacheService::class)) {
            $cacheService = $container->get(\TYPO3\CMS\Extbase\Service\CacheService::class);
            \Closure::bind(static function () use ($cacheService): void {
                $cacheService->clearCacheForTables = [];
                $cacheService->cacheTagStack = new \SplStack();
            }, null, \TYPO3\CMS\Extbase\Service\CacheService::class)();
        }

        // Extbase ValidatorResolver caches the (recursively-built)
        // ConjunctionValidator for each model class in
        // `$baseValidatorConjunctions`. For static TCA / annotations
        // the conjunction is stable across requests, so the cache
        // would be safe IF nothing else could mutate it — but
        // extensions may register dynamic validators per request,
        // and the merged conjunction then leaks into other requests
        // for the same model class. Reset to force rebuild from the
        // current set of registrations on first access.
        if ($container->has(\TYPO3\CMS\Extbase\Validation\ValidatorResolver::class)) {
            $validatorResolver = $container->get(\TYPO3\CMS\Extbase\Validation\ValidatorResolver::class);
            \Closure::bind(static function () use ($validatorResolver): void {
                $validatorResolver->baseValidatorConjunctions = [];
            }, null, \TYPO3\CMS\Extbase\Validation\ValidatorResolver::class)();
        }

        // MenuContentObjectFactory's TMENU-type → class-string map is
        // snapshotted at boot (see capture()) and restored here so a
        // mid-request `registerMenuType()` from one request can't
        // override another request's menu rendering.
        if ($container->has(\TYPO3\CMS\Frontend\ContentObject\Menu\MenuContentObjectFactory::class)) {
            $menuFactory = $container->get(\TYPO3\CMS\Frontend\ContentObject\Menu\MenuContentObjectFactory::class);
            $bootMapping = $snapshot->menuTypeToClassMapping;
            \Closure::bind(static function () use ($menuFactory, $bootMapping): void {
                $menuFactory->menuTypeToClassMapping = $bootMapping;
            }, null, \TYPO3\CMS\Frontend\ContentObject\Menu\MenuContentObjectFactory::class)();
        }

        // InMemoryLogWriter (cms-adminpanel) is a SingletonInterface that
        // accumulates every LogRecord written during a request. The admin
        // panel's DebugModule renders the array via getLogEntries(). Under
        // worker mode the array persists across requests, so User B sees
        // User A's debug output (SQL queries, variable dumps, stack traces).
        if ($container->has(\TYPO3\CMS\Adminpanel\Log\InMemoryLogWriter::class)) {
            $logWriter = $container->get(\TYPO3\CMS\Adminpanel\Log\InMemoryLogWriter::class);
            \Closure::bind(static function () use ($logWriter): void {
                $logWriter->log = [];
            }, null, \TYPO3\CMS\Adminpanel\Log\InMemoryLogWriter::class)();
        }

        // FilePersistenceSlot (cms-form) is a SingletonInterface that
        // whitelists file-system operations via allowInvocation(). The
        // whitelist persists: User A's allowed YAML-save path from a form
        // editor session could let User B's assertFileName() call pass
        // for a path B shouldn't touch.
        if ($container->has(\TYPO3\CMS\Form\Slot\FilePersistenceSlot::class)) {
            $filePersistenceSlot = $container->get(\TYPO3\CMS\Form\Slot\FilePersistenceSlot::class);
            \Closure::bind(static function () use ($filePersistenceSlot): void {
                $filePersistenceSlot->allowedInvocations = [];
            }, null, \TYPO3\CMS\Form\Slot\FilePersistenceSlot::class)();
        }

        // ResourcePublicationSlot (cms-form) is a SingletonInterface that
        // accumulates file identifiers added during form-upload processing.
        // has() checks on subsequent requests would return true for files
        // uploaded by a previous user.
        if ($container->has(\TYPO3\CMS\Form\Slot\ResourcePublicationSlot::class)) {
            $resourceSlot = $container->get(\TYPO3\CMS\Form\Slot\ResourcePublicationSlot::class);
            \Closure::bind(static function () use ($resourceSlot): void {
                $resourceSlot->fileIdentifiers = [];
            }, null, \TYPO3\CMS\Form\Slot\ResourcePublicationSlot::class)();
        }

        // PageTitleProviderManager memoizes the resolved page title
        // per provider class in `$pageTitleCache`. Without this reset,
        // a provider that returned "About" for page X in one request
        // and would normally return empty for page Y in the next
        // re-emits "About" via the empty-fallback at line 60 of the
        // class. Public reset API exists.
        if ($container->has(\TYPO3\CMS\Core\PageTitle\PageTitleProviderManager::class)) {
            $container->get(\TYPO3\CMS\Core\PageTitle\PageTitleProviderManager::class)
                ->setPageTitleCache([]);
        }

        // DI singletons with public state APIs.
        $container->get(PageRenderer::class)->updateState($snapshot->pageRendererState);
        $container->get(AssetCollector::class)->updateState($snapshot->assetCollectorState);
        $container->get(MetaTagManagerRegistry::class)->updateState($snapshot->metaTagRegistryState);

        // FlashMessageService has no public reset; the queues are a private property.
        $flashMessageService = $container->get(FlashMessageService::class);
        \Closure::bind(static function () use ($flashMessageService): void {
            $flashMessageService->flashMessageQueues = [];
        }, null, FlashMessageService::class)();

        // CSP PolicyRegistry / DirectiveHashCollection are
        // #[Autoconfigure(public: true)] singletons that accumulate per
        // request:
        //   - PolicyRegistry::$mutationCollections (appended via
        //     appendMutationCollection() from various controllers that
        //     temporarily widen CSP for the current view).
        //   - DirectiveHashCollection::$hashValues (appended via
        //     addInlineHash/addResourceHash/addGenericHashValue from
        //     PageRenderer / AssetRenderer for every script & style asset
        //     rendered on the page).
        // In worker mode both grow unbounded across requests. Independent
        // of growth, the next response's CSP header carries every
        // mutation/hash from every prior request — a potential
        // header-size blowup and a soft information-leak.
        // NOTE: this does not address the bigger CSP-nonce reuse issue —
        // see Tests/e2e/module/csp-nonce-uniqueness.spec.ts for that.
        if ($container->has(\TYPO3\CMS\Core\Security\ContentSecurityPolicy\PolicyRegistry::class)) {
            $policyRegistry = $container->get(\TYPO3\CMS\Core\Security\ContentSecurityPolicy\PolicyRegistry::class);
            \Closure::bind(static function () use ($policyRegistry): void {
                $policyRegistry->mutationCollections = [];
            }, null, \TYPO3\CMS\Core\Security\ContentSecurityPolicy\PolicyRegistry::class)();
        }
        if ($container->has(\TYPO3\CMS\Core\Security\ContentSecurityPolicy\DirectiveHashCollection::class)) {
            $directiveHashCollection = $container->get(\TYPO3\CMS\Core\Security\ContentSecurityPolicy\DirectiveHashCollection::class);
            \Closure::bind(static function () use ($directiveHashCollection): void {
                $directiveHashCollection->hashValues = [
                    'inline' => [],
                    'resource' => [],
                    'uri' => [],
                    'generic' => [],
                ];
            }, null, \TYPO3\CMS\Core\Security\ContentSecurityPolicy\DirectiveHashCollection::class)();
        }

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
