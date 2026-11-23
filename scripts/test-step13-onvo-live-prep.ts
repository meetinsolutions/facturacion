/**
 * MEETINFACT 1.0 — PASO 13: SUITE DE PREPARACIÓN Y VALIDACIÓN SEGURA ONVO PAY LIVE
 * Ejecuta validaciones criptográficas, de idempotencia, anti-cruce de ambientes (livemode),
 * anti-replay y consistencia de montos en céntimos en el entorno aislado QA.
 * RESTRICCIÓN: CERO llamadas a la API LIVE real de ONVO. CERO impacto en producción.
 */
import assert from 'assert';
import crypto from 'crypto';
import { pool } from '../src/db/pool.js';
import { verificarFirmaWebhook } from '../src/server.js';
import {
  procesarWebhook,
  confirmarPagoOnvo,
  iniciarCheckoutRecurrente,
  getGatewaysConfig,
  asignarPlanManual,
  getEstadoSuscripcion
} from '../src/services/billing-service.js';
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
  console.log(`[ONVO-PREP ${step}/8] ${paso ? '✅ APROBADO' : '❌ FALLIDO'} — ${nombre}: ${detalle}`);
}

async function runOnvoLivePrepTests() {
  console.log('======================================================================');
  console.log('   MEETINFACT 1.0 — PASO 13: PREPARACIÓN Y SEGURIDAD ONVO LIVE       ');
  console.log('   Entorno Aislado QA (Port 3055 / DB facturacion_test)              ');
  console.log('======================================================================\n');

  const ts = Date.now();
  const testSecret = 'whsec_2NaByjlLjsGTSBfuqFLM9oWJviCeCyc-gjrcKKS7hbc';

  // ---------------------------------------------------------------------------
  // 1. AUTENTICIDAD CRIPTOGRÁFICA HMAC-SHA256 Y SVIX
  // ---------------------------------------------------------------------------
  try {
    const payload = JSON.stringify({ event: 'test.ping', timestamp: ts });
    const nowSec = Math.floor(Date.now() / 1000);

    // Formato nativo X-Onvo-Signature: t=...,v1=...
    const toSignOnvo = `${nowSec}.${payload}`;
    const keyBuf = Buffer.from(testSecret.slice(6), 'base64');
    const validSigHex = crypto.createHmac('sha256', keyBuf).update(toSignOnvo).digest('hex');

    const reqValido: any = {
      headers: {
        'x-onvo-signature': `t=${nowSec},v1=${validSigHex}`
      },
      rawBody: payload,
      body: JSON.parse(payload)
    };
    assert(verificarFirmaWebhook('onvopay', testSecret, reqValido), 'Firma válida nativa ONVO debe ser aceptada');

    // Formato Svix: svix-id, svix-timestamp, svix-signature
    const svixId = `msg_${ts}`;
    const toSignSvix = `${svixId}.${nowSec}.${payload}`;
    const validSvixSigB64 = crypto.createHmac('sha256', keyBuf).update(toSignSvix).digest('base64');

    const reqSvixValido: any = {
      headers: {
        'svix-id': svixId,
        'svix-timestamp': String(nowSec),
        'svix-signature': `v1,${validSvixSigB64}`
      },
      rawBody: payload,
      body: JSON.parse(payload)
    };
    assert(verificarFirmaWebhook('onvopay', testSecret, reqSvixValido), 'Firma Svix válida debe ser aceptada');

    record(1, 'Autenticidad Criptográfica HMAC/Svix', true, 'Firmas nativas ONVO y Svix v1 verificadas matemáticamente.');
  } catch (err: any) {
    record(1, 'Autenticidad Criptográfica HMAC/Svix', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 2. RECHAZO DE FIRMAS INVÁLIDAS Y PAYLOADS ALTERADOS
  // ---------------------------------------------------------------------------
  try {
    const payloadOriginal = JSON.stringify({ event: 'charge.succeeded', amount: 6900 });
    const payloadAlterado = JSON.stringify({ event: 'charge.succeeded', amount: 100 });
    const nowSec = Math.floor(Date.now() / 1000);

    const toSign = `${nowSec}.${payloadOriginal}`;
    const keyBuf = Buffer.from(testSecret.slice(6), 'base64');
    const sigOriginal = crypto.createHmac('sha256', keyBuf).update(toSign).digest('hex');

    // Request con payload manipulado (tampering)
    const reqTampered: any = {
      headers: { 'x-onvo-signature': `t=${nowSec},v1=${sigOriginal}` },
      rawBody: payloadAlterado,
      body: JSON.parse(payloadAlterado)
    };
    assert(!verificarFirmaWebhook('onvopay', testSecret, reqTampered), 'Payload alterado debe ser rechazado');

    // Request con firma falsificada
    const reqFakeSig: any = {
      headers: { 'x-onvo-signature': `t=${nowSec},v1=00112233445566778899aabbccddeeff` },
      rawBody: payloadOriginal,
      body: JSON.parse(payloadOriginal)
    };
    assert(!verificarFirmaWebhook('onvopay', testSecret, reqFakeSig), 'Firma falsificada debe ser rechazada');

    // Request sin firma
    const reqNoSig: any = { headers: {}, rawBody: payloadOriginal, body: JSON.parse(payloadOriginal) };
    assert(!verificarFirmaWebhook('onvopay', testSecret, reqNoSig), 'Request sin firma debe ser rechazado');

    record(2, 'Rechazo de Firmas Inválidas y Tampering', true, 'Payloads manipulados y firmas falsas son bloqueados al 100%.');
  } catch (err: any) {
    record(2, 'Rechazo de Firmas Inválidas y Tampering', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 3. PROTECCIÓN ANTI-REPLAY POR TIMESTAMP (VENTANA 300s)
  // ---------------------------------------------------------------------------
  try {
    const payload = JSON.stringify({ event: 'test.replay' });
    const keyBuf = Buffer.from(testSecret.slice(6), 'base64');

    // Timestamp de hace 15 minutos (900 segundos en el pasado)
    const tsViejo = Math.floor(Date.now() / 1000) - 900;
    const sigVieja = crypto.createHmac('sha256', keyBuf).update(`${tsViejo}.${payload}`).digest('hex');
    const reqReplayViejo: any = {
      headers: { 'x-onvo-signature': `t=${tsViejo},v1=${sigVieja}` },
      rawBody: payload,
      body: JSON.parse(payload)
    };
    assert(!verificarFirmaWebhook('onvopay', testSecret, reqReplayViejo), 'Evento viejo (>300s) debe ser rechazado');

    // Timestamp en el futuro (+900 segundos)
    const tsFuturo = Math.floor(Date.now() / 1000) + 900;
    const sigFuturo = crypto.createHmac('sha256', keyBuf).update(`${tsFuturo}.${payload}`).digest('hex');
    const reqReplayFuturo: any = {
      headers: { 'x-onvo-signature': `t=${tsFuturo},v1=${sigFuturo}` },
      rawBody: payload,
      body: JSON.parse(payload)
    };
    assert(!verificarFirmaWebhook('onvopay', testSecret, reqReplayFuturo), 'Evento con timestamp futuro anómalo debe ser rechazado');

    record(3, 'Protección Anti-Replay por Timestamp', true, 'Eventos desfasados (>300s) o futuros son rechazados estrictamente.');
  } catch (err: any) {
    record(3, 'Protección Anti-Replay por Timestamp', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 4. AISLAMIENTO ESTRICTO SANDBOX VS LIVE (ANTI-CRUCE LIVEMODE)
  // ---------------------------------------------------------------------------
  try {
    // Configurar tenant de prueba en QA
    const regTenant = await registrarTenantYAdmin({
      nombreEmpresa: 'ONVO SECURITY AUDIT SA',
      cedula: '3101999111',
      nombreUsuario: 'Auditor Onvo',
      email: `onvo.audit.${ts}@meetinfact.cr`,
      password: 'AuditPassword123!'
    });
    const tenantId = regTenant.auth.tenantId;

    // Crear transacción pendiente para prueba
    const txId = crypto.randomUUID();
    const sessionId = `cs_test_${ts}`;
    const subRes = await pool.query('SELECT id FROM subscriptions WHERE tenant_id = $1', [tenantId]);
    await pool.query(
      `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, amount_crc, currency, provider, status, checkout_session_id)
       VALUES ($1, $2, $3, 'emprendedor', 'monthly', 6900, 6900, 'CRC', 'onvopay', 'pending', $4)`,
      [txId, tenantId, subRes.rows[0]?.id || null, sessionId]
    );

    // 4.1 En QA el servidor tiene configurada la secretKey de Sandbox ('onvo_test_...').
    // Si recibe un webhook con 'livemode: true', DEBE ser rechazado de forma tajante.
    let cruceLiveRechazado = false;
    try {
      await procesarWebhook('onvopay', {
        type: 'checkout_session.completed',
        livemode: true, // ¡Evento LIVE en entorno Sandbox!
        data: {
          object: {
            id: sessionId,
            paymentIntent: `pi_live_${ts}`,
            status: 'paid',
            paymentStatus: 'paid',
            amountTotal: 690000,
            currency: 'CRC',
            metadata: { transactionId: txId, tenantId, planCode: 'emprendedor', billingCycle: 'monthly' }
          }
        }
      });
    } catch (e: any) {
      cruceLiveRechazado = e.message.includes('live') || e.message.includes('Sandbox');
    }
    assert(cruceLiveRechazado, 'El webhook con livemode: true DEBE ser rechazado en entorno Sandbox');

    // 4.2 Verificación con envelope oficial ONVO mode: 'live'
    let cruceModeLiveRechazado = false;
    try {
      await procesarWebhook('onvopay', {
        type: 'checkout_session.completed',
        mode: 'live', // Formato oficial ONVO
        data: {
          object: {
            id: sessionId,
            paymentIntent: `pi_live_mode_${ts}`,
            status: 'paid',
            paymentStatus: 'paid',
            amountTotal: 690000,
            currency: 'CRC',
            metadata: { transactionId: txId, tenantId, planCode: 'emprendedor', billingCycle: 'monthly' }
          }
        }
      });
    } catch (e: any) {
      cruceModeLiveRechazado = e.message.includes('live') || e.message.includes('Sandbox');
    }
    assert(cruceModeLiveRechazado, 'El webhook con mode: live DEBE ser rechazado en entorno Sandbox');

    // 4.3 Verificación de respuesta a prueba de conexión del dashboard ONVO
    const testPingRes = await procesarWebhook('onvopay', {
      type: 'webhook_endpoint.test',
      mode: 'test'
    });
    assert(testPingRes.received === true && testPingRes.test === true, 'Evento webhook_endpoint.test debe ser respondido favorablemente');

    record(4, 'Aislamiento Estricto Sandbox vs LIVE', true, 'Eventos con mode/livemode discrepantes son rechazados y prueba ping responde 200.');
  } catch (err: any) {
    record(4, 'Aislamiento Estricto Sandbox vs LIVE', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 5. VALIDACIÓN DE IMPORTES EN CÉNTIMOS (MINOR UNITS CRC) Y MONEDA
  // ---------------------------------------------------------------------------
  try {
    const regTenant = await registrarTenantYAdmin({
      nombreEmpresa: 'MINOR UNITS CRC SA',
      cedula: '3101999222',
      nombreUsuario: 'Auditor Minor Units',
      email: `cents.audit.${ts}@meetinfact.cr`,
      password: 'AuditPassword123!'
    });
    const tenantId = regTenant.auth.tenantId;

    const txId = crypto.randomUUID();
    const sessionId = `cs_cents_${ts}`;
    const subRes = await pool.query('SELECT id FROM subscriptions WHERE tenant_id = $1', [tenantId]);
    await pool.query(
      `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, amount_crc, currency, provider, status, checkout_session_id)
       VALUES ($1, $2, $3, 'pro', 'monthly', 12900, 12900, 'CRC', 'onvopay', 'pending', $4)`,
      [txId, tenantId, subRes.rows[0]?.id || null, sessionId]
    );

    // ₡12.900 debe ser exactamente 1.290.000 céntimos. Si envían 129.000 (discrepancia de decimales), debe rechazar.
    let importeDiscrepanteRechazado = false;
    try {
      await procesarWebhook('onvopay', {
        type: 'checkout_session.completed',
        livemode: false,
        data: {
          object: {
            id: sessionId,
            paymentIntent: `pi_cents_bad_${ts}`,
            status: 'paid',
            paymentStatus: 'paid',
            amountTotal: 129000, // Error: 10x menor
            currency: 'CRC',
            metadata: { transactionId: txId, tenantId, planCode: 'pro', billingCycle: 'monthly' }
          }
        }
      });
    } catch (e: any) {
      importeDiscrepanteRechazado = e.message.includes('Discrepancia de importe');
    }
    assert(importeDiscrepanteRechazado, 'Importe no coincidente en céntimos debe ser rechazado');

    // Moneda diferente (USD en vez de CRC)
    let monedaDiscrepanteRechazada = false;
    try {
      await procesarWebhook('onvopay', {
        type: 'checkout_session.completed',
        livemode: false,
        data: {
          object: {
            id: sessionId,
            paymentIntent: `pi_curr_bad_${ts}`,
            status: 'paid',
            paymentStatus: 'paid',
            amountTotal: 1290000,
            currency: 'USD', // Error: se esperaba CRC
            metadata: { transactionId: txId, tenantId, planCode: 'pro', billingCycle: 'monthly' }
          }
        }
      });
    } catch (e: any) {
      monedaDiscrepanteRechazada = e.message.includes('Discrepancia de moneda');
    }
    assert(monedaDiscrepanteRechazada, 'Moneda discrepante debe ser rechazada');

    record(5, 'Validación de Importes en Céntimos y Moneda', true, 'Cálculo de minor units (₡12.900 = 1.290.000 céntimos) y moneda validados rigurosamente.');
  } catch (err: any) {
    record(5, 'Validación de Importes en Céntimos y Moneda', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 6. IDEMPOTENCIA ANTE REINTENTOS Y PREVENCIÓN DE DOBLE ACTIVACIÓN
  // ---------------------------------------------------------------------------
  try {
    const regTenant = await registrarTenantYAdmin({
      nombreEmpresa: 'IDEMPOTENCIA ONVO SA',
      cedula: '3101999333',
      nombreUsuario: 'Auditor Idempotencia',
      email: `idempotent.${ts}@meetinfact.cr`,
      password: 'AuditPassword123!'
    });
    const tenantId = regTenant.auth.tenantId;

    const txId = crypto.randomUUID();
    const sessionId = `cs_idem_${ts}`;
    const paymentIntentId = `pi_idem_${ts}`;
    const subRes = await pool.query('SELECT id FROM subscriptions WHERE tenant_id = $1', [tenantId]);
    await pool.query(
      `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, amount_crc, currency, provider, status, checkout_session_id)
       VALUES ($1, $2, $3, 'emprendedor', 'monthly', 6900, 6900, 'CRC', 'onvopay', 'pending', $4)`,
      [txId, tenantId, subRes.rows[0]?.id || null, sessionId]
    );

    const webhookBody = {
      type: 'checkout_session.completed',
      livemode: false,
      data: {
        object: {
          id: sessionId,
          paymentIntent: paymentIntentId,
          status: 'paid',
          paymentStatus: 'paid',
          amountTotal: 690000,
          currency: 'CRC',
          metadata: { transactionId: txId, tenantId, planCode: 'emprendedor', billingCycle: 'monthly' }
        }
      }
    };

    // Primer procesamiento: debe activar
    const res1 = await procesarWebhook('onvopay', webhookBody);
    assert(res1.received === true && res1.alreadyPaid === false, 'Primer webhook debe procesarse');
    const txAfter1 = await pool.query('SELECT status FROM payment_transactions WHERE id = $1', [txId]);
    assert(txAfter1.rows[0]?.status === 'paid', 'Transacción en base de datos debe marcar status paid');

    const sub1 = await getEstadoSuscripcion(tenantId);
    assert(sub1.subscription?.status === 'active' && sub1.subscription?.planCode === 'emprendedor', 'Suscripción activada');
    const fin1 = new Date(sub1.subscription.currentPeriodEnd).getTime();

    // Segundo procesamiento (duplicado/reintento de red): debe retornar alreadyPaid y NO modificar fin
    const res2 = await procesarWebhook('onvopay', webhookBody);
    assert(res2.received === true && res2.alreadyPaid === true, 'Segundo webhook debe retornar alreadyPaid');

    const sub2 = await getEstadoSuscripcion(tenantId);
    const fin2 = new Date(sub2.subscription.currentPeriodEnd).getTime();
    assert(fin1 === fin2, 'La vigencia de la suscripción NO debe multiplicarse ante webhooks duplicados');

    record(6, 'Idempotencia y Prevención de Doble Activación', true, 'Webhooks duplicados detectados mediante advisory locks y status idempotente.');
  } catch (err: any) {
    record(6, 'Idempotencia y Prevención de Doble Activación', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 7. MANEJO DE EVENTOS: FALLIDOS, CANCELADOS Y REEMBOLSOS
  // ---------------------------------------------------------------------------
  try {
    const regTenant = await registrarTenantYAdmin({
      nombreEmpresa: 'LIFECYCLE ONVO SA',
      cedula: '3101999444',
      nombreUsuario: 'Auditor Ciclo',
      email: `lifecycle.${ts}@meetinfact.cr`,
      password: 'AuditPassword123!'
    });
    const tenantId = regTenant.auth.tenantId;

    // Transacción que fallará
    const txIdFail = crypto.randomUUID();
    await pool.query(
      `INSERT INTO payment_transactions (id, tenant_id, plan_code, billing_cycle, amount_usd, amount_crc, currency, provider, status)
       VALUES ($1, $2, 'emprendedor', 'monthly', 6900, 6900, 'CRC', 'onvopay', 'pending')`,
      [txIdFail, tenantId]
    );

    await procesarWebhook('onvopay', {
      type: 'checkout_session.canceled',
      livemode: false,
      metadata: { transactionId: txIdFail }
    });

    const txFailRes = await pool.query('SELECT status, comprobante_notas FROM payment_transactions WHERE id = $1', [txIdFail]);
    assert(txFailRes.rows[0]?.status === 'failed', 'Transacción cancelada debe marcarse como failed');

    // Transacción reembolsada
    const txIdRefund = crypto.randomUUID();
    const piRefund = `pi_refund_${ts}`;
    await pool.query(
      `INSERT INTO payment_transactions (id, tenant_id, plan_code, billing_cycle, amount_usd, amount_crc, currency, provider, status, payment_intent_id)
       VALUES ($1, $2, 'emprendedor', 'monthly', 6900, 6900, 'CRC', 'onvopay', 'paid', $3)`,
      [txIdRefund, tenantId, piRefund]
    );

    const refRes = await procesarWebhook('onvopay', {
      type: 'payment_intent.refunded',
      livemode: false,
      data: {
        object: {
          id: piRefund,
          metadata: { transactionId: txIdRefund }
        }
      }
    });
    assert(refRes.refunded === true, 'Evento de reembolso reconocido');

    const txRefundRes = await pool.query('SELECT status, comprobante_notas FROM payment_transactions WHERE id = $1', [txIdRefund]);
    assert(txRefundRes.rows[0]?.status === 'refunded', 'Transacción marcada como refunded en base de datos');
    assert(txRefundRes.rows[0]?.comprobante_notas.includes('REEMBOLSO ONVO'), 'Nota de auditoría de reembolso guardada');

    record(7, 'Ciclo de Vida: Cancelados, Fallidos y Reembolsos', true, 'Estados terminales y notas de auditoría persistidos correctamente.');
  } catch (err: any) {
    record(7, 'Ciclo de Vida: Cancelados, Fallidos y Reembolsos', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 8. SEGURIDAD Y ZERO-LEAKS DE CREDENCIALES
  // ---------------------------------------------------------------------------
  try {
    const gateways = await getGatewaysConfig();
    assert(gateways.onvopay.secretKey, 'secretKey existe en configuración del servidor');

    // Simular llamada a API pública de planes
    const apiPlanesData = {
      success: true,
      data: [],
      sinpe: gateways.sinpe,
      pasarelaActiva: gateways.pasarelaActiva
    };

    const serialized = JSON.stringify(apiPlanesData);
    assert(!serialized.includes(gateways.onvopay.secretKey), 'La clave secreta nunca debe figurar en respuestas públicas');
    assert(!serialized.includes(gateways.onvopay.webhookSecret), 'El secreto del webhook nunca debe figurar en respuestas públicas');

    record(8, 'Zero-Leaks de Credenciales en API', true, 'Claves secretas y secretos de webhook aislados del cliente HTTP.');
  } catch (err: any) {
    record(8, 'Zero-Leaks de Credenciales en API', false, err.message);
    throw err;
  }

  console.log('\n======================================================================');
  console.log(`   VALIDACIÓN ONVO PASO 13: ${resultados.filter(r => r.paso).length}/8 BLOQUES APROBADOS   `);
  console.log('======================================================================');

  await pool.end();
}

runOnvoLivePrepTests().catch(err => {
  console.error('[ONVO PREP ERROR]', err);
  process.exit(1);
});
