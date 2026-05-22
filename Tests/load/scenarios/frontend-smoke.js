/**
 * Frontend smoke test — 1 VU × 30 s.
 *
 * Cheapest possible sanity check: a single virtual user requests every
 * Camino frontend route in a loop for 30 s. Catches "server is down",
 * "frontend rendering is broken", "TLS cert handshake fails" before
 * spending minutes on a larger scenario.
 *
 *   k6 run scenarios/frontend-smoke.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { CONFIG, FRONTEND_PATHS, REQUEST_PARAMS } from '../lib/config.js';
import { defaultThresholds } from '../lib/thresholds.js';
import { okStatus, looksLikeCaminoPage, noPHPError } from '../lib/checks.js';

export const options = {
    insecureSkipTLSVerify: true,
    scenarios: {
        smoke: {
            executor: 'constant-vus',
            vus:      1,
            duration: '30s',
        },
    },
    thresholds: defaultThresholds,
};

/**
 * One-off worker warmup before the measured iterations begin.
 *
 * k6's `setup()` runs exactly once at the start of the test and its
 * own HTTP requests are emitted into a separate metric scope that
 * thresholds do not gate on — perfect for absorbing the FrankenPHP
 * worker's first-request boot cost (1–3 s on cold CI runners). Without
 * this, the 1 VU × 30 s smoke yields ~48 measured requests of which
 * exactly one carries the boot cost, and the p95 (top 5% ≈ 2 samples)
 * latches onto that single outlier — tripping the 500 ms gate.
 *
 * https://grafana.com/docs/k6/latest/using-k6/test-lifecycle/
 */
export function setup() {
    http.get(`${CONFIG.baseUrl}${FRONTEND_PATHS[0]}`, REQUEST_PARAMS);
}

export default function () {
    for (const path of FRONTEND_PATHS) {
        const res = http.get(`${CONFIG.baseUrl}${path}`, REQUEST_PARAMS);
        check(res, { ...okStatus, ...looksLikeCaminoPage, ...noPHPError });
        sleep(0.5);
    }
}
