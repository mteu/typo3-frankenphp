<?php

declare(strict_types=1);

namespace Ochorocho\FrankenPhp\Composer;

use Composer\Script\Event;
use TYPO3\CMS\Composer\Plugin\Core\InstallerScriptsRegistration;
use TYPO3\CMS\Composer\Plugin\Core\InstallerScripts\EntryPoint;
use TYPO3\CMS\Composer\Plugin\Core\ScriptDispatcher;

class InstallerScripts implements InstallerScriptsRegistration
{
    public static function register(Event $event, ScriptDispatcher $scriptDispatcher): void
    {
        $scriptDispatcher->addInstallerScript(
            new EntryPoint(
                dirname(__DIR__, 2) . '/Resources/Private/Php/worker.php',
                'worker.php'
            )
        );
    }
}
