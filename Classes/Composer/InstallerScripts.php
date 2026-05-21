<?php

declare(strict_types=1);

namespace Ochorocho\FrankenPhp\Composer;

use Composer\Script\Event;
use TYPO3\CMS\Composer\Plugin\Core\InstallerScriptsRegistration;
use TYPO3\CMS\Composer\Plugin\Core\ScriptDispatcher;

class InstallerScripts implements InstallerScriptsRegistration
{
    public static function register(Event $event, ScriptDispatcher $scriptDispatcher): void
    {
        // Skip when this extension itself is the root package — i.e. someone
        // ran `composer install` at the extension repo root rather than in a
        // TYPO3 project. There's no TYPO3 install to initialize there (the
        // root composer.json only requires typo3/cms-core, so cms-backend is
        // absent and TYPO3's DI compilation fails on missing services like
        // `backend.routes`). Running frankenphp:init in that context produces
        // a confusing trace that obscures the actual problem (wrong CWD).
        if ($event->getComposer()->getPackage()->getName() === 'ochorocho/frankenphp') {
            return;
        }

        // Auto-generate all required files: worker.php, .env, Caddyfile, php.ini
        $scriptDispatcher->addInstallerScript(new RunFrankenphpInit());
    }
}
