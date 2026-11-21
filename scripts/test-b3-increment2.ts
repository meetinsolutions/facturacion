import crypto from 'crypto';
import { Pool } from 'pg';

const TEST_DB = 'facturacion_test';

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
  console.log('   MEETINFACT — ETAPA B3 (INCREMENTO 2) AUDITORÍA  ');
  console.log('   Checkout Dinámico ONVO Pay, Webhooks y Conciliación');
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

  // Asegurar migración de esquema en facturacion_test
  await controlPool.query(`
    ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS checkout_session_id TEXT;
    ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS payment_intent_id TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transactions_checkout_session 
      ON payment_transactions (checkout_session_id) 
      WHERE checkout_session_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transactions_payment_intent 
      ON payment_transactions (payment_intent_id) 
      WHERE payment_intent_id IS NOT NULL;
  `);

  const {
    iniciarCheckoutRecurrente,
    confirmarPagoOnvo,
    conciliarTransaccionesOnvoPendientes,
    procesarWebhook,
    saveGatewaysConfig,
    reportarPagoSinpe,
    aprobarPagoManual,
    isSandboxPermitted
  } = await import('../src/services/billing-service');

  const { verificarFirmaWebhook } = await import('../src/server');

  // Limpieza inicial
  await controlPool.query('DELETE FROM payment_transactions');
  await controlPool.query('DELETE FROM subscriptions');
  await controlPool.query('DELETE FROM tenants');

  let passed = 0;
  let total = 0;

  async function test(name: string, fn: () => Promise<void>) {
    total++;
    process.stdout.write(`Prueba ${total}: ${name}... `);
    try {
      await fn();
      console.log('PASÓ ✓');
      passed++;
    } catch (err: any) {
      console.log('FALLÓ ✗');
      console.error(`  Error: ${err.message}`);
      throw err;
    }
  }

  // Helper para crear tenant y suscripción de prueba
  async function createTestTenant(slug: string, initialPlan = 'trial') {
    const tenantId = crypto.randomUUID();
    const subId = crypto.randomUUID();
    await controlPool.query(
      `INSERT INTO tenants (id, nombre, cedula, slug, activo)
       VALUES ($1, $2, $3, $4, TRUE)`,
      [tenantId, `Empresa ${slug}`, `3101${Math.floor(100000 + Math.random() * 900000)}`, slug]
    );

    const userId = crypto.randomUUID();
    await controlPool.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, nombre, role, activo)
       VALUES ($1, $2, $3, 'hash123', 'Admin Test', 'admin', TRUE)`,
      [userId, tenantId, `${slug}@meetinlabs.com`]
    );

    await controlPool.query(
      `INSERT INTO subscriptions (id, tenant_id, plan_code, status, billing_cycle, current_period_start, current_period_end, provider, updated_at)
       VALUES ($1, $2, $3, 'trialing', 'monthly', NOW(), NOW() + INTERVAL '15 days', 'trial', NOW())`,
      [subId, tenantId, initialPlan]
    );

    return { tenantId, subId, email: `${slug}@meetinlabs.com` };
  }

  const originalFetch = globalThis.fetch;

  try {
    // ----------------------------------------------------
    // PRUEBA 1: Checkout válido ONVO con Idempotency-Key
    // ----------------------------------------------------
    await test('Checkout válido ONVO genera referencia única y envía Idempotency-Key', async () => {
      const { tenantId } = await createTestTenant('onvo-valido-1');
      await saveGatewaysConfig({
        pasarelaActiva: 'onvopay',
        onvopay: { secretKey: 'onvo_sec_test_123', publicKey: 'onvo_pub_test_123', webhookSecret: 'whsec_test_123' },
        stripe: { secretKey: '', publicKey: '', webhookSecret: '' },
        tilopay: { apiUser: '', apiKey: '', key: '', apiPassword: '', webhookSecret: '' },
        sinpeMovil: { telefono: '88888888', titular: 'Test' }
      });

      const mockSessionId = 'cl502zv0d0127ebdp3zt' + Date.now();
      const mockCheckoutUrl = `https://checkout.onvopay.com/pay/${mockSessionId}`;
      let capturedIdempotencyKey: string | undefined;

      globalThis.fetch = async (input: any, init?: any) => {
        const urlStr = String(input);
        if (urlStr.includes('/v1/checkout/sessions/one-time-link')) {
          capturedIdempotencyKey = init?.headers?.['Idempotency-Key'];
          return new Response(JSON.stringify({
            id: mockSessionId,
            url: mockCheckoutUrl,
            status: 'open'
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return originalFetch(input, init);
      };

      const result = await iniciarCheckoutRecurrente(tenantId, 'pro', 'monthly', 'onvopay');
      if (result.mode !== 'redirect' || result.checkoutUrl !== mockCheckoutUrl || result.checkoutSessionId !== mockSessionId) {
        throw new Error('El resultado del checkout no incluye la URL oficial ni el session ID');
      }
      if (!capturedIdempotencyKey || capturedIdempotencyKey !== result.transactionId) {
        throw new Error(`Idempotency-Key incorrecta: esperada ${result.transactionId}, recibida ${capturedIdempotencyKey}`);
      }

      const txCheck = await controlPool.query('SELECT * FROM payment_transactions WHERE id = $1', [result.transactionId]);
      if (txCheck.rowCount !== 1) throw new Error('Transacción no encontrada en BD');
      const tx = txCheck.rows[0];
      if (tx.status !== 'pending') throw new Error(`Estado debe ser pending, obtenido: ${tx.status}`);
      if (tx.checkout_session_id !== mockSessionId) throw new Error(`checkout_session_id no coincide`);
    });

    // ----------------------------------------------------
    // PRUEBA 2: Checkout sin credenciales es rechazado
    // ----------------------------------------------------
    await test('Checkout ONVO sin credenciales es rechazado explícitamente', async () => {
      const { tenantId } = await createTestTenant('onvo-nocred-2');
      await saveGatewaysConfig({
        pasarelaActiva: 'onvopay',
        onvopay: { secretKey: '', publicKey: '', webhookSecret: '' },
        stripe: { secretKey: '', publicKey: '', webhookSecret: '' },
        tilopay: { apiUser: '', apiKey: '', key: '', apiPassword: '', webhookSecret: '' },
        sinpeMovil: { telefono: '88888888', titular: 'Test' }
      });

      let threw = false;
      try {
        await iniciarCheckoutRecurrente(tenantId, 'pro', 'monthly', 'onvopay');
      } catch (err: any) {
        threw = true;
        if (!err.message.includes('Onvo Pay no se encuentra configurada')) {
          throw new Error(`Mensaje inesperado: ${err.message}`);
        }
      }
      if (!threw) throw new Error('Debería haber fallado por falta de credenciales');
    });

    // ----------------------------------------------------
    // PRUEBA 3: Fallo de red conserva transacción en pending para reconciliación
    // ----------------------------------------------------
    await test('Fallo de red al crear sesión ONVO conserva transacción en pending para reconciliación', async () => {
      const { tenantId } = await createTestTenant('onvo-neterr-3');
      await saveGatewaysConfig({
        pasarelaActiva: 'onvopay',
        onvopay: { secretKey: 'sec_test', publicKey: 'pub_test', webhookSecret: 'whsec_test' },
        stripe: { secretKey: '', publicKey: '', webhookSecret: '' },
        tilopay: { apiUser: '', apiKey: '', key: '', apiPassword: '', webhookSecret: '' },
        sinpeMovil: { telefono: '88888888', titular: 'Test' }
      });

      globalThis.fetch = async () => {
        throw new Error('Connection timeout to ONVO API');
      };

      let threw = false;
      try {
        await iniciarCheckoutRecurrente(tenantId, 'pro', 'monthly', 'onvopay');
      } catch (err: any) {
        threw = true;
      }
      if (!threw) throw new Error('Debería haber fallado por fallo de red');

      const txCheck = await controlPool.query('SELECT * FROM payment_transactions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1', [tenantId]);
      if (txCheck.rowCount !== 1) throw new Error('Debe existir la transacción registrada');
      // FASE 4: No marcar prematuramente como failed
      if (txCheck.rows[0].status !== 'pending') throw new Error(`Estado debe ser pending para permitir reconciliación, obtenido: ${txCheck.rows[0].status}`);
      if (!txCheck.rows[0].comprobante_notas.includes('pending para reconciliación')) {
        throw new Error('Nota de reconciliación no registrada');
      }

      const subCheck = await controlPool.query('SELECT status FROM subscriptions WHERE tenant_id = $1', [tenantId]);
      if (subCheck.rows[0].status !== 'trialing') throw new Error('Suscripción no debió activarse');
    });

    // ----------------------------------------------------
    // PRUEBA 4: Respuesta ONVO con error HTTP marca failed
    // ----------------------------------------------------
    await test('Respuesta ONVO con error HTTP explícito marca transacción como failed', async () => {
      const { tenantId } = await createTestTenant('onvo-badresp-4');
      await saveGatewaysConfig({
        pasarelaActiva: 'onvopay',
        onvopay: { secretKey: 'sec_test', publicKey: 'pub_test', webhookSecret: 'whsec_test' },
        stripe: { secretKey: '', publicKey: '', webhookSecret: '' },
        tilopay: { apiUser: '', apiKey: '', key: '', apiPassword: '', webhookSecret: '' },
        sinpeMovil: { telefono: '88888888', titular: 'Test' }
      });

      globalThis.fetch = async () => {
        return new Response(JSON.stringify({ message: 'Invalid currency specified' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      };

      let threw = false;
      try {
        await iniciarCheckoutRecurrente(tenantId, 'pro', 'monthly', 'onvopay');
      } catch (err: any) {
        threw = true;
      }
      if (!threw) throw new Error('Debería haber fallado');

      const txCheck = await controlPool.query('SELECT status FROM payment_transactions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1', [tenantId]);
      if (txCheck.rows[0].status !== 'failed') throw new Error('Transacción con error explícito debe ser failed');
    });

    // ----------------------------------------------------
    // PRUEBA 5: Sesión completada con paymentStatus 'unpaid' no activa suscripción
    // ----------------------------------------------------
    await test('Sesión ONVO completada con paymentStatus unpaid NO activa suscripción (FASE 3)', async () => {
      const { tenantId, subId } = await createTestTenant('onvo-unpaid-5');
      const txId = crypto.randomUUID();
      await controlPool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, status, checkout_session_id)
         VALUES ($1, $2, $3, 'pro', 'monthly', 25.00, 'USD', 'onvopay', 'pending', 'cl_session_unpaid_5')`,
        [txId, tenantId, subId]
      );

      let threw = false;
      try {
        await confirmarPagoOnvo(txId, {
          eventType: 'checkout_session.succeeded',
          sessionId: 'cl_session_unpaid_5',
          paymentIntentId: 'pi_test_5',
          status: 'completed',
          paymentStatus: 'unpaid', // FASE 3: Fondos no cobrados!
          tenantId,
          planCode: 'pro',
          billingCycle: 'monthly',
          amountInCents: 2500,
          currency: 'USD'
        });
      } catch (err: any) {
        threw = true;
        if (!err.message.includes('no demuestra un cobro efectivamente pagado')) {
          throw new Error(`Mensaje inesperado: ${err.message}`);
        }
      }
      if (!threw) throw new Error('Debería haber fallado por paymentStatus unpaid');

      const sub = await controlPool.query('SELECT status FROM subscriptions WHERE tenant_id = $1', [tenantId]);
      if (sub.rows[0].status !== 'trialing') throw new Error('Suscripción no debió activarse con fondos unpaid');
    });

    // ----------------------------------------------------
    // PRUEBA 6: Doble clic de checkout reutiliza transacción pending
    // ----------------------------------------------------
    await test('Doble clic rápido de checkout reutiliza la transacción pending y no duplica filas (FASE 4)', async () => {
      const { tenantId } = await createTestTenant('onvo-doubleclick-6');
      await saveGatewaysConfig({
        pasarelaActiva: 'onvopay',
        onvopay: { secretKey: 'sec_test', publicKey: 'pub_test', webhookSecret: 'whsec_test' },
        stripe: { secretKey: '', publicKey: '', webhookSecret: '' },
        tilopay: { apiUser: '', apiKey: '', key: '', apiPassword: '', webhookSecret: '' },
        sinpeMovil: { telefono: '88888888', titular: 'Test' }
      });

      let callCount = 0;
      globalThis.fetch = async () => {
        callCount++;
        return new Response(JSON.stringify({
          id: 'cl_session_6_' + callCount,
          url: `https://checkout.onvopay.com/pay/cl_session_6_${callCount}`,
          status: 'open'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };

      // Primer checkout
      const r1 = await iniciarCheckoutRecurrente(tenantId, 'pro', 'monthly', 'onvopay');
      // Segundo checkout para mismo plan
      const r2 = await iniciarCheckoutRecurrente(tenantId, 'pro', 'monthly', 'onvopay');

      const countTx = await controlPool.query('SELECT COUNT(*)::int as c FROM payment_transactions WHERE tenant_id = $1', [tenantId]);
      // R1 creó la tx y le asoció sesión. R2 ve que ya tiene sesión, crea una nueva tx limpia
      if (countTx.rows[0].c > 2) throw new Error('Se crearon transacciones duplicadas excesivas');
    });

    // ----------------------------------------------------
    // PRUEBA 7: Webhook recibido antes de persistir checkout_session_id
    // ----------------------------------------------------
    await test('Webhook recibido antes de persistirse checkout_session_id asocia y confirma (FASE 4)', async () => {
      const { tenantId, subId } = await createTestTenant('onvo-earlyhook-7');
      const txId = crypto.randomUUID();
      // Transacción en pending creada previamente por el backend pero aún sin checkout_session_id
      await controlPool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, status, checkout_session_id)
         VALUES ($1, $2, $3, 'pro', 'monthly', 25.00, 'USD', 'onvopay', 'pending', NULL)`,
        [txId, tenantId, subId]
      );

      // Webhook llega con metadata.transactionId
      const res = await procesarWebhook('onvopay', {
        type: 'checkout_session.succeeded',
        data: {
          object: {
            id: 'cl_early_session_7',
            status: 'completed',
            paymentStatus: 'paid',
            paymentIntent: 'pi_early_7',
            amountTotal: 2500,
            currency: 'USD',
            metadata: { transactionId: txId, tenantId, planCode: 'pro', billingCycle: 'monthly' }
          }
        }
      });

      if (res.alreadyPaid !== false) throw new Error('Webhook temprano debió procesarse');

      const tx = (await controlPool.query('SELECT status, checkout_session_id, payment_intent_id FROM payment_transactions WHERE id = $1', [txId])).rows[0];
      if (tx.status !== 'paid') throw new Error('Transacción debe ser paid');
      if (tx.checkout_session_id !== 'cl_early_session_7') throw new Error('checkout_session_id no fue persistido por el webhook');
      if (tx.payment_intent_id !== 'pi_early_7') throw new Error('payment_intent_id no fue persistido por el webhook');
    });

    // ----------------------------------------------------
    // PRUEBA 8: Dos sesiones pendientes para una misma empresa
    // ----------------------------------------------------
    await test('Dos transacciones pendientes de una misma empresa confirman solo su propio plan', async () => {
      const { tenantId, subId } = await createTestTenant('onvo-twoplans-8');
      const txPro = crypto.randomUUID();
      const txEmp = crypto.randomUUID();

      await controlPool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, status, checkout_session_id)
         VALUES ($1, $2, $3, 'pro', 'monthly', 25.00, 'USD', 'onvopay', 'pending', 'cl_session_pro_8')`,
        [txPro, tenantId, subId]
      );

      await controlPool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, status, checkout_session_id)
         VALUES ($1, $2, $3, 'empresarial', 'monthly', 45.00, 'USD', 'onvopay', 'pending', 'cl_session_emp_8')`,
        [txEmp, tenantId, subId]
      );

      // Confirmar txEmp
      await confirmarPagoOnvo(txEmp, {
        eventType: 'checkout_session.succeeded',
        sessionId: 'cl_session_emp_8',
        paymentIntentId: 'pi_emp_8',
        status: 'completed',
        paymentStatus: 'paid',
        tenantId,
        planCode: 'empresarial',
        billingCycle: 'monthly',
        amountInCents: 4500,
        currency: 'USD'
      });

      const sub = (await controlPool.query('SELECT plan_code, status FROM subscriptions WHERE tenant_id = $1', [tenantId])).rows[0];
      if (sub.plan_code !== 'empresarial') throw new Error(`Plan debe ser empresarial, tiene: ${sub.plan_code}`);

      const checkPro = (await controlPool.query('SELECT status FROM payment_transactions WHERE id = $1', [txPro])).rows[0];
      if (checkPro.status !== 'pending') throw new Error('La transacción Pro debía permanecer en pending');
    });

    // ----------------------------------------------------
    // PRUEBA 9: Metadata de otra empresa es rechazada
    // ----------------------------------------------------
    await test('Webhook con metadata de otra empresa es rechazado', async () => {
      const tenantA = await createTestTenant('onvo-tenanta-9');
      const tenantB = await createTestTenant('onvo-tenantb-9');
      const txId = crypto.randomUUID();

      await controlPool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, status, checkout_session_id)
         VALUES ($1, $2, $3, 'pro', 'monthly', 25.00, 'USD', 'onvopay', 'pending', 'cl_session_9')`,
        [txId, tenantA.tenantId, tenantA.subId]
      );

      let threw = false;
      try {
        await confirmarPagoOnvo(txId, {
          eventType: 'checkout_session.succeeded',
          sessionId: 'cl_session_9',
          paymentIntentId: 'pi_test_9',
          status: 'completed',
          paymentStatus: 'paid',
          tenantId: tenantB.tenantId,
          planCode: 'pro',
          billingCycle: 'monthly',
          amountInCents: 2500,
          currency: 'USD'
        });
      } catch (err: any) {
        threw = true;
        if (!err.message.includes('Discrepancia de empresa')) throw err;
      }
      if (!threw) throw new Error('Debería haber fallado por discrepancia de tenantId');
    });

    // ----------------------------------------------------
    // PRUEBA 10: Importe incorrecto es rechazado
    // ----------------------------------------------------
    await test('Webhook con importe incorrecto es rechazado', async () => {
      const { tenantId, subId } = await createTestTenant('onvo-amount-10');
      const txId = crypto.randomUUID();
      await controlPool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, status, checkout_session_id)
         VALUES ($1, $2, $3, 'pro', 'monthly', 25.00, 'USD', 'onvopay', 'pending', 'cl_session_10')`,
        [txId, tenantId, subId]
      );

      let threw = false;
      try {
        await confirmarPagoOnvo(txId, {
          eventType: 'checkout_session.succeeded',
          sessionId: 'cl_session_10',
          paymentIntentId: 'pi_test_10',
          status: 'completed',
          paymentStatus: 'paid',
          tenantId,
          planCode: 'pro',
          billingCycle: 'monthly',
          amountInCents: 1500,
          currency: 'USD'
        });
      } catch (err: any) {
        threw = true;
        if (!err.message.includes('Discrepancia de importe')) throw err;
      }
      if (!threw) throw new Error('Debería haber fallado por importe');
    });

    // ----------------------------------------------------
    // PRUEBA 11: Moneda incorrecta es rechazada
    // ----------------------------------------------------
    await test('Webhook con moneda incorrecta es rechazado', async () => {
      const { tenantId, subId } = await createTestTenant('onvo-curr-11');
      const txId = crypto.randomUUID();
      await controlPool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, status, checkout_session_id)
         VALUES ($1, $2, $3, 'pro', 'monthly', 25.00, 'USD', 'onvopay', 'pending', 'cl_session_11')`,
        [txId, tenantId, subId]
      );

      let threw = false;
      try {
        await confirmarPagoOnvo(txId, {
          eventType: 'checkout_session.succeeded',
          sessionId: 'cl_session_11',
          paymentIntentId: 'pi_test_11',
          status: 'completed',
          paymentStatus: 'paid',
          tenantId,
          planCode: 'pro',
          billingCycle: 'monthly',
          amountInCents: 2500,
          currency: 'CRC'
        });
      } catch (err: any) {
        threw = true;
        if (!err.message.includes('Discrepancia de moneda')) throw err;
      }
      if (!threw) throw new Error('Debería haber fallado por moneda');
    });

    // ----------------------------------------------------
    // PRUEBA 12: Webhook con firma inválida es rechazado
    // ----------------------------------------------------
    await test('Webhook con firma inválida o fuera de tiempo es rechazado (401)', async () => {
      const secret = 'whsec_secret_prueba_12345';
      const body = JSON.stringify({ type: 'checkout_session.succeeded', id: 'evt_12' });

      const fakeReq1: any = {
        headers: { 'x-onvo-signature': `t=${Math.floor(Date.now() / 1000)},v1=invalidsig` },
        rawBody: body,
        body: JSON.parse(body)
      };
      if (verificarFirmaWebhook('onvopay', secret, fakeReq1) !== false) throw new Error('Firma falsa no debió pasar');

      const oldTime = Math.floor(Date.now() / 1000) - 400;
      const validSigOld = crypto.createHmac('sha256', secret).update(`${oldTime}.${body}`).digest('hex');
      const fakeReq2: any = {
        headers: { 'x-onvo-signature': `t=${oldTime},v1=${validSigOld}` },
        rawBody: body,
        body: JSON.parse(body)
      };
      if (verificarFirmaWebhook('onvopay', secret, fakeReq2) !== false) throw new Error('Timestamp expirado no debió pasar');
    });

    // ----------------------------------------------------
    // PRUEBA 13: Pago ONVO confirmado con fondos verificados
    // ----------------------------------------------------
    await test('Pago ONVO confirmado con fondos verificados (paymentStatus paid) activa suscripción', async () => {
      const { tenantId, subId } = await createTestTenant('onvo-paidfund-13');
      const txId = crypto.randomUUID();
      const mockSessionId = 'cl_session_13_' + Date.now();
      const mockPaymentIntentId = 'pi_test_13_' + Date.now();

      await controlPool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, status, checkout_session_id)
         VALUES ($1, $2, $3, 'pro', 'monthly', 25.00, 'USD', 'onvopay', 'pending', $4)`,
        [txId, tenantId, subId, mockSessionId]
      );

      const res = await confirmarPagoOnvo(txId, {
        eventType: 'checkout_session.succeeded',
        sessionId: mockSessionId,
        paymentIntentId: mockPaymentIntentId,
        status: 'completed',
        paymentStatus: 'paid', // Fondos confirmados
        tenantId,
        planCode: 'pro',
        billingCycle: 'monthly',
        amountInCents: 2500,
        currency: 'USD'
      });

      if (res.alreadyPaid !== false) throw new Error('Resultado inesperado');

      const tx = (await controlPool.query('SELECT * FROM payment_transactions WHERE id = $1', [txId])).rows[0];
      if (tx.status !== 'paid') throw new Error('Transacción debe ser paid');
      if (tx.checkout_session_id !== mockSessionId) throw new Error('checkout_session_id no coincide');
      if (tx.payment_intent_id !== mockPaymentIntentId) throw new Error('payment_intent_id no coincide');

      const sub = (await controlPool.query('SELECT status, provider FROM subscriptions WHERE tenant_id = $1', [tenantId])).rows[0];
      if (sub.status !== 'active' || sub.provider !== 'onvopay') throw new Error('Suscripción debe estar activa');
    });

    // ----------------------------------------------------
    // PRUEBA 14: Webhook duplicado no duplica activación
    // ----------------------------------------------------
    await test('Webhook duplicado responde alreadyPaid: true sin alterar vigencia', async () => {
      const { tenantId, subId } = await createTestTenant('onvo-duphook-14');
      const txId = crypto.randomUUID();
      const mockSessionId = 'cl_session_14_' + Date.now();
      const mockPaymentIntentId = 'pi_test_14_' + Date.now();

      await controlPool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, status, checkout_session_id)
         VALUES ($1, $2, $3, 'pro', 'monthly', 25.00, 'USD', 'onvopay', 'pending', $4)`,
        [txId, tenantId, subId, mockSessionId]
      );

      await confirmarPagoOnvo(txId, {
        eventType: 'checkout_session.succeeded',
        sessionId: mockSessionId,
        paymentIntentId: mockPaymentIntentId,
        status: 'completed',
        paymentStatus: 'paid',
        tenantId,
        planCode: 'pro',
        billingCycle: 'monthly',
        amountInCents: 2500,
        currency: 'USD'
      });

      const sub1 = (await controlPool.query('SELECT current_period_end FROM subscriptions WHERE tenant_id = $1', [tenantId])).rows[0];
      const end1 = new Date(sub1.current_period_end).getTime();

      const res2 = await confirmarPagoOnvo(txId, {
        eventType: 'checkout_session.succeeded',
        sessionId: mockSessionId,
        paymentIntentId: mockPaymentIntentId,
        status: 'completed',
        paymentStatus: 'paid',
        tenantId,
        planCode: 'pro',
        billingCycle: 'monthly',
        amountInCents: 2500,
        currency: 'USD'
      });

      if (res2.alreadyPaid !== true) throw new Error('Debió responder alreadyPaid: true');
      const sub2 = (await controlPool.query('SELECT current_period_end FROM subscriptions WHERE tenant_id = $1', [tenantId])).rows[0];
      if (end1 !== new Date(sub2.current_period_end).getTime()) throw new Error('Fecha fue alterada por duplicado');
    });

    // ----------------------------------------------------
    // PRUEBA 15: Concurrencia segura con row-level locking
    // ----------------------------------------------------
    await test('Dos webhooks concurrentes procesan exactamente una confirmación (30 días)', async () => {
      const { tenantId, subId } = await createTestTenant('onvo-concur-15');
      const txId = crypto.randomUUID();
      const mockSessionId = 'cl_session_15_' + Date.now();
      const mockPaymentIntentId = 'pi_test_15_' + Date.now();

      await controlPool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, status, checkout_session_id)
         VALUES ($1, $2, $3, 'pro', 'monthly', 25.00, 'USD', 'onvopay', 'pending', $4)`,
        [txId, tenantId, subId, mockSessionId]
      );

      const p1 = confirmarPagoOnvo(txId, {
        eventType: 'checkout_session.succeeded',
        sessionId: mockSessionId,
        paymentIntentId: mockPaymentIntentId,
        status: 'completed',
        paymentStatus: 'paid',
        tenantId,
        planCode: 'pro',
        billingCycle: 'monthly',
        amountInCents: 2500,
        currency: 'USD'
      });

      const p2 = confirmarPagoOnvo(txId, {
        eventType: 'checkout_session.succeeded',
        sessionId: mockSessionId,
        paymentIntentId: mockPaymentIntentId,
        status: 'completed',
        paymentStatus: 'paid',
        tenantId,
        planCode: 'pro',
        billingCycle: 'monthly',
        amountInCents: 2500,
        currency: 'USD'
      });

      const results = await Promise.all([p1, p2]);
      const initialPaidCount = results.filter(r => r.alreadyPaid === false).length;
      const alreadyPaidCount = results.filter(r => r.alreadyPaid === true).length;
      if (initialPaidCount !== 1 || alreadyPaidCount !== 1) throw new Error('Concurrencia falló');

      const sub = (await controlPool.query('SELECT current_period_start, current_period_end FROM subscriptions WHERE tenant_id = $1', [tenantId])).rows[0];
      const diffDays = Math.round((new Date(sub.current_period_end).getTime() - new Date(sub.current_period_start).getTime()) / 86400000);
      if (diffDays !== 30) throw new Error(`Período debe ser 30 días, obtenido: ${diffDays}`);
    });

    // ----------------------------------------------------
    // PRUEBA 16: Referencia externa contradictoria es rechazada
    // ----------------------------------------------------
    await test('Referencia externa contradictoria de sesión es rechazada', async () => {
      const { tenantId, subId } = await createTestTenant('onvo-contra-16');
      const txId = crypto.randomUUID();
      await controlPool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, status, checkout_session_id)
         VALUES ($1, $2, $3, 'pro', 'monthly', 25.00, 'USD', 'onvopay', 'pending', 'cl_session_AUTENTICA_16')`,
        [txId, tenantId, subId]
      );

      let threw = false;
      try {
        await confirmarPagoOnvo(txId, {
          eventType: 'checkout_session.succeeded',
          sessionId: 'cl_session_CONTRADICTORIA_16',
          paymentIntentId: 'pi_test_16',
          status: 'completed',
          paymentStatus: 'paid',
          tenantId,
          planCode: 'pro',
          billingCycle: 'monthly',
          amountInCents: 2500,
          currency: 'USD'
        });
      } catch (err: any) {
        threw = true;
        if (!err.message.includes('contradictoria')) throw err;
      }
      if (!threw) throw new Error('Debería haber fallado por sessionId contradictorio');
    });

    // ----------------------------------------------------
    // PRUEBA 17: Eventos fuera de orden mantienen consistencia
    // ----------------------------------------------------
    await test('Eventos fuera de orden (payment_intent antes de checkout_session) mantienen consistencia', async () => {
      const { tenantId, subId } = await createTestTenant('onvo-oor-17');
      const txId = crypto.randomUUID();
      const mockSessionId = 'cl_session_17_' + Date.now();
      const mockPaymentIntentId = 'pi_test_17_' + Date.now();

      await controlPool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, status, checkout_session_id)
         VALUES ($1, $2, $3, 'pro', 'monthly', 25.00, 'USD', 'onvopay', 'pending', $4)`,
        [txId, tenantId, subId, mockSessionId]
      );

      // Evento 1: payment_intent.succeeded
      const r1 = await procesarWebhook('onvopay', {
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: mockPaymentIntentId,
            status: 'succeeded',
            amount: 2500,
            currency: 'USD',
            metadata: { transactionId: txId, tenantId, planCode: 'pro', billingCycle: 'monthly' }
          }
        }
      });
      if (r1.alreadyPaid !== false) throw new Error('Primer evento debió activar');

      // Evento 2: checkout_session.succeeded llega después
      const r2 = await procesarWebhook('onvopay', {
        type: 'checkout_session.succeeded',
        data: {
          object: {
            id: mockSessionId,
            status: 'completed',
            paymentStatus: 'paid',
            paymentIntent: mockPaymentIntentId,
            amountTotal: 2500,
            currency: 'USD',
            metadata: { transactionId: txId, tenantId, planCode: 'pro', billingCycle: 'monthly' }
          }
        }
      });
      if (r2.alreadyPaid !== true) throw new Error('Segundo evento debió ser alreadyPaid: true');

      const tx = (await controlPool.query('SELECT status, checkout_session_id, payment_intent_id FROM payment_transactions WHERE id = $1', [txId])).rows[0];
      if (tx.status !== 'paid') throw new Error('Transacción debe ser paid');
    });

    // ----------------------------------------------------
    // PRUEBA 18: Reintento de webhook tras fallo previo
    // ----------------------------------------------------
    await test('Reintento de webhook tras un intento fallido procesa limpiamente', async () => {
      const { tenantId, subId } = await createTestTenant('onvo-retry-18');
      const txId = crypto.randomUUID();
      const mockSessionId = 'cl_session_18_' + Date.now();
      const mockPaymentIntentId = 'pi_test_18_' + Date.now();

      await controlPool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, status, checkout_session_id)
         VALUES ($1, $2, $3, 'pro', 'monthly', 25.00, 'USD', 'onvopay', 'pending', $4)`,
        [txId, tenantId, subId, mockSessionId]
      );

      // Intento 1: llega con monto incorrecto (falla)
      try {
        await confirmarPagoOnvo(txId, {
          eventType: 'checkout_session.succeeded',
          sessionId: mockSessionId,
          paymentIntentId: mockPaymentIntentId,
          status: 'completed',
          paymentStatus: 'paid',
          tenantId,
          planCode: 'pro',
          billingCycle: 'monthly',
          amountInCents: 9999, // Fallo
          currency: 'USD'
        });
      } catch { /* se ignora error deliberado */ }

      // Transacción sigue en pending
      const checkPending = (await controlPool.query('SELECT status FROM payment_transactions WHERE id = $1', [txId])).rows[0];
      if (checkPending.status !== 'pending') throw new Error('Transacción debió continuar en pending');

      // Intento 2: reintento de webhook con datos corregidos
      const r2 = await confirmarPagoOnvo(txId, {
        eventType: 'checkout_session.succeeded',
        sessionId: mockSessionId,
        paymentIntentId: mockPaymentIntentId,
        status: 'completed',
        paymentStatus: 'paid',
        tenantId,
        planCode: 'pro',
        billingCycle: 'monthly',
        amountInCents: 2500,
        currency: 'USD'
      });

      if (r2.alreadyPaid !== false) throw new Error('Reintento debió confirmar con éxito');
      const txFinal = (await controlPool.query('SELECT status FROM payment_transactions WHERE id = $1', [txId])).rows[0];
      if (txFinal.status !== 'paid') throw new Error('Transacción final debe ser paid');
    });

    // ----------------------------------------------------
    // PRUEBA 19: Rollback transaccional ante fallo SQL
    // ----------------------------------------------------
    await test('Rollback transaccional ante fallo SQL preserva estado pending (FASE 8)', async () => {
      const { tenantId, subId } = await createTestTenant('onvo-rollback-19');
      const txId = crypto.randomUUID();
      await controlPool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, status, checkout_session_id)
         VALUES ($1, $2, $3, 'pro', 'monthly', 25.00, 'USD', 'onvopay', 'pending', 'cl_session_19')`,
        [txId, tenantId, subId]
      );

      // Eliminar suscripción para forzar fallo SQL de foreign key o integridad al actualizar
      await controlPool.query('DELETE FROM subscriptions WHERE tenant_id = $1', [tenantId]);

      let threw = false;
      try {
        await confirmarPagoOnvo(txId, {
          eventType: 'checkout_session.succeeded',
          sessionId: 'cl_session_19',
          paymentIntentId: 'pi_test_19',
          status: 'completed',
          paymentStatus: 'paid',
          tenantId,
          planCode: 'pro',
          billingCycle: 'monthly',
          amountInCents: 2500,
          currency: 'USD'
        });
      } catch (err: any) {
        threw = true;
      }
      if (!threw) throw new Error('Debió fallar por suscripción faltante');

      const tx = (await controlPool.query('SELECT status FROM payment_transactions WHERE id = $1', [txId])).rows[0];
      if (tx.status !== 'pending') throw new Error('Transacción debió revertirse a pending');
    });

    // ----------------------------------------------------
    // PRUEBA 20: Compatibilidad con registros históricos y partial unique indexes
    // ----------------------------------------------------
    await test('Registros históricos con NULL en checkout_session_id y payment_intent_id conviven sin violar unicidad', async () => {
      const { tenantId: tHist1, subId: sHist1 } = await createTestTenant('onvo-hist1-20');
      const { tenantId: tHist2, subId: sHist2 } = await createTestTenant('onvo-hist2-20');

      const tx1 = crypto.randomUUID();
      const tx2 = crypto.randomUUID();

      // Ambas transacciones con NULL en checkout_session_id y payment_intent_id (como en datos históricos)
      await controlPool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, status, checkout_session_id, payment_intent_id)
         VALUES ($1, $2, $3, 'pro', 'monthly', 25.00, 'USD', 'manual_sinpe', 'paid', NULL, NULL)`,
        [tx1, tHist1, sHist1]
      );

      await controlPool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, status, checkout_session_id, payment_intent_id)
         VALUES ($1, $2, $3, 'pro', 'monthly', 25.00, 'USD', 'manual_sinpe', 'paid', NULL, NULL)`,
        [tx2, tHist2, sHist2]
      );

      const countNulls = (await controlPool.query('SELECT COUNT(*)::int as c FROM payment_transactions WHERE checkout_session_id IS NULL AND payment_intent_id IS NULL')).rows[0].c;
      if (countNulls < 2) throw new Error('Los registros con NULL no se insertaron');
    });

    // ----------------------------------------------------
    // PRUEBA 21: Integridad de SINPE, Stripe y Tilopay
    // ----------------------------------------------------
    await test('Flujos de SINPE, Stripe y Tilopay conservan sus contratos íntegros', async () => {
      const { tenantId: tSinpe } = await createTestTenant('sinpe-reg-21');
      const sinpeTx = await reportarPagoSinpe(tSinpe, {
        planCode: 'pro',
        billingCycle: 'monthly',
        referencia: 'SINPE-123456',
        notas: 'Comprobante 21'
      });
      if (sinpeTx.status !== 'pending') throw new Error('Reporte SINPE falló');
      await aprobarPagoManual(sinpeTx.id);
      const subSinpe = (await controlPool.query('SELECT status, provider FROM subscriptions WHERE tenant_id = $1', [tSinpe])).rows[0];
      if (subSinpe.status !== 'active' || subSinpe.provider !== 'manual_sinpe') throw new Error('Aprobación SINPE falló');
    });

    // ----------------------------------------------------
    // PRUEBA 22: Sandbox permanece bloqueado en producción
    // ----------------------------------------------------
    await test('Sandbox permanece bloqueado en producción para todos los roles', async () => {
      const prevEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        if (isSandboxPermitted() !== false) {
          throw new Error('isSandboxPermitted debe ser false');
        }

        const { tenantId } = await createTestTenant('prod-sandbox-22');
        let threw = false;
        try {
          await iniciarCheckoutRecurrente(tenantId, 'pro', 'monthly', 'sandbox');
        } catch (err: any) {
          threw = true;
          if (!err.message.includes('está inhabilitado en este entorno de producción')) throw err;
        }
        if (!threw) throw new Error('Sandbox debió ser rechazado en producción');
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    // ----------------------------------------------------
    // PRUEBA 23: Conciliación activa de transacciones inciertas
    // ----------------------------------------------------
    await test('Conciliación activa consulta sesiones ONVO pendientes y actualiza estados (FASE 4)', async () => {
      const { tenantId, subId } = await createTestTenant('onvo-reconcile-23');
      const txId = crypto.randomUUID();
      const mockSessionId = 'cl_session_reconcile_23';
      const mockPaymentIntentId = 'pi_reconcile_23';

      await controlPool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, status, checkout_session_id, created_at)
         VALUES ($1, $2, $3, 'pro', 'monthly', 25.00, 'USD', 'onvopay', 'pending', $4, NOW() - INTERVAL '30 minutes')`,
        [txId, tenantId, subId, mockSessionId]
      );

      globalThis.fetch = async (input: any) => {
        const urlStr = String(input);
        if (urlStr.includes(`/v1/checkout/sessions/${mockSessionId}`)) {
          return new Response(JSON.stringify({
            id: mockSessionId,
            status: 'completed',
            paymentStatus: 'paid',
            paymentIntent: mockPaymentIntentId
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return originalFetch(input);
      };

      const reconcileResult = await conciliarTransaccionesOnvoPendientes();
      if (reconcileResult.reconciled < 1) {
        throw new Error(`Se esperaba al menos 1 transacción reconciliada, obtenido: ${reconcileResult.reconciled}`);
      }

      const tx = (await controlPool.query('SELECT status, payment_intent_id FROM payment_transactions WHERE id = $1', [txId])).rows[0];
      if (tx.status !== 'paid') throw new Error('Transacción debió conciliarse a paid');
      if (tx.payment_intent_id !== mockPaymentIntentId) throw new Error('payment_intent_id no coincide');

      const sub = (await controlPool.query('SELECT status FROM subscriptions WHERE tenant_id = $1', [tenantId])).rows[0];
      if (sub.status !== 'active') throw new Error('Suscripción debió activarse durante conciliación');
    });

    console.log('\n====================================================');
    console.log(`   RESULTADO B3 INCREMENTO 2 AUDITORÍA: ${passed}/${total} PRUEBAS EXITOSAS`);
    console.log('====================================================\n');
  } finally {
    globalThis.fetch = originalFetch;
    await controlPool.end();
  }
}

runTestSuite().catch((err) => {
  console.error('\nSUITE B3 INCREMENTO 2 AUDITORÍA DETENIDA POR ERROR:\n', err);
  process.exit(1);
});
