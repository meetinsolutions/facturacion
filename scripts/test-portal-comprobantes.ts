/**
 * MEETINFACT — SUITE DE PRUEBAS DE SEGURIDAD Y FUNCIONALIDAD
 * Módulo: Portal de Comprobantes (Incremento 1: Acceso Seguro Individual)
 * Base de datos: facturacion_test
 */
import crypto from 'crypto';
import { Pool } from 'pg';
import {
  generarTokenAcceso,
  validarTokenAcceso,
  revocarTokensComprobante,
  rotarTokenAcceso,
  registrarAuditoriaAcceso,
  hashToken
} from '../src/services/comprobante-token-service.js';
import { generarPortalComprobanteHTML } from '../src/services/portal-viewer-renderer.js';
import { obtenerOgenerarFacturaPDF, invalidarCachePDF } from '../src/services/pdf-generator.js';

const TEST_DB = 'facturacion_test';
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL no definida.');

const url = new URL(databaseUrl);
const configuredDb = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
if (configuredDb !== TEST_DB) {
  throw new Error(`CRÍTICO: Intentando ejecutar en ${configuredDb}, se requiere ${TEST_DB}`);
}

const pool = new Pool({ connectionString: databaseUrl, max: 10 });

let passed = 0;
let total = 0;

async function test(name: string, fn: () => Promise<void>) {
  total++;
  process.stdout.write(`Prueba ${total}: ${name}... `);
  try {
    await fn();
    console.log('PASÓ ✓');
    passed++;
  } catch (err: any) {
    console.log('FALLÓ ✗');
    console.error(`  Error: ${err.message}`);
    throw err;
  }
}

async function createTenantWithComprobante(slug: string, claveSuffix = '001') {
  const tenantId = crypto.randomUUID();
  const clave = `50621112600310199999900100001010000000000${claveSuffix}`;
  const consecutivo = `0010000101000000000${claveSuffix}`;

  const tenantRes = await pool.query(
    `INSERT INTO tenants (id, nombre, cedula, slug, activo)
     VALUES ($1, $2, '3-101-999999', $3, TRUE)
     ON CONFLICT (slug) DO UPDATE SET activo = TRUE
     RETURNING id`,
    [tenantId, `Empresa Portal ${slug}`, slug]
  );
  const actualTenantId = tenantRes.rows[0].id;

  await pool.query(
    `INSERT INTO tenant_configs (tenant_id, emisor_json)
     VALUES ($1, $2)
     ON CONFLICT (tenant_id) DO UPDATE SET emisor_json = $2`,
    [
      actualTenantId,
      JSON.stringify({
        emisor: {
          nombre: `Comercializadora ${slug} S.A.`,
          nombreComercial: `Tienda ${slug}`,
          identificacion: { tipo: '02', numero: '3101999999' },
          correo: `facturas@${slug}.cr`
        }
      })
    ]
  );

  const docOriginal = {
    clave,
    consecutivo,
    fechaEmision: new Date().toISOString(),
    emisor: {
      nombre: `Comercializadora ${slug} S.A.`,
      identificacion: { tipo: '02', numero: '3101999999' }
    },
    receptor: {
      nombre: 'Cliente de Prueba S.A.',
      identificacion: { tipo: '02', numero: '3102123456' },
      correo: 'cliente@ejemplo.cr'
    },
    lineas: [
      {
        numeroLinea: 1,
        detalle: 'Consultoría Especializada en Sistemas',
        codigoCabys: '8314100000000',
        cantidad: 1,
        unidadMedida: 'Unid',
        precioUnitario: 50000,
        montoTotal: 50000,
        tarifaIVA: 13,
        montoIVA: 6500,
        montoTotalLinea: 56500
      }
    ],
    resumen: {
      totalServGravados: 50000,
      totalMercanciasGravadas: 0,
      totalImpuesto: 6500,
      totalComprobante: 56500
    }
  };

  const xmlFirmado = `<?xml version="1.0" encoding="utf-8"?><FacturaElectronica><Clave>${clave}</Clave><NumeroConsecutivo>${consecutivo}</NumeroConsecutivo><TotalComprobante>56500</TotalComprobante><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignatureValue>MOCK_FIRMA_${slug}</ds:SignatureValue></ds:Signature></FacturaElectronica>`;

  await pool.query(
    `INSERT INTO comprobantes (tenant_id, clave, consecutivo, tipo_documento, fecha, moneda, total, cliente, estado_hacienda, xml_firmado, doc_original_json)
     VALUES ($1, $2, $3, '01', NOW(), 'CRC', 56500.00, 'Cliente de Prueba S.A.', 'aceptado', $4, $5)
     ON CONFLICT (tenant_id, clave) DO UPDATE SET total = 56500.00, estado_hacienda = 'aceptado'`,
    [actualTenantId, clave, consecutivo, xmlFirmado, JSON.stringify(docOriginal)]
  );

  // Limpiar tokens residuales y auditorías de ejecuciones previas para idempotencia estricta
  await pool.query('DELETE FROM comprobantes_tokens_acceso WHERE tenant_id = $1', [actualTenantId]);
  await pool.query('DELETE FROM auditoria_descargas_comprobantes WHERE tenant_id = $1', [actualTenantId]);

  return { tenantId: actualTenantId, clave, consecutivo, xmlFirmado, docOriginal };
}

async function run() {
  console.log('======================================================================');
  console.log('  MEETINFACT — PORTAL DE COMPROBANTES: SUITE DE AUDITORÍA Y SEGURIDAD');
  console.log('  Base de datos objetivo: ' + configuredDb);
  console.log('======================================================================\n');

  // ------------------------------------------------------------------
  // 1. GENERACIÓN Y HASHING CRIPTOGRÁFICO DE TOKENS (256 BITS)
  // ------------------------------------------------------------------
  await test('1. Token se genera con 256 bits de entropía y solo persiste hash SHA-256', async () => {
    const { tenantId, clave } = await createTenantWithComprobante('tkn-gen', '101');
    const { rawToken, expiraEn, tokenHash } = await generarTokenAcceso(tenantId, clave, 90);

    if (!rawToken || rawToken.length < 42) {
      throw new Error(`Longitud insuficiente para token de 256 bits: ${rawToken?.length}`);
    }

    // Verificar que tokenHash calculado coincide exactamente con SHA-256
    const expectedHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    if (tokenHash !== expectedHash) {
      throw new Error('El tokenHash generado no corresponde al SHA-256 del rawToken');
    }

    // Verificar en BD que solo existe el hash y NUNCA el rawToken
    const dbRow = (await pool.query('SELECT * FROM comprobantes_tokens_acceso WHERE token_hash = $1', [tokenHash])).rows[0];
    if (!dbRow) throw new Error('Token hash no fue encontrado en base de datos');
    if (JSON.stringify(dbRow).includes(rawToken)) {
      throw new Error('SEGURIDAD CRÍTICA: El rawToken fue almacenado en la base de datos');
    }
  });

  // ------------------------------------------------------------------
  // 2. VALIDACIÓN Y RESCATE DE DATOS
  // ------------------------------------------------------------------
  await test('2. Token válido rescata comprobante completo y actualiza contador de accesos', async () => {
    const { tenantId, clave } = await createTenantWithComprobante('tkn-val', '102');
    const { rawToken } = await generarTokenAcceso(tenantId, clave, 90);

    const comp = await validarTokenAcceso(rawToken);
    if (!comp) throw new Error('Token válido fue rechazado');
    if (comp.clave !== clave) throw new Error(`Clave no coincide: ${comp.clave} vs ${clave}`);
    if (comp.tenantId !== tenantId) throw new Error('Tenant ID no coincide');
    if (comp.total !== 56500) throw new Error(`Total no coincide: ${comp.total}`);
    if (comp.estadoHacienda !== 'aceptado') throw new Error('Estado de Hacienda no coincide');

    // Esperar actualización asíncrona de métricas
    await new Promise(r => setTimeout(r, 100));
    const tokenDb = (await pool.query('SELECT accesos_contador, ultimo_acceso FROM comprobantes_tokens_acceso WHERE token_hash = $1', [hashToken(rawToken)])).rows[0];
    if (tokenDb.accesos_contador < 1) throw new Error('Contador de accesos no se incrementó');
    if (!tokenDb.ultimo_acceso) throw new Error('ultimo_acceso no registrado');
  });

  // ------------------------------------------------------------------
  // 3. PROTECCIÓN CONTRA MANIPULACIÓN (ANTI-TAMPERING)
  // ------------------------------------------------------------------
  await test('3. Alteración de 1 solo carácter en el token es rechazada (HTTP 404)', async () => {
    const { tenantId, clave } = await createTenantWithComprobante('tkn-tamper', '103');
    const { rawToken } = await generarTokenAcceso(tenantId, clave, 90);

    // Alterar el último carácter
    const tamperedToken = rawToken.slice(0, -1) + (rawToken.slice(-1) === 'A' ? 'B' : 'A');
    const comp = await validarTokenAcceso(tamperedToken);
    if (comp !== null) {
      throw new Error('Token alterado fue aceptado');
    }

    // Token vacío o con caracteres ilegales
    if (await validarTokenAcceso('') !== null) throw new Error('Token vacío fue aceptado');
    if (await validarTokenAcceso('abc!@#$%^&*()') !== null) throw new Error('Token con caracteres ilegales fue aceptado');
  });

  // ------------------------------------------------------------------
  // 4. AISLAMIENTO ESTRICTO MULTI-TENANT
  // ------------------------------------------------------------------
  await test('4. Aislamiento multi-tenant: Token de Empresa A jamás accede a Empresa B', async () => {
    const empresaA = await createTenantWithComprobante('tenant-a', '201');
    const empresaB = await createTenantWithComprobante('tenant-b', '202');

    const tokenA = await generarTokenAcceso(empresaA.tenantId, empresaA.clave, 90);
    const tokenB = await generarTokenAcceso(empresaB.tenantId, empresaB.clave, 90);

    // Validar token A
    const compA = await validarTokenAcceso(tokenA.rawToken);
    if (!compA || compA.tenantId !== empresaA.tenantId) throw new Error('Token A no resolvió Tenant A');

    // Intentar alterar comprobante en BD vinculando clave de B a Tenant A
    let fkBlocked = false;
    try {
      await pool.query(
        `INSERT INTO comprobantes_tokens_acceso (tenant_id, clave, token_hash, expira_en)
         VALUES ($1, $2, $3, NOW() + INTERVAL '1 day')`,
        [empresaA.tenantId, empresaB.clave, crypto.createHash('sha256').update('spoof').digest('hex')]
      );
    } catch (err: any) {
      fkBlocked = true;
    }
    if (!fkBlocked) {
      throw new Error('La clave foránea compuesta (tenant_id, clave) debió bloquear inserción cruzada');
    }
  });

  // ------------------------------------------------------------------
  // 5. EXPIRACIÓN TEMPORAL DE TOKENS
  // ------------------------------------------------------------------
  await test('5. Token expirado es rechazado inmediatamente (retorna null / 404)', async () => {
    const { tenantId, clave } = await createTenantWithComprobante('tkn-exp', '301');
    const { rawToken, tokenHash } = await generarTokenAcceso(tenantId, clave, 90);

    // Forzar expiración en el pasado
    await pool.query(
      `UPDATE comprobantes_tokens_acceso SET expira_en = NOW() - INTERVAL '1 hour' WHERE token_hash = $1`,
      [tokenHash]
    );

    const comp = await validarTokenAcceso(rawToken);
    if (comp !== null) {
      throw new Error('Token expirado fue validado como activo');
    }
  });

  // ------------------------------------------------------------------
  // 6. REVOCACIÓN Y ROTACIÓN DE TOKENS
  // ------------------------------------------------------------------
  await test('6. Revocación inmediata y rotación de tokens', async () => {
    const { tenantId, clave } = await createTenantWithComprobante('tkn-rot', '401');
    const token1 = await generarTokenAcceso(tenantId, clave, 90);

    // Revocar
    const revocados = await revocarTokensComprobante(tenantId, clave);
    if (revocados !== 1) throw new Error(`Cantidad revocada incorrecta: ${revocados}`);

    const checkRev = await validarTokenAcceso(token1.rawToken);
    if (checkRev !== null) throw new Error('Token revocado sigue activo');

    // Rotar (emite nuevo y revoca previos)
    const tokenNuevo = await rotarTokenAcceso(tenantId, clave, 90);
    const checkNuevo = await validarTokenAcceso(tokenNuevo.rawToken);
    if (!checkNuevo) throw new Error('Nuevo token generado en rotación no es válido');
    if (tokenNuevo.rawToken === token1.rawToken) throw new Error('Token rotado debe ser diferente');
  });

  // ------------------------------------------------------------------
  // 7. INTEGRIDAD BIT A BIT DEL XML FIRMADO
  // ------------------------------------------------------------------
  await test('7. Integridad bit a bit del XML firmado descargado', async () => {
    const { tenantId, clave, xmlFirmado } = await createTenantWithComprobante('tkn-xml', '501');
    const { rawToken } = await generarTokenAcceso(tenantId, clave, 90);

    const comp = await validarTokenAcceso(rawToken);
    if (!comp) throw new Error('Comprobante no disponible');

    const expectedHash = crypto.createHash('sha256').update(xmlFirmado).digest('hex');
    const deliveredHash = crypto.createHash('sha256').update(comp.xmlFirmado).digest('hex');

    if (expectedHash !== deliveredHash) {
      throw new Error(`Hash SHA-256 no coincide. Esperado: ${expectedHash}, Recibido: ${deliveredHash}`);
    }
    if (comp.xmlFirmado !== xmlFirmado) {
      throw new Error('Contenido del XML fue alterado');
    }
  });

  // ------------------------------------------------------------------
  // 8. BITÁCORA DE AUDITORÍA DE ACCESOS Y DESCARGAS
  // ------------------------------------------------------------------
  await test('8. Registro de auditoría para visualizaciones y descargas', async () => {
    const { tenantId, clave } = await createTenantWithComprobante('tkn-audit', '601');

    await registrarAuditoriaAcceso({
      tenantId,
      clave,
      tipoAccion: 'view_html',
      ipOrigen: '190.7.215.209',
      userAgent: 'Mozilla/5.0 Test Suite'
    });

    await registrarAuditoriaAcceso({
      tenantId,
      clave,
      tipoAccion: 'download_pdf',
      ipOrigen: '190.7.215.209',
      userAgent: 'Mozilla/5.0 Test Suite'
    });

    await registrarAuditoriaAcceso({
      tenantId,
      clave,
      tipoAccion: 'download_xml',
      ipOrigen: '190.7.215.209',
      userAgent: 'Mozilla/5.0 Test Suite'
    });

    const rows = (await pool.query(
      'SELECT tipo_accion, ip_origen, user_agent FROM auditoria_descargas_comprobantes WHERE tenant_id = $1 AND clave = $2 ORDER BY fecha ASC',
      [tenantId, clave]
    )).rows;

    if (rows.length !== 3) throw new Error(`Esperadas 3 filas de auditoría, obtenidas: ${rows.length}`);
    if (rows[0].tipo_accion !== 'view_html') throw new Error('Acción 1 no es view_html');
    if (rows[1].tipo_accion !== 'download_pdf') throw new Error('Acción 2 no es download_pdf');
    if (rows[2].tipo_accion !== 'download_xml') throw new Error('Acción 3 no es download_xml');
    if (String(rows[0].ip_origen) !== '190.7.215.209') throw new Error('IP no coincide');
  });

  // ------------------------------------------------------------------
  // 9. VISUALIZADOR RESPONSIVE CON ESTADO REAL DE HACIENDA
  // ------------------------------------------------------------------
  await test('9. Visualizador HTML responsive refleja estado real de Hacienda', async () => {
    const compAceptado = await createTenantWithComprobante('tkn-ui-ok', '701');
    const { rawToken } = await generarTokenAcceso(compAceptado.tenantId, compAceptado.clave, 90);
    const dataAceptado = (await validarTokenAcceso(rawToken))!;

    const htmlOk = await generarPortalComprobanteHTML(dataAceptado, rawToken);
    if (!htmlOk.includes('Autorizado por Ministerio de Hacienda')) {
      throw new Error('Badge de aceptación tributaria no encontrado en el HTML');
    }
    if (!htmlOk.includes(compAceptado.clave)) {
      throw new Error('Clave de 50 dígitos no encontrada en el HTML');
    }
    if (!htmlOk.includes(`/c/${rawToken}/pdf`)) {
      throw new Error('Enlace de descarga PDF no encontrado');
    }
    if (!htmlOk.includes(`/c/${rawToken}/xml`)) {
      throw new Error('Enlace de descarga XML no encontrado');
    }

    // Probar con comprobante rechazado
    dataAceptado.estadoHacienda = 'rechazado';
    const htmlRechazado = await generarPortalComprobanteHTML(dataAceptado, rawToken);
    if (!htmlRechazado.includes('Comprobante Rechazado por Hacienda')) {
      throw new Error('Estado rechazado no se reflejó correctamente');
    }
    if (htmlRechazado.includes('Autorizado por Ministerio de Hacienda')) {
      throw new Error('Comprobante rechazado no debe mostrarse como autorizado');
    }
  });

  // ------------------------------------------------------------------
  // 10. GENERACIÓN Y CACHÉ PROTEGIDA DE PDF
  // ------------------------------------------------------------------
  await test('10. Descarga de PDF con caché protegida y mutex concurrente', async () => {
    const { tenantId, clave } = await createTenantWithComprobante('tkn-pdf-cache', '801');
    invalidarCachePDF(tenantId, clave);
    let invocacionesGenerador = 0;

    const dummyGenerator = async () => {
      invocacionesGenerador++;
      return `<html><body><h1>Factura PDF de Prueba</h1><p>Clave: ${clave}</p></body></html>`;
    };

    // Primera llamada: genera y almacena en caché
    const pdf1 = await obtenerOgenerarFacturaPDF(tenantId, clave, dummyGenerator);
    if (!Buffer.isBuffer(pdf1) || pdf1.length < 500) {
      throw new Error('Buffer de PDF generado no es válido');
    }
    if (invocacionesGenerador !== 1) {
      throw new Error(`Se esperaba 1 invocación al generador, hubo: ${invocacionesGenerador}`);
    }

    // Segunda llamada: debe servirse de caché en disco sin invocar el generador
    const pdf2 = await obtenerOgenerarFacturaPDF(tenantId, clave, dummyGenerator);
    if (invocacionesGenerador !== 1) {
      throw new Error('La segunda petición de PDF relanzó el generador en lugar de usar caché');
    }
    if (pdf1.length !== pdf2.length) {
      throw new Error('El PDF de caché difiere en tamaño');
    }

    // Peticiones simultáneas concurrentes: deben reutilizar la misma promesa
    const [c1, c2, c3] = await Promise.all([
      obtenerOgenerarFacturaPDF(tenantId, clave, dummyGenerator),
      obtenerOgenerarFacturaPDF(tenantId, clave, dummyGenerator),
      obtenerOgenerarFacturaPDF(tenantId, clave, dummyGenerator)
    ]);
    if (c1.length !== c2.length || c2.length !== c3.length) {
      throw new Error('Inconsistencia en respuestas concurrentes de PDF');
    }
  });

  console.log('\n======================================================================');
  console.log(`RESULTADO DE LA SUITE DEL PORTAL DE COMPROBANTES: ${passed}/${total} PRUEBAS EXITOSAS`);
  console.log('======================================================================\n');
}

run()
  .catch(err => {
    console.error('[FATAL PORTAL TEST]', err);
    process.exit(1);
  })
  .finally(() => pool.end());
