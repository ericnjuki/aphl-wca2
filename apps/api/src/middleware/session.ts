import expressSession from 'express-session';
import { SqlJsSessionStore } from '../db/session-store';
import env from '../config/env';

const store = new SqlJsSessionStore();

const sessionMiddleware = expressSession({
  store,
  secret: env.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: env.session.cookieSecure,
    sameSite: 'lax',
    maxAge: env.session.maxAgeMs,
  },
  name: 'wca.sid',
});

export { store };
export default sessionMiddleware;
