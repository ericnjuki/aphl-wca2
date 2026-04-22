import session from 'express-session';
import { getDbSync, persistDb } from './database';

type Callback<T = undefined> = T extends undefined
  ? (err?: unknown) => void
  : (err: unknown, result?: T | null) => void;

/**
 * A sql.js-backed session store.  All operations are synchronous against the
 * in-memory database; persistDb() is called after every write so the file on
 * disk stays current.
 *
 * Expired sessions are pruned on every `get` and on an interval set at
 * construction time (default: every 15 minutes).
 */
export class SqlJsSessionStore extends session.Store {
  private pruneInterval: ReturnType<typeof setInterval>;

  constructor(pruneIntervalMs = 15 * 60 * 1000) {
    super();
    this.pruneInterval = setInterval(() => this.prune(), pruneIntervalMs).unref();
  }

  private prune(): void {
    try {
      const db = getDbSync();
      db.run('DELETE FROM sessions WHERE expires_at <= ?', [Date.now()]);
      persistDb();
    } catch {
      // DB may not be ready during startup — safe to ignore.
    }
  }

  get(sid: string, callback: Callback<session.SessionData>): void {
    try {
      const db = getDbSync();
      const rows = db.exec(
        'SELECT data, expires_at FROM sessions WHERE sid = ?',
        [sid],
      );

      if (!rows.length || !rows[0].values.length) {
        return (callback as (err: unknown, result?: null) => void)(null, null);
      }

      const [data, expiresAt] = rows[0].values[0] as [string, number];

      if (Date.now() > expiresAt) {
        this.destroy(sid, () => undefined);
        return (callback as (err: unknown, result?: null) => void)(null, null);
      }

      (callback as (err: unknown, result?: session.SessionData) => void)(
        null,
        JSON.parse(data) as session.SessionData,
      );
    } catch (err) {
      (callback as (err: unknown) => void)(err);
    }
  }

  set(sid: string, sessionData: session.SessionData, callback?: Callback): void {
    try {
      const db = getDbSync();
      const expires =
        sessionData.cookie?.expires instanceof Date
          ? sessionData.cookie.expires.getTime()
          : Date.now() + 24 * 60 * 60 * 1000; // default 24 h

      db.run(
        `INSERT INTO sessions (sid, data, expires_at)
         VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`,
        [sid, JSON.stringify(sessionData), expires],
      );
      persistDb();
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  destroy(sid: string, callback?: Callback): void {
    try {
      const db = getDbSync();
      db.run('DELETE FROM sessions WHERE sid = ?', [sid]);
      persistDb();
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  touch(sid: string, sessionData: session.SessionData, callback?: Callback): void {
    // Re-use set to update the expiry timestamp.
    this.set(sid, sessionData, callback);
  }

  close(): void {
    clearInterval(this.pruneInterval);
  }
}
