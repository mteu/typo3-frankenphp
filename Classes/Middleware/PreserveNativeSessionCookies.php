<?php

declare(strict_types=1);

namespace Ochorocho\FrankenPhp\Middleware;

use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Worker-mode workaround for TYPO3 Core's response emitter clobbering
 * PHP-native Set-Cookie headers.
 *
 * The install tool's BackendModuleController calls session_start() +
 * session_regenerate_id() inside the worker request, which uses PHP's
 * header() function to emit Set-Cookie for the Typo3InstallTool session.
 * TYPO3's AbstractApplication::sendResponse then iterates the PSR-7
 * response headers and does header('Set-Cookie: ...', true) on the FIRST
 * iteration of the Set-Cookie values — which removes every pre-existing
 * Set-Cookie header, including PHP's session cookie. The browser receives
 * no install-tool cookie, the next ?__typo3_install AJAX request lands
 * without a session, the install tool 403s the call, and router.js
 * renders "The Install Tool session expired" inside the iframe.
 *
 * Under PHP-FPM this race never happens: PHP sends its session cookie at
 * request shutdown — AFTER the emitter has run — so the cookie survives.
 * Worker mode (FrankenPHP, RoadRunner, etc.) emits the response while
 * session machinery has already added the cookie, exposing the bug.
 *
 * This middleware runs on the way out: it captures every PHP-native
 * Set-Cookie that doesn't already exist in the PSR-7 response, merges
 * them in via withAddedHeader, then header_remove('Set-Cookie') so the
 * emitter is the single source of truth.
 */
final class PreserveNativeSessionCookies implements MiddlewareInterface
{
    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        $response = $handler->handle($request);

        $existingCookieNames = [];
        foreach ($response->getHeader('Set-Cookie') as $existing) {
            $eq = strpos($existing, '=');
            if ($eq !== false) {
                $existingCookieNames[strtolower(substr($existing, 0, $eq))] = true;
            }
        }

        foreach (\headers_list() as $header) {
            if (stripos($header, 'Set-Cookie:') !== 0) {
                continue;
            }
            $value = trim(substr($header, 11));
            $eq = strpos($value, '=');
            if ($eq === false) {
                continue;
            }
            $cookieName = strtolower(substr($value, 0, $eq));
            if (isset($existingCookieNames[$cookieName])) {
                // PSR-7 response already carries a cookie with this name —
                // assume the controller meant to override.
                continue;
            }
            $response = $response->withAddedHeader('Set-Cookie', $value);
            $existingCookieNames[$cookieName] = true;
        }

        // Drop PHP's accumulated Set-Cookie headers so the emitter is the
        // single source of truth (otherwise the emitter's replace=true on
        // first iteration would still wipe them and reintroduce the bug).
        \header_remove('Set-Cookie');

        return $response;
    }
}
