import { Request, Response, NextFunction } from 'express';
import { query } from '../db/database';
import { createError } from './errorHandler';

/**
 * Requires a valid session.  Returns 401 if the user is not logged in.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    return next(createError('Unauthorised', 401));
  }
  next();
}

/**
 * Requires that the user has completed their first-login password change.
 * Must be used after requireAuth.
 */
export function requirePasswordChanged(req: Request, _res: Response, next: NextFunction): void {
  if (req.session?.requirePasswordChange) {
    return next(createError('Password change required before continuing', 403));
  }
  next();
}

/**
 * Requires the authenticated user to have the 'admin' role.
 * Must be used after requireAuth.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const rows = query<{ role: string }>('SELECT role FROM users WHERE id = ?', [req.session.userId!]);
  if (!rows[0] || rows[0].role !== 'admin') {
    return next(createError('Forbidden: admin access required', 403));
  }
  next();
}
