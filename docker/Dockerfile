FROM dunglas/frankenphp:php8.3

# Composer is not shipped in the base image, so for the sake of the sandbox we're pulling the binary from the
# official Composer image. You don't want composer in a production environment, though. Same as git further below.
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer

# git + unzip let Composer fetch/extract packages efficiently (without them
# it warns and falls back to slower download paths).
RUN apt-get update && apt-get install -y --no-install-recommends \
    gettext-base \
    git \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# PHP extensions required by TYPO3
RUN install-php-extensions \
    exif \
    gd \
    intl \
    mysqli \
    opcache \
    zip

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
