<?php

declare(strict_types=1);

/**
 * Pre-built dashboard preset that ships one `frankenphp-prometheus-metrics`
 * widget instance per metric in the widget's curated METRIC_CHOICES
 * catalogue. cms-dashboard auto-discovers this file from every installed
 * package and surfaces the preset in the "Add new dashboard" wizard.
 *
 * The `defaultWidgets[i].settings` shape comes from cms-dashboard's
 * `DashboardPreset::$defaultWidgets` PHPDoc:
 *   @param list<array{identifier: string, settings?: array<string, mixed>}>
 * — so each entry pre-populates the widget instance's user-configurable
 * settings (metric + label) before the user ever opens the settings
 * dialog. Each `label` becomes the dashboard header text the user sees
 * above each chart.
 *
 * Keep the `metric` keys here in sync with
 * `Ochorocho\FrankenPhp\Widget\PrometheusMetricsWidget::METRIC_CHOICES`.
 *
 * When cms-dashboard isn't installed, the cms-dashboard ServiceProvider
 * that scans this file simply doesn't run, so the file is silently inert
 * — no conditional guard needed here.
 */
return [
    'frankenphp-live-metrics' => [
        'title'          => 'LLL:EXT:frankenphp/Resources/Private/Language/locallang_dashboard.xlf:dashboard.preset.liveMetrics.title',
        'description'    => 'LLL:EXT:frankenphp/Resources/Private/Language/locallang_dashboard.xlf:dashboard.preset.liveMetrics.description',
        'iconIdentifier' => 'content-dashboard',
        'showInWizard'   => true,
        'defaultWidgets' => [
            // FrankenPHP worker pool — primary value of this extension.
            ['identifier' => 'frankenphp-prometheus-metrics', 'settings' => ['metric' => 'frankenphp_busy_threads', 'label' => 'Busy PHP threads']],
            ['identifier' => 'frankenphp-prometheus-metrics', 'settings' => ['metric' => 'frankenphp_queue_depth', 'label' => 'Queue depth']],
            ['identifier' => 'frankenphp-prometheus-metrics', 'settings' => ['metric' => 'frankenphp_ready_workers', 'label' => 'Ready workers']],
            ['identifier' => 'frankenphp-prometheus-metrics', 'settings' => ['metric' => 'frankenphp_total_threads', 'label' => 'Total PHP threads']],
            ['identifier' => 'frankenphp-prometheus-metrics', 'settings' => ['metric' => 'frankenphp_total_workers', 'label' => 'Total workers']],

            // Caddy admin endpoint + process-level metrics (always available).
            // The legacy caddy_http_* per-server families were removed in
            // Caddy v2.11+ in favor of OpenTelemetry-based observability.
            ['identifier' => 'frankenphp-prometheus-metrics', 'settings' => ['metric' => 'caddy_admin_http_requests_total', 'label' => 'Admin endpoint requests']],
            ['identifier' => 'frankenphp-prometheus-metrics', 'settings' => ['metric' => 'process_resident_memory_bytes', 'label' => 'Process RSS']],
            ['identifier' => 'frankenphp-prometheus-metrics', 'settings' => ['metric' => 'process_cpu_seconds_total', 'label' => 'Process CPU seconds']],
            ['identifier' => 'frankenphp-prometheus-metrics', 'settings' => ['metric' => 'process_open_fds', 'label' => 'Open file descriptors']],

            // Go runtime — opcache-bloat / GC pressure detection during soak.
            ['identifier' => 'frankenphp-prometheus-metrics', 'settings' => ['metric' => 'go_goroutines', 'label' => 'Goroutines']],
            ['identifier' => 'frankenphp-prometheus-metrics', 'settings' => ['metric' => 'go_memstats_alloc_bytes', 'label' => 'Go memory allocated']],
            ['identifier' => 'frankenphp-prometheus-metrics', 'settings' => ['metric' => 'go_memstats_heap_alloc_bytes', 'label' => 'Go heap alloc bytes']],
            ['identifier' => 'frankenphp-prometheus-metrics', 'settings' => ['metric' => 'go_memstats_heap_objects', 'label' => 'Go heap objects']],
            ['identifier' => 'frankenphp-prometheus-metrics', 'settings' => ['metric' => 'go_threads', 'label' => 'Go threads']],
        ],
    ],
];
