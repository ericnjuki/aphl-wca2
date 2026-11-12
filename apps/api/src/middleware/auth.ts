import { Request, Response, NextFunction } from 'express';
import { query } from '../db/database';
import { createError } from './errorHandler';
import { isFacilityRole, type Role } from '../lib/roles';

/**
 * Requires a valid session for a user that still exists and is enabled.
 * Returns 401 if not logged in; a deleted or disabled user's session is
 * destroyed so it cannot keep working until it expires.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    return next(createError('Unauthorised', 401));
  }
  try {
    const [user] = query<{ is_enabled: number }>('SELECT is_enabled FROM users WHERE id = ?', [req.session.userId]);
    if (user && user.is_enabled) return next();
    // Test sessions are plain objects without destroy().
    if (typeof req.session.destroy === 'function') req.session.destroy(() => undefined);
    next(createError(user ? 'Your account is disabled' : 'Unauthorised', 401));
  } catch (err) { next(err); }
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

function roleOf(req: Request): string | undefined {
  return query<{ role: string }>('SELECT role FROM users WHERE id = ?', [req.session.userId!])[0]?.role;
}

/**
 * Requires the authenticated user to have the 'admin' role.
 * Must be used after requireAuth.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (roleOf(req) !== 'admin') return next(createError('Forbidden: admin access required', 403));
  next();
}

/** Requires one of the given roles. Must be used after requireAuth. */
export function requireRole(...roles: readonly Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const role = roleOf(req);
    if (!role || !(roles as readonly string[]).includes(role)) return next(createError('Forbidden', 403));
    next();
  };
}

/**
 * Only facility-placed users (facility admins, staff) take assessments.
 * Must be used after requireAuth.
 */
export function requireAssessmentTaker(req: Request, _res: Response, next: NextFunction): void {
  if (!isFacilityRole(roleOf(req) ?? '')) {
    return next(createError('Your role does not take assessments', 403));
  }
  next();
}
