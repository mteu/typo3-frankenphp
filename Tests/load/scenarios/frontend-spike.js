/**
 * Frontend spike test — 0 → 200 VUs in 30 s, hold 30 s, drop to 0.
 *
 * Goal: validate that FrankenPHP recovers cleanly after a sudden burst.
 * The worker pool should saturate during the spike (latency spikes,
 * possibly some queueing errors are acceptable) but error rate must
 * return to ~0 within the cool-down. A persistent error rate post-
 * spike indicates a leaked / corrupted singleton in the worker.
 *
 *   k6 run scenarios/frontend-spike.js
 */

import http from 'k6/http';
import { check } from 'k6';
import { CONFIG, randomFrontendPath, REQUEST_PARAMS } from '../lib/config.js';
import { saturationThresholds } from '../lib/thresholds.js';
import { okStatus } from '../lib/checks.js';

export const options = {
    insecureSkipTLSVerify: true,
    scenarios: {
        spike: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { target: 200, duration: '30s' },  // burst
                { target: 200, duration: '30s' },  // hold
                { target:   0, duration: '30s' },  // cool down
            ],
            gracefulRampDown: '10s',
        },
    },
    thresholds: saturationThresholds,
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
    check(res, okStatus);
    // No sleep — the spike is *meant* to overload the server briefly.
}
