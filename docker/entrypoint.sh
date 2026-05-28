#!/usr/bin/env bash

set -euo pipefail

# This repository IS the extension package, not a TYPO3 installation. Mirroring
# scripts/setup-typo3.sh, we materialize a throwaway TYPO3 project that REQUIRES
# the extension via a symlinked Composer path repository:
#
#   EXT_DIR  (/src) — the mounted extension source (this repo).
#   BUILD_DIR (/app) — the generated TYPO3 project (a named volume).
#
# Edits to the host source are picked up live through the symlink.
EXT_DIR="${EXT_DIR:-/src}"
BUILD_DIR="${BUILD_DIR:-/app}"
TYPO3_VERSION="${TYPO3_VERSION:-^14.3}"

log() { printf '[frankenphp] %s\n' "$*"; }

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# 1. Generate the TYPO3 project composer.json from the tracked template,
#    substituting $TYPO3_VERSION and $EXT_DIR into their placeholders.
if [ ! -f composer.json ]; then
    log "Generating TYPO3 project composer.json (TYPO3 ${TYPO3_VERSION}) ..."
    envsubst < "${EXT_DIR}/docker/sandbox-composer.json" > composer.json
fi

# 2. Install dependencies (pulls TYPO3 sysexts into vendor/typo3/, applies the patch).
if [ ! -f vendor/autoload.php ]; then
    log "Running composer install ..."
    composer install --no-interaction --no-progress
fi

# 3. Generate Caddyfile, php.ini and public/worker.php. The generated .env is
#    intentionally NOT loaded by `frankenphp run` below — the Caddyfile reads
#    {$VAR:default} placeholders straight from the container environment, so the
#    values set in docker-compose.yml always win.
if [ ! -f Caddyfile ]; then
    log "Generating FrankenPHP configuration (frankenphp:init) ..."
    vendor/bin/typo3 frankenphp:init --no-interaction --profile dev
fi

# 4. First-run TYPO3 setup against MariaDB. All TYPO3_DB_* / TYPO3_SETUP_* values
#    are read from the process environment (populated by docker-compose.yml).
if [ ! -f config/system/settings.php ]; then
    log "Running TYPO3 setup against MariaDB ..."
    vendor/bin/typo3 setup --force --no-interaction
    # Clearing the cache while a worker is already running breaks it; safe here
    # because we clear before the first `frankenphp run`.
    rm -rf var/cache
fi

log "Starting FrankenPHP (HTTP :${HTTP_PORT:-8080}, HTTPS :${HTTPS_PORT:-8443}) ..."
exec frankenphp run -c Caddyfile
