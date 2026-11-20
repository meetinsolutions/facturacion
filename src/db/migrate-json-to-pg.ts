import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pool, withTransaction } from './pool.js';
import { dataStore } from '../services/data-store.js';
import { pgDataStore } from '../services/pg-data-store.js';
import { hashPassword } from '../services/crypto-service.js';

export async function migrarDatosJsonSiEsNecesario(): Promise<void> {
  const existingAdmin = await pool.query("SELECT id, tenant_id FROM users WHERE role = 'superadmin' LIMIT 1");
  if (existingAdmin.rowCount && existingAdmin.rowCount > 0) {
    return;
  }

  console.log('[Migración SaaS] Inicializando tenant principal y migrando datos JSON existentes a PostgreSQL...');
  const configJson = dataStore.getConfig();
  const hasConfig = Boolean(configJson && (configJson.emisor || configJson.sitio));

  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const subscriptionId = crypto.randomUUID();

  const superEmail = (process.env.SUPERADMIN_EMAIL || configJson?.emisor?.correo || 'facturacion@meetinlabs.com')
    .trim()
    .toLowerCase();
  const superPassword = process.env.SUPERADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');
  const empresaNombre = configJson?.emisor?.nombreComercial || configJson?.sitio?.nombreSistema || 'MeetinLabs';
  const empresaCedula = configJson?.emisor?.cedula || '106630896';

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO tenants (id, nombre, slug, cedula, activo)
       VALUES ($1, $2, $3, $4, TRUE)`,
      [tenantId, empresaNombre, 'meetinlabs', empresaCedula]
    );

    await client.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, nombre, role, activo)
       VALUES ($1, $2, $3, $4, $5, 'superadmin', TRUE)`,
      [
        userId,
        tenantId,
        superEmail,
        hashPassword(superPassword),
        configJson?.emisor?.nombre || 'SuperAdmin MeetinLabs'
      ]
    );

    const end10y = new Date(Date.now() + 3650 * 86400_000);
    await client.query(
      `INSERT INTO subscriptions (id, tenant_id, plan_code, status, billing_cycle, current_period_start, current_period_end, next_billing_date, provider)
       VALUES ($1, $2, 'empresarial', 'active', 'yearly', NOW(), $3, NULL, 'owner')`,
      [subscriptionId, tenantId, end10y]
    );
  });

  if (hasConfig) {
    await pgDataStore.saveConfig(tenantId, configJson);
  }

  // Migrar certificado .p12 si existe
  const p12Path = path.resolve(process.env.CERTIFICADO_PATH || './certs/contribuyente.p12');
  const fallbackTestPath = path.resolve('./certs/test-cert.p12');
  const certFile = fs.existsSync(p12Path) ? p12Path : fs.existsSync(fallbackTestPath) ? fallbackTestPath : null;
  if (certFile) {
    const pin = configJson?.hacienda?.pin || process.env.CERTIFICADO_PIN || '1234';
    await pgDataStore.saveCertificadoP12(tenantId, fs.readFileSync(certFile), pin, path.basename(certFile));
  }

  // Migrar categorías y productos
  const cats = dataStore.getCategorias();
  await pgDataStore.saveCategorias(
    tenantId,
    cats.length > 0 ? cats : ['General', 'Servicios']
  );

  const prods = dataStore.getProductos();
  for (const p of prods) {
    await pgDataStore.saveProducto(tenantId, p);
  }

  // Migrar clientes
  const clientes = dataStore.getClientes();
  for (const c of clientes) {
    await pgDataStore.saveCliente(tenantId, c);
  }

  // Migrar comprobantes y secuencias exactas desde data/comprobantes.json
  const comprobantesPath = path.join(process.cwd(), 'data', 'comprobantes.json');
  if (fs.existsSync(comprobantesPath)) {
    try {
      const rawComp = JSON.parse(fs.readFileSync(comprobantesPath, 'utf-8'));
      const seqBase01 = typeof rawComp.secuencia === 'number' ? rawComp.secuencia : 0;
      const secs = rawComp.secuencias || {};
      const inits = rawComp.secuenciasIniciales || {};
      for (const tipo of ['01', '02', '03', '04'] as const) {
        const ultimo = typeof secs[tipo] === 'number' ? secs[tipo] : tipo === '01' ? seqBase01 : 0;
        const inicial = typeof inits[tipo] === 'number' ? inits[tipo] : tipo === '01' ? seqBase01 : 0;
        await pool.query(
          `INSERT INTO secuencias_consecutivos (tenant_id, tipo_documento, ultimo_numero, numero_inicial)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, tipo_documento) DO UPDATE SET
             ultimo_numero = EXCLUDED.ultimo_numero,
             numero_inicial = EXCLUDED.numero_inicial`,
          [tenantId, tipo, ultimo, inicial]
        );
      }
      const items = Array.isArray(rawComp.items) ? rawComp.items : [];
      for (const comp of items) {
        await pgDataStore.saveComprobante(tenantId, comp);
      }
    } catch (e) {
      console.error('[Migración] Error leyendo comprobantes.json:', e);
    }
  }

  // Migrar gastos y adjuntos
  const gastosStore = dataStore.getGastosStore();
  for (const g of gastosStore.items) {
    const xmlPath = dataStore.getGastoArchivoPath(g.clave, 'xml');
    const pdfPath = dataStore.getGastoArchivoPath(g.clave, 'pdf');
    const xmlContent = xmlPath && fs.existsSync(xmlPath) ? fs.readFileSync(xmlPath, 'utf-8') : undefined;
    const pdfBuffer = pdfPath && fs.existsSync(pdfPath) ? fs.readFileSync(pdfPath) : undefined;
    await pgDataStore.saveGasto(tenantId, g, xmlContent, pdfBuffer);
  }
  if (gastosStore.ultimaSincronizacion || gastosStore.ultimoResumen || gastosStore.ultimoError) {
    await pgDataStore.saveEstadoSyncGastos(tenantId, {
      ultimaSincronizacion: gastosStore.ultimaSincronizacion,
      ultimoResumen: gastosStore.ultimoResumen,
      ultimoError: gastosStore.ultimoError
    });
  }

  console.log(`[Migración SaaS] Completada para ${empresaNombre} (${superEmail}).`);
}
