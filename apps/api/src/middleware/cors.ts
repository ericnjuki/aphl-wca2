import cors, { CorsOptions } from 'cors';
import env from '../config/env';

// In dev we accept any localhost or 127.0.0.1 origin regardless of port, so
// transient Vite port bumps (5173 → 5174 when a stale process holds the
// default) don't break the app. Production still uses the strict allowlist.
const DEV_LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const options: CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, mobile apps, same-origin,
    // requests forwarded by the Vite dev proxy with Origin stripped).
    if (!origin) return callback(null, true);

    if (env.corsOrigins.includes(origin)) return callback(null, true);
    if (env.isDev && DEV_LOCALHOST_RE.test(origin)) return callback(null, true);

    callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400, // 24 h preflight cache
};

export default cors(options);
