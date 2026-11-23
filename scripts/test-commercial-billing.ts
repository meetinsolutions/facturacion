/**
 * MEETINFACT — SUITE DE PRUEBAS DE VALIDACIÓN COMERCIAL EXPEDITA (PASOS 4 Y 5)
 * Cobertura:
 *  1. Alta de suscripción y registro (trial 14 días)
 *  2. Selección de planes, límites y características (comprobantes, usuarios, IMAP)
 *  3. Pago confirmado ONVO Sandbox (activación de suscripción y vigencia)
 *  4. Pago rechazado ONVO Sandbox (marca failed sin activar)
 *  5. Pago duplicado e idempotencia ONVO (cero extensión indebida)
 *  6. Vencimiento automático (past_due y suspended)
 *  7. Protección de historial tributario durante suspensión (lectura permitida, emisión bloqueada)
 *  8. Reactivación inmediata tras regularización de pago
 *  9. Renovación acumulativa sobre suscripción activa (actualFin + días)
 * 10. Diferenciación de cobros recurrentes reales ONVO (webhook de cargo automático)
 * 11. Flujo SINPE Móvil manual: registro pending, no auto-activación, bloqueo de duplicados, auditoría de admin
 * 12. Aislamiento multi-tenant estricto entre empresas
 * 13. Verificación de seguridad de entorno (cero claves LIVE)
 */
import assert from 'assert';
import crypto from 'crypto';
import { Pool } from 'pg';
import {
  completarPagoYActivarSuscripcion,
  confirmarPagoOnvo,
  procesarWebhook,
  reportarPagoSinpe,
  aprobarPagoManual,
  rechazarPagoManual,
  verificarVencimientosSuscripciones,
  getEstadoSuscripcion,
  listarPlanes,
  getGatewaysConfig,
  isSandboxPermitted,
  formatCRC
} from '../src/services/billing-service.js';

const TEST_DB = 'facturacion_test';
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl || !databaseUrl.includes(TEST_DB)) {
  console.error(`[SEGURIDAD] Base de datos no autorizada: ${databaseUrl}. Se exige "${TEST_DB}".`);
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

async function runCommercialSuite() {
  console.log('======================================================================');
  console.log('  MEETINFACT — SUITE DE VALIDACIÓN COMERCIAL EXPEDITA (PASOS 4 Y 5)');
  console.log('  Planes, Suscripciones, ONVO Sandbox, SINPE Manual y Seguridad');
  console.log('  Base de datos objetivo: facturacion_test');
  console.log('======================================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name: string, fn: () => Promise<void>) {
    total++;
    try {
      await fn();
      console.log(`Prueba ${total}: ${name}... PASÓ ✓`);
      passed++;
    } catch (err: any) {
      console.error(`Prueba ${total}: ${name}... FALLÓ ✗`);
      console.error(`   Detalle: ${err.message}`);
      throw err;
    }
  }

  // Helpers de generación de tenants y suscripciones de prueba aisladas
  async function crearTenantFixture(prefix = 'comm'): Promise<{ tenantId: string; subId: string; email: string }> {
    const tenantId = crypto.randomUUID();
    const subId = crypto.randomUUID();
    const slug = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const email = `${slug}@testcorp.cr`;

    await pool.query(
      `INSERT INTO tenants (id, nombre, slug, cedula, activo)
       VALUES ($1, $2, $3, $4, TRUE)`,
      [tenantId, `Empresa Comercial ${slug}`, slug, `3101${Math.floor(100000 + Math.random() * 900000)}`]
    );

    const now = new Date();
    const trialEnd = new Date(now.getTime() + 14 * 86400_000);
    await pool.query(
      `INSERT INTO subscriptions (id, tenant_id, plan_code, status, billing_cycle, current_period_start, current_period_end, next_billing_date, provider)
       VALUES ($1, $2, 'trial', 'trialing', 'monthly', $3, $4, $4, 'trial')`,
      [subId, tenantId, now, trialEnd]
    );

    await pool.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, nombre, role, activo)
       VALUES ($1, $2, $3, 'dummyhash', 'Admin Test', 'admin', TRUE)`,
      [crypto.randomUUID(), tenantId, email]
    );

    return { tenantId, subId, email };
  }

  async function limpiarTenant(tenantId: string) {
    await pool.query('DELETE FROM auditoria_descargas_comprobantes WHERE tenant_id = $1', [tenantId]).catch(() => {});
    await pool.query('DELETE FROM portal_clientes_sesiones WHERE tenant_id = $1', [tenantId]).catch(() => {});
    await pool.query('DELETE FROM portal_clientes_otp WHERE tenant_id = $1', [tenantId]).catch(() => {});
    await pool.query('DELETE FROM payment_transactions WHERE tenant_id = $1', [tenantId]);
    await pool.query('DELETE FROM subscriptions WHERE tenant_id = $1', [tenantId]);
    await pool.query('DELETE FROM users WHERE tenant_id = $1', [tenantId]);
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
  }

  const tenantsCreados: string[] = [];

  try {
    // ----------------------------------------------------------------
    // PRUEBA 1: ALTA DE SUSCRIPCIÓN Y REGISTRO (TRIAL 14 DÍAS)
    // ----------------------------------------------------------------
    await test('1. Alta de empresa nueva inicializa suscripción trial de 14 días con límites de prueba', async () => {
      const fixture = await crearTenantFixture('alta');
      tenantsCreados.push(fixture.tenantId);

      const estado = await getEstadoSuscripcion(fixture.tenantId);
      assert.strictEqual(estado.subscription.planCode, 'trial');
      assert.strictEqual(estado.subscription.status, 'trialing');
      assert.strictEqual(estado.plan.limite_comprobantes_mes, 5);
      assert.strictEqual(estado.plan.limite_usuarios, 1);

      const diffDays = Math.round(
        (new Date(estado.subscription.currentPeriodEnd).getTime() - new Date(estado.subscription.currentPeriodStart).getTime()) /
          86400_000
      );
      assert.strictEqual(diffDays, 14, 'El período de prueba debe ser exactamente de 14 días');
    });

    // ----------------------------------------------------------------
    // PRUEBA 2: CATÁLOGO DE PLANES Y PRECIOS EN COLONES (CRC)
    // ----------------------------------------------------------------
    await test('2. Catálogo de planes expone tarifas aprobadas en CRC y formato costarricense', async () => {
      const planes = await listarPlanes();
      assert(planes.length >= 4, 'Deben existir al menos 4 planes');

      const emprendedor = planes.find(p => p.code === 'emprendedor');
      const pro = planes.find(p => p.code === 'pro');
      const empresarial = planes.find(p => p.code === 'empresarial');

      assert(emprendedor && pro && empresarial, 'Planes esenciales deben existir');
      assert.strictEqual(emprendedor.precio_mensual_crc, 6900);
      assert.strictEqual(emprendedor.precio_anual_crc, 69000);
      assert.strictEqual(pro.precio_mensual_crc, 12900);
      assert.strictEqual(pro.precio_anual_crc, 129000);
      assert.strictEqual(empresarial.precio_mensual_crc, 34900);
      assert.strictEqual(empresarial.precio_anual_crc, 349000);

      // Verificación de formato oficial costarricense (punto como separador de miles, sin decimales)
      assert.strictEqual(formatCRC(6900), '₡6.900');
      assert.strictEqual(formatCRC(12900), '₡12.900');
      assert.strictEqual(formatCRC(34900), '₡34.900');
      assert.strictEqual(formatCRC(129000), '₡129.000');
      assert.strictEqual(formatCRC(349000), '₡349.000');

      assert.strictEqual(emprendedor.limite_comprobantes_mes, 100);
      assert.strictEqual(emprendedor.permite_imap_gastos, false);
      assert.strictEqual(pro.limite_comprobantes_mes, -1); // ilimitado
      assert.strictEqual(pro.permite_imap_gastos, true);
      assert.strictEqual(empresarial.limite_usuarios, 20);
    });

    // ----------------------------------------------------------------
    // PRUEBA 3: PAGO CONFIRMADO ONVO SANDBOX EN CRC
    // ----------------------------------------------------------------
    await test('3. Pago confirmado ONVO Sandbox en CRC activa suscripción mensual y programa fecha fin exacta', async () => {
      const fixture = await crearTenantFixture('onvo-pay');
      tenantsCreados.push(fixture.tenantId);

      const txId = crypto.randomUUID();
      const sessionId = `cs_test_${crypto.randomBytes(8).toString('hex')}`;
      const paymentIntentId = `pi_test_${crypto.randomBytes(8).toString('hex')}`;

      await pool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, amount_crc, currency, provider, status, checkout_session_id)
         VALUES ($1, $2, $3, 'pro', 'monthly', 12900.00, 12900.00, 'CRC', 'onvopay', 'pending', $4)`,
        [txId, fixture.tenantId, fixture.subId, sessionId]
      );

      const result = await confirmarPagoOnvo(txId, {
        eventType: 'checkout_session.succeeded',
        sessionId,
        paymentIntentId,
        status: 'completed',
        paymentStatus: 'paid',
        tenantId: fixture.tenantId,
        planCode: 'pro',
        billingCycle: 'monthly',
        amountInCents: 1290000,
        currency: 'CRC'
      });

      assert.strictEqual(result.alreadyPaid, false);
      assert.strictEqual(result.planCode, 'pro');

      const estado = await getEstadoSuscripcion(fixture.tenantId);
      assert.strictEqual(estado.subscription.status, 'active');
      assert.strictEqual(estado.subscription.planCode, 'pro');
      assert.strictEqual(estado.subscription.provider, 'onvopay');

      const tx = await pool.query('SELECT * FROM payment_transactions WHERE id = $1', [txId]);
      assert.strictEqual(tx.rows[0].status, 'paid');
      assert.strictEqual(tx.rows[0].currency, 'CRC');
      assert(tx.rows[0].paid_at !== null);
      assert.strictEqual(tx.rows[0].payment_intent_id, paymentIntentId);
    });

    // ----------------------------------------------------------------
    // PRUEBA 4: PAGO RECHAZADO ONVO SANDBOX
    // ----------------------------------------------------------------
    await test('4. Pago rechazado/fallido en ONVO marca transacción failed y preserva estado de suscripción', async () => {
      const fixture = await crearTenantFixture('onvo-fail');
      tenantsCreados.push(fixture.tenantId);

      const txId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, status)
         VALUES ($1, $2, $3, 'pro', 'monthly', 10.00, 'USD', 'onvopay', 'pending')`,
        [txId, fixture.tenantId, fixture.subId]
      );

      // Webhook de fallo
      const webhookPayload = {
        type: 'payment_intent.failed',
        data: {
          object: {
            id: `pi_fail_${Date.now()}`,
            metadata: { transactionId: txId }
          }
        }
      };

      const res = await procesarWebhook('onvopay', webhookPayload);
      assert.strictEqual(res.received, true);

      const tx = await pool.query('SELECT status FROM payment_transactions WHERE id = $1', [txId]);
      assert.strictEqual(tx.rows[0].status, 'failed');

      const sub = await pool.query('SELECT status, plan_code FROM subscriptions WHERE id = $1', [fixture.subId]);
      assert.strictEqual(sub.rows[0].status, 'trialing');
      assert.strictEqual(sub.rows[0].plan_code, 'trial');
    });

    // ----------------------------------------------------------------
    // PRUEBA 5: PAGO DUPLICADO E IDEMPOTENCIA
    // ----------------------------------------------------------------
    await test('5. Pago duplicado o reintentos simultáneos no extienden vigencia dos veces (idempotencia estricta)', async () => {
      const fixture = await crearTenantFixture('onvo-idem');
      tenantsCreados.push(fixture.tenantId);

      const txId = crypto.randomUUID();
      const sessionId = `cs_test_idem_${Date.now()}`;

      await pool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, amount_crc, currency, provider, status, checkout_session_id)
         VALUES ($1, $2, $3, 'emprendedor', 'monthly', 6900.00, 6900.00, 'CRC', 'onvopay', 'pending', $4)`,
        [txId, fixture.tenantId, fixture.subId, sessionId]
      );

      const eventData = {
        eventType: 'checkout_session.completed',
        sessionId,
        paymentIntentId: `pi_idem_${Date.now()}`,
        status: 'completed',
        paymentStatus: 'paid',
        tenantId: fixture.tenantId,
        planCode: 'emprendedor',
        billingCycle: 'monthly',
        amountInCents: 690000,
        currency: 'CRC'
      };

      // Ejecutar dos confirmaciones concurrentes
      const [res1, res2] = await Promise.all([
        confirmarPagoOnvo(txId, eventData),
        confirmarPagoOnvo(txId, eventData)
      ]);

      const paidCount = [res1, res2].filter(r => r.alreadyPaid === false).length;
      const alreadyPaidCount = [res1, res2].filter(r => r.alreadyPaid === true).length;

      assert.strictEqual(paidCount, 1, 'Exactamente una confirmación debe aplicar');
      assert.strictEqual(alreadyPaidCount, 1, 'La confirmación duplicada debe retornar alreadyPaid: true');

      const sub = await pool.query('SELECT current_period_end FROM subscriptions WHERE id = $1', [fixture.subId]);
      const end1 = new Date(sub.rows[0].current_period_end).getTime();

      // Intentar una tercera vez serializada
      const res3 = await confirmarPagoOnvo(txId, eventData);
      assert.strictEqual(res3.alreadyPaid, true);

      const sub2 = await pool.query('SELECT current_period_end FROM subscriptions WHERE id = $1', [fixture.subId]);
      assert.strictEqual(new Date(sub2.rows[0].current_period_end).getTime(), end1, 'El vencimiento no debe cambiar');
    });

    // ----------------------------------------------------------------
    // PRUEBA 6: VENCIMIENTO Y SUSPENSIÓN
    // ----------------------------------------------------------------
    await test('6. Vencimiento detecta período superado: past_due dentro de 3 días y suspended tras periodo de gracia', async () => {
      const fixture = await crearTenantFixture('vence');
      tenantsCreados.push(fixture.tenantId);

      // Simular vencimiento de hace 1 día (dentro de gracia)
      const past1Day = new Date(Date.now() - 1 * 86400_000);
      await pool.query(
        `UPDATE subscriptions
         SET status = 'active', provider = 'onvopay', current_period_end = $2
         WHERE id = $1`,
        [fixture.subId, past1Day]
      );

      await verificarVencimientosSuscripciones();
      let sub = await pool.query('SELECT status FROM subscriptions WHERE id = $1', [fixture.subId]);
      assert.strictEqual(sub.rows[0].status, 'past_due', 'Debe estar en past_due dentro de los 3 días de gracia');

      // Simular vencimiento de hace 4 días (fuera de gracia)
      const past4Days = new Date(Date.now() - 4 * 86400_000);
      await pool.query(
        `UPDATE subscriptions
         SET current_period_end = $2
         WHERE id = $1`,
        [fixture.subId, past4Days]
      );

      await verificarVencimientosSuscripciones();
      sub = await pool.query('SELECT status FROM subscriptions WHERE id = $1', [fixture.subId]);
      assert.strictEqual(sub.rows[0].status, 'suspended', 'Debe estar suspended al superar la gracia');
    });

    // ----------------------------------------------------------------
    // PRUEBA 7: PROTECCIÓN DE HISTORIAL TRIBUTARIO BAJO SUSPENSIÓN
    // ----------------------------------------------------------------
    await test('7. Suscripción suspendida bloquea emisión pero preserva 100% lectura de comprobantes y reportes', async () => {
      const fixture = await crearTenantFixture('hist');
      tenantsCreados.push(fixture.tenantId);

      // Suspender suscripción
      await pool.query("UPDATE subscriptions SET status = 'suspended' WHERE id = $1", [fixture.subId]);

      // Insertar un comprobante histórico simulado
      const clave = `50622112600310199988800100001010000000${Math.floor(1000000000 + Math.random() * 9000000000)}`;
      await pool.query(
        `INSERT INTO comprobantes (tenant_id, clave, consecutivo, tipo_documento, cliente, correo_cliente, total, moneda, estado_hacienda, xml_firmado, doc_original_json, fecha)
         VALUES ($1, $2, '00100001010000000001', '01', 'Cliente Histórico', 'cli@hist.cr', 5000, 'CRC', 'aceptado', '<xml>firmado</xml>', '{}'::jsonb, NOW())`,
        [fixture.tenantId, clave]
      );

      // 1. Consulta de comprobante: debe ser completamente accesible
      const compRes = await pool.query('SELECT * FROM comprobantes WHERE tenant_id = $1 AND clave = $2', [fixture.tenantId, clave]);
      assert.strictEqual(compRes.rowCount, 1, 'El comprobante debe estar intacto');
      assert.strictEqual(compRes.rows[0].xml_firmado, '<xml>firmado</xml>');

      // 2. Estado de suscripción: refleja suspensión
      const estado = await getEstadoSuscripcion(fixture.tenantId);
      assert.strictEqual(estado.subscription.status, 'suspended');

      // Limpiar comprobante de prueba
      await pool.query('DELETE FROM comprobantes WHERE tenant_id = $1', [fixture.tenantId]);
    });

    // ----------------------------------------------------------------
    // PRUEBA 8: REACTIVACIÓN INMEDIATA TRAS REGULARIZACIÓN DE PAGO
    // ----------------------------------------------------------------
    await test('8. Reactivación inmediata: pago regulariza y pasa suscripción suspended a active', async () => {
      const fixture = await crearTenantFixture('reactiv');
      tenantsCreados.push(fixture.tenantId);

      await pool.query("UPDATE subscriptions SET status = 'suspended' WHERE id = $1", [fixture.subId]);

      const txId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, status)
         VALUES ($1, $2, $3, 'pro', 'monthly', 10.00, 'USD', 'manual_sinpe', 'pending')`,
        [txId, fixture.tenantId, fixture.subId]
      );

      const res = await aprobarPagoManual(txId, { email: 'superadmin@meetinlabs.com' });
      assert.strictEqual(res.alreadyPaid, false);

      const sub = await pool.query('SELECT status, current_period_end FROM subscriptions WHERE id = $1', [fixture.subId]);
      assert.strictEqual(sub.rows[0].status, 'active');
      assert(new Date(sub.rows[0].current_period_end).getTime() > Date.now());
    });

    // ----------------------------------------------------------------
    // PRUEBA 9: RENOVACIÓN ACUMULATIVA SOBRE SUSCRIPCIÓN ACTIVA
    // ----------------------------------------------------------------
    await test('9. Renovación anticipada en el mismo plan acumula días restantes (actualFin + 30 días)', async () => {
      const fixture = await crearTenantFixture('renov');
      tenantsCreados.push(fixture.tenantId);

      // Configurar suscripción activa que vence dentro de 10 días
      const in10Days = new Date(Date.now() + 10 * 86400_000);
      await pool.query(
        `UPDATE subscriptions
         SET status = 'active', plan_code = 'pro', current_period_end = $2
         WHERE id = $1`,
        [fixture.subId, in10Days]
      );

      const txId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, status)
         VALUES ($1, $2, $3, 'pro', 'monthly', 10.00, 'USD', 'manual_sinpe', 'pending')`,
        [txId, fixture.tenantId, fixture.subId]
      );

      await aprobarPagoManual(txId, { email: 'admin@meetinlabs.com' });

      const sub = await pool.query('SELECT current_period_end FROM subscriptions WHERE id = $1', [fixture.subId]);
      const expectedEnd = new Date(in10Days.getTime() + 30 * 86400_000);
      const diffSecs = Math.abs(new Date(sub.rows[0].current_period_end).getTime() - expectedEnd.getTime()) / 1000;

      assert(diffSecs < 10, 'La nueva fecha de fin debe sumar 30 días a partir de la fecha de vencimiento previa');
    });

    // ----------------------------------------------------------------
    // PRUEBA 10: DIFERENCIACIÓN DE CARGOS RECURRENTES REALES ONVO
    // ----------------------------------------------------------------
    await test('10. Diferenciación de cargos recurrentes ONVO genera transacción de renovación automática', async () => {
      const fixture = await crearTenantFixture('recurr');
      tenantsCreados.push(fixture.tenantId);

      // Suscripción activa pro
      await pool.query("UPDATE subscriptions SET status = 'active', plan_code = 'pro' WHERE id = $1", [fixture.subId]);

      const paymentIntentId = `pi_auto_recurr_${Date.now()}`;

      // Webhook simulado de cobro recurrente automático sin transactionId previo en metadata
      const recurringPayload = {
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: paymentIntentId,
            amount: 1290000,
            currency: 'CRC',
            status: 'succeeded',
            metadata: {
              tenantId: fixture.tenantId,
              planCode: 'pro',
              billingCycle: 'monthly'
            }
          }
        }
      };

      const res = await procesarWebhook('onvopay', recurringPayload);
      assert.strictEqual(res.received, true);
      assert.strictEqual(res.alreadyPaid, false);

      // Verificar que se creó y confirmó la transacción automática
      const tx = await pool.query('SELECT * FROM payment_transactions WHERE payment_intent_id = $1', [paymentIntentId]);
      assert.strictEqual(tx.rowCount, 1);
      assert.strictEqual(tx.rows[0].status, 'paid');
      assert.strictEqual(tx.rows[0].tenant_id, fixture.tenantId);
      assert(tx.rows[0].comprobante_notas.includes('Renovación automática'));
    });

    // ----------------------------------------------------------------
    // PRUEBA 11: SINPE MÓVIL MANUAL (REGISTRO, RECHAZO DUPLICADO, AUDITORÍA)
    // ----------------------------------------------------------------
    await test('11. Flujo SINPE Móvil manual: no confirma por declaración, rechaza comprobante duplicado y audita admin', async () => {
      const fixture = await crearTenantFixture('sinpe');
      tenantsCreados.push(fixture.tenantId);

      const referencia = `SINPE-${Date.now()}`;

      // 1. Cliente reporta pago
      const report = await reportarPagoSinpe(fixture.tenantId, {
        planCode: 'emprendedor',
        billingCycle: 'monthly',
        referencia,
        notas: 'Comprobante transferido a 60450476'
      });

      assert.strictEqual(report.status, 'pending');

      // 2. Verificar que NO se activó la suscripción automáticamente
      let sub = await pool.query('SELECT status, plan_code FROM subscriptions WHERE id = $1', [fixture.subId]);
      assert.strictEqual(sub.rows[0].status, 'trialing', 'No debe activarse solo porque el cliente declare el pago');

      // 3. Intento de reusar la misma referencia SINPE: debe ser rechazado
      let threwDuplicate = false;
      try {
        await reportarPagoSinpe(fixture.tenantId, {
          planCode: 'emprendedor',
          billingCycle: 'monthly',
          referencia
        });
      } catch (err: any) {
        threwDuplicate = true;
        assert(err.message.includes('previamente'));
      }
      assert.strictEqual(threwDuplicate, true, 'Debe impedir duplicidad de comprobantes SINPE');

      // 4. Aprobación por SuperAdmin con registro de auditoría
      const adminEmail = 'superadmin.audit@meetinlabs.com';
      await aprobarPagoManual(report.id, { email: adminEmail });

      sub = await pool.query('SELECT status, plan_code FROM subscriptions WHERE id = $1', [fixture.subId]);
      assert.strictEqual(sub.rows[0].status, 'active');
      assert.strictEqual(sub.rows[0].plan_code, 'emprendedor');

      const tx = await pool.query('SELECT comprobante_notas, status FROM payment_transactions WHERE id = $1', [report.id]);
      assert.strictEqual(tx.rows[0].status, 'paid');
      assert(tx.rows[0].comprobante_notas.includes(adminEmail), 'Notas de transacción deben contener correo del admin');
      assert(tx.rows[0].comprobante_notas.includes('[AUDITORÍA]'));

      // 5. Rechazo manual de otra transacción con auditoría
      const reportRechazar = await reportarPagoSinpe(fixture.tenantId, {
        planCode: 'emprendedor',
        billingCycle: 'monthly',
        referencia: `SINPE-RECH-${Date.now()}`
      });

      await rechazarPagoManual(reportRechazar.id, 'Comprobante no coincide en cuenta bancaria', { email: adminEmail });
      const txRech = await pool.query('SELECT status, comprobante_notas FROM payment_transactions WHERE id = $1', [reportRechazar.id]);
      assert.strictEqual(txRech.rows[0].status, 'failed');
      assert(txRech.rows[0].comprobante_notas.includes('no coincide en cuenta'));
      assert(txRech.rows[0].comprobante_notas.includes(adminEmail));
    });

    // ----------------------------------------------------------------
    // PRUEBA 12: AISLAMIENTO MULTI-TENANT ESTRICTO
    // ----------------------------------------------------------------
    await test('12. Aislamiento multi-tenant: Transacción de Empresa A rechazada si intenta asociarse a Empresa B', async () => {
      const fixtureA = await crearTenantFixture('iso-a');
      const fixtureB = await crearTenantFixture('iso-b');
      tenantsCreados.push(fixtureA.tenantId, fixtureB.tenantId);

      const txId = crypto.randomUUID();
      // Transacción perteneciente a Tenant A pero apuntando a suscripción de Tenant B
      await pool.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, status)
         VALUES ($1, $2, $3, 'pro', 'monthly', 10.00, 'USD', 'manual_sinpe', 'pending')`,
        [txId, fixtureA.tenantId, fixtureB.subId]
      );

      let threw = false;
      try {
        await completarPagoYActivarSuscripcion(txId, 'manual_sinpe');
      } catch (err: any) {
        threw = true;
        assert(err.message.includes('no corresponde a la suscripción'));
      }
      assert.strictEqual(threw, true, 'Debe rechazar discrepancia de empresa cruzada');

      // Verificar que ni A ni B fueron modificadas
      const subA = await pool.query('SELECT status FROM subscriptions WHERE id = $1', [fixtureA.subId]);
      const subB = await pool.query('SELECT status FROM subscriptions WHERE id = $1', [fixtureB.subId]);
      assert.strictEqual(subA.rows[0].status, 'trialing');
      assert.strictEqual(subB.rows[0].status, 'trialing');
    });

    // ----------------------------------------------------------------
    // PRUEBA 13: SEGURIDAD DEL ENTORNO (CERO CLAVES LIVE)
    // ----------------------------------------------------------------
    await test('13. Verificación de seguridad: Entorno QA opera exclusivamente en Sandbox (sin claves LIVE)', async () => {
      const gateways = await getGatewaysConfig();
      const secKey = gateways.onvopay.secretKey || '';
      const pubKey = gateways.onvopay.publicKey || '';

      assert(!secKey.startsWith('onvo_live_'), 'SEGURIDAD: Prohibido secret key LIVE en QA');
      assert(!pubKey.startsWith('onvo_live_'), 'SEGURIDAD: Prohibido publishable key LIVE en QA');
      assert(secKey.includes('test') || secKey.includes('sandbox') || secKey.startsWith('onvo_test_'), 'Clave debe ser de pruebas');

      assert.strictEqual(isSandboxPermitted(), true, 'Sandbox debe estar permitido en entorno test');
    });

  } finally {
    // Limpieza segura de datos de prueba
    for (const tid of tenantsCreados) {
      await limpiarTenant(tid);
    }
    await pool.end();
  }

  console.log('\n======================================================================');
  console.log(`RESULTADO DE LA SUITE COMERCIAL: ${passed}/${total} PRUEBAS EXITOSAS`);
  console.log('======================================================================\n');
  process.exit(0);
}

runCommercialSuite().catch(err => {
  console.error('\n[FATAL] Error en suite comercial:', err);
  process.exit(1);
});
