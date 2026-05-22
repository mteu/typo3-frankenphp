/**
 * Reusable k6 check definitions. Pass these to k6's `check()` like:
 *
 *   import { check } from 'k6';
 *   import { okStatus, noPHPError } from '../lib/checks.js';
 *
 *   check(res, { ...okStatus, ...noPHPError });
 *
 * The keys (e.g. "status is 2xx") become the check names in the k6 summary.
 */

export const okStatus = {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
};

export const okOrRedirect = {
    'status is 2xx or 3xx': (r) => r.status >= 200 && r.status < 400,
};

// TYPO3 / PHP fatal error markers should never leak into a response body
// for the routes we hit — flag them explicitly so a regression is visible
// in the k6 summary rather than buried inside a noisy 200-OK count.
//
// Deliberately *not* matching "Warning:" / "Notice:" — TYPO3 backend
// pages embed those strings in console.log() calls, code-doc snippets,
// and the install tool's own UI copy. We only want real fatals: PHP
// uncaught exceptions and TYPO3's Exception #NNN renderer output.
export const noPHPError = {
    'no PHP error in body': (r) =>
        typeof r.body === 'string'
        && !/Fatal error|Uncaught\s+(Error|Exception|Throwable)|Stack trace:\s*\n|TYPO3\s+Exception\s+#\d/i.test(r.body),
};

// Anonymous Camino frontend pages all render the site title in <title>.
// Catches "200 OK but blank page" and bootstrap regressions where the
// worker returned an empty body.
export const looksLikeCaminoPage = {
    'response looks like a TYPO3 frontend page': (r) =>
        typeof r.body === 'string' && r.body.length > 500 && /<title>[^<]+<\/title>/.test(r.body),
};

// The install-tool failsafe path renders one of two pages depending on
// whether typo3conf/ENABLE_INSTALL_TOOL exists.
export const looksLikeInstallTool = {
    'response looks like the install tool': (r) =>
        typeof r.body === 'string'
        && /Install Tool|Create the file|ENABLE_INSTALL_TOOL|password/i.test(r.body),
};

// The backend top-level (/typo3/main or /typo3/module/*) always renders
// the modulemenu shell. If we see a login form instead, the session
// died — detect that via the unique `t3-login-submit` button id which
// only appears on /typo3/login.
//
// (Don't use the `s` / dotAll regex flag here — k6's JS engine (Goja)
// has spotty support for ES2018 RegExp flags and they silently throw,
// making the check return false even on healthy responses.)
export const looksLikeBackend = {
    'response is the backend shell': (r) => {
        if (typeof r.body !== 'string') return false;
        const isShell = /id="modulemenu"|id="typo3-module-menu"|class="typo3-app/.test(r.body);
        const isLogin = /id="t3-login-submit"/.test(r.body);
        return isShell && !isLogin;
    },
};
