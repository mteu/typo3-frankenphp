/**
 * Frontend stress test — ramp 0 → 100 VUs over ~5 min.
 *
 * Goal: identify the saturation point of the FrankenPHP worker pool +
 * SQLite frontend rendering on this host. Look at the k6 summary's
 * `iteration_duration` and `http_req_duration` percentile breakdown to
 * see where latency takes off relative to VU count.
 *
 * Tuning hint: if you raise FRANKENPHP_WORKER_COUNT in Build/.env and
 * re-run, the inflection point should shift right (more VUs handled
 * before saturation). If it doesn't, the bottleneck is elsewhere
 * (SQLite, GFX/ImageMagick, etc).
 *
 *   k6 run scenarios/frontend-stress.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { CONFIG, randomFrontendPath, REQUEST_PARAMS } from '../lib/config.js';
import { saturationThresholds } from '../lib/thresholds.js';
import { okStatus, noPHPError } from '../lib/checks.js';

export const options = {
    insecureSkipTLSVerify: true,
    scenarios: {
        stress: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { target:  10, duration: '30s' },  // warm up
                { target:  50, duration: '2m'  },  // step up
                { target: 100, duration: '2m'  },  // peak
                { target:   0, duration: '30s' },  // ramp down
            ],
            gracefulRampDown: '15s',
        },
    },
    thresholds: saturationThresholds,
};

export default function () {
    const res = http.get(`${CONFIG.baseUrl}${randomFrontendPath()}`, REQUEST_PARAMS);
    check(res, { ...okStatus, ...noPHPError });
    sleep(Math.random() * 0.5 + 0.5);  // 0.5–1 s jitter, more realistic
}
