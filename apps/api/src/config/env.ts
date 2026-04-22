import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const env = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isDev: (process.env.NODE_ENV ?? 'development') === 'development',

  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim()),

  dbPath: path.resolve(process.env.DB_PATH ?? './data/workforce.db'),

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10),
  },

  session: {
    secret: process.env.SESSION_SECRET ?? 'change-me-in-production',
    maxAgeMs: parseInt(process.env.SESSION_MAX_AGE_MS ?? String(8 * 60 * 60 * 1000), 10), // 8 h
    // Override the cookie `Secure` flag explicitly. Needed when running in
    // `NODE_ENV=production` over plain HTTP (e.g. first Docker deploy before
    // TLS is wired up) — otherwise browsers drop the cookie and sessions
    // silently fail. Default: secure in production, insecure in dev.
    cookieSecure: process.env.SESSION_COOKIE_SECURE === undefined
      ? (process.env.NODE_ENV ?? 'development') !== 'development'
      : process.env.SESSION_COOKIE_SECURE === 'true',
  },

  // Number of proxy hops in front of the app (e.g. 1 when behind nginx).
  // 0 disables `trust proxy`. Feeds into Express's X-Forwarded-* handling
  // and express-rate-limit's client IP resolution.
  trustProxy: parseInt(process.env.TRUST_PROXY ?? '0', 10),
} as const;

export default env;
