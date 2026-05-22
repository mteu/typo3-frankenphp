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

export default function () {
    const res = http.get(`${CONFIG.baseUrl}/?__typo3_install`, REQUEST_PARAMS);
    check(res, { ...okStatus, ...looksLikeInstallTool });
    sleep(1);
}
