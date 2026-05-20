# TYPO3 FrankenPHP integration

Provides a easy way to generate required files:

```
vendor/bin/typo3 frankenphp:init
```

**The files:**

  * Worker entrypoint: `public/worker.php`
  * Webserver config: `Caddyfile`
  * Environment config: `.env`

**Install:**

```
cd packages/
git clone git@github.com:ochorocho/typo3-frankenphp.git frankenphp
composer req ochorocho/frankenphp:@dev
```

**Issues**

  * Installtool is not working. Error: `Request parameters could not be validated (&cHash empty)`