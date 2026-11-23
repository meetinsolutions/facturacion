/**
 * SUITE DE CIERRE DEFINITIVO RC2: BLOQUEO EFECTIVO DE ONVO LIVE
 * Demuestra mediante pruebas aisladas que la ausencia de configuración LIVE autorizada
 * impide iniciar las cuatro operaciones críticas en LIVE:
 * 1. Creación de sesiones de pago (checkout)
 * 2. Cobros recurrentes (conciliación/renovación)
 * 3. Recepción y validación de webhooks
 * 4. Activación de suscripciones
 * RESTRICCIÓN: CERO credenciales reales, CERO llamadas a la API LIVE de ONVO, CERO impacto en producción.
 */
import assert from 'assert';
import crypto from 'crypto';
import { pool } from '../src/db/pool.js';
import { verificarFirmaWebhook } from '../src/server.js';
import {
  iniciarCheckoutRecurrente,
  conciliarTransaccionesOnvoPendientes,
  procesarWebhook,
  confirmarPagoOnvo,
  getGatewaysConfig
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
  console.log(`[BLOQUEO-LIVE ${step}/5] ${paso ? '✅ APROBADO' : '❌ FALLIDO'} — ${nombre}: ${detalle}`);
}

async function runLiveBlockingTests() {
  console.log('======================================================================');
  console.log('   MEETINFACT 1.0 — CIERRE RC2: BLOQUEO EFECTIVO DE ONVO LIVE        ');
  console.log('   Entorno Aislado QA (Port 3055 / DB facturacion_test)              ');
  console.log('======================================================================\n');

  const ts = Date.now();
  const prevEnv = { ...process.env };

  try {
    // Registrar tenant para pruebas
    const regTenant = await registrarTenantYAdmin({
      nombreEmpresa: `EMPRESA BLOQUEO LIVE ${ts}`,
      cedula: `3101${String(ts).slice(-6)}`,
      nombreUsuario: 'Auditor Live Block',
      email: `audit.live.block.${ts}@meetinfact.cr`,
      password: 'AuditPassword123!'
    });
    const tenantId = regTenant.auth.tenantId;

    // =========================================================================
    // 1. CREACIÓN DE SESIONES DE PAGO EN LIVE SIN AUTORIZACIÓN
    // =========================================================================
    try {
      process.env.ONVO_ENVIRONMENT = 'live';
      delete process.env.ONVO_SECRET_KEY_LIVE;
      delete process.env.ONVO_WEBHOOK_SECRET_LIVE;
      process.env.ONVO_SECRET_KEY = 'sk_test_fake_sandbox_key'; // Llave de pruebas en entorno configurado a live

      let checkoutLiveRechazado = false;
      let errorMsg = '';
      try {
        await iniciarCheckoutRecurrente(tenantId, 'emprendedor', 'monthly', 'onvopay');
      } catch (err: any) {
        checkoutLiveRechazado = true;
        errorMsg = err.message;
      }

      assert(checkoutLiveRechazado, 'La creación de sesión de pago LIVE DEBE ser rechazada sin credenciales LIVE autorizadas');
      assert(errorMsg.includes('LIVE rechazada'), `Mensaje debe indicar rechazo explícito: ${errorMsg}`);

      record(1, 'Bloqueo en Creación de Sesiones LIVE', true, `Intento de checkout bloqueado preventivamente: "${errorMsg}"`);
    } catch (err: any) {
      record(1, 'Bloqueo en Creación de Sesiones LIVE', false, err.message);
      throw err;
    }

    // =========================================================================
    // 2. COBROS RECURRENTES Y CONCILIACIÓN EN LIVE SIN AUTORIZACIÓN
    // =========================================================================
    try {
      process.env.ONVO_ENVIRONMENT = 'live';
      delete process.env.ONVO_SECRET_KEY_LIVE;
      delete process.env.ONVO_WEBHOOK_SECRET_LIVE;

      const reconcileResult = await conciliarTransaccionesOnvoPendientes();
      assert.strictEqual(reconcileResult.reconciled, 0, 'No debe reconciliar ninguna transacción en LIVE sin autorización');
      assert(
        reconcileResult.reason?.includes('no autorizado') || reconcileResult.reason?.includes('no configurad'),
        `Razón de omisión debe documentar bloqueo preventivo: ${reconcileResult.reason}`
      );

      record(2, 'Bloqueo en Cobros Recurrentes y Conciliación', true, `Conciliación LIVE abortada limpiamente: "${reconcileResult.reason}"`);
    } catch (err: any) {
      record(2, 'Bloqueo en Cobros Recurrentes y Conciliación', false, err.message);
      throw err;
    }

    // =========================================================================
    // 3. RECEPCIÓN Y VALIDACIÓN DE WEBHOOKS EN LIVE SIN SECRETO OFICIAL
    // =========================================================================
    try {
      process.env.ONVO_ENVIRONMENT = 'live';
      delete process.env.ONVO_WEBHOOK_SECRET_LIVE;
      process.env.ONVO_WEBHOOK_SECRET = 'whsec_sandbox_test_secret'; // Secreto de pruebas

      const gateways = await getGatewaysConfig();
      assert.strictEqual(gateways.onvopay.webhookSecret, '', 'El webhookSecret para LIVE sin ONVO_WEBHOOK_SECRET_LIVE debe ser vacío');

      // Prueba de verificación de firma HMAC: sin secreto esperado DEBE retornar false
      const fakeReq: any = {
        headers: { 'x-onvo-signature': `t=${Math.floor(Date.now() / 1000)},v1=fake_signature` },
        rawBody: '{"event":"checkout.session.completed"}'
      };
      const firmaValida = verificarFirmaWebhook('onvopay', gateways.onvopay.webhookSecret, fakeReq);
      assert.strictEqual(firmaValida, false, 'La verificación de firma DEBE retornar false cuando el secreto es vacío');

      // Prueba de procesarWebhook directo en LIVE sin secreto:
      let webhookProcesadoRechazado = false;
      let webhookErrMsg = '';
      try {
        await procesarWebhook('onvopay', {
          type: 'checkout_session.completed',
          mode: 'live',
          data: { object: { id: `cs_live_${ts}`, status: 'paid', paymentStatus: 'paid' } }
        });
      } catch (err: any) {
        webhookProcesadoRechazado = true;
        webhookErrMsg = err.message;
      }
      assert(webhookProcesadoRechazado, 'procesarWebhook DEBE arrojar error si no hay secreto LIVE configurado');
      assert(webhookErrMsg.includes('LIVE rechazada') || webhookErrMsg.includes('Ambiente'), `Error: ${webhookErrMsg}`);

      record(3, 'Bloqueo en Recepción y Validación de Webhooks', true, 'Webhooks LIVE no pueden validarse sin secreto oficial.');
    } catch (err: any) {
      record(3, 'Bloqueo en Recepción y Validación de Webhooks', false, err.message);
      throw err;
    }

    // =========================================================================
    // 4. ACTIVACIÓN DE SUSCRIPCIONES EN LIVE SIN SECRETO
    // =========================================================================
    try {
      process.env.ONVO_ENVIRONMENT = 'live';
      delete process.env.ONVO_WEBHOOK_SECRET_LIVE;

      // Crear transacción pendiente en DB
      const txId = crypto.randomUUID();
      const subRes = await pool.query('SELECT id, status, current_period_end FROM subscriptions WHERE tenant_id = $1', [tenantId]);
      const initialPeriodEnd = subRes.rows[0]?.current_period_end;

      await pool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, amount_crc, currency, provider, status)
         VALUES ($1, $2, $3, 'pro', 'monthly', 12900, 12900, 'CRC', 'onvopay', 'pending')`,
        [txId, tenantId, subRes.rows[0]?.id || null]
      );

      let activacionRechazada = false;
      let activacionErrMsg = '';
      try {
        await confirmarPagoOnvo(txId, {
          eventType: 'checkout_session.completed',
          sessionId: `cs_test_${ts}`,
          paymentIntentId: `pi_test_${ts}`,
          status: 'completed',
          paymentStatus: 'paid',
          tenantId,
          planCode: 'pro',
          billingCycle: 'monthly',
          amountInCents: 1290000,
          currency: 'CRC'
        });
      } catch (err: any) {
        activacionRechazada = true;
        activacionErrMsg = err.message;
      }

      assert(activacionRechazada, 'La confirmación de pago y activación de suscripción DEBE fallar en LIVE sin secreto');
      assert(activacionErrMsg.includes('Activación de suscripción ONVO LIVE rechazada'), `Error esperado: ${activacionErrMsg}`);

      // Verificar que la suscripción en la base de datos permanece inalterada
      const subCheck = await pool.query('SELECT status, current_period_end FROM subscriptions WHERE tenant_id = $1', [tenantId]);
      assert.strictEqual(subCheck.rows[0].status, 'trialing', 'El estado de la suscripción debe permanecer en trialing');
      assert.strictEqual(
        new Date(subCheck.rows[0].current_period_end).toISOString(),
        new Date(initialPeriodEnd).toISOString(),
        'La fecha de vencimiento no debe haber sido extendida'
      );

      record(4, 'Bloqueo en Activación de Suscripciones', true, 'Suscripción protegida: estado y vigencia permanecen intactos.');
    } catch (err: any) {
      record(4, 'Bloqueo en Activación de Suscripciones', false, err.message);
      throw err;
    }

    // =========================================================================
    // 5. NO AFECTACIÓN DE SANDBOX (CONTINUIDAD OPERATIVA EN PRUEBAS)
    // =========================================================================
    try {
      process.env.ONVO_ENVIRONMENT = 'sandbox';
      process.env.ONVO_SECRET_KEY = 'sk_test_fake_sandbox_key';
      process.env.ONVO_PUBLIC_KEY = 'pk_test_fake_sandbox_key';
      process.env.ONVO_WEBHOOK_SECRET = 'whsec_2NaByjlLjsGTSBfuqFLM9oWJviCeCyc-gjrcKKS7hbc';

      const gatewaysSandbox = await getGatewaysConfig();
      assert.strictEqual(gatewaysSandbox.onvopay.secretKey, 'sk_test_fake_sandbox_key');
      assert.strictEqual(gatewaysSandbox.onvopay.webhookSecret, 'whsec_2NaByjlLjsGTSBfuqFLM9oWJviCeCyc-gjrcKKS7hbc');

      // Crear y confirmar transacción en Sandbox
      const txSandboxId = crypto.randomUUID();
      const subRes = await pool.query('SELECT id FROM subscriptions WHERE tenant_id = $1', [tenantId]);
      await pool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, amount_crc, currency, provider, status)
         VALUES ($1, $2, $3, 'pro', 'monthly', 12900, 12900, 'CRC', 'onvopay', 'pending')`,
        [txSandboxId, tenantId, subRes.rows[0]?.id || null]
      );

      const confirmRes = await confirmarPagoOnvo(txSandboxId, {
        eventType: 'checkout_session.completed',
        sessionId: `cs_sandbox_${ts}`,
        paymentIntentId: `pi_sandbox_${ts}`,
        status: 'completed',
        paymentStatus: 'paid',
        tenantId,
        planCode: 'pro',
        billingCycle: 'monthly',
        amountInCents: 1290000,
        currency: 'CRC'
      });

      assert(confirmRes && !confirmRes.alreadyPaid && confirmRes.tenantId === tenantId, 'Confirmación en Sandbox debe completarse con éxito');
      const subUpdated = await pool.query('SELECT status FROM subscriptions WHERE tenant_id = $1', [tenantId]);
      assert.strictEqual(subUpdated.rows[0].status, 'active', 'Suscripción en Sandbox debe activarse correctamente');

      record(5, 'No Afectación de Sandbox', true, 'El aislamiento estricto permite la operación normal en QA/Sandbox sin perturbaciones.');
    } catch (err: any) {
      record(5, 'No Afectación de Sandbox', false, err.message);
      throw err;
    }

    console.log('\n======================================================');
    console.log('🎉 TODAS LAS PRUEBAS DE BLOQUEO LIVE SUPERADAS (5/5)');
    console.log('======================================================\n');
  } finally {
    process.env = prevEnv;
  }
}

runLiveBlockingTests().catch(err => {
  console.error('❌ FALLO EN SUITE DE BLOQUEO LIVE:', err);
  process.exit(1);
});
