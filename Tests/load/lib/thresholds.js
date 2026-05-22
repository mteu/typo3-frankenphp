/**
 * Shared k6 thresholds.
 *
 * Failing a threshold in k6 marks the run as failed (exit code 99 by
 * default). Numbers calibrated for the dev sandbox (SQLite + 2-worker
 * FrankenPHP on a developer laptop) — tighten them once a production
 * baseline exists.
 */

// Used by smoke / load / soak scenarios. p95 < 500 ms covers a healthy
// anonymous frontend response on the worker mode hot path. p99 < 3000 ms
// is intentionally loose because the very first request after frankenphp
// boot pays the worker-warmup cost (5–7 s on a cold container) and that
// one sample dominates the 99th percentile in short smoke runs.
export const defaultThresholds = {
    http_req_duration: ['p(95)<500', 'p(99)<3000'],
    http_req_failed:   ['rate<0.01'],
    checks:            ['rate>0.99'],
};

// Backend (authenticated) requests trip a heavier code path —
// StateSnapshotService runs on every request, plus TYPO3 backend hits
// the session DB. 1 s p95 is a reasonable expectation under steady load.
export const backendThresholds = {
    http_req_duration: ['p(95)<1000', 'p(99)<3000'],
    http_req_failed:   ['rate<0.02'],
    checks:            ['rate>0.98'],
};

// Stress / spike scenarios deliberately drive the server to saturation;
// p95 above 500 ms is the *expected* outcome past the breaking point.
// The threshold here only catches "completely broken" — high error rate
// or thresholds we never want to violate even at peak.
export const saturationThresholds = {
    http_req_duration: ['p(95)<3000', 'p(99)<10000'],
    http_req_failed:   ['rate<0.10'],
    checks:            ['rate>0.90'],
};

// Install-tool failsafe runs as per-request PHP (no worker) — slower
// boot per request, so allow looser timings than worker-mode frontend.
export const installToolThresholds = {
    http_req_duration: ['p(95)<1500', 'p(99)<5000'],
    http_req_failed:   ['rate<0.01'],
    checks:            ['rate>0.99'],
};
