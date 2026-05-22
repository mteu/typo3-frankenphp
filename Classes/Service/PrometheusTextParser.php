<?php

declare(strict_types=1);

namespace Ochorocho\FrankenPhp\Service;

/**
 * Minimal parser for the Prometheus text exposition format
 * (https://prometheus.io/docs/instrumenting/exposition_formats/).
 *
 * Why hand-rolled: the obvious community package (butschster/prometheus-parser)
 * relies on a PEG grammar that rejects valid Prometheus samples with empty
 * label values — Caddy emits `go_build_info{checksum="",path="",version=""}`
 * which is spec-compliant but trips the parser's grammar. Writing this
 * one-shot ~80 line parser removes the third-party-bug dependency, and
 * the exposition format is tiny enough that a regex-based parser is the
 * pragmatic choice.
 *
 * Returns an associative array keyed by metric family name:
 *   [
 *     'frankenphp_busy_threads' => [
 *       'type'        => 'gauge',
 *       'description' => 'Number of busy PHP threads',
 *       'samples'     => [
 *         ['labels' => [], 'value' => 2.0],
 *       ],
 *     ],
 *     'caddy_http_request_duration_seconds' => [
 *       'type'        => 'histogram',
 *       'description' => '…',
 *       'samples'     => [
 *         ['labels' => ['le' => '0.005', 'server' => 'srv0'], 'value' => 12.0],
 *         …
 *       ],
 *     ],
 *   ]
 *
 * For histogram families, samples include all `_bucket`, `_sum`, `_count`
 * series under the parent metric name (Prometheus convention). Same for
 * summary families (quantile-labelled samples + `_sum` + `_count`).
 */
final class PrometheusTextParser
{
    /**
     * @return array<string, array{type: string, description: ?string, samples: list<array{labels: array<string, string>, value: float|null}>}>
     */
    public function parse(string $text): array
    {
        $metrics = [];
        $typeFor = [];           // simple-name → type
        $descriptionFor = [];    // simple-name → help text

        foreach (preg_split('/\r?\n/', $text) as $line) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }

            if ($line[0] === '#') {
                if (preg_match('/^# TYPE (\S+) (\S+)/', $line, $m)) {
                    $typeFor[$m[1]] = $m[2];
                    continue;
                }
                if (preg_match('/^# HELP (\S+) (.*)$/', $line, $m)) {
                    $descriptionFor[$m[1]] = $m[2];
                }
                continue;
            }

            // Sample line: <name>[{labels}] <value> [<timestamp>]
            if (!preg_match('/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(\S+)(?:\s+\S+)?$/', $line, $m)) {
                // Silently skip lines we can't parse — exporters occasionally
                // emit edge-case formats (OpenMetrics extensions, info-only
                // lines). Failing the whole scrape over one bad line would
                // be worse than degrading.
                continue;
            }

            $sampleName = $m[1];
            // $m[2] is the optional `{labels}` capture — preg_match always
            // populates an empty string for unmatched optional groups, so
            // the null-coalesce was redundant.
            $labels = $this->parseLabels($m[2]);
            $value = $this->parseValue($m[3]);

            // For histograms/summaries, samples like `metric_bucket`, `metric_sum`,
            // `metric_count` belong to the parent `metric` family.
            $familyName = $this->familyNameFor($sampleName, $typeFor);

            if (!isset($metrics[$familyName])) {
                $metrics[$familyName] = [
                    'type'        => $typeFor[$familyName] ?? 'untyped',
                    'description' => $descriptionFor[$familyName] ?? null,
                    'samples'     => [],
                ];
            }
            $metrics[$familyName]['samples'][] = [
                'labels' => $labels,
                'value'  => $value,
            ];
        }

        return $metrics;
    }

    /**
     * @return array<string, string>
     */
    private function parseLabels(string $labelBlock): array
    {
        if ($labelBlock === '' || $labelBlock === '{}') {
            return [];
        }
        // Strip surrounding braces.
        $inner = substr($labelBlock, 1, -1);
        $labels = [];
        // Match key="value" pairs with proper handling of escaped backslashes
        // and quotes inside the value (`\\` and `\"`).
        if (preg_match_all('/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\\\]|\\\\.)*)"/', $inner, $matches, PREG_SET_ORDER) !== false) {
            foreach ($matches as $match) {
                $labels[$match[1]] = strtr($match[2], ['\\"' => '"', '\\\\' => '\\', '\\n' => "\n"]);
            }
        }
        return $labels;
    }

    private function parseValue(string $raw): ?float
    {
        // Prometheus uses `+Inf`, `-Inf`, `NaN` as valid sample values. Chart.js
        // can't plot Inf/NaN so we surface them as null.
        if ($raw === '+Inf' || $raw === 'Inf') {
            return null;
        }
        if ($raw === '-Inf' || $raw === 'NaN') {
            return null;
        }
        return is_numeric($raw) ? (float)$raw : null;
    }

    /**
     * Map a sample line's name back to its family name. For histograms
     * (`<f>_bucket` / `<f>_sum` / `<f>_count`) and summaries (`<f>_sum`
     * / `<f>_count`), the family is the prefix; for everything else the
     * sample name IS the family.
     *
     * @param array<string, string> $typeFor
     */
    private function familyNameFor(string $sampleName, array $typeFor): string
    {
        foreach (['_bucket', '_sum', '_count'] as $suffix) {
            if (str_ends_with($sampleName, $suffix)) {
                $candidate = substr($sampleName, 0, -strlen($suffix));
                $parentType = $typeFor[$candidate] ?? null;
                if ($parentType === 'histogram' || $parentType === 'summary') {
                    return $candidate;
                }
            }
        }
        return $sampleName;
    }
}
