/**
 * Worker de conciliación periódica de transacciones ONVO Pay
 * Invoca conciliarTransaccionesOnvoPendientes() con protección de concurrencia
 * mediante pg_try_advisory_lock.
 */
import { conciliarTransaccionesOnvoPendientes } from '../../src/services/billing-service.js';
import { pool } from '../../src/db/pool.js';

const ADVISORY_LOCK_ID = 918273645; // Hash constante para el worker de reconciliación

async function main() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [RECONCILER] Iniciando worker de conciliación ONVO...`);

  const client = await pool.connect();
  let lockAcquired = false;

  try {
    // Protección contra ejecuciones concurrentes mediante PostgreSQL advisory lock
    const lockRes = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [ADVISORY_LOCK_ID]);
    lockAcquired = Boolean(lockRes.rows[0]?.acquired);

    if (!lockAcquired) {
      console.warn(`[${timestamp}] [RECONCILER] Otra instancia de conciliación ya está en ejecución. Finalizando sin error.`);
      process.exit(0);
    }

    const result = await conciliarTransaccionesOnvoPendientes();
    console.log(`[${timestamp}] [RECONCILER] Conciliación completada:`, JSON.stringify(result));
    process.exitCode = 0;
  } catch (err: any) {
    console.error(`[${timestamp}] [RECONCILER ERROR] Fallo inesperado durante la conciliación:`, err.message || err);
    process.exitCode = 1;
  } finally {
    if (lockAcquired) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_ID]);
      } catch (unlockErr: any) {
        console.warn(`[${timestamp}] [RECONCILER] Error al liberar advisory lock:`, unlockErr.message);
      }
    }
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('[FATAL RECONCILER]', err);
  process.exit(1);
});
