import * as crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { pool, withTransaction } from '../db/pool.js';
import { pgDataStore } from './pg-data-store.js';

export interface PlanRecord {
  code: string;
  nombre: string;
  descripcion: string;
  precio_mensual_crc: number;
  precio_anual_crc: number;
  precio_mensual_usd?: number;
  precio_anual_usd?: number;
  moneda: string;
  limite_comprobantes_mes: number;
  limite_usuarios: number;
  permite_imap_gastos: boolean;
  permite_envio_correo: boolean;
  activo: boolean;
  orden: number;
}

export function formatCRC(amount: number): string {
  const rounded = Math.round(amount);
  return '₡' + rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export interface GatewaysConfig {
  pasarelaActiva: 'sandbox' | 'onvopay' | 'tilopay' | 'stripe';
  onvopay: {
    publicKey: string;
    secretKey: string;
    webhookSecret: string;
  };
  tilopay: {
    apiKey: string;
    apiUser: string;
    apiPassword: string;
    webhookSecret: string;
  };
  stripe: {
    publishableKey: string;
    secretKey: string;
    webhookSecret: string;
  };
  sinpe: {
    numero: string;
    titular: string;
    banco: string;
    tipoCambioUsd?: number;
    moneda?: string;
  };
}

const DEFAULT_GATEWAYS: GatewaysConfig = {
  pasarelaActiva: 'sandbox',
  onvopay: { publicKey: '', secretKey: '', webhookSecret: '' },
  tilopay: { apiKey: '', apiUser: '', apiPassword: '', webhookSecret: '' },
  stripe: { publishableKey: '', secretKey: '', webhookSecret: '' },
  sinpe: {
    numero: '60450476',
    titular: 'GIOVANNI IEZZI FERNANDEZ',
    banco: 'SINPE Móvil Costa Rica',
    moneda: 'CRC'
  }
};

function mapPlan(row: any): PlanRecord {
  const mensualCrc = Number(row.precio_mensual_crc ?? row.precio_mensual_usd ?? 0);
  const anualCrc = Number(row.precio_anual_crc ?? row.precio_anual_usd ?? 0);
  return {
    code: row.code,
    nombre: row.nombre,
    descripcion: row.descripcion,
    precio_mensual_crc: mensualCrc,
    precio_anual_crc: anualCrc,
    precio_mensual_usd: Number(row.precio_mensual_usd ?? 0),
    precio_anual_usd: Number(row.precio_anual_usd ?? 0),
    moneda: row.moneda || 'CRC',
    limite_comprobantes_mes: Number(row.limite_comprobantes_mes),
    limite_usuarios: Number(row.limite_usuarios),
    permite_imap_gastos: Boolean(row.permite_imap_gastos),
    permite_envio_correo: Boolean(row.permite_envio_correo),
    activo: Boolean(row.activo),
    orden: Number(row.orden)
  };
}

export async function listarPlanes(): Promise<PlanRecord[]> {
  const res = await pool.query('SELECT * FROM plans WHERE activo = TRUE ORDER BY orden ASC');
  return res.rows.map(mapPlan);
}

export async function getGatewaysConfig(): Promise<GatewaysConfig> {
  const stored = await pgDataStore.getPlatformSetting<Partial<GatewaysConfig>>('payment_gateways');
  return {
    pasarelaActiva: stored?.pasarelaActiva || (process.env.DEFAULT_GATEWAY as any) || DEFAULT_GATEWAYS.pasarelaActiva,
    onvopay: {
      publicKey: process.env.ONVO_PUBLIC_KEY || stored?.onvopay?.publicKey || DEFAULT_GATEWAYS.onvopay.publicKey,
      secretKey: process.env.ONVO_SECRET_KEY || stored?.onvopay?.secretKey || DEFAULT_GATEWAYS.onvopay.secretKey,
      webhookSecret: process.env.ONVO_WEBHOOK_SECRET || stored?.onvopay?.webhookSecret || DEFAULT_GATEWAYS.onvopay.webhookSecret
    },
    tilopay: { ...DEFAULT_GATEWAYS.tilopay, ...(stored?.tilopay || {}) },
    stripe: { ...DEFAULT_GATEWAYS.stripe, ...(stored?.stripe || {}) },
    sinpe: { ...DEFAULT_GATEWAYS.sinpe, ...(stored?.sinpe || {}) }
  };
}

export async function saveGatewaysConfig(patch: Partial<GatewaysConfig>): Promise<GatewaysConfig> {
  const current = await getGatewaysConfig();
  const updated: GatewaysConfig = {
    pasarelaActiva: patch.pasarelaActiva || current.pasarelaActiva,
    onvopay: { ...current.onvopay, ...(patch.onvopay || {}) },
    tilopay: { ...current.tilopay, ...(patch.tilopay || {}) },
    stripe: { ...current.stripe, ...(patch.stripe || {}) },
    sinpe: {
      ...current.sinpe,
      ...(patch.sinpe || {}),
      tipoCambioUsd: Number(patch.sinpe?.tipoCambioUsd ?? current.sinpe.tipoCambioUsd) || 510
    }
  };
  await pgDataStore.setPlatformSetting('payment_gateways', updated);
  return updated;
}

export async function verificarVencimientosSuscripciones(): Promise<void> {
  const graceCutoff = new Date(Date.now() - 3 * 86400_000);
  await pool.query(
    `UPDATE subscriptions
     SET status = 'past_due', updated_at = NOW()
     WHERE provider <> 'owner'
       AND status IN ('trialing', 'active')
       AND current_period_end < NOW()
       AND current_period_end >= $1`,
    [graceCutoff]
  );
  await pool.query(
    `UPDATE subscriptions
     SET status = 'suspended', updated_at = NOW()
     WHERE provider <> 'owner'
       AND status IN ('trialing', 'active', 'past_due')
       AND current_period_end < $1`,
    [graceCutoff]
  );
}

export async function getEstadoSuscripcion(tenantId: string) {
  await verificarVencimientosSuscripciones();

  const subRes = await pool.query(
    `SELECT s.*, p.nombre AS plan_nombre, p.descripcion AS plan_descripcion,
            p.precio_mensual_crc, p.precio_anual_crc, p.precio_mensual_usd, p.precio_anual_usd,
            p.limite_comprobantes_mes, p.limite_usuarios, p.permite_imap_gastos, p.permite_envio_correo, p.orden
     FROM subscriptions s
     JOIN plans p ON p.code = s.plan_code
     WHERE s.tenant_id = $1`,
    [tenantId]
  );

  if (!subRes.rowCount) {
    throw new Error('No se encontró suscripción asociada a esta empresa.');
  }

  const row = subRes.rows[0];
  const [usoMesActual, usersRes, pagosRes, gateways] = await Promise.all([
    pgDataStore.countComprobantesMesActual(tenantId),
    pool.query('SELECT COUNT(*)::int AS total FROM users WHERE tenant_id = $1 AND activo = TRUE', [tenantId]),
    pool.query('SELECT * FROM payment_transactions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 20', [tenantId]),
    getGatewaysConfig()
  ]);

  const precioMensualCrc = Number(row.precio_mensual_crc ?? row.precio_mensual_usd ?? 0);
  const precioAnualCrc = Number(row.precio_anual_crc ?? row.precio_anual_usd ?? 0);

  return {
    subscription: {
      id: row.id,
      planCode: row.plan_code,
      status: row.status,
      billingCycle: row.billing_cycle,
      currentPeriodStart: row.current_period_start,
      currentPeriodEnd: row.current_period_end,
      nextBillingDate: row.next_billing_date,
      provider: row.provider,
      cancelAtPeriodEnd: Boolean(row.cancel_at_period_end)
    },
    plan: {
      code: row.plan_code,
      nombre: row.plan_nombre,
      descripcion: row.plan_descripcion,
      precio_mensual_crc: precioMensualCrc,
      precio_anual_crc: precioAnualCrc,
      precio_mensual_usd: Number(row.precio_mensual_usd || 0),
      precio_anual_usd: Number(row.precio_anual_usd || 0),
      moneda: 'CRC',
      precio_mensual_formatted: formatCRC(precioMensualCrc),
      precio_anual_formatted: formatCRC(precioAnualCrc),
      limite_comprobantes_mes: Number(row.limite_comprobantes_mes),
      limite_usuarios: Number(row.limite_usuarios),
      permite_imap_gastos: Boolean(row.permite_imap_gastos),
      permite_envio_correo: Boolean(row.permite_envio_correo)
    },
    usoMesActual,
    usuariosActivos: Number(usersRes.rows[0]?.total || 0),
    pasarelaActiva: gateways.pasarelaActiva,
    sinpeInfo: gateways.sinpe,
    pagos: pagosRes.rows.map(p => {
      const amountCrc = Number(p.amount_crc ?? p.amount_usd ?? 0);
      return {
        id: p.id,
        planCode: p.plan_code,
        billingCycle: p.billing_cycle,
        amountCrc,
        amountUsd: Number(p.amount_usd),
        currency: p.currency || 'CRC',
        amountFormatted: formatCRC(amountCrc),
        provider: p.provider,
        providerReference: p.provider_reference,
        status: p.status,
        notas: p.comprobante_notas,
        createdAt: p.created_at,
        paidAt: p.paid_at
      };
    })
  };
}

export async function requireActiveSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.auth) {
    res.status(401).json({ success: false, error: 'No autenticado.' });
    return;
  }
  if (req.auth.role === 'superadmin') {
    next();
    return;
  }
  try {
    const estado = await getEstadoSuscripcion(req.auth.tenantId);
    if (estado.subscription.status === 'suspended' || estado.subscription.status === 'canceled') {
      res.status(402).json({
        success: false,
        code: 'SUBSCRIPTION_SUSPENDED',
        error: 'Su suscripción se encuentra vencida o suspendida. Regularice su pago en "Mi Plan & Pagos" para seguir emitiendo.'
      });
      return;
    }
    next();
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function requireQuotaComprobantes(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.auth) {
    res.status(401).json({ success: false, error: 'No autenticado.' });
    return;
  }
  if (req.auth.role === 'superadmin') {
    next();
    return;
  }
  try {
    const estado = await getEstadoSuscripcion(req.auth.tenantId);
    const limite = estado.plan.limite_comprobantes_mes;
    if (limite !== -1 && estado.usoMesActual >= limite) {
      res.status(402).json({
        success: false,
        code: 'QUOTA_EXCEEDED',
        error: `Alcanzó el límite mensual de ${limite} comprobantes de su ${estado.plan.nombre}. Mejore su plan en "Mi Plan & Pagos".`
      });
      return;
    }
    next();
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function requireFeatureImap(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.auth) {
    res.status(401).json({ success: false, error: 'No autenticado.' });
    return;
  }
  if (req.auth.role === 'superadmin') {
    next();
    return;
  }
  try {
    const estado = await getEstadoSuscripcion(req.auth.tenantId);
    if (!estado.plan.permite_imap_gastos) {
      res.status(403).json({
        success: false,
        code: 'FEATURE_LOCKED',
        error: 'La absorción automática de gastos desde correo (IMAP) está incluida desde el Plan Profesional.'
      });
      return;
    }
    next();
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export function isSandboxPermitted(): boolean {
  // En producción (NODE_ENV === 'production' o base de datos de producción),
  // el modo sandbox está estrictamente deshabilitado para todos los usuarios (incluido SuperAdmin).
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  const dbUrl = process.env.DATABASE_URL || '';
  if (dbUrl.includes('/facturacion_saas')) {
    return false;
  }
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.NODE_ENV === 'development' ||
    process.env.ALLOW_SANDBOX_CHECKOUT === 'true'
  );
}

export async function iniciarCheckoutRecurrente(
  tenantId: string,
  planCode: string,
  billingCycle: 'monthly' | 'yearly' = 'monthly',
  providerOverride?: GatewaysConfig['pasarelaActiva']
) {
  const planRes = await pool.query('SELECT * FROM plans WHERE code = $1 AND activo = TRUE', [planCode]);
  if (!planRes.rowCount || planCode === 'trial') {
    throw new Error('Plan seleccionado no válido para suscripción de pago.');
  }
  const plan = mapPlan(planRes.rows[0]);
  const amountCrc = billingCycle === 'yearly' ? plan.precio_anual_crc : plan.precio_mensual_crc;

  const subRes = await pool.query('SELECT id FROM subscriptions WHERE tenant_id = $1', [tenantId]);
  const subscriptionId = subRes.rows[0]?.id || null;

  const gateways = await getGatewaysConfig();
  const requested = providerOverride || gateways.pasarelaActiva || 'sandbox';
  const provider = requested;

  // 1. Validación estricta de pasarelas reales: rechazo explícito si faltan credenciales (cero degradación silenciosa a sandbox)
  if (provider === 'onvopay' && !gateways.onvopay.secretKey) {
    throw new Error('La pasarela de pago Onvo Pay no se encuentra configurada en el sistema. Contacte al administrador.');
  }
  if (provider === 'stripe' && !gateways.stripe.secretKey) {
    throw new Error('La pasarela de pago Stripe no se encuentra configurada en el sistema. Contacte al administrador.');
  }
  if (provider === 'tilopay' && (!gateways.tilopay.apiKey || !gateways.tilopay.apiUser)) {
    throw new Error('La pasarela de pago Tilopay no se encuentra configurada en el sistema. Contacte al administrador.');
  }

  // 2. Validación de modo Sandbox: estrictamente prohibido en producción; en otros entornos solo si pasarelaActiva es 'sandbox'
  if (provider === 'sandbox') {
    if (!isSandboxPermitted() || gateways.pasarelaActiva !== 'sandbox') {
      throw new Error('El modo de pago de pruebas (sandbox) está inhabilitado en este entorno de producción.');
    }
  }

  // FASE 3 y 4: Bloqueo consultivo de concurrencia y control de doble clic para ONVO.
  // Protege a nivel de base de datos para que solicitudes HTTP estrictamente simultáneas de la misma empresa
  // no creen transacciones ni sesiones duplicadas para la misma intención de compra.
  let txId: string;
  if (provider === 'onvopay') {
    txId = await withTransaction(async (client) => {
      // Serializar solicitudes concurrentes para el mismo tenant
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('checkout_' || $1))`, [tenantId]);

      const existingPending = await client.query(
        `SELECT id FROM payment_transactions
         WHERE tenant_id = $1 AND plan_code = $2 AND billing_cycle = $3 AND provider = 'onvopay' AND status = 'pending'
           AND checkout_session_id IS NULL AND created_at > NOW() - INTERVAL '3 minutes'
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [tenantId, plan.code, billingCycle]
      );

      if (existingPending.rowCount && existingPending.rowCount > 0) {
        return existingPending.rows[0].id;
      }

      const newId = crypto.randomUUID();
      await client.query(
        `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, amount_crc, currency, provider, status)
         VALUES ($1, $2, $3, $4, $5, $6, $6, 'CRC', $7, 'pending')`,
        [newId, tenantId, subscriptionId, plan.code, billingCycle, amountCrc, provider]
      );
      return newId;
    });
  } else {
    txId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, amount_crc, currency, provider, status)
       VALUES ($1, $2, $3, $4, $5, $6, $6, 'CRC', $7, 'pending')`,
      [txId, tenantId, subscriptionId, plan.code, billingCycle, amountCrc, provider]
    );
  }

  const appUrl = (process.env.PUBLIC_APP_URL || process.env.APP_URL || 'https://test-facturacion.meetinlabs.com').replace(/\/+$/, '');

  if (provider === 'stripe' && gateways.stripe.secretKey) {
    const body = new URLSearchParams({
      mode: 'subscription',
      success_url: `${appUrl}/?billing=success&tx=${txId}`,
      cancel_url: `${appUrl}/?billing=cancel&tx=${txId}`,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'crc',
      'line_items[0][price_data][unit_amount]': String(Math.round(amountCrc * 100)),
      'line_items[0][price_data][recurring][interval]': billingCycle === 'yearly' ? 'year' : 'month',
      'line_items[0][price_data][product_data][name]': `${plan.nombre} (${billingCycle === 'yearly' ? 'Anual' : 'Mensual'})`,
      'metadata[transaction_id]': txId,
      'metadata[tenant_id]': tenantId,
      'metadata[plan_code]': plan.code,
      'metadata[billing_cycle]': billingCycle
    });

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${gateways.stripe.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });
    const stripeJson: any = await stripeRes.json();
    if (!stripeRes.ok || !stripeJson.url) {
      throw new Error(stripeJson?.error?.message || 'Error iniciando checkout con Stripe.');
    }
    await pool.query('UPDATE payment_transactions SET provider_reference = $2 WHERE id = $1', [txId, stripeJson.id]);
    return {
      mode: 'redirect',
      provider: 'stripe',
      transactionId: txId,
      checkoutUrl: stripeJson.url,
      amountCrc,
      amountFormatted: formatCRC(amountCrc),
      currency: 'CRC',
      planNombre: plan.nombre,
      billingCycle
    };
  }

  if (provider === 'onvopay' && gateways.onvopay.secretKey) {
    const userRes = await pool.query(
      `SELECT email FROM users WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [tenantId]
    );
    const customerEmail = userRes.rows[0]?.email || undefined;
    const amountInCents = Math.round(amountCrc * 100);

    const onvoPayload = {
      lineItems: [
        {
          quantity: 1,
          unitAmount: amountInCents,
          currency: 'CRC',
          description: `MeetinFact - ${plan.nombre} (${billingCycle === 'yearly' ? 'Anual' : 'Mensual'})`
        }
      ],
      customerEmail,
      redirectUrl: `${appUrl}/?billing=pending_confirmation&tx=${txId}`,
      cancelUrl: `${appUrl}/?billing=cancel&tx=${txId}`,
      metadata: {
        transactionId: txId,
        tenantId,
        planCode: plan.code,
        billingCycle
      }
    };

    let onvoRes: any;
    let onvoJson: any;
    try {
      onvoRes = await fetch('https://api.onvopay.com/v1/checkout/sessions/one-time-link', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${gateways.onvopay.secretKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': txId
        },
        body: JSON.stringify(onvoPayload)
      });
      onvoJson = await onvoRes.json();
    } catch (netErr: any) {
      // FASE 4: Ante error de red o timeout, NO marcar prematuramente como failed.
      // Se conserva la transacción en pending con una nota informativa, permitiendo
      // que el webhook de ONVO la concilie si la sesión llegó a crearse externamente.
      await pool.query(
        `UPDATE payment_transactions
         SET comprobante_notas = $2
         WHERE id = $1`,
        [txId, `Error de conexión con Onvo Pay: ${netErr.message}. Conservada en pending para reconciliación.`]
      );
      throw new Error(`Error de comunicación temporal con la pasarela Onvo Pay. Transacción retenida para reconciliación.`);
    }

    if (!onvoRes.ok || !onvoJson?.url || !onvoJson?.id) {
      const errMsg = onvoJson?.message || 'Respuesta inválida o incompleta de Onvo Pay.';
      await pool.query(
        `UPDATE payment_transactions
         SET status = 'failed', comprobante_notas = $2
         WHERE id = $1`,
        [txId, `Error ONVO API: ${errMsg}`]
      );
      throw new Error(`Error al crear la sesión de pago en Onvo Pay: ${errMsg}`);
    }

    await pool.query(
      `UPDATE payment_transactions SET checkout_session_id = $2 WHERE id = $1`,
      [txId, onvoJson.id]
    );

    return {
      mode: 'redirect',
      provider: 'onvopay',
      transactionId: txId,
      checkoutUrl: onvoJson.url,
      checkoutSessionId: onvoJson.id,
      amountCrc,
      amountUsd: amountCrc,
      amountFormatted: formatCRC(amountCrc),
      currency: 'CRC',
      planNombre: plan.nombre,
      billingCycle
    };
  }

  if (provider === 'tilopay' && gateways.tilopay.apiKey) {
    const loginRes = await fetch('https://app.tilopay.com/api/v1/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiuser: gateways.tilopay.apiUser,
        password: gateways.tilopay.apiPassword
      })
    });
    const loginJson: any = await loginRes.json();
    if (!loginRes.ok || !loginJson.access_token) {
      throw new Error('Error autenticando con Tilopay.');
    }
    const payRes = await fetch('https://app.tilopay.com/api/v1/processPayment', {
      method: 'POST',
      headers: {
        Authorization: `bearer ${loginJson.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        redirect: `${appUrl}/?billing=tilopay&tx=${txId}`,
        key: gateways.tilopay.apiKey,
        amount: amountCrc.toFixed(2),
        currency: 'CRC',
        orderNumber: txId,
        capture: '1',
        subscription: '1'
      })
    });
    const payJson: any = await payRes.json();
    if (!payRes.ok || !payJson.url) {
      throw new Error(payJson?.message || 'Error generando enlace de suscripción Tilopay.');
    }
    return {
      mode: 'redirect',
      provider: 'tilopay',
      transactionId: txId,
      checkoutUrl: payJson.url,
      amountCrc,
      amountUsd: amountCrc,
      amountFormatted: formatCRC(amountCrc),
      currency: 'CRC',
      planNombre: plan.nombre,
      billingCycle
    };
  }

  return {
    mode: 'sandbox',
    provider: 'sandbox',
    transactionId: txId,
    amountCrc,
    amountUsd: amountCrc,
    amountFormatted: formatCRC(amountCrc),
    currency: 'CRC',
    planNombre: plan.nombre,
    billingCycle
  };
}

export async function completarPagoYActivarSuscripcion(
  transactionId: string,
  expectedProvider: string,
  providerReference?: string,
  providerSubscriptionId?: string
) {
  return await withTransaction(async (client) => {
    const txRes = await client.query(
      `SELECT *
       FROM payment_transactions
       WHERE id = $1
       FOR UPDATE`,
      [transactionId]
    );

    if (txRes.rowCount !== 1) {
      throw new Error('Transacción de pago no encontrada.');
    }

    const tx = txRes.rows[0];

    // Validar el proveedor incluso en pagos ya confirmados.
    if (tx.provider !== expectedProvider) {
      throw new Error(
        'El proveedor del pago no coincide con el proveedor de confirmación.'
      );
    }

    // Idempotencia: nunca extender dos veces el mismo pago.
    if (tx.status === 'paid') {
      return {
        alreadyPaid: true,
        tenantId: tx.tenant_id
      };
    }

    if (tx.status !== 'pending') {
      throw new Error(
        `No se puede confirmar una transacción en estado ${tx.status}.`
      );
    }

    if (
      tx.billing_cycle !== 'monthly' &&
      tx.billing_cycle !== 'yearly'
    ) {
      throw new Error('Ciclo de facturación no válido.');
    }

    const subRes = await client.query(
      `SELECT *
       FROM subscriptions
       WHERE tenant_id = $1
       FOR UPDATE`,
      [tx.tenant_id]
    );

    if (subRes.rowCount !== 1) {
      throw new Error(
        'No existe una suscripción válida para esta empresa.'
      );
    }

    const sub = subRes.rows[0];

    // Verificar que la relación de la transacción sea consistente.
    if (
      tx.subscription_id &&
      tx.subscription_id !== sub.id
    ) {
      throw new Error(
        'La transacción no corresponde a la suscripción de la empresa.'
      );
    }

    const now = new Date();
    let inicio = now;

    if (
      sub.status === 'active' &&
      sub.plan_code === tx.plan_code
    ) {
      const actualFin = new Date(sub.current_period_end);

      if (actualFin > now) {
        inicio = actualFin;
      }
    }

    // Mantener temporalmente el cálculo vigente.
    // La migración a períodos calendario se realizará
    // después de validar los ciclos del proveedor.
    const dias = tx.billing_cycle === 'yearly' ? 365 : 30;
    const fin = new Date(inicio.getTime() + dias * 86400_000);

    const updateSubRes = await client.query(
      `UPDATE subscriptions
       SET plan_code = $2,
           status = 'active',
           billing_cycle = $3,
           current_period_start = $4,
           current_period_end = $5,
           next_billing_date = $5,
           provider = $6,
           provider_subscription_id =
             COALESCE($7, provider_subscription_id),
           cancel_at_period_end = FALSE,
           updated_at = NOW()
       WHERE id = $1
         AND tenant_id = $8`,
      [
        sub.id,
        tx.plan_code,
        tx.billing_cycle,
        inicio,
        fin,
        tx.provider,
        providerSubscriptionId || null,
        tx.tenant_id
      ]
    );

    if (updateSubRes.rowCount !== 1) {
      throw new Error(
        'Fallo de integridad al actualizar la suscripción.'
      );
    }

    const updateTxRes = await client.query(
      `UPDATE payment_transactions
       SET status = 'paid',
           paid_at = NOW(),
           provider_reference =
             COALESCE(provider_reference, $2)
       WHERE id = $1
         AND status = 'pending'`,
      [transactionId, providerReference || null]
    );

    if (updateTxRes.rowCount !== 1) {
      throw new Error(
        'Fallo de integridad al confirmar el pago.'
      );
    }

    return {
      alreadyPaid: false,
      tenantId: tx.tenant_id,
      planCode: tx.plan_code,
      periodEnd: fin
    };
  });
}

export async function reportarPagoSinpe(
  tenantId: string,
  input: { planCode: string; billingCycle: 'monthly' | 'yearly'; referencia: string; notas?: string }
) {
  const planRes = await pool.query('SELECT * FROM plans WHERE code = $1 AND activo = TRUE', [input.planCode]);
  if (!planRes.rowCount || input.planCode === 'trial') {
    throw new Error('Plan seleccionado no válido.');
  }
  const referencia = (input.referencia || '').trim();
  if (!referencia) {
    throw new Error('Debe indicar el número de comprobante o referencia SINPE.');
  }

  // Prevenir comprobantes/referencias SINPE duplicadas ya registradas en estado pending o paid
  const existingRef = await pool.query(
    `SELECT id, status FROM payment_transactions
     WHERE provider = 'manual_sinpe'
       AND LOWER(TRIM(provider_reference)) = LOWER($1)
       AND status IN ('paid', 'pending')`,
    [referencia]
  );
  if (existingRef.rowCount && existingRef.rowCount > 0) {
    throw new Error(`El número de comprobante o referencia SINPE "${referencia}" ya ha sido reportado previamente.`);
  }

  const plan = mapPlan(planRes.rows[0]);
  const amountCrc = input.billingCycle === 'yearly' ? plan.precio_anual_crc : plan.precio_mensual_crc;
  const subRes = await pool.query('SELECT id FROM subscriptions WHERE tenant_id = $1', [tenantId]);
  const txId = crypto.randomUUID();

  await pool.query(
    `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, amount_crc, currency, provider, provider_reference, status, comprobante_notas)
     VALUES ($1, $2, $3, $4, $5, $6, $6, 'CRC', 'manual_sinpe', $7, 'pending', $8)`,
    [txId, tenantId, subRes.rows[0]?.id || null, plan.code, input.billingCycle, amountCrc, referencia, (input.notas || '').trim() || null]
  );

  return { id: txId, status: 'pending', amountCrc, amountUsd: amountCrc, amountFormatted: formatCRC(amountCrc), currency: 'CRC', referencia };
}

export interface OnvoWebhookEventData {
  eventType: string;
  sessionId?: string;
  paymentIntentId?: string;
  status?: string;
  paymentStatus?: string;
  tenantId?: string;
  planCode?: string;
  billingCycle?: string;
  amountInCents?: number;
  currency?: string;
}

export async function confirmarPagoOnvo(
  transactionId: string,
  eventData: OnvoWebhookEventData
) {
  return await withTransaction(async (client) => {
    // 1. Bloquear y consultar transacción interna
    const txRes = await client.query(
      `SELECT *
       FROM payment_transactions
       WHERE id = $1
       FOR UPDATE`,
      [transactionId]
    );

    if (txRes.rowCount !== 1) {
      throw new Error(`Transacción de pago no encontrada: ${transactionId}`);
    }

    const tx = txRes.rows[0];

    // 2. Validación de proveedor
    if (tx.provider !== 'onvopay') {
      throw new Error(`El proveedor de la transacción (${tx.provider}) no es onvopay.`);
    }

    // 3. Idempotencia: si ya fue confirmada, retornar sin re-extender vigencia
    if (tx.status === 'paid') {
      return {
        alreadyPaid: true,
        tenantId: tx.tenant_id,
        planCode: tx.plan_code
      };
    }

    // 4. Estado interno debe ser pending
    if (tx.status !== 'pending') {
      throw new Error(`No se puede confirmar una transacción en estado '${tx.status}'.`);
    }

    // 5. Certificación rigurosa de fondos efectivamente cobrados (FASE 3)
    // Para checkout_session: paymentStatus DEBE certificar 'paid'.
    // Para payment_intent: status DEBE ser 'succeeded' o 'paid'.
    const statusNorm = (eventData.status || '').toLowerCase();
    const paymentStatusNorm = (eventData.paymentStatus || '').toLowerCase();

    let isFundCollected = false;
    if (eventData.eventType.includes('payment') && (statusNorm === 'succeeded' || statusNorm === 'paid')) {
      isFundCollected = true;
    } else if (eventData.eventType.includes('checkout')) {
      if (paymentStatusNorm === 'paid') {
        isFundCollected = true;
      } else if (paymentStatusNorm !== 'unpaid' && (statusNorm === 'paid' || statusNorm === 'succeeded')) {
        isFundCollected = true;
      }
    }

    if (!isFundCollected) {
      throw new Error(`El evento ONVO ('${eventData.status}', paymentStatus: '${eventData.paymentStatus}') no demuestra un cobro efectivamente pagado (fondos no confirmados o retenidos).`);
    }

    // 6. Coincidencia estricta de empresa
    if (eventData.tenantId && eventData.tenantId !== tx.tenant_id) {
      throw new Error(`Discrepancia de empresa: el evento pertenece a ${eventData.tenantId} pero la transacción a ${tx.tenant_id}.`);
    }

    // 7. Coincidencia de plan y ciclo
    if (eventData.planCode && eventData.planCode !== tx.plan_code) {
      throw new Error(`Discrepancia de plan: esperado ${tx.plan_code}, recibido ${eventData.planCode}.`);
    }
    if (eventData.billingCycle && eventData.billingCycle !== tx.billing_cycle) {
      throw new Error(`Discrepancia de ciclo: esperado ${tx.billing_cycle}, recibido ${eventData.billingCycle}.`);
    }

    // 8. Coincidencia de importe y moneda
    if (eventData.amountInCents !== undefined && eventData.amountInCents !== null) {
      const txAmount = Number(tx.amount_crc ?? tx.amount_usd);
      const expectedCents = Math.round(txAmount * 100);
      const expectedWhole = Math.round(txAmount);
      const received = Number(eventData.amountInCents);
      if (received !== expectedCents && received !== expectedWhole) {
        throw new Error(`Discrepancia de importe: esperado ${expectedCents} (o ${expectedWhole}), recibido ${received}.`);
      }
    }
    if (eventData.currency) {
      if (tx.currency.toUpperCase() !== eventData.currency.toUpperCase()) {
        throw new Error(`Discrepancia de moneda: esperada ${tx.currency}, recibida ${eventData.currency}.`);
      }
    }

    // 9. Referencia externa de checkout verificable
    if (eventData.sessionId) {
      if (tx.checkout_session_id && tx.checkout_session_id !== eventData.sessionId) {
        throw new Error(`Referencia de checkout contradictoria: registrada ${tx.checkout_session_id}, recibida ${eventData.sessionId}.`);
      }
    }

    // 10. Referencia de cobro / Payment Intent verificable y único
    const paymentRef = eventData.paymentIntentId || eventData.sessionId;
    if (!paymentRef) {
      throw new Error('El evento de ONVO no incluye una referencia válida de cobro o sesión.');
    }

    if (eventData.paymentIntentId) {
      const duplicateIntent = await client.query(
        `SELECT id FROM payment_transactions WHERE payment_intent_id = $1 AND id <> $2`,
        [eventData.paymentIntentId, transactionId]
      );
      if (duplicateIntent.rowCount && duplicateIntent.rowCount > 0) {
        throw new Error(`El Payment Intent ${eventData.paymentIntentId} ya fue utilizado en otra transacción.`);
      }
    }

    // 11. Bloquear y validar suscripción de la empresa
    const subRes = await client.query(
      `SELECT *
       FROM subscriptions
       WHERE tenant_id = $1
       FOR UPDATE`,
      [tx.tenant_id]
    );

    if (subRes.rowCount !== 1) {
      throw new Error('No existe una suscripción válida para esta empresa.');
    }

    const sub = subRes.rows[0];

    const now = new Date();
    let inicio = now;
    if (sub.status === 'active' && sub.plan_code === tx.plan_code) {
      const actualFin = new Date(sub.current_period_end);
      if (actualFin > now) {
        inicio = actualFin;
      }
    }

    const dias = tx.billing_cycle === 'yearly' ? 365 : 30;
    const fin = new Date(inicio.getTime() + dias * 86400_000);

    const updateSubRes = await client.query(
      `UPDATE subscriptions
       SET plan_code = $2,
           status = 'active',
           billing_cycle = $3,
           current_period_start = $4,
           current_period_end = $5,
           next_billing_date = $5,
           provider = 'onvopay',
           cancel_at_period_end = FALSE,
           updated_at = NOW()
       WHERE id = $1 AND tenant_id = $6`,
      [sub.id, tx.plan_code, tx.billing_cycle, inicio, fin, tx.tenant_id]
    );

    if (updateSubRes.rowCount !== 1) {
      throw new Error('Fallo de integridad al actualizar la suscripción.');
    }

    // 12. Actualizar transacción de pago
    const updateTxRes = await client.query(
      `UPDATE payment_transactions
       SET status = 'paid',
           paid_at = NOW(),
           provider_reference = COALESCE($2, provider_reference),
           checkout_session_id = COALESCE(checkout_session_id, $3),
           payment_intent_id = COALESCE($4, payment_intent_id)
       WHERE id = $1 AND status = 'pending'`,
      [transactionId, paymentRef, eventData.sessionId || null, eventData.paymentIntentId || null]
    );

    if (updateTxRes.rowCount !== 1) {
      throw new Error('Fallo de integridad al confirmar el pago en la transacción.');
    }

    return {
      alreadyPaid: false,
      tenantId: tx.tenant_id,
      planCode: tx.plan_code,
      periodEnd: fin
    };
  });
}

export async function procesarWebhook(provider: string, body: any) {
  if (provider === 'stripe') {
    const type = body?.type;
    const obj = body?.data?.object;
    if (
      type === 'checkout.session.completed' &&
      obj?.metadata?.transaction_id &&
      obj?.payment_status === 'paid'
    ) {
      await completarPagoYActivarSuscripcion(
        obj.metadata.transaction_id,
        'stripe',
        obj.id,
        typeof obj.subscription === 'string' ? obj.subscription : undefined
      );
    } else if (type === 'invoice.payment_succeeded' && obj?.subscription) {
      await pool.query(
        `UPDATE subscriptions
         SET status = 'active',
             current_period_end = GREATEST(current_period_end, NOW()) + INTERVAL '30 days',
             next_billing_date = GREATEST(current_period_end, NOW()) + INTERVAL '30 days',
             updated_at = NOW()
         WHERE provider_subscription_id = $1`,
        [obj.subscription]
      );
    } else if (type === 'invoice.payment_failed' && obj?.subscription) {
      await pool.query(
        `UPDATE subscriptions SET status = 'past_due', updated_at = NOW() WHERE provider_subscription_id = $1`,
        [obj.subscription]
      );
    }
    return { received: true };
  }

  if (provider === 'onvopay') {
    const rawType = String(body?.type || body?.event || '');
    const normalizedType = rawType.replace(/_/g, '-').toLowerCase();

    // Eventos soportados para confirmación
    const isCheckoutSuccess = (
      normalizedType === 'checkout-session.succeeded' ||
      normalizedType === 'checkout-session-succeeded' ||
      normalizedType === 'checkout-session.completed' ||
      normalizedType === 'checkout-session-completed'
    );
    const isPaymentIntentSuccess = (normalizedType === 'payment-intent.succeeded' || normalizedType === 'payment-intent-succeeded');

    if (!isCheckoutSuccess && !isPaymentIntentSuccess) {
      if (normalizedType.includes('failed') || normalizedType.includes('canceled')) {
        const obj = body?.data?.object || body?.data || {};
        const txId = obj?.metadata?.transactionId || body?.metadata?.transactionId;
        if (txId) {
          await pool.query(
            `UPDATE payment_transactions SET status = 'failed', comprobante_notas = $2 WHERE id = $1 AND status = 'pending'`,
            [txId, `Evento ONVO de cancelación/fallo: ${rawType}`]
          );
        }
      }
      return { received: true, ignored: true, reason: `Evento no accionable: ${rawType}` };
    }

    const obj = body?.data?.object || body?.data || {};
    const metadata = obj?.metadata || body?.metadata || {};

    let transactionId = metadata.transactionId;
    let sessionId: string | undefined;
    let paymentIntentId: string | undefined;
    let status = String(obj.status || (isCheckoutSuccess ? 'completed' : 'succeeded')).toLowerCase();
    let paymentStatus = String(obj.paymentStatus || obj.payment_status || '').toLowerCase();
    let amountInCents: number | undefined;
    let currency: string | undefined = obj.currency || obj.lineItems?.[0]?.currency;

    if (isCheckoutSuccess) {
      sessionId = obj.id || body?.data?.id;
      paymentIntentId = obj.paymentIntent || obj.payment_intent || obj.paymentIntentId || undefined;
      amountInCents = obj.amountTotal ?? obj.amount_total ?? obj.amount ?? obj.lineItems?.[0]?.unitAmount;
      if (!paymentStatus && (status === 'paid' || status === 'succeeded')) {
        paymentStatus = 'paid';
      }
    } else if (isPaymentIntentSuccess) {
      paymentIntentId = obj.id || body?.data?.id;
      amountInCents = obj.amount;
      paymentStatus = (status === 'succeeded' || status === 'paid') ? 'paid' : paymentStatus;
    }

    // Búsqueda por checkout_session_id si no vino en metadata
    if (!transactionId && sessionId) {
      const lookup = await pool.query(
        `SELECT id FROM payment_transactions WHERE checkout_session_id = $1 LIMIT 1`,
        [sessionId]
      );
      if (lookup.rowCount) {
        transactionId = lookup.rows[0].id;
      }
    }

    // Búsqueda por payment_intent_id si no vino en metadata ni por sessionId
    if (!transactionId && paymentIntentId) {
      const lookup = await pool.query(
        `SELECT id FROM payment_transactions WHERE payment_intent_id = $1 LIMIT 1`,
        [paymentIntentId]
      );
      if (lookup.rowCount) {
        transactionId = lookup.rows[0].id;
      }
    }

    // Diferenciación de cobros recurrentes reales:
    // Si ONVO debita un ciclo recurrente en tarjeta para un tenant registrado,
    // se genera una transacción de renovación automática vinculada a su suscripción.
    if (!transactionId && metadata.tenantId && (paymentIntentId || sessionId)) {
      const subRes = await pool.query('SELECT * FROM subscriptions WHERE tenant_id = $1', [metadata.tenantId]);
      if (subRes.rowCount) {
        const sub = subRes.rows[0];
        const planCode = metadata.planCode || sub.plan_code;
        const cycle = (metadata.billingCycle || sub.billing_cycle || 'monthly') as 'monthly' | 'yearly';
        const planRes = await pool.query('SELECT * FROM plans WHERE code = $1', [planCode]);
        const plan = planRes.rows[0];
        const amountCrc = cycle === 'yearly' ? Number(plan?.precio_anual_crc || 0) : Number(plan?.precio_mensual_crc || 0);

        const newTxId = crypto.randomUUID();
        await pool.query(
          `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, amount_crc, currency, provider, status, checkout_session_id, payment_intent_id, comprobante_notas)
           VALUES ($1, $2, $3, $4, $5, $6, $6, 'CRC', 'onvopay', 'pending', $7, $8, $9)`,
          [newTxId, metadata.tenantId, sub.id, planCode, cycle, amountCrc, sessionId || null, paymentIntentId || null, 'Renovación automática recurrente ONVO']
        );
        transactionId = newTxId;
      }
    }

    if (!transactionId) {
      console.warn('[ONVO WEBHOOK] Evento recibido sin transactionId identificable.');
      return { received: true, ignored: true, error: 'transactionId no identificado' };
    }

    // FASE 3: Si es una sesión de checkout y paymentStatus no indica 'paid' (por ejemplo está en 'unpaid' o ausente),
    // consultar la API oficial de ONVO para verificar si los fondos están efectivamente cobrados antes de activar.
    if (isCheckoutSuccess && paymentStatus !== 'paid' && status !== 'paid' && status !== 'succeeded') {
      const gateways = await getGatewaysConfig();
      if (gateways.onvopay.secretKey && sessionId) {
        try {
          const verifyRes = await fetch(`https://api.onvopay.com/v1/checkout/sessions/${sessionId}`, {
            headers: { Authorization: `Bearer ${gateways.onvopay.secretKey}` }
          });
          if (verifyRes.ok) {
            const sessionData: any = await verifyRes.json();
            status = String(sessionData.status || status).toLowerCase();
            paymentStatus = String(sessionData.paymentStatus || sessionData.payment_status || paymentStatus).toLowerCase();
            paymentIntentId = sessionData.paymentIntent || sessionData.payment_intent || paymentIntentId;
          }
        } catch (fetchErr: any) {
          console.warn('[ONVO WEBHOOK] Error consultando API ONVO para verificación de sesión:', fetchErr.message);
        }
      }
    }

    const result = await confirmarPagoOnvo(transactionId, {
      eventType: rawType,
      sessionId,
      paymentIntentId,
      status,
      paymentStatus,
      tenantId: metadata.tenantId,
      planCode: metadata.planCode,
      billingCycle: metadata.billingCycle,
      amountInCents: amountInCents !== undefined ? Number(amountInCents) : undefined,
      currency
    });

    return { received: true, ...result };
  }

  if (provider === 'tilopay') {
    const txId = body?.orderNumber || body?.order;
    if (txId && (body?.code === '1' || body?.status === 'approved')) {
      await completarPagoYActivarSuscripcion(txId, 'tilopay', body?.tpt || body?.auth);
    }
    return { received: true };
  }

  return { received: true };
}

// FASE 4: Conciliación activa de transacciones pendientes inciertas
export async function conciliarTransaccionesOnvoPendientes() {
  const gateways = await getGatewaysConfig();
  if (!gateways.onvopay.secretKey) {
    return { reconciled: 0, reason: 'ONVO secretKey no configurada' };
  }

  // Buscar transacciones ONVO pendientes con antigüedad entre 15 minutos y 24 horas
  const pendingTxRes = await pool.query(
    `SELECT id, checkout_session_id, tenant_id, plan_code, billing_cycle, amount_usd, currency, created_at
     FROM payment_transactions
     WHERE provider = 'onvopay' AND status = 'pending'
       AND created_at < NOW() - INTERVAL '15 minutes'
       AND created_at > NOW() - INTERVAL '24 hours'
     ORDER BY created_at ASC LIMIT 50`
  );

  let reconciledCount = 0;
  for (const tx of pendingTxRes.rows) {
    if (tx.checkout_session_id) {
      try {
        const res = await fetch(`https://api.onvopay.com/v1/checkout/sessions/${tx.checkout_session_id}`, {
          headers: { Authorization: `Bearer ${gateways.onvopay.secretKey}` }
        });
        if (res.ok) {
          const session: any = await res.json();
          const paymentStatus = String(session.paymentStatus || session.payment_status || '').toLowerCase();
          const sessionStatus = String(session.status || '').toLowerCase();

          if (paymentStatus === 'paid' || sessionStatus === 'paid' || sessionStatus === 'succeeded') {
            await confirmarPagoOnvo(tx.id, {
              eventType: 'checkout_session.reconciliation',
              sessionId: tx.checkout_session_id,
              paymentIntentId: session.paymentIntent || session.payment_intent || session.paymentIntentId,
              status: sessionStatus || 'completed',
              paymentStatus: 'paid',
              tenantId: tx.tenant_id,
              planCode: tx.plan_code,
              billingCycle: tx.billing_cycle,
              amountInCents: Math.round(Number(tx.amount_usd) * 100),
              currency: tx.currency
            });
            reconciledCount++;
          } else if (sessionStatus === 'expired') {
            await pool.query(
              `UPDATE payment_transactions SET status = 'failed', comprobante_notas = 'Sesión ONVO expirada sin pago durante conciliación' WHERE id = $1 AND status = 'pending'`,
              [tx.id]
            );
          }
        }
      } catch (err: any) {
        console.warn(`[RECONCILIACIÓN ONVO] Error consultando sesión ${tx.checkout_session_id}:`, err.message);
      }
    } else {
      // Sin sesión externa y con más de 1 hora de antigüedad: descartar
      const ageMinutes = (Date.now() - new Date(tx.created_at).getTime()) / 60000;
      if (ageMinutes > 60) {
        await pool.query(
          `UPDATE payment_transactions SET status = 'failed', comprobante_notas = 'Sesión ONVO nunca establecida; cerrada por tiempo límite' WHERE id = $1 AND status = 'pending'`,
          [tx.id]
        );
      }
    }
  }

  return { reconciled: reconciledCount, evaluated: pendingTxRes.rowCount };
}

// FUNCIONES SUPERADMIN SAAS
export async function getSuperAdminDashboard() {
  await verificarVencimientosSuscripciones();

  const [tenantsRes, pagosPendRes, mrrRes, planes] = await Promise.all([
    pool.query(
      `SELECT t.id, t.nombre, t.slug, t.cedula, t.activo, t.created_at,
              s.plan_code, s.status, s.billing_cycle, s.current_period_end, s.provider,
              p.nombre AS plan_nombre,
              (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id) AS total_usuarios,
              (SELECT COUNT(*)::int FROM comprobantes c WHERE c.tenant_id = t.id AND c.fecha >= date_trunc('month', NOW())) AS comprobantes_mes,
              (SELECT email FROM users u WHERE u.tenant_id = t.id ORDER BY created_at ASC LIMIT 1) AS email_principal
       FROM tenants t
       LEFT JOIN subscriptions s ON s.tenant_id = t.id
       LEFT JOIN plans p ON p.code = s.plan_code
       ORDER BY t.created_at DESC`
    ),
    pool.query(
      `SELECT pt.*, t.nombre AS tenant_nombre, t.cedula AS tenant_cedula, p.nombre AS plan_nombre
       FROM payment_transactions pt
       JOIN tenants t ON t.id = pt.tenant_id
       JOIN plans p ON p.code = pt.plan_code
       WHERE pt.status = 'pending' AND pt.provider = 'manual_sinpe'
       ORDER BY pt.created_at DESC`
    ),
    pool.query(
      `SELECT COALESCE(SUM(CASE WHEN s.billing_cycle = 'yearly' THEN p.precio_anual_crc / 12.0 ELSE p.precio_mensual_crc END), 0) AS mrr_crc,
              COALESCE(SUM(CASE WHEN s.billing_cycle = 'yearly' THEN p.precio_anual_usd / 12.0 ELSE p.precio_mensual_usd END), 0) AS mrr_usd
       FROM subscriptions s
       JOIN plans p ON p.code = s.plan_code
       WHERE s.status = 'active' AND s.provider <> 'owner'`
    ),
    listarPlanes()
  ]);

  const gateways = await getGatewaysConfig();
  const mrrCrcVal = Math.round(Number(mrrRes.rows[0]?.mrr_crc || 0));
  return {
    kpis: {
      totalTenants: tenantsRes.rowCount || 0,
      suscripcionesActivas: tenantsRes.rows.filter(r => r.status === 'active').length,
      mrrCrc: mrrCrcVal,
      mrrCrcFormatted: formatCRC(mrrCrcVal),
      mrrUsd: Number(Number(mrrRes.rows[0]?.mrr_usd || 0).toFixed(2)),
      pagosPendientes: pagosPendRes.rowCount || 0
    },
    tenants: tenantsRes.rows,
    pagosPendientes: pagosPendRes.rows,
    planes,
    gateways
  };
}

export async function asignarPlanManual(
  tenantId: string,
  planCode: string,
  dias: number = 30,
  status: 'active' | 'trialing' | 'past_due' | 'suspended' = 'active'
) {
  const fin = new Date(Date.now() + Math.max(1, Number(dias) || 30) * 86400_000);
  await pool.query(
    `UPDATE subscriptions
     SET plan_code = $2, status = $3, current_period_start = NOW(), current_period_end = $4, next_billing_date = $4, updated_at = NOW()
     WHERE tenant_id = $1`,
    [tenantId, planCode, status, fin]
  );
}

export async function aprobarPagoManual(txId: string, adminInfo?: { userId?: string; email?: string }) {
  const result = await completarPagoYActivarSuscripcion(txId, 'manual_sinpe');
  if (adminInfo && !result.alreadyPaid) {
    const auditMsg = `[AUDITORÍA] Pago aprobado por administrador: ${adminInfo.email || adminInfo.userId || 'superadmin'} (${new Date().toISOString()})`;
    await pool.query(
      `UPDATE payment_transactions
       SET comprobante_notas = CASE 
         WHEN comprobante_notas IS NULL OR comprobante_notas = '' THEN $2
         ELSE comprobante_notas || ' | ' || $2
       END
       WHERE id = $1`,
      [txId, auditMsg]
    );
  }
  return result;
}

export async function rechazarPagoManual(txId: string, motivo?: string, adminInfo?: { userId?: string; email?: string }) {
  const auditMsg = `[AUDITORÍA] Pago rechazado por admin ${adminInfo?.email || adminInfo?.userId || 'superadmin'}: ${motivo || 'Sin motivo especificado'}`;
  await pool.query(
    `UPDATE payment_transactions
     SET status = 'failed',
         comprobante_notas = CASE 
           WHEN comprobante_notas IS NULL OR comprobante_notas = '' THEN $2
           ELSE comprobante_notas || ' | ' || $2
         END
     WHERE id = $1 AND status = 'pending'`,
    [txId, auditMsg]
  );
}

export async function actualizarEstadoTenant(tenantId: string, activo: boolean) {
  const adminCheck = await pool.query("SELECT 1 FROM users WHERE tenant_id = $1 AND role = 'superadmin' LIMIT 1", [tenantId]);
  if (adminCheck.rowCount && !activo) {
    throw new Error('No se puede desactivar el tenant propietario SuperAdmin.');
  }
  await pool.query('UPDATE tenants SET activo = $2 WHERE id = $1', [tenantId, activo]);
}
