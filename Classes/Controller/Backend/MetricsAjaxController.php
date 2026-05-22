<?php

declare(strict_types=1);

namespace Ochorocho\FrankenPhp\Controller\Backend;

use Ochorocho\FrankenPhp\Service\PrometheusTextParser;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use TYPO3\CMS\Core\Http\JsonResponse;
use TYPO3\CMS\Core\Http\RequestFactory;

final class MetricsAjaxController
{
    public function __construct(
        private readonly RequestFactory $requestFactory,
        private readonly PrometheusTextParser $parser,
    ) {}

    public function indexAction(ServerRequestInterface $request): ResponseInterface
    {
        $port = $this->resolveMetricsPort();
        // The IP can be hardcoded here, as we assume we're running FrankenPHP locally.
        // So only the port is subject to change
        $url = sprintf('http://127.0.0.1:%d/metrics', $port);

        try {
            $response = $this->requestFactory->request($url, 'GET', [
                'timeout'         => 5.0,
                'connect_timeout' => 2.0,
                'http_errors'     => false,
            ]);
        } catch (\Throwable $e) {
            return new JsonResponse(
                [
                    'error'   => 'metrics endpoint unreachable',
                    'url'     => $url,
                    'detail'  => $e->getMessage(),
                    'hint'    => 'Run `vendor/bin/typo3 frankenphp:init --prometheus` and restart frankenphp.',
                ],
                503,
            );
        }

        if ($response->getStatusCode() !== 200) {
            return new JsonResponse(
                [
                    'error' => sprintf('metrics endpoint returned HTTP %d', $response->getStatusCode()),
                    'url'   => $url,
                ],
                502,
            );
        }

        return new JsonResponse([
            'url'     => $url,
            'metrics' => $this->parser->parse((string)$response->getBody()),
        ]);
    }

    private function resolveMetricsPort(): int
    {
        $env = getenv('METRICS_PORT');
        if ($env !== false && ctype_digit((string)$env)) {
            $port = (int)$env;
            if ($port > 0 && $port <= 65535) {
                return $port;
            }
        }
        return 2019;
    }
}
