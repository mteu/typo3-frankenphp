<?php

declare(strict_types=1);

namespace Ochorocho\FrankenPhp\Worker;

/**
 * Immutable snapshot of TYPO3 singleton state captured immediately after
 * Bootstrap::init() and replayed at the start of every worker request.
 */
final class WorkerStateSnapshot
{
    /**
     * @param array<string, mixed> $pageRendererState
     * @param array<string, mixed> $assetCollectorState
     * @param array<string, mixed> $metaTagRegistryState
     */
    public function __construct(
        public readonly array $pageRendererState,
        public readonly array $assetCollectorState,
        public readonly array $metaTagRegistryState,
    ) {}
}
