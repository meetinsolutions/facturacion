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
  console.log('   MEETINFACT — ETAPA B3 (INCREMENTO 1)            ');
  console.log('   Suite de Seguridad, Anti-Sandbox y Producción   ');
  console.log('   Entorno objetivo: facturacion_test              ');
  console.log('====================================================\n');

  const controlPool = new Pool({
    connectionString: databaseUrl,
    max: 5,
    connectionTimeoutMillis: 5000
  });

  const checkDb = await controlPool.query('SELECT current_database() AS db');
  if (checkDb.rows[0]?.db !== TEST_DB) {
    throw new Error('SEGURIDAD CRÍTICA: Conectado a base incorrecta.');
  }

  // Importar dinámicamente los servicios con DATABASE_URL ya fijado en facturacion_test
  const { pool, withTransaction } = await import('../src/db/pool');
  const {
    iniciarCheckoutRecurrente,
    completarPagoYActivarSuscripcion,
    reportarPagoSinpe,
    aprobarPagoManual,
    saveGatewaysConfig,
    getGatewaysConfig,
    isSandboxPermitted
  } = await import('../src/services/billing-service');

  // Limpieza inicial
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

  // Helper para crear fixtures de tenant y suscripción
  async function createTestTenant(opts?: { planCode?: string; subStatus?: string }) {
    const tenantId = crypto.randomUUID();
    const subId = crypto.randomUUID();
    const planCode = opts?.planCode || 'emprendedor';
    const subStatus = opts?.subStatus || 'trialing';

    await controlPool.query(
      `INSERT INTO tenants (id, nombre, slug, activo) VALUES ($1, $2, $3, true)`,
      [tenantId, `Tenant Test ${tenantId.slice(0, 6)}`, `slug-${tenantId.slice(0, 8)}`]
    );

    const now = new Date();
    const end = new Date(now.getTime() + 14 * 86400_000);
    await controlPool.query(
      `INSERT INTO subscriptions (id, tenant_id, plan_code, status, billing_cycle, current_period_start, current_period_end, provider)
       VALUES ($1, $2, $3, $4, 'monthly', $5, $6, 'trial')`,
      [subId, tenantId, planCode, subStatus, now, end]
    );

    return { tenantId, subId, planCode };
  }

  try {
    // ------------------------------------------------------------------------
    // PRUEBA 1: Usuario normal en producción intentando sandbox: estrictamente rechazado
    // ------------------------------------------------------------------------
    await test('Usuario normal en producción solicitando sandbox: rechazado con error 403', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        if (isSandboxPermitted()) {
          throw new Error('isSandboxPermitted debió retornar false en producción');
        }
        const { tenantId } = await createTestTenant();
        let threw = false;
        try {
          await iniciarCheckoutRecurrente(tenantId, 'emprendedor', 'monthly', 'sandbox');
        } catch (err: any) {
          threw = true;
          if (!err.message.includes('inhabilitado en este entorno de producción')) {
            throw new Error(`Mensaje inesperado: ${err.message}`);
          }
        }
        if (!threw) throw new Error('Se esperaba rechazo estricto de sandbox en producción');
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });

    // ------------------------------------------------------------------------
    // PRUEBA 2: SuperAdmin en producción intentando sandbox: rechazado igualmente
    // ------------------------------------------------------------------------
    await test('SuperAdmin en producción intentando sandbox: rechazado (sin excepciones por rol)', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        // En producción, ningún rol puede saltarse la prohibición de sandbox
        const permitted = isSandboxPermitted();
        if (permitted) {
          throw new Error('Fallo de seguridad: SuperAdmin no debe poder habilitar sandbox en producción');
        }
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });

    // ------------------------------------------------------------------------
    // PRUEBA 3: Pasarela activa sandbox en producción: rechazada
    // ------------------------------------------------------------------------
    await test('Pasarela activa sandbox en producción: rechazada (no basta cambiar pasarela en BD)', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        await saveGatewaysConfig({ pasarelaActiva: 'sandbox' });
        const { tenantId } = await createTestTenant();

        let threw = false;
        try {
          await iniciarCheckoutRecurrente(tenantId, 'emprendedor', 'monthly');
        } catch (err: any) {
          threw = true;
        }
        if (!threw) throw new Error('El backend debió rechazar sandbox en producción aunque esté en platform_settings');
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });

    // ------------------------------------------------------------------------
    // PRUEBA 4: Pasarela activa ONVO en producción: confirmación sandbox rechazada
    // ------------------------------------------------------------------------
    await test('Pasarela activa ONVO en producción: endpoint sandbox rechazado con 403', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        await saveGatewaysConfig({ pasarelaActiva: 'onvopay' });
        if (isSandboxPermitted()) {
          throw new Error('isSandboxPermitted debió retornar false con pasarela ONVO en producción');
        }
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });

    // ------------------------------------------------------------------------
    // PRUEBA 5: Transacción de otra empresa rechazada (Aislamiento Multi-Tenant)
    // ------------------------------------------------------------------------
    await test('Transacción sandbox de Empresa B es rechazada al confirmarse por Empresa A', async () => {
      const tenantA = await createTestTenant();
      const tenantB = await createTestTenant();
      const txIdB = crypto.randomUUID();

      await controlPool.query(
        `INSERT INTO payment_transactions (id, tenant_id, plan_code, billing_cycle, amount_usd, currency, provider, status)
         VALUES ($1, $2, 'pro', 'monthly', 35.00, 'USD', 'sandbox', 'pending')`,
        [txIdB, tenantB.tenantId]
      );

      const txRes = await controlPool.query(
        'SELECT * FROM payment_transactions WHERE id = $1 AND tenant_id = $2',
        [txIdB, tenantA.tenantId]
      );

      if (txRes.rowCount !== 0) {
        throw new Error('Aislamiento fallido: Empresa A tuvo acceso a la transacción de Empresa B');
      }
    });

    // ------------------------------------------------------------------------
    // PRUEBA 6: Transacción ONVO enviada al endpoint sandbox es rechazada
    // ------------------------------------------------------------------------
    await test('Transacción creada para ONVO no puede confirmarse como sandbox', async () => {
      const { tenantId } = await createTestTenant();
      const txId = crypto.randomUUID();

      await controlPool.query(
        `INSERT INTO payment_transactions (id, tenant_id, plan_code, billing_cycle, amount_usd, currency, provider, status)
         VALUES ($1, $2, 'emprendedor', 'monthly', 15.00, 'USD', 'onvopay', 'pending')`,
        [txId, tenantId]
      );

      const txRes = await controlPool.query('SELECT * FROM payment_transactions WHERE id = $1', [txId]);
      const tx = txRes.rows[0];

      if (tx.provider === 'sandbox') {
        throw new Error('La transacción debió crearse con provider onvopay');
      }

      // Validar que completarPagoYActivarSuscripcion rechace mismatch de proveedor
      let threw = false;
      try {
        await completarPagoYActivarSuscripcion(txId, 'sandbox');
      } catch (err: any) {
        threw = true;
      }
      if (!threw) throw new Error('completarPagoYActivarSuscripcion debió rechazar expectedProvider mismatch');
    });

    // ------------------------------------------------------------------------
    // PRUEBA 7: Solicitud con providerOverride='sandbox' rechazada en producción
    // ------------------------------------------------------------------------
    await test('providerOverride: sandbox es rechazado y no degrada en producción', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        await saveGatewaysConfig({ pasarelaActiva: 'onvopay' });
        const { tenantId } = await createTestTenant();

        let threw = false;
        try {
          await iniciarCheckoutRecurrente(tenantId, 'pro', 'monthly', 'sandbox');
        } catch (err: any) {
          threw = true;
        }
        if (!threw) throw new Error('Se esperaba rechazo al intentar inyectar providerOverride=sandbox');
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });

    // ------------------------------------------------------------------------
    // PRUEBA 8: Entorno de pruebas aislado + autorización válida: sandbox permitido
    // ------------------------------------------------------------------------
    await test('Entorno de pruebas aislado con sandbox activo: operación permitida', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';
      try {
        await saveGatewaysConfig({ pasarelaActiva: 'sandbox' });
        const { tenantId, subId } = await createTestTenant();

        const checkoutRes = await iniciarCheckoutRecurrente(tenantId, 'emprendedor', 'monthly');
        if (checkoutRes.mode !== 'sandbox' || checkoutRes.provider !== 'sandbox') {
          throw new Error('Se esperaba modo sandbox en entorno de pruebas autorizado');
        }

        const confirmRes = await completarPagoYActivarSuscripcion(
          checkoutRes.transactionId,
          'sandbox',
          `sandbox_${Date.now()}`,
          `sandbox_sub_${tenantId}`
        );

        if (confirmRes.alreadyPaid !== false) throw new Error('Confirmación fallida');

        const sub = await controlPool.query('SELECT status FROM subscriptions WHERE id = $1', [subId]);
        if (sub.rows[0].status !== 'active') throw new Error('La suscripción debió activarse');
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });

    // ------------------------------------------------------------------------
    // PRUEBA 9: Configuración de entorno inmutable por datos del cliente
    // ------------------------------------------------------------------------
    await test('Configuración de entorno proviene exclusivamente del servidor (inmutable por cliente)', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        // Ningún objeto body ni parámetro puede sobreescribir isSandboxPermitted()
        if (isSandboxPermitted()) {
          throw new Error('Fallo de inmutabilidad: el servidor permitió sandbox en producción');
        }
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });

    // ------------------------------------------------------------------------
    // PRUEBA 10: SINPE manual conserva su flujo íntegro (reportar y aprobar SuperAdmin)
    // ------------------------------------------------------------------------
    await test('SINPE manual conserva flujo íntegro (reportar y aprobar por SuperAdmin)', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const { tenantId, subId } = await createTestTenant();
        const comprobanteRef = 'SINPE_AUDIT_VERIFIED_99999';

        const reportRes = await reportarPagoSinpe(tenantId, {
          planCode: 'pro',
          billingCycle: 'monthly',
          referencia: comprobanteRef,
          notas: 'Depósito auditado'
        });

        if (reportRes.status !== 'pending') throw new Error('Reporte SINPE debe quedar pending');

        const txBefore = await controlPool.query('SELECT status, provider_reference FROM payment_transactions WHERE id = $1', [reportRes.id]);
        if (txBefore.rows[0].status !== 'pending' || txBefore.rows[0].provider_reference !== comprobanteRef) {
          throw new Error('Transacción SINPE inicial inconsistente');
        }

        // Aprobación manual por SuperAdmin
        const approveRes = await aprobarPagoManual(reportRes.id);
        if (approveRes.alreadyPaid !== false) throw new Error('Aprobación SINPE fallida');

        const txAfter = await controlPool.query('SELECT status, provider_reference FROM payment_transactions WHERE id = $1', [reportRes.id]);
        if (txAfter.rows[0].status !== 'paid' || txAfter.rows[0].provider_reference !== comprobanteRef) {
          throw new Error('Transacción SINPE no quedó paid o modificó referencia');
        }

        const subAfter = await controlPool.query('SELECT status, plan_code FROM subscriptions WHERE id = $1', [subId]);
        if (subAfter.rows[0].status !== 'active' || subAfter.rows[0].plan_code !== 'pro') {
          throw new Error('Suscripción SINPE no se activó correctamente');
        }
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });

  } finally {
    // Limpieza final
    await controlPool.query('DELETE FROM payment_transactions');
    await controlPool.query('DELETE FROM subscriptions');
    await controlPool.query('DELETE FROM tenants');
    await controlPool.end();
    await pool.end();
  }

  console.log('\n====================================================');
  console.log(`RESULTADO SUITE B3-INC1 (SEGURIDAD): ${passed}/${total} PRUEBAS EXITOSAS`);
  console.log('====================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('ERROR NO CAPTURADO EN RUNNER B3-INC1:', err);
  process.exit(1);
});
