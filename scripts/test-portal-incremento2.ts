/**
 * MEETINFACT — PORTAL DE COMPROBANTES: SUITE DE PRUEBAS AUTOMATIZADAS (INCREMENTO 2)
 * Validación exhaustiva de autenticación OTP, sesiones temporales, anti-enumeración,
 * aislamiento por receptor y tenant, descargas seguras y auditoría.
 * 
 * Entorno objetivo: facturacion_test (PostgreSQL port 5433)
 */
import assert from 'assert';
import crypto from 'crypto';
import { Pool } from 'pg';
import {
  solicitarOtpCliente,
  verificarOtpCliente,
  validarSesionCliente,
  revocarSesionCliente,
  listarComprobantesCliente,
  obtenerComprobanteClienteAutorizado,
  registrarAuditoriaCliente,
  getUltimoOtpParaPruebasQA,
  limpiarAlmacenPruebasQA
} from '../src/services/portal-cliente-service.js';
import { generarClave, generarConsecutivo } from '../src/services/clave-generator.js';
import { generarXMLFactura } from '../src/services/xml-builder.js';
import { ComprobanteElectronico } from '../types/factura.types.js';

const TEST_DB = 'facturacion_test';
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl || !databaseUrl.includes(TEST_DB)) {
  console.log(`[AVISO] Omitiendo ejecución en base no QA (${databaseUrl})`);
  process.exit(0);
}

const pool = new Pool({ connectionString: databaseUrl });

async function runTestSuite() {
  console.log('======================================================================');
  console.log('  MEETINFACT — PORTAL DE COMPROBANTES: INCREMENTO 2');
  console.log('  Suite de Seguridad OTP, Sesiones, Aislamiento y Auditoría');
  console.log('  Base de datos objetivo: ' + TEST_DB);
  console.log('======================================================================\n');

  let total = 0;
  let exitosas = 0;

  async function test(nombre: string, fn: () => Promise<void>) {
    total++;
    process.stdout.write(`Prueba ${total}: ${nombre}... `);
    try {
      await fn();
      console.log('PASÓ ✓');
      exitosas++;
    } catch (err: any) {
      console.log('FALLÓ ✗');
      console.error(`  Error: ${err.message}\n${err.stack}`);
      throw err;
    }
  }

  // Identificadores de prueba
  const tenantA_id = '00000000-0000-0000-0000-000000000101';
  const tenantB_id = '00000000-0000-0000-0000-000000000102';
  const emailClienteA = 'cliente.alpha@empresa-a.cr';
  const emailClienteB = 'cliente.beta@empresa-b.cr';
  const emailInexistente = 'noexiste.receptor@fantasia.cr';

  // 0. Preparar esquema y datos de prueba
  await pool.query('DELETE FROM auditoria_descargas_comprobantes WHERE correo_solicitante IN ($1, $2)', [emailClienteA, emailClienteB]);
  await pool.query('DELETE FROM portal_clientes_sesiones WHERE email IN ($1, $2, $3)', [emailClienteA, emailClienteB, emailInexistente]);
  await pool.query('DELETE FROM portal_clientes_otp WHERE email IN ($1, $2, $3)', [emailClienteA, emailClienteB, emailInexistente]);
  await pool.query('DELETE FROM comprobantes_tokens_acceso WHERE tenant_id IN ($1, $2)', [tenantA_id, tenantB_id]);
  await pool.query('DELETE FROM comprobantes WHERE tenant_id IN ($1, $2)', [tenantA_id, tenantB_id]);
  await pool.query('DELETE FROM users WHERE tenant_id IN ($1, $2)', [tenantA_id, tenantB_id]);
  await pool.query('DELETE FROM tenants WHERE id IN ($1, $2)', [tenantA_id, tenantB_id]);

  // Insertar Tenants A y B
  await pool.query(`
    INSERT INTO tenants (id, nombre, slug, cedula, activo)
    VALUES 
      ($1, 'Alpha Solutions', 'alpha-solutions', '3101888111', TRUE),
      ($2, 'Beta Logistics', 'beta-logistics', '3101888222', TRUE)
    ON CONFLICT (id) DO NOTHING
  `, [tenantA_id, tenantB_id]);

  // Crear Factura 1 para Cliente A en Tenant A
  const consecutivoA1 = generarConsecutivo(1, 1, '01', 101);
  const docA1: ComprobanteElectronico = {
    tipoDocumento: '01',
    fechaEmision: new Date('2026-11-21T15:30:00-06:00'),
    emisor: {
      nombre: 'Empresa Proveedora Alpha S.A.',
      nombreComercial: 'Alpha Solutions',
      identificacion: { tipo: '02', numero: '3101888111' },
      actividadEconomica: '722000',
      sucursal: 1,
      terminal: 1,
      correo: 'facturacion@alpha.cr',
      ubicacion: { provincia: '1', canton: '01', distrito: '01', senas: 'San Jose' }
    },
    receptor: {
      nombre: 'Cliente Alpha Corporativo',
      identificacion: { tipo: '02', numero: '3102333444' },
      correo: emailClienteA
    },
    condicionVenta: '01',
    mediosPago: ['01'],
    lineas: [{
      numeroLinea: 1,
      codigoCabys: '8314100000000',
      detalle: 'Servicio Cloud Alpha',
      cantidad: 1,
      unidadMedida: 'Unid',
      precioUnitario: 50000,
      montoTotal: 50000,
      tarifaIVA: '13',
      montoIVA: 6500,
      montoTotalLinea: 56500
    }],
    resumen: {
      codigoMoneda: 'CRC',
      totalServGravados: 50000,
      totalMercanciasGravadas: 0,
      totalImpuesto: 6500,
      totalComprobante: 56500
    }
  };
  const xmlA1Obj = generarXMLFactura(docA1, 101);
  const claveA1 = xmlA1Obj.clave;

  await pool.query(`
    INSERT INTO comprobantes (
      tenant_id, clave, consecutivo, tipo_documento, fecha, moneda, total, cliente,
      estado_hacienda, estilo, notas, correo_cliente, correo_destinatario, xml_firmado, doc_original_json
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
  `, [
    tenantA_id, claveA1, consecutivoA1, '01', new Date('2026-11-21T15:30:00-06:00'),
    'CRC', 56500, 'Cliente Alpha Corporativo', 'aceptado', 'ejecutivo', '',
    emailClienteA, emailClienteA, xmlA1Obj.xml, docA1
  ]);

  // Crear Factura 2 para Cliente B en Tenant B
  const consecutivoB1 = generarConsecutivo(1, 1, '01', 201);
  const docB1: ComprobanteElectronico = {
    tipoDocumento: '01',
    fechaEmision: new Date('2026-11-21T16:00:00-06:00'),
    emisor: {
      nombre: 'Empresa Proveedora Beta S.A.',
      nombreComercial: 'Beta Logistics',
      identificacion: { tipo: '02', numero: '3101888222' },
      actividadEconomica: '602000',
      sucursal: 1,
      terminal: 1,
      correo: 'facturacion@beta.cr',
      ubicacion: { provincia: '1', canton: '01', distrito: '01', senas: 'Heredia' }
    },
    receptor: {
      nombre: 'Cliente Beta Transportes',
      identificacion: { tipo: '02', numero: '3102555666' },
      correo: emailClienteB
    },
    condicionVenta: '01',
    mediosPago: ['04'],
    lineas: [{
      numeroLinea: 1,
      codigoCabys: '6511100000000',
      detalle: 'Transporte de Carga Beta',
      cantidad: 1,
      unidadMedida: 'Unid',
      precioUnitario: 120,
      montoTotal: 120,
      tarifaIVA: '13',
      montoIVA: 15.6,
      montoTotalLinea: 135.6
    }],
    resumen: {
      codigoMoneda: 'USD',
      totalServGravados: 120,
      totalMercanciasGravadas: 0,
      totalImpuesto: 15.6,
      totalComprobante: 135.6
    }
  };
  const xmlB1Obj = generarXMLFactura(docB1, 201);
  const claveB1 = xmlB1Obj.clave;

  await pool.query(`
    INSERT INTO comprobantes (
      tenant_id, clave, consecutivo, tipo_documento, fecha, moneda, total, cliente,
      estado_hacienda, estilo, notas, correo_cliente, correo_destinatario, xml_firmado, doc_original_json
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
  `, [
    tenantB_id, claveB1, consecutivoB1, '01', new Date('2026-11-21T16:00:00-06:00'),
    'USD', 135.6, 'Cliente Beta Transportes', 'aceptado', 'moderno', '',
    emailClienteB, emailClienteB, xmlB1Obj.xml, docB1
  ]);

  // ============================================================================
  // SUITE DE PRUEBAS
  // ============================================================================

  // 1. Anti-enumeración: Solicitud con correo inexistente retorna el mismo mensaje y no genera OTP
  await test('1. Anti-enumeración: Correo no registrado devuelve mensaje uniforme sin generar OTP', async () => {
    limpiarAlmacenPruebasQA();
    const res = await solicitarOtpCliente(emailInexistente, '10.0.0.1', pool);
    assert.strictEqual(res.ok, true);
    assert.ok(res.mensaje.includes('Si la dirección de correo cuenta con comprobantes'));

    const otpGenerado = getUltimoOtpParaPruebasQA(emailInexistente);
    assert.strictEqual(otpGenerado, undefined, 'No debe generarse OTP para correo sin comprobantes');

    const dbRows = await pool.query('SELECT * FROM portal_clientes_otp WHERE email = $1', [emailInexistente]);
    assert.strictEqual(dbRows.rowCount, 0, 'No debe insertarse registro OTP en base de datos');
  });

  // 2. Generación segura de OTP y almacenamiento exclusivo de hash SHA-256
  let otpValidoA: string = '';
  await test('2. OTP criptográfico de 6 dígitos se genera y persiste únicamente como hash SHA-256', async () => {
    limpiarAlmacenPruebasQA();
    const res = await solicitarOtpCliente(emailClienteA, '10.0.0.2', pool);
    assert.strictEqual(res.ok, true);

    const otpQA = getUltimoOtpParaPruebasQA(emailClienteA);
    assert.ok(otpQA, 'Debe generarse un OTP en almacén QA para pruebas');
    assert.strictEqual(otpQA.length, 6, 'El código debe tener exactamente 6 dígitos');
    assert.ok(/^\d{6}$/.test(otpQA), 'El código debe ser estrictamente numérico');
    otpValidoA = otpQA;

    // Verificar en BD que el código plano NO está almacenado
    const dbRows = await pool.query('SELECT otp_hash FROM portal_clientes_otp WHERE email = $1 AND used = FALSE', [emailClienteA]);
    assert.strictEqual(dbRows.rowCount, 1);
    const storedHash = dbRows.rows[0].otp_hash;
    assert.notStrictEqual(storedHash, otpQA, 'El código plano jamás debe guardarse en la BD');

    const expectedHash = crypto.createHash('sha256').update(otpQA).digest('hex');
    assert.strictEqual(storedHash, expectedHash, 'El hash en base debe coincidir exactamente con SHA-256(otp)');
  });

  // 3. Control de Cooldown: Reenvío antes de 60 segundos es bloqueado
  await test('3. Cooldown de reenvío: Solicitud antes de 60s es bloqueada con indicación de espera', async () => {
    const res = await solicitarOtpCliente(emailClienteA, '10.0.0.2', pool);
    assert.strictEqual(res.ok, false);
    assert.ok(res.mensaje.includes('Por favor espere'));
    assert.ok(Number(res.cooldown) > 0 && Number(res.cooldown) <= 60);
  });

  // 4. Verificación de OTP erróneo incrementa intentos y calcula intentos restantes
  await test('4. Código erróneo es rechazado e incrementa intentos restantes', async () => {
    const res = await verificarOtpCliente(emailClienteA, '000000', { ip: '10.0.0.2' }, pool);
    assert.strictEqual(res.ok, false);
    assert.ok(res.error?.includes('incorrecto'));
    assert.strictEqual(res.intentosRestantes, 2);

    const dbRow = await pool.query('SELECT attempts, used FROM portal_clientes_otp WHERE email = $1 AND used = FALSE', [emailClienteA]);
    assert.strictEqual(dbRow.rows[0]?.attempts, 1);
  });

  // 5. Bloqueo al superar límite de 3 intentos fallidos
  await test('5. Agotamiento de intentos (3 fallos) quema e invalida el OTP', async () => {
    await verificarOtpCliente(emailClienteA, '111111', { ip: '10.0.0.2' }, pool); // Intento 2
    const resFinal = await verificarOtpCliente(emailClienteA, '222222', { ip: '10.0.0.2' }, pool); // Intento 3

    assert.strictEqual(resFinal.ok, false);
    assert.ok(resFinal.error?.includes('límite de intentos'));

    // Debe haberse marcado como used = TRUE
    const dbRow = await pool.query('SELECT used, attempts FROM portal_clientes_otp WHERE email = $1', [emailClienteA]);
    assert.strictEqual(dbRow.rows[0]?.used, true);
    assert.strictEqual(dbRow.rows[0]?.attempts, 3);
  });

  // 6. OTP vencido es rechazado
  await test('6. Código OTP con tiempo expirado es rechazado inmediatamente', async () => {
    // Insertar un OTP vencido en el pasado
    const expiredOtp = '999888';
    const expiredHash = crypto.createHash('sha256').update(expiredOtp).digest('hex');
    await pool.query(`
      INSERT INTO portal_clientes_otp (email, otp_hash, expires_at, created_at)
      VALUES ($1, $2, NOW() - INTERVAL '5 minutes', NOW() - INTERVAL '15 minutes')
    `, [emailClienteA, expiredHash]);

    const res = await verificarOtpCliente(emailClienteA, expiredOtp, { ip: '10.0.0.2' }, pool);
    assert.strictEqual(res.ok, false);
    assert.ok(res.error?.includes('expirado'));
  });

  // 7. OTP válido genera sesión temporal de 256 bits y se quema (un solo uso)
  let sessionTokenA: string = '';
  await test('7. OTP correcto genera sesión temporal de 256 bits y quema el código (un solo uso)', async () => {
    // Limpiar y solicitar un OTP fresco
    await pool.query('DELETE FROM portal_clientes_otp WHERE email = $1', [emailClienteA]);
    await solicitarOtpCliente(emailClienteA, '10.0.0.2', pool);
    const nuevoOtp = getUltimoOtpParaPruebasQA(emailClienteA)!;

    const authRes = await verificarOtpCliente(emailClienteA, nuevoOtp, { ip: '10.0.0.2', userAgent: 'QA Test Agent' }, pool);
    assert.strictEqual(authRes.ok, true);
    assert.ok(authRes.sessionToken);
    assert.strictEqual(authRes.sessionToken.length, 64, 'Token de 256 bits debe tener 64 caracteres hex');
    sessionTokenA = authRes.sessionToken;

    // Verificar que el OTP quedó quemado
    const otpDb = await pool.query('SELECT used FROM portal_clientes_otp WHERE email = $1 ORDER BY created_at DESC LIMIT 1', [emailClienteA]);
    assert.strictEqual(otpDb.rows[0]?.used, true, 'El código debe quedar marcado como used');

    // Intentar reutilizar el mismo código debe fallar
    const reusoRes = await verificarOtpCliente(emailClienteA, nuevoOtp, { ip: '10.0.0.2' }, pool);
    assert.strictEqual(reusoRes.ok, false, 'No se debe permitir reusar un código OTP');
  });

  // 8. Validación de sesión activa y persistencia segura de token_hash
  await test('8. Validación de sesión activa recupera identidad y valida token mediante SHA-256', async () => {
    const valRes = await validarSesionCliente(sessionTokenA, pool);
    assert.strictEqual(valRes.valid, true);
    assert.strictEqual(valRes.session?.email, emailClienteA);

    // En BD no existe sessionTokenA en texto plano
    const tokenHash = crypto.createHash('sha256').update(sessionTokenA).digest('hex');
    const dbRow = await pool.query('SELECT email FROM portal_clientes_sesiones WHERE token_hash = $1 AND revocado = FALSE', [tokenHash]);
    assert.strictEqual(dbRow.rowCount, 1);
  });

  // 9. Cierre de sesión (Logout) revoca el token inmediatamente
  await test('9. Cierre de sesión revoca token en base de datos y rechaza accesos posteriores', async () => {
    // Generar segunda sesión temporal para probar logout
    await pool.query('DELETE FROM portal_clientes_otp WHERE email = $1', [emailClienteA]);
    await solicitarOtpCliente(emailClienteA, '10.0.0.2', pool);
    const otpLogout = getUltimoOtpParaPruebasQA(emailClienteA)!;
    const authRes = await verificarOtpCliente(emailClienteA, otpLogout, {}, pool);
    const tokenRevocar = authRes.sessionToken!;

    const antesLogout = await validarSesionCliente(tokenRevocar, pool);
    assert.strictEqual(antesLogout.valid, true);

    const revocadoOk = await revocarSesionCliente(tokenRevocar, pool);
    assert.strictEqual(revocadoOk, true);

    const despuesLogout = await validarSesionCliente(tokenRevocar, pool);
    assert.strictEqual(despuesLogout.valid, false);
    assert.ok(despuesLogout.error?.includes('revocada'));
  });

  // 10. Aislamiento Multi-tenant y por Receptor en Consulta de Historial
  await test('10. Aislamiento estricto: Cliente A solo visualiza sus comprobantes autorizados', async () => {
    const listadoA = await listarComprobantesCliente(emailClienteA, {}, pool);
    assert.strictEqual(listadoA.total, 1);
    assert.strictEqual(listadoA.comprobantes[0].clave, claveA1);
    assert.strictEqual(listadoA.comprobantes[0].emisorNombre, 'Alpha Solutions');
    assert.strictEqual(listadoA.comprobantes[0].total, 56500);

    // Cliente A JAMÁS debe ver el comprobante del Cliente B
    const contieneB = listadoA.comprobantes.some(c => c.clave === claveB1);
    assert.strictEqual(contieneB, false, 'Cliente A no debe listar comprobantes de Cliente B');

    // Comprobar con Cliente B
    const listadoB = await listarComprobantesCliente(emailClienteB, {}, pool);
    assert.strictEqual(listadoB.total, 1);
    assert.strictEqual(listadoB.comprobantes[0].clave, claveB1);
    assert.strictEqual(listadoB.comprobantes[0].emisorNombre, 'Beta Logistics');
  });

  // 11. Filtros por fecha y tipo de documento en zona horaria oficial de Costa Rica
  await test('11. Filtros de historial por fecha, estado y tipo operan correctamente en hora oficial CR', async () => {
    // Filtro coincidente
    const filtroOk = await listarComprobantesCliente(emailClienteA, {
      fechaDesde: '2026-11-21',
      fechaHasta: '2026-11-21',
      tipoDocumento: '01',
      estado: 'aceptado'
    }, pool);
    assert.strictEqual(filtroOk.total, 1);

    // Filtro no coincidente por tipo (buscar Nota de Crédito 03)
    const filtroVacio = await listarComprobantesCliente(emailClienteA, {
      tipoDocumento: '03'
    }, pool);
    assert.strictEqual(filtroVacio.total, 0);

    // Filtro no coincidente por rango de fecha
    const filtroFecha = await listarComprobantesCliente(emailClienteA, {
      fechaDesde: '2026-11-22',
      fechaHasta: '2026-11-22'
    }, pool);
    assert.strictEqual(filtroFecha.total, 0);
  });

  // 12. Acceso y descarga autorizada de comprobante individual (XML y metadatos)
  await test('12. Acceso autorizado a comprobante y verificación de integridad bit a bit del XML', async () => {
    const docAutorizado = await obtenerComprobanteClienteAutorizado(emailClienteA, claveA1, pool);
    assert.ok(docAutorizado, 'Debe devolver el documento para el receptor autorizado');
    assert.strictEqual(docAutorizado.comprobante.clave, claveA1);
    assert.strictEqual(docAutorizado.emisorNombre, 'Alpha Solutions');

    // Integridad del XML
    const xmlSha = crypto.createHash('sha256').update(docAutorizado.comprobante.xmlFirmado).digest('hex');
    const xmlOriginalSha = crypto.createHash('sha256').update(xmlA1Obj.xml).digest('hex');
    assert.strictEqual(xmlSha, xmlOriginalSha, 'El XML entregado al cliente debe ser idéntico al emitido');

    // Intento de Cliente A de consultar comprobante de Cliente B debe retornar NULL (404)
    const docCruzado = await obtenerComprobanteClienteAutorizado(emailClienteA, claveB1, pool);
    assert.strictEqual(docCruzado, null, 'Intento de acceso cruzado debe ser denegado tajantemente');
  });

  // 13. Registro de Auditoría de accesos y descargas correlacionado con sesión de cliente
  await test('13. Auditoría registra eventos de consulta y descarga vinculados a sesión y correo', async () => {
    const sessionInfo = await validarSesionCliente(sessionTokenA, pool);
    const realSessionId = sessionInfo.session?.id || null;

    await registrarAuditoriaCliente(
      tenantA_id,
      claveA1,
      realSessionId,
      emailClienteA,
      'portal_visualizacion',
      '192.168.1.50',
      'Mozilla/5.0 Test Browser',
      pool
    );

    await registrarAuditoriaCliente(
      tenantA_id,
      claveA1,
      realSessionId,
      emailClienteA,
      'portal_descarga_xml',
      '192.168.1.50',
      'Mozilla/5.0 Test Browser',
      pool
    );

    const auditRows = await pool.query(
      `SELECT tipo_accion, correo_solicitante, ip_origen 
       FROM auditoria_descargas_comprobantes 
       WHERE clave = $1 AND correo_solicitante = $2 
       ORDER BY fecha ASC`,
      [claveA1, emailClienteA]
    );

    assert.strictEqual(auditRows.rowCount, 2);
    assert.strictEqual(auditRows.rows[0].tipo_accion, 'portal_visualizacion');
    assert.strictEqual(auditRows.rows[0].correo_solicitante, emailClienteA);
    assert.strictEqual(auditRows.rows[1].tipo_accion, 'portal_descarga_xml');
  });

  // 14. Regresión: Enlaces de token de un solo comprobante (Incremento 1) continúan operando
  await test('14. Regresión Incremento 1: Acceso mediante token de un solo comprobante preservado', async () => {
    const { generarTokenAcceso, validarTokenAcceso } = await import('../src/services/comprobante-token-service.js');
    const tokenInc1 = await generarTokenAcceso(tenantA_id, claveA1, 24, pool);
    assert.ok(tokenInc1.rawToken);

    const compValidado = await validarTokenAcceso(tokenInc1.rawToken, pool);
    assert.ok(compValidado);
    assert.strictEqual(compValidado.clave, claveA1);
    assert.strictEqual(compValidado.tenantId, tenantA_id);
  });

  // 15. Protección bajo concurrencia: Múltiples solicitudes simultáneas no burlan el rate limit ni el bloqueo
  await test('15. Concurrencia: Peticiones simultáneas respetan locks de transacción y cooldown', async () => {
    const concurrentEmail = 'concurrent.test@empresa.cr';
    // Insertar un comprobante para este correo
    await pool.query(`
      INSERT INTO comprobantes (tenant_id, clave, consecutivo, tipo_documento, fecha, moneda, total, cliente, estado_hacienda, estilo, notas, correo_cliente, correo_destinatario, xml_firmado, doc_original_json)
      VALUES ($1, '50621112600310188811100100001010000000999199999999', '00100001010000000999', '01', NOW(), 'CRC', 1000, 'Test Concurrente', 'aceptado', 'ejecutivo', '', $2, $2, '<xml/>', '{"receptor":{"correo":"concurrent.test@empresa.cr"}}')
    `, [tenantA_id, concurrentEmail]);

    // Ejecutar 3 solicitudes exactamente concurrentes
    const resultados = await Promise.all([
      solicitarOtpCliente(concurrentEmail, '10.0.0.10', undefined, pool),
      solicitarOtpCliente(concurrentEmail, '10.0.0.10', undefined, pool),
      solicitarOtpCliente(concurrentEmail, '10.0.0.10', undefined, pool)
    ]);

    // Una debe haber tenido éxito y las otras deben haber recibido cooldown / rate limit
    const exitosas = resultados.filter(r => r.ok).length;
    const bloqueadas = resultados.filter(r => !r.ok).length;
    assert.strictEqual(exitosas, 1, 'Exactamente 1 petición concurrente debe tener éxito');
    assert.strictEqual(bloqueadas, 2, 'Las peticiones concurrentes simultáneas deben ser bloqueadas por cooldown');

    // Limpiar comprobante de prueba
    await pool.query("DELETE FROM comprobantes WHERE clave = '50621112600310188811100100001010000000999199999999'");
    await pool.query('DELETE FROM portal_clientes_otp WHERE email = $1', [concurrentEmail]);
  });

  // 16. Aislamiento cuando se comparte correo electrónico: La cédula del receptor desambigua y aísla los comprobantes
  await test('16. Correo compartido: Receptor A con cédula 1 no accede a comprobantes de Receptor B con cédula 2', async () => {
    const sharedEmail = 'contabilidad.compartida@despacho.cr';
    const cedula1 = '3102111111';
    const cedula2 = '3102222222';
    const claveDoc1 = '50621112600310188811100100001010000000999111111111';
    const claveDoc2 = '50621112600310188811100100001010000000999222222222';

    // Insertar dos comprobantes para el mismo correo pero diferente cédula de receptor
    await pool.query(`
      INSERT INTO comprobantes (tenant_id, clave, consecutivo, tipo_documento, fecha, moneda, total, cliente, estado_hacienda, estilo, notas, correo_cliente, correo_destinatario, xml_firmado, doc_original_json)
      VALUES 
        ($1, $2, '00100001010000000111', '01', NOW(), 'CRC', 15000, 'Empresa Uno', 'aceptado', 'ejecutivo', '', $3, $3, '<xml/>', '{"receptor":{"correo":"contabilidad.compartida@despacho.cr","identificacion":{"tipo":"02","numero":"3102111111"}}}'),
        ($1, $4, '00100001010000000222', '01', NOW(), 'CRC', 25000, 'Empresa Dos', 'aceptado', 'ejecutivo', '', $3, $3, '<xml/>', '{"receptor":{"correo":"contabilidad.compartida@despacho.cr","identificacion":{"tipo":"02","numero":"3102222222"}}}')
    `, [tenantA_id, claveDoc1, sharedEmail, claveDoc2]);

    // Consultar historial filtrando por cédula del Receptor 1
    const listadoR1 = await listarComprobantesCliente(sharedEmail, { cedulaReceptor: cedula1 }, pool);
    assert.strictEqual(listadoR1.total, 1);
    assert.strictEqual(listadoR1.comprobantes[0].clave, claveDoc1);

    // Intentar obtener el documento del Receptor 2 usando la cédula del Receptor 1 debe retornar NULL
    const accesoCruzado = await obtenerComprobanteClienteAutorizado(sharedEmail, claveDoc2, cedula1, pool);
    assert.strictEqual(accesoCruzado, null, 'Receptor 1 no debe tener acceso al comprobante de Receptor 2');

    // Limpiar datos
    await pool.query('DELETE FROM comprobantes WHERE clave IN ($1, $2)', [claveDoc1, claveDoc2]);
  });

  console.log('\n======================================================================');
  console.log(`RESULTADO DE LA SUITE INCREMENTO 2: ${exitosas}/${total} PRUEBAS EXITOSAS`);
  console.log('======================================================================');
}

runTestSuite()
  .then(() => pool.end().then(() => process.exit(0)))
  .catch((err) => {
    console.error('Fallo crítico en suite de pruebas Incremento 2:', err);
    pool.end().then(() => process.exit(1));
  });
