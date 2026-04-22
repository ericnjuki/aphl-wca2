import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { query, execute } from '../db/database';
import { requireAuth } from '../middleware/auth';
import { strictLimiter } from '../middleware/rateLimiter';
import { createError } from '../middleware/errorHandler';

interface UserRow extends Record<string, unknown> {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  user_name: string;
  password: string;
  role: string;
  is_first_login: number; // SQLite stores booleans as 0/1
  is_enabled: number;
  national_id: string;
  id_type: string;
}

/** Strip sensitive fields before sending to the client. */
function sanitiseUser(user: UserRow) {
  const { password: _, ...safe } = user;
  return {
    ...safe,
    is_first_login: Boolean(user.is_first_login),
    is_enabled: Boolean(user.is_enabled),
  };
}

const router = Router();

// ── POST /auth/login ──────────────────────────────────────────────────────────
router.post(
  '/login',
  strictLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { login, password } = req.body as { login?: string; password?: string };

      if (!login || !password) {
        return next(createError('login and password are required', 400));
      }

      const [user] = query<UserRow>(
        'SELECT * FROM users WHERE (email = ? OR user_name = ?) AND is_enabled = TRUE',
        [login, login],
      );

      if (!user) {
        return next(createError('Invalid credentials', 401));
      }

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return next(createError('Invalid credentials', 401));
      }

      const requirePasswordChange = Boolean(user.is_first_login);

      // Regenerate session to prevent session fixation.
      req.session.regenerate((err) => {
        if (err) return next(err);

        req.session.userId = user.id;
        req.session.requirePasswordChange = requirePasswordChange;

        req.session.save((saveErr) => {
          if (saveErr) return next(saveErr);

          res.json({
            user: sanitiseUser(user),
            requirePasswordChange,
          });
        });
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /auth/logout ─────────────────────────────────────────────────────────
router.post('/logout', requireAuth, (req: Request, res: Response, next: NextFunction) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('wca.sid');
    res.json({ message: 'Logged out' });
  });
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    const [user] = query<UserRow>('SELECT * FROM users WHERE id = ?', [req.session.userId!]);

    if (!user) return next(createError('User not found', 404));

    res.json({
      user: sanitiseUser(user),
      requirePasswordChange: req.session.requirePasswordChange ?? false,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /auth/change-password ────────────────────────────────────────────────
router.post(
  '/change-password',
  strictLimiter,
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { current_password, new_password } = req.body as {
        current_password?: string;
        new_password?: string;
      };

      if (!current_password || !new_password) {
        return next(createError('current_password and new_password are required', 400));
      }

      if (new_password.length < 8) {
        return next(createError('new_password must be at least 8 characters', 400));
      }

      const [user] = query<UserRow>('SELECT * FROM users WHERE id = ?', [req.session.userId!]);

      if (!user) return next(createError('User not found', 404));

      // On first login the stored password is the temporary one — verify it.
      const valid = await bcrypt.compare(current_password, user.password);
      if (!valid) {
        return next(createError('Current password is incorrect', 401));
      }

      if (current_password === new_password) {
        return next(createError('New password must differ from the current password', 400));
      }

      const hashed = await bcrypt.hash(new_password, 12);

      const userId = req.session.userId!;
      execute(
        `UPDATE users
         SET password = ?, is_first_login = FALSE, temp_password = NULL, updated_at = datetime('now')
         WHERE id = ?`,
        [hashed, userId],
      );

      // Clear the flag on the current session.
      req.session.requirePasswordChange = false;

      req.session.save((err) => {
        if (err) return next(err);
        res.json({ message: 'Password updated successfully' });
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
