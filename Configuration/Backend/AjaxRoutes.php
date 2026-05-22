<?php

declare(strict_types=1);

use Ochorocho\FrankenPhp\Controller\Backend\MetricsAjaxController;

/**
 * Backend AJAX routes for the FrankenPHP dashboard widget. The widget's
 * Lit web component polls this route every few seconds, the controller
 * scrapes localhost:METRICS_PORT/metrics and returns parsed JSON.
 *
 * The PHP curl loopback bypasses Caddy admin's CSRF guard (no Origin
 * header sent), so we can hit the admin endpoint server-side even
 * though browsers can't.
 */
return [
    'frankenphp_metrics' => [
        'path'   => '/frankenphp/metrics',
        'target' => MetricsAjaxController::class . '::indexAction',
    ],
];
