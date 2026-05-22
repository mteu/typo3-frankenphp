/**
 * Frontend load test — 20 VUs × 2 min.
 *
 * Steady-state anonymous traffic against the Camino frontend routes.
 * Each VU picks a random route per iteration with a 1 s think-time —
 * the goal is a realistic-looking sustained workload that the worker
 * mode hot path should handle comfortably (p95 < 500 ms).
 *
 *   k6 run scenarios/frontend-load.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { CONFIG, randomFrontendPath, REQUEST_PARAMS } from '../lib/config.js';
import { defaultThresholds } from '../lib/thresholds.js';
import { okStatus, looksLikeCaminoPage, noPHPError } from '../lib/checks.js';

export const options = {
    insecureSkipTLSVerify: true,
    scenarios: {
        load: {
            executor: 'constant-vus',
            vus:      20,
            duration: '2m',
        },
    },
    thresholds: defaultThresholds,
};

export default function () {
    const res = http.get(`${CONFIG.baseUrl}${randomFrontendPath()}`, REQUEST_PARAMS);
    check(res, { ...okStatus, ...looksLikeCaminoPage, ...noPHPError });
    sleep(1);
}
