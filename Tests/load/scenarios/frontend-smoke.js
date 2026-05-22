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

export default function () {
    for (const path of FRONTEND_PATHS) {
        const res = http.get(`${CONFIG.baseUrl}${path}`, REQUEST_PARAMS);
        check(res, { ...okStatus, ...looksLikeCaminoPage, ...noPHPError });
        sleep(0.5);
    }
}
