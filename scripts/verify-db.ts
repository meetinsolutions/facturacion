import { ensureSshTunnelIfEnabled } from '../src/db/ssh-tunnel';
import { checkDatabaseConnection, pool } from '../src/db/pool';
import { initDatabaseSchema } from '../src/db/schema';
import { migrarDatosJsonSiEsNecesario } from '../src/db/migrate-json-to-pg';

(async () => {
  await ensureSshTunnelIfEnabled();
  console.log('DB OK:', await checkDatabaseConnection());
  await initDatabaseSchema();
  console.log('Schema OK');
  await migrarDatosJsonSiEsNecesario();
  const r = await pool.query("SELECT (SELECT count(*) FROM tenants) t, (SELECT count(*) FROM users) u, (SELECT count(*) FROM comprobantes) c, (SELECT count(*) FROM productos) p, (SELECT count(*) FROM clientes) cl, (SELECT count(*) FROM plans) pl");
  console.log(r.rows[0]);
  await pool.end();
  process.exit(0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
