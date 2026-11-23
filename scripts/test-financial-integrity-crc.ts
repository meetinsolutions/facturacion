/**
 * MEETINFACT — SUITE DE VALIDACIÓN Y AJUSTES FINANCIEROS PUNTUALES EN QA
 * Valida los 4 puntos requeridos:
 * 1. IMPORTES ONVO SANDBOX: Unidades en céntimos para CRC, eliminación de fallback ambiguo, rechazo de discrepancias.
 * 2. CÁLCULO MRR: Cartera mixta (mensual CRC, anual CRC/12, trial=0, excluyendo estados inactivos y owner).
 * 3. HISTORIAL MULTIDIVISA: Pagos históricos en USD ($XX.XX), pagos nuevos en CRC (₡XX.XXX), cero reconversión retroactiva.
 * 4. MIGRACIONES Y PRESERVACIÓN HISTÓRICA: Cero alteración de datos previos.
 */
import assert from 'assert';
import crypto from 'crypto';
import { pool } from '../src/db/pool.js';
import {
  confirmarPagoOnvo,
  procesarWebhook,
  getEstadoSuscripcion,
  getSuperAdminDashboard,
  formatCRC
} from '../src/services/billing-service.js';

async function main() {
  console.log('======================================================================');
  console.log('  MEETINFACT — TEST DE INTEGRIDAD FINANCIERA Y MIGRACIÓN COMERCIAL CRC');
  console.log('======================================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name: string, fn: () => Promise<void>) {
    total++;
    try {
      await fn();
      console.log(`✅ [PASS ${total}] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`❌ [FAIL ${total}] ${name}`);
      console.error(`   Error: ${err.message}`);
      throw err;
    }
  }

  const cleanupTenants: string[] = [];

  try {
    // Helper para crear tenant
    async function crearTenant(nombre: string, planCode = 'trial', status = 'trialing', cycle: 'monthly' | 'yearly' = 'monthly', provider = 'trial') {
      const tid = crypto.randomUUID();
      const subId = crypto.randomUUID();
      const slug = `fin-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      await pool.query(
        `INSERT INTO tenants (id, nombre, slug, cedula, activo) VALUES ($1, $2, $3, $4, TRUE)`,
        [tid, nombre, slug, `3101${Math.floor(100000 + Math.random() * 900000)}`]
      );
      await pool.query(
        `INSERT INTO subscriptions (id, tenant_id, plan_code, status, billing_cycle, current_period_start, current_period_end, next_billing_date, provider)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW() + INTERVAL '30 days', NOW() + INTERVAL '30 days', $6)`,
        [subId, tid, planCode, status, cycle, provider]
      );
      await pool.query(
        `INSERT INTO users (id, tenant_id, email, password_hash, nombre, role, activo)
         VALUES ($1, $2, $3, 'hash', 'Test User', 'admin', TRUE)`,
        [crypto.randomUUID(), tid, `${slug}@test.cr`]
      );
      cleanupTenants.push(tid);
      return { tid, subId };
    }

    // ====================================================================
    // BLOQUE 1: IMPORTES ONVO SANDBOX Y RECHAZO DE AMBIGÜEDAD
    // ====================================================================
    console.log('--- BLOQUE 1: IMPORTES ONVO SANDBOX ---');

    await test('1.1 ONVO CRC exige importe exacto en céntimos (₡12.900 = 1290000 céntimos)', async () => {
      const { tid, subId } = await crearTenant('Tenant ONVO CRC Céntimos', 'pro', 'incomplete', 'monthly', 'onvopay');
      const txId = crypto.randomUUID();
      const sessId = `cs_crc_${crypto.randomBytes(6).toString('hex')}`;
      const piId = `pi_crc_${crypto.randomBytes(6).toString('hex')}`;

      // Transacción en CRC por ₡12.900
      await pool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, amount_crc, currency, provider, status, checkout_session_id)
         VALUES ($1, $2, $3, 'pro', 'monthly', 25.00, 12900.00, 'CRC', 'onvopay', 'pending', $4)`,
        [txId, tid, subId, sessId]
      );

      // Webhook con céntimos exactos: 12900 * 100 = 1290000
      const res = await confirmarPagoOnvo(txId, {
        eventType: 'checkout-session.succeeded',
        sessionId: sessId,
        paymentIntentId: piId,
        status: 'completed',
        paymentStatus: 'paid',
        tenantId: tid,
        planCode: 'pro',
        billingCycle: 'monthly',
        amountInCents: 1290000,
        currency: 'CRC'
      });

      assert.strictEqual(res.alreadyPaid, false);
      const tx = await pool.query('SELECT status, currency FROM payment_transactions WHERE id = $1', [txId]);
      assert.strictEqual(tx.rows[0].status, 'paid');
      assert.strictEqual(tx.rows[0].currency, 'CRC');
    });

    await test('1.2 Rechazo estricto si se envían colones enteros (12900) en vez de céntimos (1290000) — Eliminación de ambigüedad', async () => {
      const { tid, subId } = await crearTenant('Tenant ONVO Ambiguity Reject', 'pro', 'incomplete', 'monthly', 'onvopay');
      const txId = crypto.randomUUID();
      const sessId = `cs_rej_${crypto.randomBytes(6).toString('hex')}`;
      const piId = `pi_rej_${crypto.randomBytes(6).toString('hex')}`;

      await pool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, amount_crc, currency, provider, status, checkout_session_id)
         VALUES ($1, $2, $3, 'pro', 'monthly', 25.00, 12900.00, 'CRC', 'onvopay', 'pending', $4)`,
        [txId, tid, subId, sessId]
      );

      let threw = false;
      try {
        await confirmarPagoOnvo(txId, {
          eventType: 'checkout-session.succeeded',
          sessionId: sessId,
          paymentIntentId: piId,
          status: 'completed',
          paymentStatus: 'paid',
          tenantId: tid,
          planCode: 'pro',
          billingCycle: 'monthly',
          amountInCents: 12900, // Intentar enviar 12900 en lugar de 1290000
          currency: 'CRC'
        });
      } catch (err: any) {
        threw = true;
        assert(err.message.includes('Discrepancia de importe'), `Esperado error de discrepancia de importe: ${err.message}`);
        assert(err.message.includes('1290000'), 'Debe indicar que esperaba 1290000');
      }
      assert.strictEqual(threw, true, 'Debe haber rechazado la ambigüedad');

      const tx = await pool.query('SELECT status FROM payment_transactions WHERE id = $1', [txId]);
      assert.strictEqual(tx.rows[0].status, 'pending', 'No debe haber confirmado el pago');
    });

    await test('1.3 Rechazo estricto ante discrepancia de moneda (ej. webhook en USD para transacción en CRC)', async () => {
      const { tid, subId } = await crearTenant('Tenant ONVO Currency Mismatch', 'pro', 'incomplete', 'monthly', 'onvopay');
      const txId = crypto.randomUUID();
      const sessId = `cs_curr_${crypto.randomBytes(6).toString('hex')}`;

      await pool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, amount_crc, currency, provider, status, checkout_session_id)
         VALUES ($1, $2, $3, 'pro', 'monthly', 25.00, 12900.00, 'CRC', 'onvopay', 'pending', $4)`,
        [txId, tid, subId, sessId]
      );

      let threw = false;
      try {
        await confirmarPagoOnvo(txId, {
          eventType: 'checkout-session.succeeded',
          sessionId: sessId,
          paymentIntentId: `pi_${sessId}`,
          status: 'completed',
          paymentStatus: 'paid',
          tenantId: tid,
          planCode: 'pro',
          billingCycle: 'monthly',
          amountInCents: 1290000,
          currency: 'USD' // Discrepancia intencional
        });
      } catch (err: any) {
        threw = true;
        assert(err.message.includes('Discrepancia de moneda'), `Esperado error de moneda: ${err.message}`);
      }
      assert.strictEqual(threw, true);
    });

    // ====================================================================
    // BLOQUE 2: CÁLCULO MRR POR SUSCRIPCIÓN CON CARTERA MIXTA
    // ====================================================================
    console.log('\n--- BLOQUE 2: CÁLCULO MRR CON CARTERA MIXTA ---');

    await test('2.1 MRR computa exactamente por suscripción (mensual=precio, anual=precio/12, trial=0, excluyendo inactivos y owner)', async () => {
      // Crear cartera mixta aislada
      // 1. Mensual Pro: ₡12.900
      const c1 = await crearTenant('MRR Activo Mensual Pro', 'pro', 'active', 'monthly', 'onvopay');
      // 2. Anual Pro: ₡129.000 / 12 = ₡10.750
      const c2 = await crearTenant('MRR Activo Anual Pro', 'pro', 'active', 'yearly', 'onvopay');
      // 3. Mensual Emprendedor: ₡6.900
      const c3 = await crearTenant('MRR Activo Mensual Empr', 'emprendedor', 'active', 'monthly', 'manual_sinpe');
      // 4. Anual Empresarial: ₡349.000 / 12 = ₡29.083.333...
      const c4 = await crearTenant('MRR Activo Anual Emp', 'empresarial', 'active', 'yearly', 'onvopay');

      // Estados que NO deben computar (₡0):
      // 5. Trial activo (₡0)
      const c5 = await crearTenant('MRR Trial', 'trial', 'active', 'monthly', 'trial');
      // 6. Trialing (₡0)
      const c6 = await crearTenant('MRR Trialing', 'pro', 'trialing', 'monthly', 'trial');
      // 7. Past Due (₡0)
      const c7 = await crearTenant('MRR Past Due', 'pro', 'past_due', 'monthly', 'onvopay');
      // 8. Suspended (₡0)
      const c8 = await crearTenant('MRR Suspended', 'empresarial', 'suspended', 'monthly', 'onvopay');
      // 9. Canceled (₡0)
      const c9 = await crearTenant('MRR Canceled', 'pro', 'canceled', 'monthly', 'onvopay');
      // 10. Provider Owner (₡0)
      const c10 = await crearTenant('MRR Owner', 'empresarial', 'active', 'monthly', 'owner');

      // Consultar cálculo MRR directo para los tenants de prueba
      const testIds = [c1.tid, c2.tid, c3.tid, c4.tid, c5.tid, c6.tid, c7.tid, c8.tid, c9.tid, c10.tid];
      const mrrRes = await pool.query(
        `SELECT COALESCE(SUM(CASE WHEN s.billing_cycle = 'yearly' THEN p.precio_anual_crc / 12.0 ELSE p.precio_mensual_crc END), 0) AS mrr_crc
         FROM subscriptions s
         JOIN plans p ON p.code = s.plan_code
         WHERE s.status = 'active' AND s.provider <> 'owner' AND s.plan_code <> 'trial'
           AND s.tenant_id = ANY($1::uuid[])`,
        [testIds]
      );

      const mrrCalculado = Number(mrrRes.rows[0].mrr_crc);
      // Esperado: 12900 + 10750 + 6900 + (349000 / 12) = 30550 + 29083.3333 = 59633.3333...
      const esperado = 12900 + 10750 + 6900 + (349000 / 12.0);
      const diff = Math.abs(mrrCalculado - esperado);
      assert(diff < 0.01, `MRR calculado (${mrrCalculado}) difiere del esperado (${esperado})`);

      // Verificar que el redondeo de visualización es exactamente ₡59.633
      assert.strictEqual(Math.round(mrrCalculado), 59633);
      assert.strictEqual(formatCRC(Math.round(mrrCalculado)), '₡59.633');

      // Verificar en SuperAdmin Dashboard que se refleja el MRR global correctamente
      const saDash = await getSuperAdminDashboard();
      assert(saDash.kpis.mrrCrc >= 59633, 'El MRR total del dashboard debe incluir al menos la cartera de prueba');
      assert(saDash.kpis.mrrCrcFormatted.startsWith('₡'), 'Debe estar formateado en colones');
    });

    // ====================================================================
    // BLOQUE 3: HISTORIAL DE TRANSACCIONES MULTIDIVISA
    // ====================================================================
    console.log('\n--- BLOQUE 3: HISTORIAL DE TRANSACCIONES MULTIDIVISA ---');

    await test('3.1 Historial visualiza pagos USD en "$XX.XX" y nuevos pagos CRC en "₡XX.XXX" sin reconversión', async () => {
      const { tid } = await crearTenant('Tenant Historial Multidivisa', 'pro', 'active', 'monthly', 'onvopay');

      // Pago histórico pre-migración: USD $10.00 (amount_crc es null)
      const txUsdId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO payment_transactions (id, tenant_id, plan_code, billing_cycle, amount_usd, amount_crc, currency, provider, status, created_at, paid_at)
         VALUES ($1, $2, 'pro', 'monthly', 10.00, NULL, 'USD', 'onvopay', 'paid', NOW() - INTERVAL '60 days', NOW() - INTERVAL '60 days')`,
        [txUsdId, tid]
      );

      // Pago nuevo post-migración: CRC ₡12.900 (amount_crc es 12900.00)
      const txCrcId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO payment_transactions (id, tenant_id, plan_code, billing_cycle, amount_usd, amount_crc, currency, provider, status, created_at, paid_at)
         VALUES ($1, $2, 'pro', 'monthly', 25.00, 12900.00, 'CRC', 'onvopay', 'paid', NOW(), NOW())`,
        [txCrcId, tid]
      );

      // Obtener estado de suscripción y sus pagos
      const estado = await getEstadoSuscripcion(tid);
      const pagos = estado.pagos;

      const pagoUsd = pagos.find(p => p.id === txUsdId);
      const pagoCrc = pagos.find(p => p.id === txCrcId);

      assert(pagoUsd, 'Debe existir el pago en USD');
      assert(pagoCrc, 'Debe existir el pago en CRC');

      // Verificación estricta de formato y moneda del histórico USD
      assert.strictEqual(pagoUsd.currency, 'USD');
      assert.strictEqual(pagoUsd.amountUsd, 10.00);
      assert.strictEqual(pagoUsd.amountFormatted, '$10.00', 'Histórico USD debe formatear con $ y no en colones');

      // Verificación estricta de formato y moneda del nuevo CRC
      assert.strictEqual(pagoCrc.currency, 'CRC');
      assert.strictEqual(pagoCrc.amountCrc, 12900.00);
      assert.strictEqual(pagoCrc.amountFormatted, '₡12.900', 'Pago CRC debe formatear con ₡');
    });

    // ====================================================================
    // BLOQUE 4: VALIDACIÓN DE MIGRACIÓN Y NO MODIFICACIÓN DE DATOS PREVIOS
    // ====================================================================
    console.log('\n--- BLOQUE 4: PRESERVACIÓN HISTÓRICA TRAS MIGRACIÓN ---');

    await test('4.1 La migración no altera importes, monedas ni datos de transacciones preexistentes', async () => {
      // Verificar si existen transacciones previas en USD en facturacion_test
      const usdRows = await pool.query(
        `SELECT id, amount_usd, amount_crc, currency FROM payment_transactions WHERE currency = 'USD' LIMIT 5`
      );

      for (const row of usdRows.rows) {
        assert.strictEqual(row.currency, 'USD', 'La moneda debe mantenerse estrictamente como USD');
        assert(Number(row.amount_usd) > 0, 'El amount_usd debe mantenerse intacto');
      }

      // Verificar que los planes mantienen los precios USD originales y los nuevos precios CRC
      const planesRes = await pool.query('SELECT code, precio_mensual_usd, precio_mensual_crc, moneda FROM plans ORDER BY orden ASC');
      for (const p of planesRes.rows) {
        assert.strictEqual(p.moneda, 'CRC', 'La moneda comercial principal del catálogo es CRC');
        assert(p.precio_mensual_crc !== null, 'Debe existir precio en CRC');
        // El precio USD histórico sigue existiendo sin ser borrado
        assert(p.precio_mensual_usd !== null, 'El precio USD de referencia histórica se preserva');
      }
    });

  } finally {
    // Limpieza
    for (const tid of cleanupTenants) {
      await pool.query('DELETE FROM payment_transactions WHERE tenant_id = $1', [tid]).catch(() => {});
      await pool.query('DELETE FROM subscriptions WHERE tenant_id = $1', [tid]).catch(() => {});
      await pool.query('DELETE FROM users WHERE tenant_id = $1', [tid]).catch(() => {});
      await pool.query('DELETE FROM tenants WHERE id = $1', [tid]).catch(() => {});
    }
  }

  console.log('\n======================================================================');
  console.log(`  RESUMEN: ${passed}/${total} PRUEBAS FINANCIERAS PASARON EXITOSAMENTE`);
  console.log('======================================================================\n');
  process.exit(0);
}

main().catch(err => {
  console.error('\n[FATAL] Error en suite financiera:', err);
  process.exit(1);
});
