<?php

declare(strict_types=1);

namespace Ochorocho\FrankenPhp\Command;

use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\Console\Question\ConfirmationQuestion;
use Symfony\Component\Console\Question\Question;
use Symfony\Component\Console\Style\SymfonyStyle;
use TYPO3\CMS\Core\Core\Environment;

#[AsCommand(
    name: 'frankenphp:init',
    description: 'Initialize FrankenPHP configuration (Caddyfile and .env)',
)]
class InitCommand extends Command
{
    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $io = new SymfonyStyle($input, $output);
        $projectPath = Environment::getProjectPath();
        $caddyFilePath = $projectPath . '/Caddyfile';

        $envFilePath = $projectPath . '/.env';

        $existingFiles = [];
        if (file_exists($caddyFilePath)) {
            $existingFiles[] = 'Caddyfile';
        }
        if (file_exists($envFilePath)) {
            $existingFiles[] = '.env';
        }

        if ($existingFiles !== []) {
            $io->warning(sprintf(
                '%s already %s. Skipping to avoid overwriting.',
                implode(' and ', $existingFiles),
                count($existingFiles) > 1 ? 'exist' : 'exists'
            ));
            return Command::FAILURE;
        }

        $helper = $this->getHelper('question');
        $root = str_replace('//', '/', $this->deriveWebDir($projectPath));

        $io->info('Set environment variables (.env):');
        $httpPort = $this->askPort($helper, $input, $output, 'HTTP_PORT', 8888);
        $httpsPort = $this->askPort($helper, $input, $output, 'HTTPS_PORT', 8885);

        $phpIniScanDir = (string)$helper->ask($input, $output, new Question(
            'PHP_INI_SCAN_DIR [<info>./</info>]: ',
            './'
        ));

        $typo3Context = (string)$helper->ask($input, $output, new Question(
            'TYPO3_CONTEXT [<info>Development</info>]: ',
            'Development'
        ));

        $serverName = (string)$helper->ask($input, $output, new Question(
            'SERVER_NAME [<info>localhost</info>]: ',
            'localhost'
        ));

        $workerMode = (bool)$helper->ask($input, $output, new ConfirmationQuestion(
            'Enable FrankenPHP Worker Mode? [<info>yes</info>]: ',
            true
        ));

        $workerCount = null;
        $maxRequests = null;
        if ($workerMode) {
            $workerCount = (string)$helper->ask($input, $output, new Question(
                'FRANKENPHP_WORKER_COUNT [<info>5</info>]: ',
                '2'
            ));

            $maxRequests = (string)$helper->ask($input, $output, new Question(
                'MAX_REQUESTS [<info>500</info>]: ',
                '500'
            ));
        }

        $caddyFileContent = $this->buildCaddyfile($root, $workerMode);
        file_put_contents($caddyFilePath, $caddyFileContent);
        $io->success('Created Caddyfile');

        $envContent = $this->buildEnvFile(
            $phpIniScanDir,
            $typo3Context,
            $serverName,
            $httpPort,
            $httpsPort,
            $workerCount,
            $maxRequests
        );
        file_put_contents($envFilePath, $envContent);
        $io->success('Created .env');

        return Command::SUCCESS;
    }

    private function deriveWebDir(string $projectPath): string
    {
        $publicPath = Environment::getPublicPath();
        if (str_starts_with($publicPath, $projectPath . '/')) {
            return substr($publicPath, strlen($projectPath) + 1);
        }

        return 'public';
    }

    /**
     * @return int<1, 65535>
     */
    private function askPort(mixed $helper, InputInterface $input, OutputInterface $output, string $label, int $default): int
    {
        $question = new Question(
            sprintf('%s [<info>%d</info>]: ', $label, $default),
            (string)$default
        );
        $question->setValidator(static function (mixed $value): int {
            $port = (int)$value;
            if ($port < 1 || $port > 65535) {
                throw new \RuntimeException('Port must be an integer between 1 and 65535.');
            }
            return $port;
        });

        return (int)$helper->ask($input, $output, $question);
    }

    private function buildCaddyfile(string $root, bool $workerMode): string
    {
        $handleFile = '/index.php';
        $workerBlock = '';
        if ($workerMode) {
            $handleFile = '/worker.php';
            $workerBlock = <<<'WORKER'

	frankenphp {
		worker public/worker.php
	}
WORKER;
        }

        return <<<CADDYFILE
{
	# Use non-standard ports to avoid permission issues
	http_port {\$HTTP_PORT:8888}
	https_port {\$HTTPS_PORT:8885}
	auto_https disable_redirects
	debug
{$workerBlock}

	# https://caddyserver.com/docs/caddyfile/directives#sorting-algorithm
	order mercure after encode
	order vulcain after reverse_proxy
	order php_server before file_server
	order php before file_server
}

{\$CADDY_EXTRA_CONFIG}

# HTTP on 8888, HTTPS on 8885
http://{\$SERVER_NAME:localhost}:{\$HTTP_PORT:8888}, https://{\$SERVER_NAME:localhost}:{\$HTTPS_PORT:8885} {
	log {
		# Redact the authorization query parameter that can be set by Mercure
		format filter {
			wrap console
			fields {
				uri query {
					replace authorization REDACTED
				}
			}
		}
	}

	root * {$root}/

	# Self-signed certificate for localhost HTTPS
	tls internal

	encode zstd gzip

	{\$CADDY_SERVER_EXTRA_DIRECTIVES}

	# Serve existing static files directly (CSS, JS, images, etc.)
	@static file
	handle @static {
		file_server
	}

	# ALL non-static requests go to index.php
	# REQUEST_URI is preserved automatically by Caddy's rewrite
	handle {
		rewrite * {$handleFile}
		php
	}
}

CADDYFILE;
    }

    private function buildEnvFile(
        string $phpIniScanDir,
        string $typo3Context,
        string $serverName,
        int $httpPort,
        int $httpsPort,
        ?string $workerCount,
        ?string $maxRequests,
    ): string {
        $workerEnv = '';
        if ($workerCount !== null && $maxRequests !== null) {
            $workerEnv = <<<ENV

# FrankenPHP worker configuration
FRANKENPHP_WORKER_COUNT={$workerCount}
MAX_REQUESTS={$maxRequests}
ENV;
        }

        return <<<ENV
PHP_INI_SCAN_DIR={$phpIniScanDir}
TYPO3_CONTEXT={$typo3Context}

SERVER_NAME={$serverName}
HTTP_PORT={$httpPort}
HTTPS_PORT={$httpsPort}
{$workerEnv}

ENV;
    }
}
