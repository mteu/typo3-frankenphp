<?php

declare(strict_types=1);

return [
    'backend' => [
        // Worker-mode workaround: TYPO3's response emitter wipes PHP-native
        // Set-Cookie headers under FrankenPHP. This middleware re-injects
        // them into the PSR-7 response on the way out. See the class
        // docblock for the full trace.
        'ochorocho/frankenphp/preserve-native-session-cookies' => [
            'target' => \Ochorocho\FrankenPhp\Middleware\PreserveNativeSessionCookies::class,
        ],
    ],
];
