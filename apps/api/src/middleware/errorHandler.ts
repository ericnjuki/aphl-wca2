import { ErrorRequestHandler, Request, Response, NextFunction } from 'express';
import env from '../config/env';

export interface ApiError extends Error {
  statusCode?: number;
}

/** Attach a statusCode to any Error to control the HTTP response. */
export function createError(message: string, statusCode = 500): ApiError {
  const err: ApiError = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/** 404 handler — mount after all routes. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(createError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
}

/** Central error handler — mount last. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err: ApiError, _req, res, _next) => {
  const status = err.statusCode ?? 500;
  const message = err.message ?? 'Internal server error';

  if (status >= 500) {
    console.error('[error]', err);
  }

  res.status(status).json({
    error: message,
    ...(env.isDev && status >= 500 ? { stack: err.stack } : {}),
  });
};
