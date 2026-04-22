import rateLimit from 'express-rate-limit';
import env from '../config/env';

/** General limiter applied to all routes. */
export const generalLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

/** Tighter limiter for write / auth routes. */
export const strictLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: Math.max(1, Math.floor(env.rateLimit.max / 5)),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
