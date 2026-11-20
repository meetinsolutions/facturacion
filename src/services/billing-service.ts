import * as crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { pool, withTransaction } from '../db/pool.js';
import { pgDataStore } from './pg-data-store.js';

export interface PlanRecord {
  code: string;
  nombre: string;
  descripcion: string;
  precio_mensual_usd: number;
  precio_anual_usd: number;
  limite_comprobantes_mes: number;
  limite_usuarios: number;
  permite_imap_gastos: boolean;
  permite_envio_correo: boolean;
  activo: boolean;
  orden: number;
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
    tipoCambioUsd: number;
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
    tipoCambioUsd: 510
  }
};

function mapPlan(row: any): PlanRecord {
  return {
    code: row.code,
    nombre: row.nombre,
    descripcion: row.descripcion,
    precio_mensual_usd: Number(row.precio_mensual_usd),
    precio_anual_usd: Number(row.precio_anual_usd),
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
  if (!stored) return DEFAULT_GATEWAYS;
  return {
    pasarelaActiva: stored.pasarelaActiva || 'sandbox',
    onvopay: { ...DEFAULT_GATEWAYS.onvopay, ...(stored.onvopay || {}) },
    tilopay: { ...DEFAULT_GATEWAYS.tilopay, ...(stored.tilopay || {}) },
    stripe: { ...DEFAULT_GATEWAYS.stripe, ...(stored.stripe || {}) },
    sinpe: { ...DEFAULT_GATEWAYS.sinpe, ...(stored.sinpe || {}) }
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
            p.precio_mensual_usd, p.precio_anual_usd, p.limite_comprobantes_mes,
            p.limite_usuarios, p.permite_imap_gastos, p.permite_envio_correo, p.orden
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
      precio_mensual_usd: Number(row.precio_mensual_usd),
      precio_anual_usd: Number(row.precio_anual_usd),
      limite_comprobantes_mes: Number(row.limite_comprobantes_mes),
      limite_usuarios: Number(row.limite_usuarios),
      permite_imap_gastos: Boolean(row.permite_imap_gastos),
      permite_envio_correo: Boolean(row.permite_envio_correo)
    },
    usoMesActual,
    usuariosActivos: Number(usersRes.rows[0]?.total || 0),
    pasarelaActiva: gateways.pasarelaActiva,
    sinpeInfo: gateways.sinpe,
    pagos: pagosRes.rows.map(p => ({
      id: p.id,
      planCode: p.plan_code,
      billingCycle: p.billing_cycle,
      amountUsd: Number(p.amount_usd),
      currency: p.currency,
      provider: p.provider,
      providerReference: p.provider_reference,
      status: p.status,
      notas: p.comprobante_notas,
      createdAt: p.created_at,
      paidAt: p.paid_at
    }))
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

const ONVO_DIRECT_LINKS: Record<string, { monthly: string; yearly: string }> = {
  emprendedor: {
    monthly: 'https://buy.onvopay.com/test_pC5GcXnzWE_dpFkf_sn-TeVb3rc',
    yearly: 'https://buy.onvopay.com/test_Cr8_67VpCxoK70do1_k_QW1unfc'
  },
  pro: {
    monthly: 'https://buy.onvopay.com/test_6VzVdGxPh2TIawOt39IjUVjZcYA',
    yearly: 'https://buy.onvopay.com/test_jQyRWv_oM8LPxmu_8ghFWrQ_FXE'
  },
  profesional: {
    monthly: 'https://buy.onvopay.com/test_6VzVdGxPh2TIawOt39IjUVjZcYA',
    yearly: 'https://buy.onvopay.com/test_jQyRWv_oM8LPxmu_8ghFWrQ_FXE'
  },
  empresarial: {
    monthly: 'https://buy.onvopay.com/test_Fo5VyQvXf4p2KhE0f5yUX7aDhh8',
    yearly: 'https://buy.onvopay.com/test_UVtR8I-9TQH-zxIYZlrh5B7m1ZM'
  }
};

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
  const amountUsd = billingCycle === 'yearly' ? plan.precio_anual_usd : plan.precio_mensual_usd;

  const subRes = await pool.query('SELECT id FROM subscriptions WHERE tenant_id = $1', [tenantId]);
  const subscriptionId = subRes.rows[0]?.id || null;

  const gateways = await getGatewaysConfig();
  const requested = providerOverride || gateways.pasarelaActiva || 'sandbox';
  let provider = requested;

  // Si se solicita Onvo Pay y existe enlace directo de checkout, utilizarlo inmediatamente
  const onvoDirectUrl = ONVO_DIRECT_LINKS[plan.code]?.[billingCycle];
  if ((provider === 'onvopay' || provider === 'sandbox') && onvoDirectUrl && providerOverride === 'onvopay') {
    const txId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, status, provider_reference)
       VALUES ($1, $2, $3, $4, $5, $6, 'USD', 'onvopay', 'pending', $7)`,
      [txId, tenantId, subscriptionId, plan.code, billingCycle, amountUsd, onvoDirectUrl]
    );
    return {
      mode: 'redirect',
      provider: 'onvopay',
      transactionId: txId,
      checkoutUrl: onvoDirectUrl,
      amountUsd,
      planNombre: plan.nombre,
      billingCycle
    };
  }

  if (provider === 'stripe' && !gateways.stripe.secretKey) provider = 'sandbox';
  if (provider === 'onvopay' && !gateways.onvopay.secretKey) provider = 'sandbox';
  if (provider === 'tilopay' && (!gateways.tilopay.apiKey || !gateways.tilopay.apiUser)) provider = 'sandbox';

  const txId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'USD', $7, 'pending')`,
    [txId, tenantId, subscriptionId, plan.code, billingCycle, amountUsd, provider]
  );

  const appUrl = (process.env.PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

  if (provider === 'stripe' && gateways.stripe.secretKey) {
    const body = new URLSearchParams({
      mode: 'subscription',
      success_url: `${appUrl}/?billing=success&tx=${txId}`,
      cancel_url: `${appUrl}/?billing=cancel&tx=${txId}`,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(Math.round(amountUsd * 100)),
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
      amountUsd,
      planNombre: plan.nombre,
      billingCycle
    };
  }

  if (provider === 'onvopay' && gateways.onvopay.secretKey) {
    const onvoRes = await fetch('https://api.onvopay.com/v1/payment-intents', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${gateways.onvopay.secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: Math.round(amountUsd * 100),
        currency: 'USD',
        description: `${plan.nombre} (${billingCycle === 'yearly' ? 'Anual' : 'Mensual'})`,
        metadata: { transactionId: txId, tenantId, planCode: plan.code, billingCycle }
      })
    });
    const onvoJson: any = await onvoRes.json();
    if (!onvoRes.ok) {
      throw new Error(onvoJson?.message || 'Error creando cobro en Onvo Pay.');
    }
    await pool.query('UPDATE payment_transactions SET provider_reference = $2 WHERE id = $1', [txId, onvoJson.id || null]);
    return {
      mode: onvoJson.checkoutUrl ? 'redirect' : 'onvopay_intent',
      provider: 'onvopay',
      transactionId: txId,
      checkoutUrl: onvoJson.checkoutUrl || onvoJson.url || null,
      clientSecret: onvoJson.clientSecret || null,
      publicKey: gateways.onvopay.publicKey,
      amountUsd,
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
        amount: amountUsd.toFixed(2),
        currency: 'USD',
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
      amountUsd,
      planNombre: plan.nombre,
      billingCycle
    };
  }

  return {
    mode: 'sandbox',
    provider: 'sandbox',
    transactionId: txId,
    amountUsd,
    planNombre: plan.nombre,
    billingCycle
  };
}

export async function completarPagoYActivarSuscripcion(
  transactionId: string,
  providerReference?: string,
  providerSubscriptionId?: string
) {
  return await withTransaction(async (client) => {
    const txRes = await client.query('SELECT * FROM payment_transactions WHERE id = $1 FOR UPDATE', [transactionId]);
    if (!txRes.rowCount) {
      throw new Error('Transacción de pago no encontrada.');
    }
    const tx = txRes.rows[0];
    if (tx.status === 'paid') {
      return { alreadyPaid: true, tenantId: tx.tenant_id };
    }

    await client.query(
      `UPDATE payment_transactions
       SET status = 'paid',
           paid_at = NOW(),
           provider_reference = COALESCE($2, provider_reference)
       WHERE id = $1`,
      [transactionId, providerReference || null]
    );

    const dias = tx.billing_cycle === 'yearly' ? 365 : 30;
    const subRes = await client.query('SELECT * FROM subscriptions WHERE tenant_id = $1 FOR UPDATE', [tx.tenant_id]);
    const now = new Date();
    let inicio = now;
    if (subRes.rowCount && subRes.rows[0].status === 'active' && subRes.rows[0].plan_code === tx.plan_code) {
      const actualFin = new Date(subRes.rows[0].current_period_end);
      if (actualFin > now) inicio = actualFin;
    }
    const fin = new Date(inicio.getTime() + dias * 86400_000);

    await client.query(
      `UPDATE subscriptions
       SET plan_code = $2,
           status = 'active',
           billing_cycle = $3,
           current_period_start = $4,
           current_period_end = $5,
           next_billing_date = $5,
           provider = $6,
           provider_subscription_id = COALESCE($7, provider_subscription_id),
           cancel_at_period_end = FALSE,
           updated_at = NOW()
       WHERE tenant_id = $1`,
      [tx.tenant_id, tx.plan_code, tx.billing_cycle, now, fin, tx.provider, providerSubscriptionId || null]
    );

    return { alreadyPaid: false, tenantId: tx.tenant_id, planCode: tx.plan_code, periodEnd: fin };
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

  const plan = mapPlan(planRes.rows[0]);
  const amountUsd = input.billingCycle === 'yearly' ? plan.precio_anual_usd : plan.precio_mensual_usd;
  const subRes = await pool.query('SELECT id FROM subscriptions WHERE tenant_id = $1', [tenantId]);
  const txId = crypto.randomUUID();

  await pool.query(
    `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, currency, provider, provider_reference, status, comprobante_notas)
     VALUES ($1, $2, $3, $4, $5, $6, 'USD', 'manual_sinpe', $7, 'pending', $8)`,
    [txId, tenantId, subRes.rows[0]?.id || null, plan.code, input.billingCycle, amountUsd, referencia, (input.notas || '').trim() || null]
  );

  return { id: txId, status: 'pending', amountUsd, referencia };
}

export async function procesarWebhook(provider: string, body: any) {
  if (provider === 'stripe') {
    const type = body?.type;
    const obj = body?.data?.object;
    if (type === 'checkout.session.completed' && obj?.metadata?.transaction_id) {
      await completarPagoYActivarSuscripcion(
        obj.metadata.transaction_id,
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
    const txId = body?.data?.metadata?.transactionId || body?.metadata?.transactionId;
    const event = body?.type || body?.event;
    if (txId && (event === 'payment-intent.succeeded' || body?.status === 'succeeded')) {
      await completarPagoYActivarSuscripcion(txId, body?.data?.id || body?.id);
    }
    return { received: true };
  }

  if (provider === 'tilopay') {
    const txId = body?.orderNumber || body?.order;
    if (txId && (body?.code === '1' || body?.status === 'approved')) {
      await completarPagoYActivarSuscripcion(txId, body?.tpt || body?.auth);
    }
    return { received: true };
  }

  return { received: true };
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
      `SELECT COALESCE(SUM(CASE WHEN s.billing_cycle = 'yearly' THEN p.precio_anual_usd / 12.0 ELSE p.precio_mensual_usd END), 0) AS mrr
       FROM subscriptions s
       JOIN plans p ON p.code = s.plan_code
       WHERE s.status = 'active' AND s.provider <> 'owner'`
    ),
    listarPlanes()
  ]);

  const gateways = await getGatewaysConfig();
  return {
    kpis: {
      totalTenants: tenantsRes.rowCount || 0,
      suscripcionesActivas: tenantsRes.rows.filter(r => r.status === 'active').length,
      mrrUsd: Number(Number(mrrRes.rows[0]?.mrr || 0).toFixed(2)),
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

export async function aprobarPagoManual(txId: string) {
  return await completarPagoYActivarSuscripcion(txId);
}

export async function rechazarPagoManual(txId: string, motivo?: string) {
  await pool.query(
    `UPDATE payment_transactions
     SET status = 'failed', comprobante_notas = COALESCE($2, comprobante_notas)
     WHERE id = $1`,
    [txId, motivo || null]
  );
}

export async function actualizarEstadoTenant(tenantId: string, activo: boolean) {
  const adminCheck = await pool.query("SELECT 1 FROM users WHERE tenant_id = $1 AND role = 'superadmin' LIMIT 1", [tenantId]);
  if (adminCheck.rowCount && !activo) {
    throw new Error('No se puede desactivar el tenant propietario SuperAdmin.');
  }
  await pool.query('UPDATE tenants SET activo = $2 WHERE id = $1', [tenantId, activo]);
}
