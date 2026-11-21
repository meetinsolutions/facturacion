import { hashPassword } from '../src/services/crypto-service.js';
import { pool } from '../src/db/pool.js';

async function main() {
  const hash = hashPassword('MeetinTest2026!');
  const res = await pool.query(
    'UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING email, role',
    [hash, 'facturacion@meetinlabs.com']
  );
  console.log('Usuario actualizado:', JSON.stringify(res.rows[0]));
  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
