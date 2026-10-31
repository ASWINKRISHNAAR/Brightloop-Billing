import { query, closePool } from './pool.js';
import bcrypt from 'bcryptjs';

async function main() {
  try {
    // Reset lockout for all seed users
    const r = await query(
      `UPDATE users 
       SET failed_login_attempts = 0, locked_until = NULL 
       WHERE email IN ('admin@brightloop.io', 'staff@brightloop.io', 'customer@brightloop.io')`,
      []
    );
    console.log('Lockout reset, rows affected:', r.rowCount);

    // Re-hash and update password to make sure it's correct
    const hash = await bcrypt.hash('Admin@1234!', 10);
    const r2 = await query(
      `UPDATE users SET password_hash = $1 
       WHERE email IN ('admin@brightloop.io', 'staff@brightloop.io', 'customer@brightloop.io')`,
      [hash]
    );
    console.log('Password reset, rows affected:', r2.rowCount);

    // Verify
    const check = await query(
      `SELECT email, failed_login_attempts, locked_until, is_active FROM users 
       WHERE email = 'admin@brightloop.io'`,
      []
    );
    console.log('Admin user state:', JSON.stringify(check.rows[0]));
  } finally {
    await closePool();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

