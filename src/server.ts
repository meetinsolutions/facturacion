import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import dotenv from 'dotenv';
import { MotorFacturacion } from './index.js';
import {
  ComprobanteElectronico,
  CondicionVenta,
  LineaDetalleVenta,
  MedioPago,
  ResumenFactura,
  TarifaIVA,
  TipoDocumento,
  TipoIdentificacion
} from './types/factura.types.js';
import { ConfiguracionSistema, ComprobanteGuardado } from './services/data-store.js';
import { pgDataStore } from './services/pg-data-store.js';
import {
  generarFacturaEleganteHTML,
  EstiloFactura,
  ESTILOS_FACTURA_VALIDOS,
  PLANTILLAS_FACTURA_PRESETS,
  resolverDisenoFactura
} from './services/factura-renderer.js';
import { generarFacturaPDFBuffer } from './services/pdf-generator.js';
import { enviarComprobantePorCorreo, probarConexionCorreo } from './services/email-service.js';
import { parsearFacturaXMLCostaRica } from './services/xml-expense-parser.js';
import { generarReporteGastosHTML } from './services/reporte-gastos-renderer.js';
import { probarConexionIMAP, sincronizarGastosDesdeCorreo, normalizarCedula } from './services/imap-expense-sync.js';
import { ensureSshTunnelIfEnabled } from './db/ssh-tunnel.js';
import { pool } from './db/pool.js';
import { initDatabaseSchema } from './db/schema.js';
import { migrarDatosJsonSiEsNecesario } from './db/migrate-json-to-pg.js';
import {
  requireAuth,
  requireAdmin,
  requireSuperAdmin,
  setAuthCookie,
  clearAuthCookie,
  AUTH_COOKIE_NAME,
  registrarTenantYAdmin,
  autenticarUsuario,
  cambiarContrasena,
  listarUsuariosTenant,
  crearUsuarioTenant,
  actualizarUsuarioTenant,
  eliminarUsuarioTenant
} from './services/auth-service.js';
import {
  listarPlanes,
  getEstadoSuscripcion,
  requireActiveSubscription,
  requireQuotaComprobantes,
  requireFeatureImap,
  iniciarCheckoutRecurrente,
  completarPagoYActivarSuscripcion,
  reportarPagoSinpe,
  procesarWebhook,
  getSuperAdminDashboard,
  asignarPlanManual,
  aprobarPagoManual,
  rechazarPagoManual,
  actualizarEstadoTenant,
  saveGatewaysConfig,
  getGatewaysConfig,
  isSandboxPermitted,
  verificarVencimientosSuscripciones
} from './services/billing-service.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

app.use(cors({ origin: true, credentials: true }));
// Permitir payloads Base64 para logos y certificados de hasta 15MB, guardando rawBody para firmas de webhooks
app.use(express.json({
  limit: '15mb',
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString('utf-8');
  }
}));
app.use(express.urlencoded({ limit: '15mb', extended: true }));
app.use(cookieParser());

// Evitar caché obsoleto en archivos HTML del navegador
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// Enlaces oficiales directos de Onvo Pay para planes
export const ONVO_CHECKOUT_LINKS: Record<string, { monthly: string; yearly: string }> = {
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

// Rutas amigables para Landing Page y Aplicación SaaS
app.get(['/landing', '/precios', '/planes'], (req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), 'public', 'landing.html'));
});

app.get('/app', (req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// Raíz: si el usuario ya tiene sesión activa o solicita la app, va al dashboard; si no, ve la Landing Page
app.get('/', (req: Request, res: Response, next: NextFunction) => {
  if (req.cookies?.[AUTH_COOKIE_NAME] || req.query.app === '1') {
    return res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
  }
  res.sendFile(path.join(process.cwd(), 'public', 'landing.html'));
});

// Servir la interfaz estática
app.use(express.static(path.join(process.cwd(), 'public')));

// Certificado de pruebas (solo para firma local/simulación cuando el tenant aún no sube su .p12)
const certPathPruebas = path.resolve(process.env.CERTIFICADO_PATH || './certs/test-cert.p12');
const certPinPruebas = process.env.CERTIFICADO_PIN || '1234';

/**
 * Crea un motor de facturación aislado por tenant con su propio certificado y credenciales de Hacienda.
 */
async function crearMotorParaTenant(
  tenantId: string,
  config: ConfiguracionSistema
): Promise<{ motor: MotorFacturacion; certificadoPropio: boolean }> {
  const motor = new MotorFacturacion();
  const cert = await pgDataStore.getCertificadoP12(tenantId);
  let certificadoPropio = false;
  if (cert) {
    motor.configurarCertificado(cert.buffer, cert.pin);
    certificadoPropio = true;
  } else if (fs.existsSync(certPathPruebas)) {
    motor.configurarCertificado(certPathPruebas, certPinPruebas);
  } else {
    throw new Error('Debe subir su certificado de firma digital (.p12) en Configuración > Hacienda.');
  }

  const user = config.hacienda?.usuario;
  const pass = config.hacienda?.password;
  if (user && pass) {
    motor.configurarHacienda(user, pass, config.hacienda?.entorno || 'staging');
  }
  return { motor, certificadoPropio };
}

function tid(req: Request): string {
  return req.auth!.tenantId;
}

// Handler async seguro para Express 4
const ah = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch((err: any) => {
      console.error('[API Error]', err?.message || err);
      if (!res.headersSent) res.status(500).json({ success: false, error: err?.message || 'Error interno' });
    });
  };

function mapCodigoTarifaIVA(tarifa: number): TarifaIVA {
  switch (tarifa) {
    case 0:
      return '01';
    case 1:
      return '02';
    case 2:
      return '03';
    case 4:
      return '04';
    case 8:
      return '07';
    default:
      return '08';
  }
}

function construirComprobanteDesdePayload(body: any, config: ConfiguracionSistema): ComprobanteElectronico {
  const tipoDocumento = (body.tipoDocumento || '01') as TipoDocumento;
  const condicionVenta = (body.condicionVenta || '01') as CondicionVenta;
  const plazoCredito = body.plazoCredito ? String(body.plazoCredito) : undefined;
  const mediosPago: MedioPago[] =
    Array.isArray(body.mediosPago) && body.mediosPago.length > 0
      ? body.mediosPago
      : [(body.medioPago || '01') as MedioPago];

  const items = Array.isArray(body.items) ? body.items : [];
  const moneda = (body.moneda || config.sitio?.moneda || 'CRC') as 'CRC' | 'USD' | 'EUR';
  const tipoCambio = moneda !== 'CRC' ? Number(body.tipoCambio) || Number(config.sitio?.tipoCambioDefault) || 510 : undefined;

  let totalMercanciasGravadas = 0;
  let totalMercanciasExentas = 0;
  let totalServiciosGravados = 0;
  let totalServiciosExentos = 0;
  let totalDescuentos = 0;
  let totalImpuestos = 0;
  let totalVenta = 0;

  const lineasCalculadas: LineaDetalleVenta[] = items.map((it: any, index: number) => {
    const cantidad = Number(it.cantidad) || 1;
    const precioUnitario = Number(it.precioUnitario) || 0;
    const montoTotal = cantidad * precioUnitario;

    const montoDescuento =
      it.montoDescuento !== undefined
        ? Number(it.montoDescuento) || 0
        : (montoTotal * (Number(it.descuentoPorcentaje) || 0)) / 100;

    const subTotal = Math.max(0, montoTotal - montoDescuento);
    const tarifaIVA = it.tarifaIVA !== undefined ? Number(it.tarifaIVA) : 13;
    const montoIVA = (subTotal * tarifaIVA) / 100;
    const totalLinea = subTotal + montoIVA;

    totalVenta += montoTotal;
    totalDescuentos += montoDescuento;
    totalImpuestos += montoIVA;

    if (it.unidadMedida === 'Sp') {
      if (tarifaIVA > 0) totalServiciosGravados += montoTotal;
      else totalServiciosExentos += montoTotal;
    } else {
      if (tarifaIVA > 0) totalMercanciasGravadas += montoTotal;
      else totalMercanciasExentas += montoTotal;
    }

    return {
      numeroLinea: index + 1,
      codigoCabys: it.codigoCabys || '2399901000100',
      codigoInterno: it.codigoInterno,
      cantidad,
      unidadMedida: it.unidadMedida || 'Unid',
      detalle: it.detalle || 'Producto / Servicio',
      precioUnitario,
      montoTotal,
      montoDescuento: montoDescuento > 0 ? montoDescuento : undefined,
      naturalezaDescuento:
        montoDescuento > 0
          ? it.naturalezaDescuento || (it.descuentoPorcentaje ? `Descuento ${it.descuentoPorcentaje}%` : 'Descuento comercial')
          : undefined,
      subTotal,
      codigoImpuesto: '01',
      codigoTarifaIVA: (it.codigoTarifaIVA || mapCodigoTarifaIVA(tarifaIVA)) as TarifaIVA,
      tarifaIVA,
      montoIVA,
      montoTotalLinea: totalLinea
    };
  });

  const totalVentaNeta = Math.max(0, totalVenta - totalDescuentos);

  const resumen: ResumenFactura = {
    codigoMoneda: moneda,
    tipoCambio,
    totalServiciosGravados,
    totalServiciosExentos,
    totalMercanciasGravadas,
    totalMercanciasExentas,
    totalGravado: totalMercanciasGravadas + totalServiciosGravados,
    totalExento: totalMercanciasExentas + totalServiciosExentos,
    totalVenta,
    totalDescuentos,
    totalVentaNeta,
    totalImpuesto: totalImpuestos,
    totalComprobante: totalVentaNeta + totalImpuestos
  };

  const cliente = body.cliente;
  const cedulaReceptor = cliente?.cedula ? String(cliente.cedula).replace(/[\s-]+/g, '') : '';
  const tieneCliente = Boolean(cliente && (cliente.nombre || cedulaReceptor || cliente.correo));

  return {
    fechaEmision: new Date(),
    tipoDocumento,
    condicionVenta,
    plazoCredito: condicionVenta === '02' ? plazoCredito || '30' : undefined,
    mediosPago,
    emisor: {
      nombre: config.emisor.nombre,
      identificacion: {
        tipo: config.emisor.tipoIdentificacion,
        numero: config.emisor.cedula
      },
      nombreComercial: config.emisor.nombreComercial,
      actividadEconomica: config.emisor.actividadEconomica,
      sucursal: Number(config.emisor.sucursal) || 1,
      terminal: Number(config.emisor.terminal) || 1,
      ubicacion: {
        provincia: '1',
        canton: '01',
        distrito: '01',
        senas: config.emisor.direccion
      },
      telefono: {
        codigoPais: '506',
        numero: config.emisor.telefono
      },
      correo: config.emisor.correo,
      entorno: config.hacienda.entorno
    },
    receptor: tieneCliente
      ? {
          nombre: cliente.nombre || 'Cliente',
          nombreComercial: cliente.nombreComercial || undefined,
          identificacion: cedulaReceptor
            ? {
                tipo: (cliente.tipoIdentificacion || '01') as TipoIdentificacion,
                numero: cedulaReceptor
              }
            : undefined,
          ubicacion: cliente.direccion
            ? {
                provincia: '1',
                canton: '01',
                distrito: '01',
                senas: cliente.direccion
              }
            : undefined,
          telefono: cliente.telefono
            ? {
                codigoPais: '506',
                numero: cliente.telefono
              }
            : undefined,
          correo: cliente.correo || undefined
        }
      : undefined,
    lineas: lineasCalculadas,
    resumen
  };
}

// ==========================================
// AUTENTICACIÓN (PÚBLICO)
// ==========================================

app.post('/api/auth/register', ah(async (req, res) => {
  try {
    const { nombreEmpresa, cedula, nombreUsuario, email, password } = req.body || {};
    const { token, auth } = await registrarTenantYAdmin({ nombreEmpresa, cedula, nombreUsuario, email, password });
    setAuthCookie(res, token);
    res.json({ success: true, data: { user: auth } });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
}));

app.post('/api/auth/login', ah(async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const { token, auth } = await autenticarUsuario(String(email || ''), String(password || ''));
    setAuthCookie(res, token);
    res.json({ success: true, data: { user: auth } });
  } catch (err: any) {
    res.status(401).json({ success: false, error: err.message });
  }
}));

app.post('/api/auth/logout', (req: Request, res: Response) => {
  clearAuthCookie(res);
  res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, ah(async (req, res) => {
  const [suscripcion, tenantRes] = await Promise.all([
    getEstadoSuscripcion(tid(req)),
    pool.query('SELECT id, nombre, cedula, slug, activo FROM tenants WHERE id = $1', [tid(req)])
  ]);
  res.json({ success: true, data: { user: req.auth, tenant: tenantRes.rows[0] || null, suscripcion } });
}));

app.post('/api/auth/cambiar-password', requireAuth, ah(async (req, res) => {
  try {
    await cambiarContrasena(req.auth!.userId, String(req.body?.actual || ''), String(req.body?.nueva || ''));
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
}));

// ==========================================
// PLANES Y WEBHOOKS (PÚBLICO)
// ==========================================

app.get('/api/planes', ah(async (req, res) => {
  const [planes, gateways] = await Promise.all([listarPlanes(), getGatewaysConfig()]);
  res.json({
    success: true,
    data: planes,
    sinpe: gateways.sinpe,
    pasarelaActiva: gateways.pasarelaActiva,
    onvoLinks: ONVO_CHECKOUT_LINKS
  });
}));

function safeCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function esTimestampValido(tsRaw: string | number, maxDiffSegundos = 300): boolean {
  if (!tsRaw) return false;
  const tsNum = typeof tsRaw === 'number' ? tsRaw : parseInt(String(tsRaw), 10);
  if (isNaN(tsNum) || tsNum <= 0) return false;
  const tsSegundos = tsNum > 1e11 ? Math.floor(tsNum / 1000) : tsNum;
  const ahoraSegundos = Math.floor(Date.now() / 1000);
  return Math.abs(ahoraSegundos - tsSegundos) <= maxDiffSegundos;
}

export function verificarFirmaWebhook(
  provider: string,
  secretEsperado: string,
  req: Request
): boolean {
  if (!secretEsperado || typeof secretEsperado !== 'string' || !secretEsperado.trim()) {
    return false;
  }

  const rawBody = (req as any).rawBody || JSON.stringify(req.body || {});

  // 1. Verificación para Onvo Pay (soporta formato nativo X-Onvo-Signature y headers Svix)
  if (provider === 'onvopay') {
    const onvoHeader = (req.headers['x-onvo-signature'] || req.headers['X-Onvo-Signature']) as string;
    const svixId = (req.headers['svix-id'] || req.headers['webhook-id']) as string;
    const svixTimestamp = (req.headers['svix-timestamp'] || req.headers['webhook-timestamp']) as string;
    const svixSignature = (req.headers['svix-signature'] || req.headers['webhook-signature']) as string;

    // A) Formato Documentado Oficial ONVO: 'x-onvo-signature: t=...,v1=...'
    if (onvoHeader) {
      const parts = onvoHeader.split(',');
      let tValue: string | undefined;
      const signaturesRecibidas: string[] = [];

      for (const p of parts) {
        const idx = p.indexOf('=');
        if (idx > -1) {
          const k = p.slice(0, idx).trim();
          const v = p.slice(idx + 1).trim();
          if (k === 't') tValue = v;
          else if (k === 'v1' && v) signaturesRecibidas.push(v);
        }
      }

      if (tValue && signaturesRecibidas.length > 0) {
        if (!esTimestampValido(tValue, 300)) {
          console.warn('[ONVO WEBHOOK] Timestamp fuera de tolerancia (anti-replay):', tValue);
          return false;
        }

        const toSign = `${tValue}.${rawBody}`;
        const keys: Buffer[] = [Buffer.from(secretEsperado, 'utf-8')];
        if (secretEsperado.startsWith('whsec_')) {
          try {
            keys.push(Buffer.from(secretEsperado.slice(6), 'base64'));
          } catch { /* ignorar */ }
        }

        for (const key of keys) {
          const sigHex = crypto.createHmac('sha256', key).update(toSign).digest('hex');
          const sigB64 = crypto.createHmac('sha256', key).update(toSign).digest('base64');
          for (const recibida of signaturesRecibidas) {
            if (safeCompare(recibida, sigHex) || safeCompare(recibida, sigB64)) {
              return true;
            }
          }
        }
      }
    }

    // B) Formato Svix Headers (svix-id, svix-timestamp, svix-signature)
    if (svixSignature && svixId && svixTimestamp) {
      if (!esTimestampValido(svixTimestamp, 300)) {
        console.warn('[ONVO WEBHOOK] Svix Timestamp fuera de tolerancia (anti-replay):', svixTimestamp);
        return false;
      }

      const toSign = `${svixId}.${svixTimestamp}.${rawBody}`;
      const keys: Buffer[] = [];
      if (secretEsperado.startsWith('whsec_')) {
        try {
          keys.push(Buffer.from(secretEsperado.slice(6), 'base64'));
        } catch { /* ignorar */ }
      }
      keys.push(Buffer.from(secretEsperado, 'utf-8'));

      const sigList = svixSignature.split(' ').map(s => {
        const parts = s.split(',');
        return parts.length > 1 ? parts[1] : parts[0];
      }).filter(Boolean);

      for (const key of keys) {
        const sigB64 = crypto.createHmac('sha256', key).update(toSign).digest('base64');
        const sigHex = crypto.createHmac('sha256', key).update(toSign).digest('hex');
        for (const s of sigList) {
          if (safeCompare(s, sigB64) || safeCompare(s, sigHex)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  // 2. Verificación para Stripe (stripe-signature: t=...,v1=...)
  if (provider === 'stripe') {
    const stripeHeader = (req.headers['stripe-signature'] || '') as string;
    if (!stripeHeader) return false;

    const parts = stripeHeader.split(',');
    let tValue: string | undefined;
    const signatures: string[] = [];
    for (const p of parts) {
      const idx = p.indexOf('=');
      if (idx > -1) {
        const k = p.slice(0, idx).trim();
        const v = p.slice(idx + 1).trim();
        if (k === 't') tValue = v;
        else if (k === 'v1' && v) signatures.push(v);
      }
    }

    if (!tValue || signatures.length === 0 || !esTimestampValido(tValue, 300)) {
      return false;
    }

    const toSign = `${tValue}.${rawBody}`;
    const expectedSig = crypto.createHmac('sha256', secretEsperado).update(toSign).digest('hex');
    for (const s of signatures) {
      if (safeCompare(s, expectedSig)) return true;
    }
    return false;
  }

  // 3. Verificación para Tilopay (header seguro x-webhook-secret)
  if (provider === 'tilopay') {
    const tokenHeader = String(req.headers['x-webhook-secret'] || req.headers['x-tilopay-signature'] || '');
    if (tokenHeader && safeCompare(tokenHeader, secretEsperado)) {
      return true;
    }
    return false;
  }

  return false;
}

app.post('/api/billing/webhook/:provider', ah(async (req, res) => {
  const provider = String(req.params.provider).toLowerCase();

  if (!['onvopay', 'stripe', 'tilopay'].includes(provider)) {
    console.warn(`[WEBHOOK] Proveedor no soportado: ${provider}`);
    return res.status(400).json({ success: false, error: 'Proveedor no soportado.' });
  }

  const gateways = await getGatewaysConfig();
  const secretEsperado =
    provider === 'stripe' ? gateways.stripe.webhookSecret :
    provider === 'onvopay' ? gateways.onvopay.webhookSecret :
    provider === 'tilopay' ? gateways.tilopay.webhookSecret : '';

  if (!secretEsperado) {
    console.error(`[WEBHOOK ${provider}] Rechazado: webhookSecret no configurado en el servidor.`);
    return res.status(500).json({ success: false, error: 'Webhook secret no configurado en el servidor.' });
  }

  if (!verificarFirmaWebhook(provider, secretEsperado, req)) {
    console.warn(`[WEBHOOK ${provider}] Firma de webhook inválida o expirada.`);
    return res.status(401).json({ success: false, error: 'Firma de webhook inválida.' });
  }

  try {
    const result = await procesarWebhook(provider, req.body);
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error(`[WEBHOOK ${provider}] Error procesando webhook:`, err.message);
    res.status(400).json({ success: false, error: err.message });
  }
}));

// A partir de aquí todas las rutas /api requieren sesión
app.use('/api', requireAuth);

// ==========================================
// SUSCRIPCIÓN DEL TENANT
// ==========================================

app.get('/api/billing/estado', ah(async (req, res) => {
  const [suscripcion, planes] = await Promise.all([getEstadoSuscripcion(tid(req)), listarPlanes()]);
  res.json({ success: true, data: { ...suscripcion, planes } });
}));

app.post('/api/billing/checkout', requireAdmin, ah(async (req, res) => {
  try {
    const { planCode, billingCycle, provider } = req.body || {};
    const result = await iniciarCheckoutRecurrente(
      tid(req),
      String(planCode || ''),
      billingCycle === 'yearly' ? 'yearly' : 'monthly',
      provider
    );
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
}));

// Confirmación de pago en modo sandbox (pruebas sin pasarela real)
app.post('/api/billing/sandbox/confirmar', requireAdmin, ah(async (req, res) => {
  if (!isSandboxPermitted()) {
    return res.status(403).json({
      success: false,
      error: 'La confirmación de pagos sandbox está estrictamente inhabilitada en el entorno de producción.'
    });
  }

  const txId = String(req.body?.transactionId || '').trim();
  if (!txId) {
    return res.status(400).json({ success: false, error: 'transactionId requerido.' });
  }

  const tx = await pool.query('SELECT tenant_id, provider, status FROM payment_transactions WHERE id = $1', [txId]);
  if (!tx.rowCount || tx.rows[0].tenant_id !== tid(req)) {
    return res.status(404).json({ success: false, error: 'Transacción sandbox no encontrada.' });
  }

  if (tx.rows[0].provider !== 'sandbox') {
    return res.status(400).json({
      success: false,
      error: 'No se puede confirmar una transacción de pasarela real mediante el endpoint sandbox.'
    });
  }

  if (tx.rows[0].status !== 'pending') {
    return res.status(400).json({
      success: false,
      error: `La transacción no se encuentra pendiente (estado: ${tx.rows[0].status}).`
    });
  }

  const result = await completarPagoYActivarSuscripcion(
    txId,
    'sandbox',
    `sandbox_${Date.now()}`,
    `sandbox_sub_${tid(req)}`
  );
  res.json({ success: true, data: result, suscripcion: await getEstadoSuscripcion(tid(req)) });
}));

app.post('/api/billing/sinpe', requireAdmin, ah(async (req, res) => {
  try {
    const { planCode, billingCycle, referencia, notas } = req.body || {};
    const result = await reportarPagoSinpe(tid(req), {
      planCode: String(planCode || ''),
      billingCycle: billingCycle === 'yearly' ? 'yearly' : 'monthly',
      referencia: String(referencia || ''),
      notas
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
}));

app.post('/api/billing/cancelar', requireAdmin, ah(async (req, res) => {
  await pool.query(
    'UPDATE subscriptions SET cancel_at_period_end = TRUE, updated_at = NOW() WHERE tenant_id = $1',
    [tid(req)]
  );
  res.json({ success: true, data: await getEstadoSuscripcion(tid(req)) });
}));

// ==========================================
// USUARIOS DEL TENANT
// ==========================================

app.get('/api/usuarios', requireAdmin, ah(async (req, res) => {
  res.json({ success: true, data: await listarUsuariosTenant(tid(req)) });
}));

app.post('/api/usuarios', requireAdmin, ah(async (req, res) => {
  try {
    res.json({ success: true, data: await crearUsuarioTenant(tid(req), req.body || {}) });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
}));

app.put('/api/usuarios/:id', requireAdmin, ah(async (req, res) => {
  try {
    const data = await actualizarUsuarioTenant(tid(req), String(req.params.id), req.body || {}, req.auth!.userId);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
}));

app.delete('/api/usuarios/:id', requireAdmin, ah(async (req, res) => {
  try {
    const ok = await eliminarUsuarioTenant(tid(req), String(req.params.id), req.auth!.userId);
    res.json({ success: ok });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
}));

// ==========================================
// SUPERADMIN SAAS
// ==========================================

app.get('/api/superadmin/dashboard', requireSuperAdmin, ah(async (req, res) => {
  res.json({ success: true, data: await getSuperAdminDashboard() });
}));

app.post('/api/superadmin/tenants/:id/plan', requireSuperAdmin, ah(async (req, res) => {
  const { planCode, dias, status } = req.body || {};
  await asignarPlanManual(String(req.params.id), String(planCode || 'emprendedor'), Number(dias) || 30, status || 'active');
  res.json({ success: true });
}));

app.post('/api/superadmin/tenants/:id/estado', requireSuperAdmin, ah(async (req, res) => {
  try {
    await actualizarEstadoTenant(String(req.params.id), Boolean(req.body?.activo));
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
}));

app.post('/api/superadmin/pagos/:id/aprobar', requireSuperAdmin, ah(async (req, res) => {
  try {
    res.json({ success: true, data: await aprobarPagoManual(String(req.params.id)) });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
}));

app.post('/api/superadmin/pagos/:id/rechazar', requireSuperAdmin, ah(async (req, res) => {
  await rechazarPagoManual(String(req.params.id), req.body?.motivo);
  res.json({ success: true });
}));

app.post('/api/superadmin/gateways', requireSuperAdmin, ah(async (req, res) => {
  res.json({ success: true, data: await saveGatewaysConfig(req.body || {}) });
}));

// ==========================================
// ENDPOINTS DE CONFIGURACIÓN DEL SITIO
// ==========================================

app.get('/api/configuracion', ah(async (req, res) => {
  const config = await pgDataStore.getConfig(tid(req));
  res.json({ success: true, data: config });
}));

app.post('/api/configuracion', requireAdmin, ah(async (req, res) => {
  const updated = await pgDataStore.saveConfig(tid(req), req.body || {});
  res.json({ success: true, data: updated });
}));

app.post('/api/configuracion/certificado', requireAdmin, ah(async (req, res) => {
  const { p12Base64, pin, filename } = req.body || {};
  if (!p12Base64 || !pin) {
    return res.status(400).json({ success: false, error: 'Debe proporcionar el archivo .p12 y el PIN.' });
  }
  const buffer = Buffer.from(String(p12Base64).replace(/^data:[^;]+;base64,/, ''), 'base64');
  try {
    // Validar antes de guardar
    new MotorFacturacion().configurarCertificado(buffer, String(pin));
  } catch (err: any) {
    return res.status(400).json({ success: false, error: 'Certificado o PIN inválido: ' + err.message });
  }
  await pgDataStore.saveCertificadoP12(tid(req), buffer, String(pin), filename || 'certificado.p12');
  res.json({ success: true, message: 'Certificado cargado, validado y almacenado cifrado.' });
}));

// ==========================================
// ENDPOINTS DE CATÁLOGO & PRODUCTOS (CRUD)
// ==========================================

app.get('/api/productos', ah(async (req, res) => {
  res.json({ success: true, data: await pgDataStore.getProductos(tid(req)) });
}));

app.post('/api/productos', ah(async (req, res) => {
  res.json({ success: true, data: await pgDataStore.saveProducto(tid(req), req.body || {}) });
}));

app.delete('/api/productos/:id', ah(async (req, res) => {
  res.json({ success: await pgDataStore.deleteProducto(tid(req), String(req.params.id)) });
}));

app.get('/api/categorias', ah(async (req, res) => {
  res.json({ success: true, data: await pgDataStore.getCategorias(tid(req)) });
}));

app.post('/api/categorias', ah(async (req, res) => {
  res.json({ success: true, data: await pgDataStore.saveCategorias(tid(req), req.body?.categorias || []) });
}));

// ==========================================
// ENDPOINTS DE CATÁLOGO DE CLIENTES (CRUD)
// ==========================================

app.get('/api/clientes', ah(async (req, res) => {
  res.json({ success: true, data: await pgDataStore.getClientes(tid(req)) });
}));

app.post('/api/clientes', ah(async (req, res) => {
  try {
    res.json({ success: true, data: await pgDataStore.saveCliente(tid(req), req.body || {}) });
  } catch (err: any) {
    const msg = String(err?.message || '');
    const isValidation = msg.includes('obligatorio') || msg.includes('inválido');
    res.status(isValidation ? 400 : 500).json({ success: false, error: msg });
  }
}));

app.delete('/api/clientes/:id', ah(async (req, res) => {
  res.json({ success: await pgDataStore.deleteCliente(tid(req), String(req.params.id)) });
}));

// ==========================================
// ENDPOINTS OPERATIVOS Y FACTURADOR
// ==========================================

app.get('/api/estado', ah(async (req, res) => {
  const t = tid(req);
  const config = await pgDataStore.getConfig(t);
  const [consecutivoActual, secuencias, comprobantes] = await Promise.all([
    pgDataStore.getSecuenciaActual(t),
    pgDataStore.getSecuencias(t),
    pgDataStore.getComprobantes(t)
  ]);
  res.json({
    success: true,
    data: {
      servidor: 'Activo',
      entorno: config.hacienda?.entorno || 'staging',
      haciendaConectado: Boolean(config.hacienda?.usuario && config.hacienda?.password),
      enviarAHacienda: Boolean(config.hacienda?.enviarAHacienda),
      certificadoCargado: Boolean(config.certificadoCargado),
      consecutivoActual,
      secuencias,
      totalComprobantesEmitidos: comprobantes.length
    }
  });
}));

// Presets oficiales del Editor Visual de Factura
app.get('/api/factura/editor-presets', ah(async (req, res) => {
  const config = await pgDataStore.getConfig(tid(req));
  const disenoActual = resolverDisenoFactura(config);
  res.json({
    success: true,
    data: {
      presets: PLANTILLAS_FACTURA_PRESETS,
      disenoActual
    }
  });
}));

// Vista previa en HTML elegante antes de emitir (también usada por el Editor Visual de Factura)
app.post('/api/factura/preview', async (req: Request, res: Response) => {
  try {
    const configBase = await pgDataStore.getConfig(tid(req));
    const config: ConfiguracionSistema =
      typeof req.body.logoBase64Override === 'string'
        ? { ...configBase, sitio: { ...configBase.sitio, logoBase64: req.body.logoBase64Override } }
        : configBase;
    const doc = construirComprobanteDesdePayload(req.body, config);
    const estilo = (req.body.estilo || config.sitio?.disenoFactura?.plantillaBase || config.sitio?.estiloFactura || 'ejecutivo') as EstiloFactura;

    const html = await generarFacturaEleganteHTML({
      clave: '50600000000000000000000000000000000000000000000000',
      consecutivo: '00100001010000000042',
      doc,
      config,
      estilo,
      disenoOverride: req.body.diseno,
      notas: req.body.notas,
      esBorrador: req.body.esBorrador !== false,
      ocultarBarraAcciones: Boolean(req.body.ocultarBarraAcciones)
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error: any) {
    res.status(500).send(`Error generando vista previa: ${error.message}`);
  }
});

// Descargar PDF de prueba desde el Editor Visual de Factura (con diseño en vivo sin guardar)
app.post('/api/factura/preview-pdf', async (req: Request, res: Response) => {
  try {
    const configBase = await pgDataStore.getConfig(tid(req));
    const config: ConfiguracionSistema =
      typeof req.body.logoBase64Override === 'string'
        ? { ...configBase, sitio: { ...configBase.sitio, logoBase64: req.body.logoBase64Override } }
        : configBase;
    const doc = construirComprobanteDesdePayload(req.body, config);
    const estilo = (req.body.estilo || config.sitio?.disenoFactura?.plantillaBase || config.sitio?.estiloFactura || 'ejecutivo') as EstiloFactura;
    const disenoResuelto = resolverDisenoFactura(config, estilo, req.body.diseno);

    const html = await generarFacturaEleganteHTML({
      clave: '50619112600010663089600100001010000000042110958315',
      consecutivo: '00100001010000000042',
      doc,
      config,
      estilo,
      disenoOverride: req.body.diseno,
      notas: req.body.notas,
      esBorrador: true,
      ocultarBarraAcciones: true
    });

    const pdfBuffer = await generarFacturaPDFBuffer(html, {
      format: disenoResuelto.tamanoPapel === 'a4' ? 'A4' : 'Letter'
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="VistaPrevia_Factura.pdf"');
    res.send(pdfBuffer);
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Error generando PDF de prueba: ${error.message}` });
  }
});

async function generarPDFParaComprobante(
  item: ComprobanteGuardado,
  config: ConfiguracionSistema,
  estiloOverride?: EstiloFactura
): Promise<Buffer> {
  const estilo: EstiloFactura = estiloOverride && ESTILOS_FACTURA_VALIDOS.includes(estiloOverride)
    ? estiloOverride
    : config.sitio?.disenoFactura?.plantillaBase || item.estilo || config.sitio?.estiloFactura || 'ejecutivo';
  const disenoResuelto = resolverDisenoFactura(config, estilo);

  const html = await generarFacturaEleganteHTML({
    clave: item.clave,
    consecutivo: item.consecutivo,
    doc: item.docOriginal,
    config,
    estilo,
    notas: item.notas
  });

  return generarFacturaPDFBuffer(html, {
    format: disenoResuelto.tamanoPapel === 'a4' ? 'A4' : 'Letter'
  });
}

// Emitir y firmar comprobante
app.post('/api/factura/emitir', requireActiveSubscription, requireQuotaComprobantes, async (req: Request, res: Response) => {
  try {
    const t = tid(req);
    const config = await pgDataStore.getConfig(t);
    const items = req.body.items;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Debe incluir al menos una línea de producto.' });
    }

    const doc = construirComprobanteDesdePayload(req.body, config);

    const user = config.hacienda?.usuario;
    const pass = config.hacienda?.password;
    const envioHabilitado = Boolean(config.hacienda?.enviarAHacienda);
    const autoEnviar = envioHabilitado && Boolean(req.body.autoEnviar) && Boolean(user && pass);

    const { motor, certificadoPropio } = await crearMotorParaTenant(t, config);
    if (autoEnviar && !certificadoPropio) {
      return res.status(400).json({
        success: false,
        error: 'Para enviar a Hacienda debe subir su certificado de firma digital (.p12) en Configuración.'
      });
    }

    const secuencia = await pgDataStore.getNextSecuencia(t, doc.tipoDocumento);
    const resultado = await motor.emitirFactura(doc, secuencia, autoEnviar);

    const estiloSeleccionado = (req.body.estilo || config.sitio?.estiloFactura || 'ejecutivo') as EstiloFactura;

    const registro: ComprobanteGuardado = {
      clave: resultado.clave,
      consecutivo: resultado.consecutivo,
      tipoDocumento: doc.tipoDocumento,
      fecha: doc.fechaEmision,
      moneda: doc.resumen.codigoMoneda,
      total: doc.resumen.totalComprobante,
      cliente: doc.receptor?.nombre || 'Cliente General',
      estadoHacienda: autoEnviar ? 'enviado' : 'firmado_local',
      estilo: estiloSeleccionado,
      notas: req.body.notas || undefined,
      correoCliente: doc.receptor?.correo || undefined,
      xmlFirmado: resultado.xmlFirmado,
      docOriginal: doc
    };

    await pgDataStore.saveComprobante(t, registro);

    let correoResultado: {
      intentado: boolean;
      enviado: boolean;
      destinatario?: string;
      messageId?: string;
      error?: string;
      motivoOmitido?: string;
    };

    const permitirAutoCorreo = req.body.enviarCorreo !== undefined
      ? Boolean(req.body.enviarCorreo)
      : Boolean(config.correo?.envioAutomatico);
    const destinatario = doc.receptor?.correo?.trim() || '';

    if (!permitirAutoCorreo) {
      correoResultado = { intentado: false, enviado: false, motivoOmitido: 'Envío automático desactivado' };
    } else if (!destinatario) {
      correoResultado = { intentado: false, enviado: false, motivoOmitido: 'El cliente no tiene correo electrónico registrado' };
    } else if (!config.correo?.host || !config.correo?.usuario || !config.correo?.password) {
      correoResultado = {
        intentado: false,
        enviado: false,
        motivoOmitido: 'Falta completar la configuración SMTP (host, usuario o contraseña)'
      };
    } else {
      try {
        const pdfBuffer = await generarPDFParaComprobante(registro, config, estiloSeleccionado);
        const envio = await enviarComprobantePorCorreo({ config, comprobante: registro, destinatario, pdfBuffer });
        await pgDataStore.updateComprobanteCorreo(t, registro.clave, {
          correoEnviado: true,
          correoEnviadoEn: new Date().toISOString(),
          correoDestinatario: envio.destinatario,
          correoError: undefined
        });
        correoResultado = { intentado: true, enviado: true, destinatario: envio.destinatario, messageId: envio.messageId };
      } catch (mailErr: any) {
        console.error('[SMTP Auto Error]', mailErr?.message || mailErr);
        await pgDataStore.updateComprobanteCorreo(t, registro.clave, {
          correoEnviado: false,
          correoDestinatario: destinatario,
          correoError: mailErr?.message || 'Error enviando correo'
        });
        correoResultado = { intentado: true, enviado: false, destinatario, error: mailErr?.message || 'Error enviando correo' };
      }
    }

    res.json({
      success: true,
      data: (await pgDataStore.getComprobanteByClave(t, registro.clave)) || registro,
      correoResultado
    });
  } catch (error: any) {
    console.error('[API Error]', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/facturas', ah(async (req, res) => {
  res.json({ success: true, data: await pgDataStore.getComprobantes(tid(req)) });
}));

app.post('/api/facturas/limpiar-pruebas', requireAdmin, ah(async (req, res) => {
  const t = tid(req);
  if (typeof req.body?.resetSecuencia === 'number') {
    return res.json({ success: true, data: await pgDataStore.clearPruebasLocales(t, req.body.resetSecuencia, true) });
  }
  if (req.body?.reiniciarConsecutivo === false && !req.body?.reiniciarABase) {
    return res.json({ success: true, data: await pgDataStore.clearPruebasLocales(t, undefined, false) });
  }
  res.json({ success: true, data: await pgDataStore.clearPruebasLocales(t, undefined, true) });
}));

app.delete('/api/facturas/:clave', ah(async (req, res) => {
  const result = await pgDataStore.deleteComprobante(tid(req), String(req.params.clave));
  if (!result.deleted) {
    return res.status(400).json({ success: false, error: result.reason });
  }
  res.json({ success: true });
}));

app.get('/api/facturas/:clave/xml', ah(async (req, res) => {
  const item = await pgDataStore.getComprobanteByClave(tid(req), String(req.params.clave));
  if (!item) {
    return res.status(404).json({ success: false, error: 'Comprobante no encontrado' });
  }
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', `attachment; filename="${item.clave}_firmado.xml"`);
  res.send(item.xmlFirmado);
}));

// Ver e Imprimir Factura Gráfica Elegante
app.get('/api/facturas/:clave/print', ah(async (req, res) => {
  const t = tid(req);
  const item = await pgDataStore.getComprobanteByClave(t, String(req.params.clave));
  if (!item) {
    return res.status(404).send('Comprobante no encontrado.');
  }

  const config = await pgDataStore.getConfig(t);
  const estiloQuery = req.query.estilo as string | undefined;
  const estilo: EstiloFactura = ESTILOS_FACTURA_VALIDOS.includes(estiloQuery as EstiloFactura)
    ? (estiloQuery as EstiloFactura)
    : config.sitio?.disenoFactura?.plantillaBase || item.estilo || config.sitio?.estiloFactura || 'ejecutivo';

  const html = await generarFacturaEleganteHTML({
    clave: item.clave,
    consecutivo: item.consecutivo,
    doc: item.docOriginal,
    config,
    estilo,
    notas: item.notas
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}));

// Descargar representación gráfica en PDF
app.get('/api/facturas/:clave/pdf', ah(async (req, res) => {
  const t = tid(req);
  const item = await pgDataStore.getComprobanteByClave(t, String(req.params.clave));
  if (!item) {
    return res.status(404).json({ success: false, error: 'Comprobante no encontrado.' });
  }
  const config = await pgDataStore.getConfig(t);
  const pdfBuffer = await generarPDFParaComprobante(item, config, req.query.estilo as EstiloFactura | undefined);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Factura_${item.consecutivo}.pdf"`);
  res.send(pdfBuffer);
}));

// Enviar o reenviar comprobante (PDF + XML) por correo electrónico
app.post('/api/facturas/:clave/enviar-correo', ah(async (req, res) => {
  const t = tid(req);
  const clave = String(req.params.clave);
  const item = await pgDataStore.getComprobanteByClave(t, clave);
  if (!item) {
    return res.status(404).json({ success: false, error: 'Comprobante no encontrado.' });
  }

  const destinatario = (req.body?.destinatario || '').trim() || item.correoCliente || item.docOriginal?.receptor?.correo || '';
  if (!destinatario) {
    return res.status(400).json({ success: false, error: 'Debe indicar el correo electrónico del destinatario.' });
  }

  try {
    const config = await pgDataStore.getConfig(t);
    const pdfBuffer = await generarPDFParaComprobante(item, config, req.body?.estilo as EstiloFactura | undefined);
    const envio = await enviarComprobantePorCorreo({ config, comprobante: item, destinatario, pdfBuffer });

    const updated = await pgDataStore.updateComprobanteCorreo(t, clave, {
      correoEnviado: true,
      correoEnviadoEn: new Date().toISOString(),
      correoDestinatario: envio.destinatario,
      correoError: undefined
    });

    res.json({ success: true, data: updated, messageId: envio.messageId, destinatario: envio.destinatario });
  } catch (error: any) {
    const msg = String(error?.message || 'Error enviando correo');
    console.error('[SMTP Send Error]', msg);
    await pgDataStore.updateComprobanteCorreo(t, clave, { correoError: msg });
    const isConfigOrInputError =
      msg.includes('Debe configurar') || msg.includes('no es válido') || msg.includes('destinatario');
    res.status(isConfigOrInputError ? 400 : 500).json({ success: false, error: msg });
  }
}));

app.get('/api/reportes/caja', ah(async (req, res) => {
  const hoy = new Date().toISOString().split('T')[0];
  const comprobantesHoy = (await pgDataStore.getComprobantes(tid(req))).filter(c =>
    new Date(c.fecha).toISOString().split('T')[0] === hoy
  );

  const totalVentas = comprobantesHoy.reduce((acc, c) => acc + (c.total || 0), 0);
  const totalFacturas = comprobantesHoy.filter(c => c.tipoDocumento === '01').length;
  const totalTiquetes = comprobantesHoy.filter(c => c.tipoDocumento === '04').length;

  res.json({
    success: true,
    data: {
      fecha: hoy,
      montoApertura: 50000,
      totalVentas,
      totalEfectivoEsperado: 50000 + totalVentas,
      conteoComprobantes: { total: comprobantesHoy.length, facturas: totalFacturas, tiquetes: totalTiquetes },
      ultimasVentas: comprobantesHoy.slice(0, 10)
    }
  });
}));

// Probar Conexión con Hacienda en Tiempo Real
app.post('/api/hacienda/test-conexion', async (req: Request, res: Response) => {
  try {
    const { usuario, password, entorno } = req.body || {};
    const config = await pgDataStore.getConfig(tid(req));

    const userToTest = usuario || config.hacienda?.usuario;
    const passToTest = password || config.hacienda?.password;
    const envToTest = entorno || config.hacienda?.entorno || 'staging';

    if (!userToTest || !passToTest) {
      return res.status(400).json({
        success: false,
        error: 'Debe ingresar el Usuario y la Contraseña generados en TRIBU-CR para realizar la prueba.'
      });
    }

    const { HaciendaClient } = await import('./services/hacienda-client.js');
    const testClient = new HaciendaClient({
      clientId: envToTest === 'produccion' ? 'api-prod' : 'api-stag',
      username: userToTest,
      password: passToTest,
      entorno: envToTest
    });

    const token = await testClient.obtenerToken();

    res.json({
      success: true,
      mensaje: `¡Conexión Exitosa con el Ministerio de Hacienda (${String(envToTest).toUpperCase()})!`,
      detalles: {
        autenticado: true,
        entorno: envToTest,
        tokenGenerado: `${token.substring(0, 25)}... (Token Válido de Hacienda)`,
        fechaPrueba: new Date().toISOString()
      }
    });
  } catch (error: any) {
    console.error('[Hacienda Test Error]', error.message);
    res.status(401).json({
      success: false,
      error: error.message,
      sugerencia: 'Verifique que el usuario corresponda al entorno seleccionado (Staging o Producción) y que la contraseña no contenga espacios extras.'
    });
  }
});

// Probar conexión SMTP y envío de correo de diagnóstico
app.post('/api/correo/test', ah(async (req, res) => {
  const config = await pgDataStore.getConfig(tid(req));
  const correoCfg = {
    proveedor: req.body?.proveedor ?? config.correo?.proveedor ?? 'hostinger',
    host: req.body?.host ?? config.correo?.host ?? 'smtp.hostinger.com',
    puerto: req.body?.puerto !== undefined ? Number(req.body.puerto) : (config.correo?.puerto ?? 465),
    seguro: req.body?.seguro !== undefined ? Boolean(req.body.seguro) : (config.correo?.seguro ?? true),
    usuario: req.body?.usuario ?? config.correo?.usuario ?? '',
    password: req.body?.password !== undefined ? String(req.body.password) : (config.correo?.password ?? ''),
    nombreRemitente:
      req.body?.nombreRemitente ?? config.correo?.nombreRemitente ?? config.emisor?.nombreComercial ?? 'Facturación Electrónica'
  };

  try {
    const destinatarioPrueba = typeof req.body?.destinatarioPrueba === 'string' ? req.body.destinatarioPrueba.trim() : '';
    const result = await probarConexionCorreo(correoCfg, destinatarioPrueba || undefined);
    res.json({
      success: true,
      mensaje: result.mensaje,
      detalles: { messageId: result.messageId || null, host: correoCfg.host, puerto: correoCfg.puerto, usuario: correoCfg.usuario }
    });
  } catch (error: any) {
    console.error('[SMTP Test Error]', error?.message || error);
    res.status(400).json({
      success: false,
      error: error?.message || 'Error conectando con el servidor SMTP',
      sugerencia: 'Para Hostinger verifique que usa smtp.hostinger.com, puerto 465 con SSL/TLS y la contraseña exacta del buzón creada en hPanel.'
    });
  }
}));

// ==========================================
// ENDPOINTS DE CONSECUTIVOS CONFIGURABLES DGT
// ==========================================

app.get('/api/consecutivos', ah(async (req, res) => {
  const t = tid(req);
  const config = await pgDataStore.getConfig(t);
  res.json({
    success: true,
    data: {
      ...(await pgDataStore.getSecuencias(t)),
      sucursal: config.emisor?.sucursal || '001',
      terminal: config.emisor?.terminal || '00001'
    }
  });
}));

app.post('/api/consecutivos', requireAdmin, ah(async (req, res) => {
  try {
    const t = tid(req);
    const config = await pgDataStore.getConfig(t);
    const proximos = req.body?.proximos || req.body || {};
    const result = await pgDataStore.setProximosConsecutivos(t, proximos);
    res.json({
      success: true,
      data: { ...result, sucursal: config.emisor?.sucursal || '001', terminal: config.emisor?.terminal || '00001' }
    });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error?.message || 'Consecutivo inválido' });
  }
}));

// ==========================================
// ENDPOINTS DE CONTROL DE GASTOS E IMAP
// ==========================================

app.post('/api/correo/test-imap', ah(async (req, res) => {
  const config = await pgDataStore.getConfig(tid(req));
  const imapCfg = {
    usuario: req.body?.usuario ?? config.correo?.usuario ?? '',
    password: req.body?.password !== undefined ? String(req.body.password) : (config.correo?.password ?? ''),
    imapHost: req.body?.imapHost ?? config.correo?.imapHost ?? 'imap.hostinger.com',
    imapPuerto: req.body?.imapPuerto !== undefined ? Number(req.body.imapPuerto) : (config.correo?.imapPuerto ?? 993),
    imapSeguro: req.body?.imapSeguro !== undefined ? Boolean(req.body.imapSeguro) : (config.correo?.imapSeguro ?? true),
    imapCarpeta: req.body?.imapCarpeta ?? config.correo?.imapCarpeta ?? 'INBOX'
  };

  try {
    const result = await probarConexionIMAP(imapCfg);
    res.json({
      success: true,
      mensaje: result.mensaje,
      detalles: { host: result.host, puerto: result.puerto, carpeta: result.carpeta, totalMensajes: result.totalMensajes }
    });
  } catch (error: any) {
    console.error('[IMAP Test Error]', error?.message || error);
    res.status(400).json({
      success: false,
      error: error?.message || 'Error conectando al servidor IMAP',
      sugerencia: 'Para Hostinger verifique que usa imap.hostinger.com, puerto 993 con SSL/TLS y la contraseña exacta del buzón.'
    });
  }
}));

app.get('/api/gastos', ah(async (req, res) => {
  const store = await pgDataStore.getGastosStore(tid(req));
  let totalCRC = 0;
  let impuestoCRC = 0;
  let pendientes = 0;

  for (const g of store.items) {
    const signo = g.tipoDocumento === '03' ? -1 : 1;
    totalCRC += signo * Number(g.totalCRC || 0);
    impuestoCRC += signo * Number(g.impuestoCRC || 0);
    if (g.estadoConfirmacion === 'pendiente') pendientes += 1;
  }

  res.json({
    success: true,
    data: {
      ...store,
      resumen: {
        totalCRC: Number(totalCRC.toFixed(2)),
        impuestoCRC: Number(impuestoCRC.toFixed(2)),
        totalComprobantes: store.items.length,
        pendientes
      }
    }
  });
}));

app.post('/api/gastos/sincronizar', requireFeatureImap, async (req: Request, res: Response) => {
  try {
    const t = tid(req);
    const config = await pgDataStore.getConfig(t);
    const resumen = await sincronizarGastosDesdeCorreo(t, config, req.body || {});
    res.json({ success: true, data: resumen });
  } catch (error: any) {
    const msg = String(error?.message || 'Error sincronizando gastos');
    const isConfigErr = msg.includes('Debe configurar');
    res.status(isConfigErr ? 400 : 500).json({ success: false, error: msg });
  }
});

app.post('/api/gastos/importar-xml', ah(async (req, res) => {
  const t = tid(req);
  const { xmlContent, pdfBase64, permitirPropio } = req.body || {};
  if (!xmlContent || typeof xmlContent !== 'string') {
    return res.status(400).json({ success: false, error: 'Debe proporcionar el contenido XML del comprobante.' });
  }

  const config = await pgDataStore.getConfig(t);
  const tipoCambioDefault = Number(config.sitio?.tipoCambioDefault) || 510;
  const parsed = parsearFacturaXMLCostaRica(xmlContent, { tipoCambioDefault, origen: 'carga_manual' });

  if (parsed.tipo === 'mensaje_hacienda') {
    return res.status(400).json({
      success: false,
      error: 'El archivo corresponde a un Mensaje de Hacienda/Receptor, no a una factura de gasto.'
    });
  }
  if (parsed.tipo !== 'comprobante' || !parsed.gasto) {
    return res.status(400).json({ success: false, error: parsed.motivo || 'XML inválido.' });
  }

  const cedulaPropia = normalizarCedula(config.emisor?.cedula);
  const cedulaEmisor = normalizarCedula(parsed.gasto.emisorCedula);
  if (!permitirPropio && cedulaPropia && cedulaEmisor && cedulaEmisor === cedulaPropia) {
    return res.status(400).json({
      success: false,
      error: 'Este XML fue emitido con su propia cédula tributaria y no puede registrarse como gasto recibido.'
    });
  }

  let pdfBuffer: Buffer | undefined;
  if (pdfBase64 && typeof pdfBase64 === 'string') {
    pdfBuffer = Buffer.from(pdfBase64.replace(/^data:application\/pdf;base64,/, ''), 'base64');
  }

  const saved = await pgDataStore.saveGasto(t, parsed.gasto, xmlContent, pdfBuffer);
  res.json({ success: true, data: saved.item, duplicado: saved.duplicado });
}));

app.get('/api/gastos/exportar-csv', ah(async (req, res) => {
  const mes = String(req.query.mes || '').trim();
  const categoria = String(req.query.categoria || '').trim();
  const estado = String(req.query.estado || '').trim();

  const items = (await pgDataStore.getGastos(tid(req))).filter(g => {
    if (mes && !String(g.fechaEmision || '').startsWith(mes)) return false;
    if (categoria && g.categoriaGasto !== categoria) return false;
    if (estado && g.estadoConfirmacion !== estado) return false;
    return true;
  });

  const csvEscape = (v: unknown) => {
    let str = String(v ?? '');
    if (/^[=+\-@]/.test(str)) {
      str = `'${str}`;
    }
    return `"${str.replace(/"/g, '""')}"`;
  };

  const headers = [
    'Fecha', 'Tipo', 'Consecutivo', 'Clave', 'Proveedor', 'Cedula Emisor', 'Categoria', 'Estado',
    'Moneda', 'Tipo Cambio', 'Venta Neta', 'IVA Original', 'Total Original', 'IVA CRC', 'Total CRC'
  ];

  const rows = items.map(g => {
    const signo = g.tipoDocumento === '03' ? -1 : 1;
    return [
      g.fechaEmision,
      g.tipoDocumentoNombre || g.tipoDocumento,
      g.consecutivo,
      g.clave,
      g.emisorNombre,
      g.emisorCedula,
      g.categoriaGasto,
      g.estadoConfirmacion,
      g.moneda,
      g.tipoCambio,
      (signo * (g.totalVentaNeta || 0)).toFixed(2),
      (signo * (g.totalImpuesto || 0)).toFixed(2),
      (signo * (g.totalComprobante || 0)).toFixed(2),
      (signo * (g.impuestoCRC || 0)).toFixed(2),
      (signo * (g.totalCRC || 0)).toFixed(2)
    ].map(csvEscape).join(',');
  });

  const csvContent = '\uFEFF' + [headers.map(csvEscape).join(','), ...rows].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="gastos.csv"');
  res.send(csvContent);
}));

app.get('/api/gastos/reporte-html', ah(async (req, res) => {
  const t = tid(req);
  const mes = String(req.query.mes || '').trim();
  const categoria = String(req.query.categoria || '').trim();
  const estado = String(req.query.estado || '').trim();
  const busqueda = String(req.query.q || '').trim().toLowerCase();

  const todos = await pgDataStore.getGastos(t);
  const gastosFiltrados = todos.filter(g => {
    if (mes && !String(g.fechaEmision || '').startsWith(mes)) return false;
    if (categoria && g.categoriaGasto !== categoria) return false;
    if (estado && g.estadoConfirmacion !== estado) return false;
    if (busqueda) {
      const match = [g.emisorNombre, g.emisorNombreComercial, g.emisorCedula, g.clave, g.consecutivo, g.categoriaGasto]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(busqueda));
      if (!match) return false;
    }
    return true;
  });

  const config = await pgDataStore.getConfig(t);
  const html = generarReporteGastosHTML({
    gastos: gastosFiltrados,
    config,
    filtros: { mes, categoria, estado, busqueda },
    usuario: (req as any).auth?.email
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}));

app.get('/api/gastos/reporte-pdf', ah(async (req, res) => {
  const t = tid(req);
  const mes = String(req.query.mes || '').trim();
  const categoria = String(req.query.categoria || '').trim();
  const estado = String(req.query.estado || '').trim();
  const busqueda = String(req.query.q || '').trim().toLowerCase();

  const todos = await pgDataStore.getGastos(t);
  const gastosFiltrados = todos.filter(g => {
    if (mes && !String(g.fechaEmision || '').startsWith(mes)) return false;
    if (categoria && g.categoriaGasto !== categoria) return false;
    if (estado && g.estadoConfirmacion !== estado) return false;
    if (busqueda) {
      const match = [g.emisorNombre, g.emisorNombreComercial, g.emisorCedula, g.clave, g.consecutivo, g.categoriaGasto]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(busqueda));
      if (!match) return false;
    }
    return true;
  });

  const config = await pgDataStore.getConfig(t);
  const html = generarReporteGastosHTML({
    gastos: gastosFiltrados,
    config,
    filtros: { mes, categoria, estado, busqueda },
    usuario: (req as any).auth?.email
  });

  const pdfBuffer = await generarFacturaPDFBuffer(html, { format: 'Letter', landscape: true });
  const filename = `Reporte_Gastos_${mes || 'general'}_${new Date().toISOString().slice(0, 10)}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.send(pdfBuffer);
}));

app.put('/api/gastos/:clave', ah(async (req, res) => {
  const updated = await pgDataStore.updateGasto(tid(req), String(req.params.clave), req.body || {});
  if (!updated) {
    return res.status(404).json({ success: false, error: 'Gasto no encontrado.' });
  }
  res.json({ success: true, data: updated });
}));

app.delete('/api/gastos/:clave', ah(async (req, res) => {
  res.json({ success: await pgDataStore.deleteGasto(tid(req), String(req.params.clave)) });
}));

app.get('/api/gastos/:clave/xml', ah(async (req, res) => {
  const clave = String(req.params.clave);
  const data = await pgDataStore.getGastoArchivo(tid(req), clave, 'xml');
  if (!data) {
    return res.status(404).json({ success: false, error: 'Archivo XML de gasto no encontrado.' });
  }
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="Gasto_${clave}.xml"`);
  res.send(data);
}));

app.get('/api/gastos/:clave/pdf', ah(async (req, res) => {
  const clave = String(req.params.clave);
  const data = await pgDataStore.getGastoArchivo(tid(req), clave, 'pdf');
  if (!data) {
    return res.status(404).json({ success: false, error: 'Archivo PDF de gasto no encontrado.' });
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Gasto_${clave}.pdf"`);
  res.send(data);
}));

app.post('/api/gastos/:clave/pdf', ah(async (req, res) => {
  const t = tid(req);
  const clave = String(req.params.clave);
  const { pdfBase64 } = req.body || {};
  if (!pdfBase64 || typeof pdfBase64 !== 'string') {
    return res.status(400).json({ success: false, error: 'Debe enviar el archivo PDF en base64.' });
  }
  const buffer = Buffer.from(pdfBase64.replace(/^data:application\/pdf;base64,/, ''), 'base64');
  const ok = await pgDataStore.saveGastoPdf(t, clave, buffer);
  res.json({ success: ok });
}));

// ==========================================
// SCHEDULERS MULTI-TENANT
// ==========================================

const ultimoSyncPorTenant = new Map<string, number>();

async function ejecutarAutoSyncImapMultiTenant(): Promise<void> {
  try {
    const tenants = await pgDataStore.listarTenantsConAutoSyncImap();
    const ahora = Date.now();
    for (const { tenantId, config } of tenants) {
      const mins = Math.max(5, Number(config.correo?.imapIntervaloMin) || 15);
      const ultimo = ultimoSyncPorTenant.get(tenantId) || 0;
      if (ahora - ultimo < mins * 60_000) continue;
      const estado = await getEstadoSuscripcion(tenantId).catch(() => null);
      if (!estado || !estado.plan.permite_imap_gastos) continue;
      if (!['active', 'trialing'].includes(String(estado.subscription.status))) continue;
      ultimoSyncPorTenant.set(tenantId, ahora);
      sincronizarGastosDesdeCorreo(tenantId, config).catch(err => {
        console.error(`[IMAP AutoSync Error][${tenantId}]`, err?.message || err);
      });
    }
  } catch (err: any) {
    console.error('[IMAP Scheduler Error]', err?.message || err);
  }
}

async function bootstrap(): Promise<void> {
  await ensureSshTunnelIfEnabled();
  await initDatabaseSchema();
  await migrarDatosJsonSiEsNecesario();
  await verificarVencimientosSuscripciones();

  app.listen(PORT, HOST, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 PLATAFORMA SAAS DE FACTURACIÓN ELECTRÓNICA ACTIVA`);
    console.log(`📍 URL Local: http://${HOST}:${PORT}`);
    console.log(`🗄  Base de datos: PostgreSQL (multi-tenant)`);
    console.log(`======================================================\n`);
  });

  const imapTimer = setInterval(ejecutarAutoSyncImapMultiTenant, 60_000);
  imapTimer.unref();
  const billingTimer = setInterval(() => {
    verificarVencimientosSuscripciones().catch(err => console.error('[Billing Scheduler Error]', err?.message || err));
  }, 60 * 60_000);
  billingTimer.unref();
}

bootstrap().catch(err => {
  console.error('[FATAL] No se pudo iniciar el servidor:', err);
  process.exit(1);
});
