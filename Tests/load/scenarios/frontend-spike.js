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

export default function () {
    const res = http.get(`${CONFIG.baseUrl}${randomFrontendPath()}`, REQUEST_PARAMS);
    check(res, okStatus);
    // No sleep — the spike is *meant* to overload the server briefly.
}
