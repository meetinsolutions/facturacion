import crypto from 'crypto';
import { Pool } from 'pg';

const TEST_DB = 'facturacion_test';

// 1. Verificación estricta de entorno y seguridad
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL no está definida.');
}

const url = new URL(databaseUrl);
if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
  throw new Error('Protocolo PostgreSQL no válido.');
}

const configuredDb = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
if (configuredDb !== TEST_DB) {
  throw new Error(`SEGURIDAD CRÍTICA: La base configurada es "${configuredDb}", NO "${TEST_DB}". Abortando.`);
}

async function runTestSuite() {
  console.log('====================================================');
  console.log('   SUITE DE PRUEBAS DE INTEGRIDAD DE FACTURACIÓN   ');
  console.log('   Entorno objetivo: facturacion_test              ');
  console.log('====================================================\n');

  // Conexión directa para control y verificación previa
  const controlPool = new Pool({
    connectionString: databaseUrl,
    max: 5,
    connectionTimeoutMillis: 5000
  });

  const checkDb = await controlPool.query('SELECT current_database() AS db');
  if (checkDb.rows[0]?.db !== TEST_DB) {
    throw new Error('SEGURIDAD CRÍTICA: Conectado a base incorrecta.');
  }

  // Importar dinámicamente los servicios después de asegurar process.env.DATABASE_URL
  const { pool, withTransaction } = await import('../src/db/pool');
  const { completarPagoYActivarSuscripcion } = await import('../src/services/billing-service');

  // Limpiar datos previos en la base de pruebas
  await controlPool.query('DELETE FROM payment_transactions');
  await controlPool.query('DELETE FROM subscriptions');
  await controlPool.query('DELETE FROM tenants');

  let passed = 0;
  let total = 0;

  async function test(name: string, fn: () => Promise<void>) {
    total++;
    try {
      await fn();
      console.log(`✅ [PASS] Prueba ${total}: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`❌ [FAIL] Prueba ${total}: ${name}`);
      console.error(`   Error: ${err.message}`);
    }
  }

  // Helpers para crear fixtures
  async function createFixture(opts: {
    tenantId?: string;
    subId?: string;
    txId?: string;
    planCode?: string;
    subStatus?: string;
    txStatus?: string;
    provider?: string;
    providerRef?: string;
    linkSub?: boolean;
    skipSub?: boolean;
  }) {
    const tenantId = opts.tenantId || crypto.randomUUID();
    const subId = opts.subId || crypto.randomUUID();
    const txId = opts.txId || crypto.randomUUID();
    const planCode = opts.planCode || 'emprendedor';
    const subStatus = opts.subStatus || 'trialing';
    const txStatus = opts.txStatus || 'pending';
    const provider = opts.provider || 'stripe';
    const providerRef = opts.providerRef || null;

    await controlPool.query(
      `INSERT INTO tenants (id, nombre, slug, activo) VALUES ($1, $2, $3, true)`,
      [tenantId, `Test Corp ${tenantId.slice(0, 8)}`, `slug-${tenantId.slice(0, 8)}`]
    );

    if (!opts.skipSub) {
      const now = new Date();
      const end = new Date(now.getTime() + 7 * 86400_000);
      await controlPool.query(
        `INSERT INTO subscriptions (id, tenant_id, plan_code, status, billing_cycle, current_period_start, current_period_end, provider)
         VALUES ($1, $2, $3, $4, 'monthly', $5, $6, 'trial')`,
        [subId, tenantId, planCode, subStatus, now, end]
      );
    }

    const linkedSubId = opts.skipSub ? null : (opts.linkSub !== false ? subId : null);

    await controlPool.query(
      `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, provider_reference, status)
       VALUES ($1, $2, $3, $4, 'monthly', 15.00, 'USD', $5, $6, $7)`,
      [txId, tenantId, linkedSubId, planCode, provider, providerRef, txStatus]
    );

    return { tenantId, subId, txId, planCode };
  }

  try {
    // ----------------------------------------------------
    // Escenario 1: Proveedor incorrecto
    // ----------------------------------------------------
    await test('Proveedor incorrecto es rechazado sin modificar estado', async () => {
      const { txId, tenantId } = await createFixture({ provider: 'stripe' });
      let threw = false;
      try {
        await completarPagoYActivarSuscripcion(txId, 'onvopay');
      } catch (err: any) {
        threw = true;
        if (!err.message.includes('proveedor')) throw err;
      }
      if (!threw) throw new Error('Se esperaba excepción por proveedor incompatible');

      const tx = await controlPool.query('SELECT status FROM payment_transactions WHERE id = $1', [txId]);
      if (tx.rows[0].status !== 'pending') throw new Error('El estado de la transacción fue modificado indebidamente');

      const sub = await controlPool.query('SELECT status FROM subscriptions WHERE tenant_id = $1', [tenantId]);
      if (sub.rows[0].status !== 'trialing') throw new Error('El estado de la suscripción fue modificado indebidamente');
    });

    // ----------------------------------------------------
    // Escenario 2: Transacción en estado no pending (cancelada/fallida)
    // ----------------------------------------------------
    await test('Transacción fallida/cancelada no puede ser confirmada', async () => {
      const { txId } = await createFixture({ provider: 'stripe', txStatus: 'failed' });
      let threw = false;
      try {
        await completarPagoYActivarSuscripcion(txId, 'stripe');
      } catch (err: any) {
        threw = true;
        if (!err.message.includes('No se puede confirmar')) throw err;
      }
      if (!threw) throw new Error('Se esperaba excepción por estado failed');
    });

    // ----------------------------------------------------
    // Escenario 3: Transacción ya pagada (Idempotencia)
    // ----------------------------------------------------
    await test('Transacción ya pagada retorna alreadyPaid: true sin alterar períodos', async () => {
      const { txId, tenantId, subId } = await createFixture({ provider: 'stripe', txStatus: 'paid' });
      const subBefore = await controlPool.query('SELECT current_period_end FROM subscriptions WHERE id = $1', [subId]);

      const res = await completarPagoYActivarSuscripcion(txId, 'stripe');
      if (res.alreadyPaid !== true) throw new Error(`Se esperaba alreadyPaid: true, se obtuvo ${res.alreadyPaid}`);
      if (res.tenantId !== tenantId) throw new Error('tenantId no coincide');

      const subAfter = await controlPool.query('SELECT current_period_end FROM subscriptions WHERE id = $1', [subId]);
      if (new Date(subBefore.rows[0].current_period_end).getTime() !== new Date(subAfter.rows[0].current_period_end).getTime()) {
        throw new Error('El período de suscripción fue extendido indebidamente en pago duplicado');
      }
    });

    // ----------------------------------------------------
    // Escenario 4: Suscripción inexistente (Rollback completo)
    // ----------------------------------------------------
    await test('Transacción sin suscripción asociada revierte cambios por completo', async () => {
      const { txId } = await createFixture({ provider: 'stripe', skipSub: true });
      let threw = false;
      try {
        await completarPagoYActivarSuscripcion(txId, 'stripe');
      } catch (err: any) {
        threw = true;
        if (!err.message.includes('No existe una suscripción válida')) throw err;
      }
      if (!threw) throw new Error('Se esperaba excepción por suscripción faltante');

      const tx = await controlPool.query('SELECT status, paid_at FROM payment_transactions WHERE id = $1', [txId]);
      if (tx.rows[0].status !== 'pending' || tx.rows[0].paid_at !== null) {
        throw new Error('Rollback falló: la transacción quedó marcada como pagada');
      }
    });

    // ----------------------------------------------------
    // Escenario 5: Relación inconsistente (Tenant A asociado a suscripción de Tenant B)
    // ----------------------------------------------------
    await test('Transacción vinculada a suscripción de otra empresa es rechazada', async () => {
      const fixtureA = await createFixture({ provider: 'stripe' });
      const fixtureB = await createFixture({ provider: 'stripe' });

      // Asociar la transacción de Tenant A con la suscripción de Tenant B
      await controlPool.query('UPDATE payment_transactions SET subscription_id = $1 WHERE id = $2', [
        fixtureB.subId,
        fixtureA.txId
      ]);

      let threw = false;
      try {
        await completarPagoYActivarSuscripcion(fixtureA.txId, 'stripe');
      } catch (err: any) {
        threw = true;
        if (!err.message.includes('no corresponde a la suscripción')) throw err;
      }
      if (!threw) throw new Error('Se esperaba excepción por discrepancia de tenant/suscripción');

      const tx = await controlPool.query('SELECT status FROM payment_transactions WHERE id = $1', [fixtureA.txId]);
      if (tx.rows[0].status !== 'pending') throw new Error('La transacción fue modificada a pesar del error de relación');
    });

    // ----------------------------------------------------
    // Escenario 6: Pago válido (Activación y preservación de referencia previa)
    // ----------------------------------------------------
    await test('Pago válido activa suscripción y preserva referencia previa existente', async () => {
      const originalRef = 'SINPE_COMPROBANTE_ORIGINAL_12345';
      const { txId, tenantId } = await createFixture({
        provider: 'manual_sinpe',
        providerRef: originalRef,
        txStatus: 'pending'
      });

      const res = await completarPagoYActivarSuscripcion(txId, 'manual_sinpe', 'NUEVA_REFERENCIA_SOBREESCRIBIR');
      if (res.alreadyPaid !== false) throw new Error('alreadyPaid debe ser false en primera confirmación');

      const tx = await controlPool.query('SELECT status, provider_reference, paid_at FROM payment_transactions WHERE id = $1', [txId]);
      if (tx.rows[0].status !== 'paid') throw new Error('La transacción debe estar en estado paid');
      if (!tx.rows[0].paid_at) throw new Error('paid_at debe tener fecha y hora');
      if (tx.rows[0].provider_reference !== originalRef) {
        throw new Error(`Referencia externa sobreescrita. Esperado: "${originalRef}", actual: "${tx.rows[0].provider_reference}"`);
      }

      const sub = await controlPool.query('SELECT status, current_period_end FROM subscriptions WHERE tenant_id = $1', [tenantId]);
      if (sub.rows[0].status !== 'active') throw new Error('La suscripción debe haber pasado a active');
    });

    // ----------------------------------------------------
    // Escenario 7: Fallo SQL provocado (Rollback atómico)
    // ----------------------------------------------------
    await test('Fallo transaccional ejecuta rollback completo en withTransaction', async () => {
      const { txId } = await createFixture({ provider: 'stripe' });

      let threw = false;
      try {
        await withTransaction(async (client) => {
          await client.query("UPDATE payment_transactions SET status = 'paid' WHERE id = $1", [txId]);
          // Provocar error SQL de clave foránea o tabla inexistente
          await client.query("INSERT INTO payment_transactions (id, tenant_id, plan_code, amount_usd, provider, status) VALUES ($1, $2, 'plan_inexistente_xyz', 10, 'stripe', 'pending')", [
            crypto.randomUUID(),
            crypto.randomUUID()
          ]);
        });
      } catch (err: any) {
        threw = true;
      }
      if (!threw) throw new Error('Se esperaba error en la transacción provocada');

      const tx = await controlPool.query('SELECT status FROM payment_transactions WHERE id = $1', [txId]);
      if (tx.rows[0].status !== 'pending') {
        throw new Error('Rollback falló: la transacción quedó en paid a pesar de la excepción');
      }
    });

    // ----------------------------------------------------
    // Escenario 8: Dos confirmaciones simultáneas (Concurrencia)
    // ----------------------------------------------------
    await test('Dos confirmaciones simultáneas resultan en exactamente una activación', async () => {
      const { txId, tenantId, subId } = await createFixture({ provider: 'stripe' });

      const [res1, res2] = await Promise.all([
        completarPagoYActivarSuscripcion(txId, 'stripe', 'ref_1'),
        completarPagoYActivarSuscripcion(txId, 'stripe', 'ref_2')
      ]);

      const paidCount = [res1, res2].filter(r => r.alreadyPaid === false).length;
      const alreadyPaidCount = [res1, res2].filter(r => r.alreadyPaid === true).length;

      if (paidCount !== 1 || alreadyPaidCount !== 1) {
        throw new Error(`Concurrencia fallida. Activaciones nuevas: ${paidCount}, Ya pagadas: ${alreadyPaidCount}`);
      }

      const tx = await controlPool.query('SELECT status FROM payment_transactions WHERE id = $1', [txId]);
      if (tx.rows[0].status !== 'paid') throw new Error('La transacción debe estar paid');
    });

  } finally {
    // Limpieza al final de la suite
    await controlPool.query('DELETE FROM payment_transactions');
    await controlPool.query('DELETE FROM subscriptions');
    await controlPool.query('DELETE FROM tenants');
    await controlPool.end();
    await pool.end();
  }

  console.log('\n====================================================');
  console.log(`RESULTADO FINAL: ${passed}/${total} PRUEBAS EXITOSAS`);
  console.log('====================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('ERROR NO CAPTURADO EN RUNNER:', err);
  process.exit(1);
});
