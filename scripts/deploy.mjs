#!/usr/bin/env node
// Interactive deploy CLI: collects domain/port/TLS-mode, lets you review and
// jump back to change any answer, writes `.env`, brings the stack up via
// `docker compose`, and (when fronted by an existing proxy) generates an
// nginx snippet for the host's own reverse proxy. Run via `pnpm run deploy`.
import { select, input, confirm, Separator } from '@inquirer/prompts';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envPath = path.join(rootDir, '.env');

// ── Colour + status helpers (no dependency — raw ANSI) ──────────────────────
const c = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};
const ok = (msg) => console.log(`${c.green('✔')} ${msg}`);
const fail = (msg) => console.log(`${c.red('✖')} ${msg}`);
const info = (msg) => console.log(`${c.cyan('›')} ${msg}`);
const heading = (msg) => console.log(`\n${c.bold(c.cyan(msg))}`);

const CONTINUE = '__continue__';
const CANCEL = '__cancel__';

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

// ── Field definitions ────────────────────────────────────────────────────────
// Each field knows how to prompt for itself and how to render its current
// value in the review summary. `visible` controls which fields apply given
// the current TLS mode. `tlsMode` is one of three CLI-facing choices:
//   'internal' — this container terminates TLS itself via certbot
//   'external' — plain HTTP here, fronted by an existing HTTPS proxy on the host
//   'none'     — plain HTTP only, no TLS anywhere, no domain needed
// 'external' and 'none' both map to the same TLS_MODE=external infra (same
// compose overlay, same nginx template) — they only differ in whether a
// domain/cert paths are asked for and an nginx snippet gets generated.

const DOMAIN_RE = /^[a-zA-Z0-9.-]+$/;
const portValidate = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 65535 ? true : 'Enter a valid port number (1-65535)';
};

function maskSecret(secret) {
  if (!secret) return c.dim('(none — will generate)');
  return `${secret.slice(0, 8)}${c.dim('…')}`;
}

const TLS_MODE_LABELS = {
  internal: 'internal — this container terminates TLS itself (certbot)',
  external: 'external — plain HTTP here, fronted by an existing HTTPS proxy',
  none: 'none — plain HTTP only, no TLS anywhere, no domain needed',
};

const fieldDefs = [
  {
    key: 'tlsMode',
    label: 'TLS mode',
    visible: () => true,
    display: (s) => TLS_MODE_LABELS[s.tlsMode],
    ask: async (s) =>
      select({
        message: 'How is TLS handled for this deployment?',
        default: s.tlsMode,
        choices: [
          { name: TLS_MODE_LABELS.internal, value: 'internal' },
          { name: TLS_MODE_LABELS.external, value: 'external' },
          { name: TLS_MODE_LABELS.none, value: 'none' },
        ],
      }),
  },
  {
    key: 'domain',
    label: 'Domain',
    visible: () => true,
    display: (s) => s.domain || c.dim('(none)'),
    ask: async (s) => {
      const required = s.tlsMode === 'internal';
      const value = await input({
        message: required
          ? 'Domain (no scheme, e.g. wca.example.org)'
          : 'Domain (no scheme, e.g. wca.example.org) — leave blank if none',
        default: s.domain || undefined,
        validate: (v) => {
          const val = v.trim();
          if (!val) return required ? 'A domain is required when TLS mode is "internal"' : true;
          return DOMAIN_RE.test(val) ? true : 'Enter a valid domain (letters, numbers, dots and hyphens only)';
        },
      });
      return value.trim();
    },
  },
  {
    key: 'httpPort',
    label: 'HTTP port',
    visible: (s) => s.tlsMode === 'internal',
    display: (s) => s.httpPort,
    ask: async (s) => input({ message: 'HTTP port to bind on this host', default: String(s.httpPort ?? 80), validate: portValidate }),
  },
  {
    key: 'httpsPort',
    label: 'HTTPS port',
    visible: (s) => s.tlsMode === 'internal',
    display: (s) => s.httpsPort,
    ask: async (s) => input({ message: 'HTTPS port to bind on this host', default: String(s.httpsPort ?? 443), validate: portValidate }),
  },
  {
    key: 'appPort',
    label: 'App port',
    visible: (s) => s.tlsMode === 'external' || s.tlsMode === 'none',
    display: (s) => s.appPort,
    ask: async (s) =>
      input({
        message: 'App port to bind on this host (a reverse proxy, if any, would proxy_pass here)',
        default: String(s.appPort ?? 8888),
        validate: portValidate,
      }),
  },
  {
    key: 'certPath',
    label: 'Existing TLS cert path (fullchain)',
    visible: (s) => s.tlsMode === 'external',
    display: (s) => s.certPath || c.dim('(not set)'),
    ask: async (s) =>
      input({
        message: "Path to the existing TLS cert (fullchain) on the host, used only to generate the nginx snippet",
        default: s.certPath || `/etc/letsencrypt/live/${s.domain || 'example.com'}/fullchain.pem`,
      }),
  },
  {
    key: 'keyPath',
    label: 'Existing TLS key path',
    visible: (s) => s.tlsMode === 'external',
    display: (s) => s.keyPath || c.dim('(not set)'),
    ask: async (s) =>
      input({
        message: 'Path to the existing TLS private key on the host',
        default: s.keyPath || `/etc/letsencrypt/live/${s.domain || 'example.com'}/privkey.pem`,
      }),
  },
  {
    key: 'corsOrigins',
    label: 'CORS_ORIGINS',
    visible: () => true,
    display: (s) => s.corsOrigins,
    ask: async (s) => {
      const plainHttp = s.tlsMode === 'none';
      const guess = plainHttp
        ? `http://localhost:${s.appPort ?? 8888}`
        : `https://${s.domain || 'example.com'}`;
      return input({
        message: plainHttp
          ? 'CORS_ORIGINS (comma-separated) — use whatever origin the browser actually reaches this at (host IP or hostname), e.g. http://192.168.1.50:8888'
          : 'CORS_ORIGINS (comma-separated)',
        default: s.corsOrigins || guess,
      });
    },
  },
  {
    key: 'sessionSecret',
    label: 'SESSION_SECRET',
    visible: () => true,
    display: (s) => maskSecret(s.sessionSecret),
    ask: async (s) => {
      const choice = await select({
        message: 'SESSION_SECRET',
        choices: [
          ...(s.sessionSecret ? [{ name: `Keep existing (${maskSecret(s.sessionSecret)})`, value: 'keep' }] : []),
          { name: 'Generate a new one', value: 'generate' },
          { name: 'Enter manually', value: 'manual' },
        ],
      });
      if (choice === 'keep') return s.sessionSecret;
      if (choice === 'generate') return randomBytes(48).toString('hex');
      return input({ message: 'Enter SESSION_SECRET' });
    },
  },
  {
    key: 'cookieSecure',
    label: 'SESSION_COOKIE_SECURE',
    visible: () => true,
    display: (s) => String(s.cookieSecure),
    ask: async (s) => {
      const plainHttp = s.tlsMode === 'none';
      const dflt = s.cookieSecureExplicit ? s.cookieSecure : !plainHttp;
      return confirm({
        message: plainHttp
          ? 'Is the app reached over HTTPS anywhere in front of it? (say "n" for a genuine plain-HTTP deploy — the session cookie won\'t be marked Secure)'
          : 'Is the app always reached over HTTPS at the edge? (say "n" only for the brief internal-TLS bootstrap window before a cert exists)',
        default: dflt,
      });
    },
  },
];

function visibleFields(settings) {
  return fieldDefs.filter((f) => f.visible(settings));
}

function printSummary(settings) {
  heading('Current configuration');
  for (const f of visibleFields(settings)) {
    console.log(`  ${c.dim(f.label.padEnd(24))} ${f.display(settings)}`);
  }
  console.log();
}

// ── Collect + review loop ────────────────────────────────────────────────────

async function collect(existing) {
  const domain = existing.get('DOMAIN') ?? '';
  const settings = {
    tlsMode: existing.get('TLS_MODE') === 'internal' ? 'internal' : existing.has('TLS_MODE') ? 'external' : 'internal',
    domain: domain === '_' ? '' : domain,
    httpPort: Number(existing.get('HTTP_PORT') ?? 80),
    httpsPort: Number(existing.get('HTTPS_PORT') ?? 443),
    appPort: Number(existing.get('APP_PORT') ?? 8888),
    certPath: '',
    keyPath: '',
    corsOrigins: existing.get('CORS_ORIGINS') ?? '',
    sessionSecret: existing.get('SESSION_SECRET') ?? '',
    cookieSecure: (existing.get('SESSION_COOKIE_SECURE') ?? 'true') === 'true',
    cookieSecureExplicit: existing.has('SESSION_COOKIE_SECURE'),
  };

  for (const field of fieldDefs) {
    if (!field.visible(settings)) continue;
    settings[field.key] = await field.ask(settings);
  }

  return settings;
}

async function reviewLoop(settings) {
  while (true) {
    printSummary(settings);

    const choice = await select({
      message: 'Review your settings',
      pageSize: 12,
      choices: [
        ...visibleFields(settings).map((f) => ({ name: `Change ${f.label}`, value: f.key })),
        new Separator(),
        { name: c.green('Continue — write .env and deploy'), value: CONTINUE },
        { name: c.red('Cancel'), value: CANCEL },
      ],
    });

    if (choice === CONTINUE) return settings;
    if (choice === CANCEL) return null;

    const field = fieldDefs.find((f) => f.key === choice);
    settings[field.key] = await field.ask(settings);

    // Switching TLS mode can reveal fields that were never asked for yet
    // (e.g. internal → external needs appPort; none → external needs cert
    // paths). Fill sane defaults for any newly-visible field that's still
    // empty.
    if (field.key === 'tlsMode') {
      for (const f of visibleFields(settings)) {
        if (settings[f.key] === '' || settings[f.key] === undefined) {
          settings[f.key] = await f.ask(settings);
        }
      }
    }
  }
}

// ── Apply ─────────────────────────────────────────────────────────────────────

async function apply(settings) {
  const envValues = {
    TLS_MODE: settings.tlsMode === 'internal' ? 'internal' : 'external',
    DOMAIN: settings.domain || '_',
    CORS_ORIGINS: settings.corsOrigins,
    SESSION_SECRET: settings.sessionSecret,
    SESSION_COOKIE_SECURE: String(settings.cookieSecure),
  };
  const composeFiles = ['docker-compose.yml'];

  if (settings.tlsMode === 'internal') {
    composeFiles.push('docker-compose.internal-tls.yml');
    envValues.HTTP_PORT = String(settings.httpPort);
    envValues.HTTPS_PORT = String(settings.httpsPort);
  } else {
    composeFiles.push('docker-compose.external.yml');
    envValues.APP_PORT = String(settings.appPort);
  }

  await writeEnv(envValues);
  ok(`Wrote ${envPath}`);

  const proceed = await confirm({
    message: `Run docker compose ${composeFiles.map((f) => `-f ${f}`).join(' ')} up -d --build now?`,
    default: true,
  });

  if (proceed) {
    const args = composeFiles.flatMap((f) => ['-f', f]).concat(['up', '-d', '--build']);
    await run('docker', ['compose', ...args], { cwd: rootDir });
    ok('Stack is up.');
  } else {
    info(`Skipped. Run manually with:\n  docker compose ${composeFiles.map((f) => `-f ${f}`).join(' ')} up -d --build`);
  }

  if (settings.tlsMode === 'external') {
    const templatePath = path.join(rootDir, 'deploy', 'nginx-external-snippet.template');
    const template = await readFile(templatePath, 'utf8');
    const rendered = template
      .replaceAll('{{DOMAIN}}', settings.domain)
      .replaceAll('{{PORT}}', String(settings.appPort))
      .replaceAll('{{SSL_CERTIFICATE}}', settings.certPath)
      .replaceAll('{{SSL_CERTIFICATE_KEY}}', settings.keyPath);

    const outDir = path.join(rootDir, 'deploy', 'generated');
    await mkdir(outDir, { recursive: true });
    const snippetName = settings.domain || `app-${settings.appPort}`;
    const outPath = path.join(outDir, `${snippetName}.conf`);
    await writeFile(outPath, rendered, 'utf8');

    ok(`Generated nginx snippet: ${outPath}`);
    info("Append it to the host reverse proxy's site config, then `nginx -t && systemctl reload nginx` on that host.");
  } else if (settings.tlsMode === 'none') {
    ok(`Plain HTTP deploy — reachable at http://<this host's IP or hostname>:${settings.appPort}`);
    info('No TLS anywhere in front of this. Add one later by re-running `pnpm run deploy` and switching TLS mode to "internal" or "external" once a proxy/cert exists.');
  } else {
    info('TLS mode "internal": if certs are not yet issued, follow the certbot bootstrap steps in docs/DEPLOYMENT.md before flipping SESSION_COOKIE_SECURE to true.');
  }
}

async function main() {
  console.log(`\n${c.bold(c.cyan('workforce-competency deploy'))}`);
  console.log(c.dim('Collects your deployment settings, lets you review them, then brings the stack up.\n'));

  const existing = await loadExistingEnv();
  const settings = await collect(existing);
  const reviewed = await reviewLoop(settings);

  if (!reviewed) {
    fail('Cancelled — no changes were made.');
    return;
  }

  await apply(reviewed);
}

main().catch((err) => {
  if (err?.name === 'ExitPromptError') {
    fail('Cancelled.');
    return;
  }
  fail(err?.message ?? String(err));
  process.exitCode = 1;
});
