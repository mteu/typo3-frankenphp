/**
 * Install tool load test — 10 VUs × 2 min.
 *
 * Hits `/?__typo3_install` repeatedly. Unlike the worker-mode path, the
 * failsafe runs as PER-REQUEST PHP (no worker), so latency is bounded
 * by PHP-FPM-style boot cost. The threshold for this scenario is
 * deliberately looser to reflect that (cf. installToolThresholds).
 *
 *   k6 run scenarios/install-tool-load.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { CONFIG, REQUEST_PARAMS } from '../lib/config.js';
import { installToolThresholds } from '../lib/thresholds.js';
import { okStatus, looksLikeInstallTool } from '../lib/checks.js';

export const options = {
    insecureSkipTLSVerify: true,
    scenarios: {
        load: {
            executor: 'constant-vus',
            vus:      10,
            duration: '2m',
        },
    },
    thresholds: installToolThresholds,
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
    const res = http.get(`${CONFIG.baseUrl}/?__typo3_install`, REQUEST_PARAMS);
    check(res, { ...okStatus, ...looksLikeInstallTool });
    sleep(1);
}
