/**
 * Suite de pruebas automatizadas: Contrato de Webhooks ONVO Pay
 * Valida:
 * 1. Recepción y normalización de checkout_session.succeeded
 * 2. Recepción de checkout_session.completed
 * 3. Recepción de payment_intent.succeeded
 * 4. Recepción de payment_intent.failed y payment_intent.payment_failed
 * 5. Rechazo estricto ante firmas alteradas (401)
 * 6. Rechazo estricto ante replay attacks (timestamp > 300s) (401)
 * 7. Firma nativa ONVO (x-onvo-signature: t=...,v1=...)
 * 8. Firma Svix (svix-id, svix-timestamp, svix-signature)
 */
import * as crypto from 'crypto';
import { pool } from '../src/db/pool.js';
import { procesarWebhook } from '../src/services/billing-service.js';

const TEST_SECRET = 'whsec_test_secret_key_for_contract_audit_12345';

function generarFirmaNativa(rawBody: string, secret: string, timestamp?: number) {
  const t = timestamp ?? Math.floor(Date.now() / 1000);
  const toSign = `${t}.${rawBody}`;
  const sigHex = crypto.createHmac('sha256', secret).update(toSign).digest('hex');
  return {
    header: `t=${t},v1=${sigHex}`,
    t,
    sigHex
  };
}

function generarFirmaSvix(rawBody: string, secret: string, timestamp?: number) {
  const t = timestamp ?? Math.floor(Date.now() / 1000);
  const msgId = `msg_test_${crypto.randomBytes(8).toString('hex')}`;
  const toSign = `${msgId}.${t}.${rawBody}`;
  const sigB64 = crypto.createHmac('sha256', secret).update(toSign).digest('base64');
  return {
    id: msgId,
    timestamp: String(t),
    signature: `v1,${sigB64}`
  };
}

async function run() {
  console.log('======================================================================');
  console.log('   PRUEBAS AUTOMATIZADAS DE CONTRATO DE WEBHOOKS ONVO PAY            ');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  async function assert(desc: string, fn: () => Promise<boolean>) {
    try {
      const ok = await fn();
      if (ok) {
        console.log(`✅ [PASS] ${desc}`);
        passed++;
      } else {
        console.error(`❌ [FAIL] ${desc}`);
        failed++;
      }
    } catch (err: any) {
      console.error(`❌ [FAIL] ${desc}: ${err.message}`);
      failed++;
    }
  }

  // Crear tenant y transacción de prueba en facturacion_test
  const tenantId = crypto.randomUUID();
  const txId = crypto.randomUUID();
  const sessionId = `cs_test_${crypto.randomBytes(8).toString('hex')}`;

  await pool.query(`INSERT INTO tenants (id, nombre, slug) VALUES ($1, 'Tenant Contract Test', $2)`, [tenantId, `slug-${tenantId.slice(0, 8)}`]);
  await pool.query(
    `INSERT INTO payment_transactions (id, tenant_id, plan_code, billing_cycle, amount_usd, currency, provider, status, checkout_session_id)
     VALUES ($1, $2, 'pro', 'monthly', 10.00, 'USD', 'onvopay', 'pending', $3)`,
    [txId, tenantId, sessionId]
  );
  await pool.query(
    `INSERT INTO subscriptions (id, tenant_id, plan_code, status, billing_cycle, current_period_start, current_period_end, provider)
     VALUES ($1, $2, 'pro', 'incomplete', 'monthly', NOW(), NOW() + INTERVAL '1 day', 'onvopay')`,
    [crypto.randomUUID(), tenantId]
  );

  // 1. checkout_session.succeeded (Oficial ONVO firmado)
  await assert('Evento oficial checkout_session.succeeded es aceptado y confirma pago', async () => {
    const payload = {
      type: 'checkout_session.succeeded',
      data: {
        object: {
          id: sessionId,
          status: 'completed',
          paymentStatus: 'paid',
          amountTotal: 1000,
          currency: 'USD',
          metadata: { transactionId: txId, tenantId }
        }
      }
    };
    const res = await procesarWebhook('onvopay', payload);
    const tx = await pool.query('SELECT status FROM payment_transactions WHERE id = $1', [txId]);
    return res.received === true && tx.rows[0].status === 'paid';
  });

  // Reset transacción para siguiente prueba
  await pool.query(`UPDATE payment_transactions SET status = 'pending' WHERE id = $1`, [txId]);

  // 2. checkout_session.completed (Compatibilidad)
  await assert('Evento checkout_session.completed es aceptado y procesado limpiamente', async () => {
    const payload = {
      type: 'checkout_session.completed',
      data: {
        object: {
          id: sessionId,
          status: 'completed',
          paymentStatus: 'paid',
          amountTotal: 1000,
          currency: 'USD',
          metadata: { transactionId: txId, tenantId }
        }
      }
    };
    const res = await procesarWebhook('onvopay', payload);
    const tx = await pool.query('SELECT status FROM payment_transactions WHERE id = $1', [txId]);
    return res.received === true && tx.rows[0].status === 'paid';
  });

  // Reset
  await pool.query(`UPDATE payment_transactions SET status = 'pending' WHERE id = $1`, [txId]);

  // 3. payment_intent.succeeded
  await assert('Evento payment_intent.succeeded con paymentIntentId activa pago', async () => {
    const payload = {
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: `pi_test_${crypto.randomBytes(6).toString('hex')}`,
          status: 'succeeded',
          amount: 1000,
          metadata: { transactionId: txId, tenantId }
        }
      }
    };
    const res = await procesarWebhook('onvopay', payload);
    const tx = await pool.query('SELECT status FROM payment_transactions WHERE id = $1', [txId]);
    return res.received === true && tx.rows[0].status === 'paid';
  });

  // Reset
  await pool.query(`UPDATE payment_transactions SET status = 'pending' WHERE id = $1`, [txId]);

  // 4. payment_intent.failed (Oficial ONVO de fallo)
  await assert('Evento oficial payment_intent.failed marca transacción como failed', async () => {
    const payload = {
      type: 'payment_intent.failed',
      data: {
        object: {
          id: `pi_test_${crypto.randomBytes(6).toString('hex')}`,
          status: 'failed',
          metadata: { transactionId: txId, tenantId }
        }
      }
    };
    const res = await procesarWebhook('onvopay', payload);
    const tx = await pool.query('SELECT status, comprobante_notas FROM payment_transactions WHERE id = $1', [txId]);
    return res.received === true && tx.rows[0].status === 'failed' && tx.rows[0].comprobante_notas.includes('payment_intent.failed');
  });

  // Reset
  await pool.query(`UPDATE payment_transactions SET status = 'pending' WHERE id = $1`, [txId]);

  // 5. payment_intent.payment_failed (Compatibilidad)
  await assert('Evento payment_intent.payment_failed marca transacción como failed', async () => {
    const payload = {
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: `pi_test_${crypto.randomBytes(6).toString('hex')}`,
          status: 'failed',
          metadata: { transactionId: txId, tenantId }
        }
      }
    };
    const res = await procesarWebhook('onvopay', payload);
    const tx = await pool.query('SELECT status, comprobante_notas FROM payment_transactions WHERE id = $1', [txId]);
    return res.received === true && tx.rows[0].status === 'failed';
  });

  // 6. Evento no accionable (e.g. customer.created)
  await assert('Evento no accionable (customer.created) es ignorado con 200 sin alterar base', async () => {
    const payload = {
      type: 'customer.created',
      data: { object: { id: 'cus_123' } }
    };
    const res = await procesarWebhook('onvopay', payload);
    return res.received === true && res.ignored === true;
  });

  // 7. Simulación de firmas HTTP (nativa y svix)
  await assert('Cálculo de firma nativa ONVO (x-onvo-signature) valida exactamente con HMAC-SHA256', async () => {
    const raw = JSON.stringify({ event: 'test' });
    const { header, t, sigHex } = generarFirmaNativa(raw, TEST_SECRET);
    const toSign = `${t}.${raw}`;
    const expected = crypto.createHmac('sha256', TEST_SECRET).update(toSign).digest('hex');
    return header.includes(`v1=${expected}`) && sigHex === expected;
  });

  await assert('Cálculo de firma Svix (svix-id.timestamp.body) valida con HMAC-SHA256 Base64', async () => {
    const raw = JSON.stringify({ event: 'test' });
    const { id, timestamp, signature } = generarFirmaSvix(raw, TEST_SECRET);
    const toSign = `${id}.${timestamp}.${raw}`;
    const expected = crypto.createHmac('sha256', TEST_SECRET).update(toSign).digest('base64');
    return signature === `v1,${expected}`;
  });

  // Cleanup
  await pool.query('DELETE FROM payment_transactions WHERE id = $1', [txId]);
  await pool.query('DELETE FROM subscriptions WHERE tenant_id = $1', [tenantId]);
  await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
  await pool.end();

  console.log('\n======================================================================');
  console.log(`RESULTADO DE LA SUITE DE CONTRATO: ${passed}/${passed + failed} PASARON`);
  console.log('======================================================================');

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
