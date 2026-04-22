import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import env from './config/env';
import corsMiddleware from './middleware/cors';
import { generalLimiter } from './middleware/rateLimiter';
import { notFoundHandler, errorHandler } from './middleware/errorHandler';
import sessionMiddleware from './middleware/session';
import apiRouter from './routes/index';

const app = express();

// Honour X-Forwarded-* headers from the reverse proxy (nginx). Without this
// Express sees every request as coming from the proxy's IP and treats HTTPS
// requests as HTTP, which breaks secure cookies and skews rate limiting.
if (env.trustProxy > 0) {
  app.set('trust proxy', env.trustProxy);
}

// ── Security & transport ──────────────────────────────────────────────────────
// `crossOriginResourcePolicy: 'cross-origin'` is required because the API and
// the web app are served from different origins (ports) during development —
// helmet's default of `same-origin` would block the browser from reading
// responses even though CORS itself allows them.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(corsMiddleware);
app.use(compression());

// ── Logging ───────────────────────────────────────────────────────────────────
app.use(morgan(env.isDev ? 'dev' : 'combined'));

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use(generalLimiter);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Sessions ──────────────────────────────────────────────────────────────────
app.use(sessionMiddleware);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/v1', apiRouter);

// ── Error handling ────────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
