<?php

declare(strict_types=1);

namespace Ochorocho\FrankenPhp\EventListener;

use TYPO3\CMS\Backend\Backend\Event\SystemInformationToolbarCollectorEvent;
use TYPO3\CMS\Core\Attribute\AsEventListener;

/**
 * Adds a "Worker Mode" row to the System Information dropdown in the backend
 * topbar showing whether FrankenPHP worker mode is active for the current
 * request — Enabled when served by the long-running worker, Disabled when
 * served by per-request PHP execution (e.g. install-tool recovery URL).
 *
 * Detection relies on the TYPO3_FRANKENPHP_WORKER_MODE constant defined
 * in `Resources/Private/Php/worker.php`: when the constant is true the worker
 * dispatched this request; when undefined the request was served by
 * `public/index.php`.
 */
final readonly class AddFrankenPhpModeToSystemInformation
{
    #[AsEventListener('frankenphp/mode-info')]
    public function __invoke(SystemInformationToolbarCollectorEvent $event): void
    {
        $event->getToolbarItem()->addSystemInformation(
            'Worker Mode',
            ($this->isWorkerModeEnabled() ? 'Enabled' : 'Disabled'),
            'frankenphp',
        );
    }

    private function isWorkerModeEnabled(): bool
    {
        return defined('TYPO3_FRANKENPHP_WORKER_MODE') && TYPO3_FRANKENPHP_WORKER_MODE === true;
    }
}
