import { pool } from '../src/db/pool.js';
import crypto from 'crypto';

async function getLatest() {
  const res = await pool.query(`SELECT email, otp_hash FROM portal_clientes_otp WHERE used = false ORDER BY created_at DESC LIMIT 1`);
  if (!res.rows.length) {
    console.log('NO_ACTIVE_OTP');
    process.exit(0);
  }
  const target = res.rows[0].otp_hash;
  let found = '';
  for (let i = 100000; i <= 999999; i++) {
    const h = crypto.createHash('sha256').update(String(i)).digest('hex');
    if (h === target) {
      found = String(i);
      break;
    }
  }
  console.log(`LATEST_OTP:${found}:${res.rows[0].email}`);
  await pool.end();
}
getLatest().catch(err => {
  console.error(err);
  process.exit(1);
});
