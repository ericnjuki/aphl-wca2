#!/usr/bin/env node
// Interactive deploy CLI: collects domain/port/TLS-mode, writes `.env`, brings
// the stack up via `docker compose`, and (in TLS_MODE=external) generates an
// nginx snippet for the host's own reverse proxy. Run via `pnpm run deploy`.
import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envPath = path.join(rootDir, '.env');

const rl = createInterface({ input: process.stdin, output: process.stdout });

async function ask(question, { defaultValue } = {}) {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || defaultValue || '';
}

async function askYesNo(question, defaultYes) {
  const suffix = defaultYes ? ' [Y/n]' : ' [y/N]';
  const answer = (await rl.question(`${question}${suffix}: `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === 'y' || answer === 'yes';
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`))));
    child.on('error', reject);
  });
}

async function loadExistingEnv() {
  try {
    const text = await readFile(envPath, 'utf8');
    const map = new Map();
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      map.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
    }
    return map;
  } catch {
    return new Map();
  }
}

async function writeEnv(values) {
  const existing = await loadExistingEnv();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    existing.set(key, value);
  }
  const body = [...existing.entries()].map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  await writeFile(envPath, body, 'utf8');
}

async function main() {
  console.log('workforce-competency deploy\n');

  const existing = await loadExistingEnv();

  const tlsModeAnswer = await askYesNo(
    'Does this container manage its own TLS via certbot? (choose "n" if a reverse proxy already on this host terminates HTTPS)',
    (existing.get('TLS_MODE') ?? 'own') === 'own',
  );
  const tlsMode = tlsModeAnswer ? 'own' : 'external';

  const domain = await ask('Domain (no scheme, e.g. wca.ken-info.org)', {
    defaultValue: existing.get('DOMAIN'),
  });
  if (!domain) {
    console.error('A domain is required.');
    process.exitCode = 1;
    return;
  }

  const envValues = { TLS_MODE: tlsMode, DOMAIN: domain };
  const composeFiles = ['docker-compose.yml'];
  let appPort;

  if (tlsMode === 'own') {
    composeFiles.push('docker-compose.own-tls.yml');
    const httpPort = await ask('HTTP port to bind on this host', { defaultValue: existing.get('HTTP_PORT') ?? '80' });
    const httpsPort = await ask('HTTPS port to bind on this host', { defaultValue: existing.get('HTTPS_PORT') ?? '443' });
    envValues.HTTP_PORT = httpPort;
    envValues.HTTPS_PORT = httpsPort;
  } else {
    composeFiles.push('docker-compose.external.yml');
    appPort = await ask('App port to bind on this host (the host reverse proxy will proxy_pass here)', {
      defaultValue: existing.get('APP_PORT') ?? '8888',
    });
    envValues.APP_PORT = appPort;
  }

  const corsDefault = existing.get('CORS_ORIGINS') ?? `https://${domain}`;
  envValues.CORS_ORIGINS = await ask('CORS_ORIGINS (comma-separated)', { defaultValue: corsDefault });

  let sessionSecret = existing.get('SESSION_SECRET');
  if (!sessionSecret || (await askYesNo('SESSION_SECRET already set — generate a new one?', false))) {
    sessionSecret = randomBytes(48).toString('hex');
    console.log('Generated a new SESSION_SECRET.');
  }
  envValues.SESSION_SECRET = sessionSecret;

  const cookieSecureDefault = tlsMode === 'own'
    ? await askYesNo('Is HTTPS already working (certs already issued)? (say "n" for the very first own-TLS bootstrap deploy)', false)
    : true;
  envValues.SESSION_COOKIE_SECURE = String(cookieSecureDefault);

  await writeEnv(envValues);
  console.log(`\nWrote ${envPath}`);

  const proceed = await askYesNo(`\nRun docker compose ${composeFiles.map((f) => `-f ${f}`).join(' ')} up -d --build now?`, true);
  if (proceed) {
    const args = composeFiles.flatMap((f) => ['-f', f]).concat(['up', '-d', '--build']);
    await run('docker', ['compose', ...args], { cwd: rootDir });
    console.log('\nStack is up.');
  } else {
    console.log(`\nSkipped. Run manually with:\n  docker compose ${composeFiles.map((f) => `-f ${f}`).join(' ')} up -d --build`);
  }

  if (tlsMode === 'external') {
    const certPath = await ask('Path to the existing TLS cert (fullchain) on the host', {
      defaultValue: '/etc/letsencrypt/live/ken-info.org/fullchain.pem',
    });
    const keyPath = await ask('Path to the existing TLS private key on the host', {
      defaultValue: '/etc/letsencrypt/live/ken-info.org/privkey.pem',
    });

    const templatePath = path.join(rootDir, 'deploy', 'nginx-external-snippet.template');
    const template = await readFile(templatePath, 'utf8');
    const rendered = template
      .replaceAll('{{DOMAIN}}', domain)
      .replaceAll('{{PORT}}', appPort)
      .replaceAll('{{SSL_CERTIFICATE}}', certPath)
      .replaceAll('{{SSL_CERTIFICATE_KEY}}', keyPath);

    const outDir = path.join(rootDir, 'deploy', 'generated');
    await mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `${domain}.conf`);
    await writeFile(outPath, rendered, 'utf8');

    console.log(`\nGenerated nginx snippet: ${outPath}`);
    console.log('Append it to the host reverse proxy\'s site config, then `nginx -t && systemctl reload nginx` on that host.');
  } else {
    console.log('\nTLS_MODE=own: if certs are not yet issued, follow the certbot bootstrap steps in the README before flipping SESSION_COOKIE_SECURE to true.');
  }

  rl.close();
}

main().catch((err) => {
  console.error(err);
  rl.close();
  process.exitCode = 1;
});
