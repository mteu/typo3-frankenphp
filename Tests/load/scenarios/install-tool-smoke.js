/**
 * Install tool smoke test — 1 VU × 30 s.
 *
 * Confirms `?__typo3_install` keeps routing to per-request /index.php
 * (failsafe boot) rather than landing on the worker. The Caddyfile's
 * @typo3_install matcher does the rewrite. A regression there would
 * either return the backend shell or 404 — both flagged by the checks.
 *
 *   k6 run scenarios/install-tool-smoke.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { CONFIG, REQUEST_PARAMS } from '../lib/config.js';
import { installToolThresholds } from '../lib/thresholds.js';
import { okStatus, looksLikeInstallTool } from '../lib/checks.js';

export const options = {
    insecureSkipTLSVerify: true,
    scenarios: {
        smoke: {
            executor: 'constant-vus',
            vus:      1,
            duration: '30s',
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
    http.get(`${CONFIG.baseUrl}${typeof FRONTEND_PATHS !== 'undefined' ? FRONTEND_PATHS[0] : '/?__typo3_install'}`, REQUEST_PARAMS);
}

export default function () {
    const res = http.get(`${CONFIG.baseUrl}/?__typo3_install`, REQUEST_PARAMS);
    check(res, { ...okStatus, ...looksLikeInstallTool });
    sleep(1);
}
