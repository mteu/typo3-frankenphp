<?php

declare(strict_types=1);

namespace Ochorocho\FrankenPhp\Event;

use Psr\Container\ContainerInterface;

/**
 * Dispatched at the start of every FrankenPHP worker request, after the
 * built-in snapshot has been restored but before the TYPO3 Application runs.
 *
 * Listeners can perform additional per-request resets (cache front-ends,
 * custom registries, third-party singletons).
 */
final class WorkerRequestStartingEvent
{
    public function __construct(
        public readonly ContainerInterface $container,
    ) {}
}
