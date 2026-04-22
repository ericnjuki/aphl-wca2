import bcrypt from 'bcryptjs';
import { Database } from 'sql.js';

const SALT_ROUNDS = 12;

const seedUsers = [
  {
    email: 'admin@aphl.com',
    first_name: 'National',
    last_name: 'Administrator',
    national_id: 'APHL',
    id_type: 'national id',
    user_name: 'admin',
    password: 'APHLwca2024',
    role: 'admin',
    is_first_login: 1,
    is_enabled: 1,
  },
];

export async function runSeed(db: Database): Promise<void> {
  let seeded = 0;

  for (const user of seedUsers) {
    const existing = db.exec(
      'SELECT id FROM users WHERE email = ? OR user_name = ?',
      [user.email, user.user_name],
    );

    if (existing.length > 0 && existing[0].values.length > 0) continue;

    const hashed = await bcrypt.hash(user.password, SALT_ROUNDS);

    db.run(
      `INSERT INTO users
         (email, first_name, last_name, national_id, id_type,
          user_name, password, role, is_first_login, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.email,
        user.first_name,
        user.last_name,
        user.national_id,
        user.id_type,
        user.user_name,
        hashed,
        user.role,
        user.is_first_login,
        user.is_enabled,
      ],
    );

    console.log(`[seed] user '${user.user_name}' created`);
    seeded++;
  }

  if (seeded === 0) {
    console.log('[seed] already up-to-date');
  }
}
