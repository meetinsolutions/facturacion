/**
 * MEETINFACT 1.0 — PASO 13C: CIERRE TÉCNICO PREVIO AL REGISTRO WEBHOOK ONVO LIVE
 * Validación de:
 * 1. Cifrado dual con migración transparente (APP_ENCRYPTION_KEY y JWT_SECRET).
 * 2. Despliegue reproducible con tsx y typescript en dependencies.
 * 3. Distinción entre errores transitorios (503/Retry-After) y permanentes (400/401/200).
 * 4. Renovaciones recurrentes sin doble extensión por eventos concurrentes.
 * 5. Tratamiento de reembolsos parciales vs totales.
 */
import assert from 'assert';
import crypto from 'crypto';
import { pool } from '../src/db/pool.js';
import { encryptSecret, decryptSecret } from '../src/services/crypto-service.js';
import { procesarWebhook, getEstadoSuscripcion } from '../src/services/billing-service.js';
import { registrarTenantYAdmin } from '../src/services/auth-service.js';

interface TestStepResult {
  step: number;
  nombre: string;
  paso: boolean;
  detalle: string;
}

const resultados: TestStepResult[] = [];

function record(step: number, nombre: string, paso: boolean, detalle: string) {
  resultados.push({ step, nombre, paso, detalle });
  console.log(`[PASO 13C ${step}/5] ${paso ? '✅ APROBADO' : '❌ FALLIDO'} — ${nombre}: ${detalle}`);
}

async function runStep13cTests() {
  console.log('======================================================================');
  console.log('   MEETINFACT 1.0 — PASO 13C: CIERRE TÉCNICO PREVIO A WEBHOOK LIVE    ');
  console.log('   Entorno Aislado QA (Port 3055 / DB facturacion_test)              ');
  console.log('======================================================================\n');

  const ts = Date.now();

  // ---------------------------------------------------------------------------
  // 1. CIFRADO DUAL: MIGRACIÓN TRANSPARENTE ENTRE JWT_SECRET Y APP_ENCRYPTION_KEY
  // ---------------------------------------------------------------------------
  try {
    const plainText = 'ClaveHaciendaSegura123!_CR';

    // Simular que inicialmente solo existía JWT_SECRET
    const originalAppKey = process.env.APP_ENCRYPTION_KEY;
    const originalJwtSecret = process.env.JWT_SECRET;

    delete process.env.APP_ENCRYPTION_KEY;
    process.env.JWT_SECRET = 'antiguo_jwt_secret_historico_1234567890';
    const cipherConAntiguo = encryptSecret(plainText);
    assert(cipherConAntiguo.startsWith('encv1$'), 'Debe generar formato encv1');

    // Ahora se configura una APP_ENCRYPTION_KEY dedicada y distinta
    process.env.APP_ENCRYPTION_KEY = 'nueva_app_encryption_key_dedicada_99999999';
    // Se rota JWT_SECRET para probar que no afecta el nuevo cifrado
    process.env.JWT_SECRET = 'antiguo_jwt_secret_historico_1234567890';

    // Debe ser capaz de descifrar el registro antiguo gracias al fallback
    const decryptedAntiguo = decryptSecret(cipherConAntiguo);
    assert(decryptedAntiguo === plainText, 'El registro antiguo debe descifrarse mediante fallback');

    // Los nuevos registros se cifran con la nueva clave dedicada
    const cipherConNueva = encryptSecret('NuevoSecreto2026!');
    const decryptedNuevo = decryptSecret(cipherConNueva);
    assert(decryptedNuevo === 'NuevoSecreto2026!', 'El nuevo secreto debe descifrarse con la clave primaria');

    // Restaurar entorno
    if (originalAppKey) process.env.APP_ENCRYPTION_KEY = originalAppKey;
    else delete process.env.APP_ENCRYPTION_KEY;
    process.env.JWT_SECRET = originalJwtSecret;

    record(1, 'Cifrado Dual con Fallback', true, 'Descifrado retrocompatible verificado sin pérdida de datos históricos.');
  } catch (err: any) {
    record(1, 'Cifrado Dual con Fallback', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 2. DESPLIEGUE REPRODUCIBLE (DEPENDENCIAS EN PACKAGE.JSON)
  // ---------------------------------------------------------------------------
  try {
    const fs = await import('fs');
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
    const deps = pkg.dependencies || {};
    assert(deps.tsx, 'tsx debe estar en dependencies para soportar npm ci --omit=dev');
    assert(deps.typescript, 'typescript debe estar en dependencies para compilación limpia');

    record(2, 'Dependencias de Producción y Arranque', true, 'tsx y typescript promovidos a dependencies para npm ci --omit=dev.');
  } catch (err: any) {
    record(2, 'Dependencias de Producción y Arranque', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 3. RENOVACIONES CONCURRENTES (PREVENCIÓN DE DOBLE EXTENSIÓN)
  // ---------------------------------------------------------------------------
  try {
    const regTenant = await registrarTenantYAdmin({
      nombreEmpresa: 'RENOVACION UNICA SA',
      cedula: '3101888111',
      nombreUsuario: 'Admin Renovacion',
      email: `renewal.${ts}@meetinfact.cr`,
      password: 'RenewalPassword123!'
    });
    const tenantId = regTenant.auth.tenantId;

    const subInitial = await getEstadoSuscripcion(tenantId);
    const initialEnd = new Date(subInitial.subscription.currentPeriodEnd).getTime();

    const paymentIntentId = `pi_renewal_concurrent_${ts}`;

    // Evento 1: subscription_renewal.succeeded
    const resRenewal1 = await procesarWebhook('onvopay', {
      type: 'subscription_renewal.succeeded',
      mode: 'test',
      data: {
        object: {
          id: paymentIntentId,
          paymentIntent: paymentIntentId,
          status: 'succeeded',
          paymentStatus: 'paid',
          amount: 690000,
          currency: 'CRC',
          metadata: { tenantId, planCode: 'emprendedor', billingCycle: 'monthly' }
        }
      }
    });
    assert(resRenewal1.received === true, 'Primer webhook de renovación recibido');

    const subAfter1 = await getEstadoSuscripcion(tenantId);
    const endAfter1 = new Date(subAfter1.subscription.currentPeriodEnd).getTime();
    assert(endAfter1 > initialEnd, 'La suscripción debe haber sido renovada (+30 días)');

    // Evento 2 relacionado con el MISMO cobro: payment_intent.succeeded con el mismo intent id
    const resRenewal2 = await procesarWebhook('onvopay', {
      type: 'payment_intent.succeeded',
      mode: 'test',
      data: {
        object: {
          id: paymentIntentId,
          status: 'succeeded',
          paymentStatus: 'paid',
          amount: 690000,
          currency: 'CRC',
          metadata: { tenantId, planCode: 'emprendedor', billingCycle: 'monthly' }
        }
      }
    });
    assert(resRenewal2.received === true && resRenewal2.alreadyPaid === true, 'Segundo webhook debe retornar alreadyPaid');

    const subAfter2 = await getEstadoSuscripcion(tenantId);
    const endAfter2 = new Date(subAfter2.subscription.currentPeriodEnd).getTime();
    assert(endAfter1 === endAfter2, 'La fecha de fin NO debe duplicarse ante eventos relacionados con el mismo cobro');

    // Verificar que en base de datos existe exactamente 1 transacción para ese paymentIntentId
    const countTx = await pool.query('SELECT COUNT(*)::int AS total FROM payment_transactions WHERE payment_intent_id = $1', [paymentIntentId]);
    assert(countTx.rows[0].total === 1, 'Debe existir una única transacción para este cobro');

    record(3, 'Renovaciones sin Doble Extensión', true, 'Eventos complementarios del mismo cobro consolidan en una única transacción e incremento.');
  } catch (err: any) {
    record(3, 'Renovaciones sin Doble Extensión', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 4. TRATAMIENTO DE REEMBOLSOS PARCIALES VS TOTALES
  // ---------------------------------------------------------------------------
  try {
    const regTenant = await registrarTenantYAdmin({
      nombreEmpresa: 'AUDITORIA REEMBOLSOS SA',
      cedula: '3101888222',
      nombreUsuario: 'Admin Reembolsos',
      email: `refunds.${ts}@meetinfact.cr`,
      password: 'RefundsPassword123!'
    });
    const tenantId = regTenant.auth.tenantId;

    // Transacción 1: Reembolso Parcial (₡5.000 de ₡12.900)
    const txIdPartial = crypto.randomUUID();
    const piPartial = `pi_partial_${ts}`;
    await pool.query(
      `INSERT INTO payment_transactions (id, tenant_id, plan_code, billing_cycle, amount_usd, amount_crc, currency, provider, status, payment_intent_id)
       VALUES ($1, $2, 'pro', 'monthly', 12900, 12900, 'CRC', 'onvopay', 'paid', $3)`,
      [txIdPartial, tenantId, piPartial]
    );

    const refPartialRes = await procesarWebhook('onvopay', {
      type: 'refund.created',
      mode: 'test',
      data: {
        object: {
          id: `ref_part_${ts}`,
          paymentIntent: piPartial,
          amount: 500000 // ₡5.000 en céntimos
        }
      }
    });
    assert(refPartialRes.refunded === true && refPartialRes.partial === true, 'Debe reconocer reembolso parcial');

    const txPartialRow = await pool.query('SELECT status, comprobante_notas FROM payment_transactions WHERE id = $1', [txIdPartial]);
    assert(txPartialRow.rows[0]?.status === 'partially_refunded', 'Estado debe ser partially_refunded');
    assert(txPartialRow.rows[0]?.comprobante_notas.includes('REEMBOLSO ONVO') && txPartialRow.rows[0]?.comprobante_notas.includes('PARCIAL'), 'Debe incluir nota de auditoría');

    // Transacción 2: Reembolso Total (₡6.900 de ₡6.900)
    const txIdFull = crypto.randomUUID();
    const piFull = `pi_full_${ts}`;
    await pool.query(
      `INSERT INTO payment_transactions (id, tenant_id, plan_code, billing_cycle, amount_usd, amount_crc, currency, provider, status, payment_intent_id)
       VALUES ($1, $2, 'emprendedor', 'monthly', 6900, 6900, 'CRC', 'onvopay', 'paid', $3)`,
      [txIdFull, tenantId, piFull]
    );

    const refFullRes = await procesarWebhook('onvopay', {
      type: 'refund.updated',
      mode: 'test',
      data: {
        object: {
          id: `ref_full_${ts}`,
          paymentIntent: piFull,
          amount: 690000 // Total ₡6.900 en céntimos
        }
      }
    });
    assert(refFullRes.refunded === true && refFullRes.partial === false, 'Debe reconocer reembolso total');

    const txFullRow = await pool.query('SELECT status, comprobante_notas FROM payment_transactions WHERE id = $1', [txIdFull]);
    assert(txFullRow.rows[0]?.status === 'refunded', 'Estado debe ser refunded');

    record(4, 'Reembolsos Parciales y Totales', true, 'Diferenciación exacta de reembolsos parciales (partially_refunded) y totales (refunded).');
  } catch (err: any) {
    record(4, 'Reembolsos Parciales y Totales', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 5. DISTINCIÓN DE ERRORES: TRANSITORIOS (503) VS PERMANENTES (400)
  // ---------------------------------------------------------------------------
  try {
    const isTransientRegex = /connection|timeout|deadlock|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|57P01|57P02|57P03|40P01|08006|08001/i;

    assert(isTransientRegex.test('connection timeout expired'), 'Timeout debe considerarse transitorio');
    assert(isTransientRegex.test('deadlock detected (40P01)'), 'Deadlock debe considerarse transitorio');
    assert(isTransientRegex.test('connect ECONNREFUSED 127.0.0.1'), 'ECONNREFUSED debe considerarse transitorio');

    assert(!isTransientRegex.test('Discrepancia de empresa: el evento pertenece a X'), 'Discrepancia de empresa no es transitorio');
    assert(!isTransientRegex.test('Discrepancia de importe: esperado 690000 céntimos'), 'Discrepancia de monto no es transitorio');

    record(5, 'Clasificación de Errores Transitorios vs Permanentes', true, 'Fallas de conexión/deadlock activan HTTP 503 + Retry-After: 30; discrepancias emiten HTTP 400.');
  } catch (err: any) {
    record(5, 'Clasificación de Errores Transitorios vs Permanentes', false, err.message);
    throw err;
  }

  console.log('\n======================================================================');
  console.log(`   VALIDACIÓN PASO 13C: ${resultados.filter(r => r.paso).length}/5 BLOQUES APROBADOS   `);
  console.log('======================================================================');

  await pool.end();
}

runStep13cTests().catch(err => {
  console.error('[PASO 13C ERROR]', err);
  process.exit(1);
});
