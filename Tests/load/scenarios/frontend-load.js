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


/**
 * Cold-boot warmup — see frontend-smoke.js for rationale. The first
 * worker request after frankenphp boot pays a 1–3 s startup cost
 * that distorts percentile thresholds in short scenarios; running a
 * throwaway request from setup() (which is excluded from threshold
 * metrics) keeps the measured window clean.
 */
export function setup() {
    // Loop so the warmup hits every worker slot at least once — see
    // frontend-smoke.js for the full rationale.
    const path = typeof FRONTEND_PATHS !== 'undefined' ? FRONTEND_PATHS : ['/?__typo3_install'];
    for (let i = 0; i < 10; i++) {
        http.get(`${CONFIG.baseUrl}${path[i % path.length]}`, REQUEST_PARAMS);
    }
}

export default function () {
    const res = http.get(`${CONFIG.baseUrl}${randomFrontendPath()}`, REQUEST_PARAMS);
    check(res, { ...okStatus, ...looksLikeCaminoPage, ...noPHPError });
    sleep(1);
}
