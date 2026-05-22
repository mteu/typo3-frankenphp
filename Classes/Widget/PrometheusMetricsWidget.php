<?php

declare(strict_types=1);

namespace Ochorocho\FrankenPhp\Widget;

use TYPO3\CMS\Backend\Routing\UriBuilder;
use TYPO3\CMS\Backend\View\BackendViewFactory;
use TYPO3\CMS\Core\Page\JavaScriptModuleInstruction;
use TYPO3\CMS\Core\Settings\SettingDefinition;
use TYPO3\CMS\Dashboard\Widgets\AdditionalCssInterface;
use TYPO3\CMS\Dashboard\Widgets\JavaScriptInterface;
use TYPO3\CMS\Dashboard\Widgets\WidgetConfigurationInterface;
use TYPO3\CMS\Dashboard\Widgets\WidgetContext;
use TYPO3\CMS\Dashboard\Widgets\WidgetRendererInterface;
use TYPO3\CMS\Dashboard\Widgets\WidgetResult;

/**
 * Live Prometheus metrics widget. Renders a Chart.js chart whose data
 * is polled every few seconds from the AJAX endpoint that proxies
 * Caddy's /metrics. Chart type is derived from the metric's Prometheus
 * TYPE (counter/gauge → line, summary → multi-line per quantile,
 * histogram → bar of bucket distribution).
 *
 * Settings (rendered as a native TYPO3 dashboard widget settings dialog
 * via getSettingsDefinitions()):
 *   - metric: which Prometheus metric family to chart
 *   - label:  optional title override; falls back to the metric name
 */
final readonly class PrometheusMetricsWidget implements
    WidgetRendererInterface,
    JavaScriptInterface,
    AdditionalCssInterface
{
    /**
     * Curated picker enum — covers FrankenPHP, the most useful Caddy
     * HTTP metrics, and a handful of Go runtime gauges. Add entries
     * here (or override the SettingDefinition.enum at registration
     * time) to surface additional metrics in the dropdown.
     */
    // Keep this list in sync with what FrankenPHP / Caddy / Go runtime
    // ACTUALLY emit on the admin /metrics endpoint — adding a metric
    // here that the endpoint doesn't expose will trigger the widget's
    // "metric not exposed" error at runtime. To enumerate authoritative
    // names: `curl http://localhost:2019/metrics | grep "^# TYPE"`.
    private const array METRIC_CHOICES = [
        'frankenphp_busy_threads'                    => 'frankenphp_busy_threads (gauge)',
        'frankenphp_busy_workers'                    => 'frankenphp_busy_workers (gauge)',
        'frankenphp_queue_depth'                     => 'frankenphp_queue_depth (gauge)',
        'frankenphp_ready_workers'                   => 'frankenphp_ready_workers (gauge)',
        'frankenphp_total_threads'                   => 'frankenphp_total_threads (counter)',
        'frankenphp_total_workers'                   => 'frankenphp_total_workers (gauge)',
        'frankenphp_worker_request_count'            => 'frankenphp_worker_request_count (counter)',
        'caddy_http_requests_in_flight'              => 'caddy_http_requests_in_flight (gauge)',
        'caddy_http_requests_total'                  => 'caddy_http_requests_total (counter)',
        'caddy_http_request_duration_seconds'        => 'caddy_http_request_duration_seconds (histogram)',
        'caddy_http_request_size_bytes'              => 'caddy_http_request_size_bytes (histogram)',
        'caddy_http_response_size_bytes'             => 'caddy_http_response_size_bytes (histogram)',
        'go_goroutines'                              => 'go_goroutines (gauge)',
        'go_memstats_alloc_bytes'                    => 'go_memstats_alloc_bytes (gauge)',
        'go_memstats_heap_alloc_bytes'               => 'go_memstats_heap_alloc_bytes (gauge)',
        'go_memstats_heap_objects'                   => 'go_memstats_heap_objects (gauge)',
        'go_threads'                                 => 'go_threads (gauge)',
    ];

    public function __construct(
        // $configuration is required by the cms-dashboard DI compiler pass
        // (it's named-injected for every dashboard.widget tagged service),
        // and gives us the widget identifier / static metadata. We surface
        // it to the Fluid template so callers can reference it if they
        // ever override the template.
        private WidgetConfigurationInterface $configuration,
        private BackendViewFactory $backendViewFactory,
        private UriBuilder $uriBuilder,
    ) {}

    public function getSettingsDefinitions(): array
    {
        return [
            new SettingDefinition(
                key: 'metric',
                type: 'string',
                default: 'frankenphp_busy_threads',
                label: 'LLL:EXT:frankenphp/Resources/Private/Language/locallang_dashboard.xlf:widget.prometheusMetrics.setting.metric.label',
                description: 'LLL:EXT:frankenphp/Resources/Private/Language/locallang_dashboard.xlf:widget.prometheusMetrics.setting.metric.description',
                enum: self::METRIC_CHOICES,
            ),
            new SettingDefinition(
                key: 'label',
                type: 'string',
                default: '',
                label: 'LLL:EXT:frankenphp/Resources/Private/Language/locallang_dashboard.xlf:widget.prometheusMetrics.setting.label.label',
                description: 'LLL:EXT:frankenphp/Resources/Private/Language/locallang_dashboard.xlf:widget.prometheusMetrics.setting.label.description',
            ),
        ];
    }

    public function renderWidget(WidgetContext $context): WidgetResult
    {
        $metric = (string)$context->settings->get('metric');
        $label = (string)$context->settings->get('label');

        $view = $this->backendViewFactory->create($context->request, ['ochorocho/frankenphp']);
        $view->assignMultiple([
            'instance'      => $context->identifier,
            'metric'        => $metric,
            'label'         => $label !== '' ? $label : $metric,
            // TYPO3 prefixes AjaxRoutes.php entries with `ajax_` in its
            // internal route registry, so the lookup name is not the
            // bare key from AjaxRoutes.php — it's `ajax_<key>`.
            'ajaxUrl'       => (string)$this->uriBuilder->buildUriFromRoute('ajax_frankenphp_metrics'),
            'configuration' => $this->configuration,
        ]);

        return new WidgetResult(
            content: $view->render('Widget/PrometheusMetrics'),
            label: $label !== '' ? $label : null,
            refreshable: false,
        );
    }

    public function getJavaScriptModuleInstructions(): array
    {
        // The web component self-registers under <frankenphp-prometheus-widget>
        // on module load; no invoke() needed — the Fluid template ships
        // the custom element instance with all data-* attributes the
        // component reads on connectedCallback.
        return [
            JavaScriptModuleInstruction::create('@ochorocho/frankenphp/widget/prometheus-metrics.js'),
        ];
    }

    public function getCssFiles(): array
    {
        return ['EXT:frankenphp/Resources/Public/Css/widget/prometheus-metrics.css'];
    }
}
