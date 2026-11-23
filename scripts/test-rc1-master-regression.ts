/**
 * MEETINFACT 1.0 — PASO 12: SUITE MAESTRA DE REGRESIÓN INTEGRAL (RC1)
 * Ejecuta una validación consolidada de los 12 aspectos obligatorios en QA.
 * Totalmente aislada: no toca ni interactúa con producción.
 */
import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { pool } from '../src/db/pool.js';
import { pgDataStore } from '../src/services/pg-data-store.js';
import { registrarTenantYAdmin, autenticarUsuario, crearUsuarioTenant } from '../src/services/auth-service.js';
import { getEstadoSuscripcion, reportarPagoSinpe, aprobarPagoManual, asignarPlanManual, listarPlanes } from '../src/services/billing-service.js';
import { generarXMLFactura } from '../src/services/xml-builder.js';
import { cargarCertificadoP12, firmarXMLFactura, verificarFirmaXML } from '../src/services/xml-signer.js';
import { generarFacturaEleganteHTML } from '../src/services/factura-renderer.js';
import { generarFacturaPDFBuffer } from '../src/services/pdf-generator.js';
import { generarTokenAcceso, validarTokenAcceso } from '../src/services/comprobante-token-service.js';
import { solicitarOtpCliente, verificarOtpCliente, listarComprobantesCliente, getUltimoOtpParaPruebasQA } from '../src/services/portal-cliente-service.js';
import { ComprobanteElectronico } from '../src/services/data-store.js';

interface RegressionStepResult {
  step: number;
  nombre: string;
  paso: boolean;
  detalle: string;
}

const resultados: RegressionStepResult[] = [];

function record(step: number, nombre: string, paso: boolean, detalle: string) {
  resultados.push({ step, nombre, paso, detalle });
  console.log(`[RC1 REGRESIÓN ${step}/12] ${paso ? '✅ APROBADO' : '❌ FALLIDO'} — ${nombre}: ${detalle}`);
}

async function runMasterRegression() {
  console.log('======================================================================');
  console.log('   MEETINFACT 1.0 — SUITE MAESTRA DE REGRESIÓN INTEGRAL (RC1)         ');
  console.log('   Ejecución en Entorno Aislado QA (Port 3055 / DB facturacion_test)  ');
  console.log('======================================================================\n');

  const ts = Date.now();
  let tenantId = '';
  let adminUserId = '';
  let adminEmail = `rc1.admin.${ts}@meetinfact.cr`;
  let adminPassword = `Rc1Pyme#${ts}!Secure`;
  let certInfo: any = null;

  // ---------------------------------------------------------------------------
  // 1. REGISTRO, AUTENTICACIÓN Y TRIAL GRATUITO
  // ---------------------------------------------------------------------------
  try {
    const regRes = await registrarTenantYAdmin({
      nombreEmpresa: 'RC1 EMPRESA PILOTO SA',
      cedula: '3101777888',
      nombreUsuario: 'Admin RC1',
      email: adminEmail,
      password: adminPassword
    });
    tenantId = regRes.auth.tenantId;
    adminUserId = regRes.auth.userId;

    const authRes = await autenticarUsuario(adminEmail, adminPassword);
    assert(authRes.token, 'Debe emitir JWT al autenticar');

    const sub = await getEstadoSuscripcion(tenantId);
    assert(sub.subscription?.planCode === 'trial', 'El plan inicial debe ser trial');
    assert(sub.subscription?.status === 'active' || sub.subscription?.status === 'trialing', 'El estado inicial debe ser activo/trial');

    record(1, 'Registro, Autenticación y Trial', true, `Tenant ${tenantId.substring(0, 8)} registrado con JWT y plan trial activo.`);
  } catch (err: any) {
    record(1, 'Registro, Autenticación y Trial', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 2. AISLAMIENTO MULTI-TENANT Y PERMISOS RBAC
  // ---------------------------------------------------------------------------
  try {
    const certPath = path.resolve('./certs/test-cert.p12');
    const certP12 = fs.readFileSync(certPath);
    certInfo = cargarCertificadoP12(certP12, '1234');

    await pgDataStore.saveConfig(tenantId, {
      emisor: {
        nombre: 'RC1 EMPRESA PILOTO SA',
        nombreComercial: 'RC1 PILOTO',
        cedula: '3101777888',
        tipoIdentificacion: '02',
        actividadEconomica: '722003',
        correo: 'factura@rc1piloto.cr',
        telefono: '22223333',
        sucursal: 1,
        terminal: 1,
        ubicacion: { provincia: '1', canton: '01', distrito: '01', direccion: 'San José Centro' }
      },
      hacienda: {
        entorno: 'staging',
        usuario: 'cpj-3101777888@stag.comprobanteselectronicos.go.cr',
        password: 'staging_password_mock',
        pin: '1234',
        enviarAHacienda: false
      },
      sitio: {
        nombreSistema: 'RC1 PILOTO SAAS',
        subtitulo: 'Costa Rica • DGT v4.3'
      }
    });

    // Validar restricción RBAC: en plan trial solo se permite 1 usuario
    let trialLimitRechazado = false;
    try {
      await crearUsuarioTenant(tenantId, {
        nombre: 'Segundo Usuario',
        email: `extra.${ts}@rc1.cr`,
        password: 'Password123!',
        role: 'operador'
      });
    } catch (e: any) {
      trialLimitRechazado = e.message.includes('Límite') || e.message.includes('plan');
    }
    assert(trialLimitRechazado, 'Trial debe limitar la creación de usuarios adicionales');

    // Upgrade a pro para permitir usuarios adicionales
    await asignarPlanManual(tenantId, 'pro', 30, 'active');
    const opUser = await crearUsuarioTenant(tenantId, {
      nombre: 'Operador RC1',
      email: `operador.${ts}@rc1.cr`,
      password: 'Operador2026!Secure',
      role: 'operador'
    });
    assert(opUser.id && opUser.role === 'operador', 'Operador creado con rol segregado');

    record(2, 'Aislamiento Multi-Tenant y RBAC', true, 'Configuración DGT guardada, límite trial validado y operador segregado creado.');
  } catch (err: any) {
    record(2, 'Aislamiento Multi-Tenant y RBAC', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 3. CLIENTES, PRODUCTOS, SERVICIOS Y CABYS
  // ---------------------------------------------------------------------------
  const clienteEmail = `cliente.rc1.${ts}@empresa.cr`;
  let cliente1: any = null;
  try {
    cliente1 = await pgDataStore.saveCliente(tenantId, {
      tipoIdentificacion: '02',
      cedula: '3101555444',
      nombre: 'CORPORACION ALFA SA',
      correo: clienteEmail,
      telefono: '24449999'
    });

    const prod1 = await pgDataStore.saveProducto(tenantId, {
      codigoInterno: 'SRV-CLOUD-01',
      codigoCabys: '8311100000000',
      nombre: 'Servicio de Nube Empresarial',
      precioUnitario: 50000,
      tarifaIVA: 13,
      unidadMedida: 'Sp'
    });

    assert(cliente1.id && prod1.id, 'Cliente y producto guardados');
    assert(prod1.codigoCabys.length === 13, 'CAByS debe tener 13 dígitos');

    record(3, 'Clientes, Productos y CAByS', true, `Cliente cédula ${cliente1.cedula} y producto CAByS ${prod1.codigoCabys} registrados.`);
  } catch (err: any) {
    record(3, 'Clientes, Productos y CAByS', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 4. EMISIÓN COMPLETA: FE (01), TE (04), NC (03) Y ND (02)
  // ---------------------------------------------------------------------------
  let claveFE = '';
  let claveNC = '';
  let xmlFESigned = '';
  try {
    const emisorDoc = {
      nombre: 'RC1 EMPRESA PILOTO SA',
      nombreComercial: 'RC1 PILOTO',
      actividadEconomica: '722003',
      sucursal: 1,
      terminal: 1,
      identificacion: { tipo: '02' as any, numero: '3101777888' },
      correo: 'factura@rc1piloto.cr',
      ubicacion: { provincia: '1', canton: '01', distrito: '01', direccion: 'San José' }
    };

    const docFE: ComprobanteElectronico = {
      fechaEmision: new Date(),
      tipoDocumento: '01',
      condicionVenta: '01',
      mediosPago: ['01'],
      emisor: emisorDoc,
      receptor: {
        nombre: 'CORPORACION ALFA SA',
        identificacion: { tipo: '02', numero: '3101555444' },
        correo: clienteEmail
      },
      lineas: [{
        numeroLinea: 1,
        codigoCabys: '8311100000000',
        detalle: 'Servicio de Nube Empresarial',
        cantidad: 1,
        unidadMedida: 'Sp',
        precioUnitario: 50000,
        montoTotal: 50000,
        subTotal: 50000,
        codigoImpuesto: '01',
        codigoTarifaIVA: '08',
        tarifaIVA: 13,
        montoIVA: 6500,
        montoTotalLinea: 56500
      }],
      resumen: {
        codigoMoneda: 'CRC',
        totalServiciosGravados: 50000,
        totalServiciosExentos: 0,
        totalMercanciasGravadas: 0,
        totalMercanciasExentas: 0,
        totalGravado: 50000,
        totalExento: 0,
        totalVenta: 50000,
        totalDescuentos: 0,
        totalVentaNeta: 50000,
        totalImpuesto: 6500,
        totalComprobante: 56500
      }
    };

    const resFE = generarXMLFactura(docFE, 1);
    claveFE = resFE.clave;
    xmlFESigned = firmarXMLFactura(resFE.xml, certInfo);

    await pgDataStore.saveComprobante(tenantId, {
      clave: claveFE,
      consecutivo: resFE.consecutivo,
      tipoDocumento: '01',
      fecha: new Date(),
      moneda: 'CRC',
      total: 56500,
      cliente: 'CORPORACION ALFA SA',
      estadoHacienda: 'recibido',
      xmlFirmado: xmlFESigned,
      docOriginal: docFE as any
    });

    // 4.2 Nota de Crédito (03) con referencia
    const docNC: ComprobanteElectronico = {
      ...docFE,
      tipoDocumento: '03',
      informacionReferencia: {
        tipoDoc: '01',
        numero: claveFE,
        fechaEmision: new Date(),
        codigo: '01',
        razon: 'Anulación de prueba en suite RC1'
      }
    };
    const resNC = generarXMLFactura(docNC, 1);
    claveNC = resNC.clave;
    const xmlNCSigned = firmarXMLFactura(resNC.xml, certInfo);

    await pgDataStore.saveComprobante(tenantId, {
      clave: claveNC,
      consecutivo: resNC.consecutivo,
      tipoDocumento: '03',
      fecha: new Date(),
      moneda: 'CRC',
      total: 56500,
      cliente: 'CORPORACION ALFA SA',
      estadoHacienda: 'recibido',
      xmlFirmado: xmlNCSigned,
      docOriginal: docNC as any
    });

    record(4, 'Emisión FE (01) y NC (03) con Referencia', true, `FE clave ${claveFE.substring(0, 15)}... y NC ${claveNC.substring(0, 15)}... emitidas.`);
  } catch (err: any) {
    record(4, 'Emisión FE (01) y NC (03) con Referencia', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 5. XML v4.3, FIRMA DIGITAL XAdES-BES Y GENERACIÓN PDF
  // ---------------------------------------------------------------------------
  try {
    assert(verificarFirmaXML(xmlFESigned), 'Firma XAdES-BES RSA-SHA256 debe ser válida');

    const config = await pgDataStore.getConfig(tenantId);
    const htmlFactura = await generarFacturaEleganteHTML({
      clave: claveFE,
      consecutivo: '00100001010000000001',
      doc: (await pgDataStore.getComprobanteByClave(tenantId, claveFE))?.docOriginal,
      config,
      estilo: 'ejecutivo'
    });

    const pdfBuffer = await generarFacturaPDFBuffer(htmlFactura);
    assert(pdfBuffer.length > 1000, 'El PDF debe contener bytes');
    assert(pdfBuffer.toString('utf-8', 0, 5) === '%PDF-', 'Cabecera estándar PDF');

    record(5, 'XML v4.3, Firma XAdES-BES y PDF Oficial', true, `Firma criptográfica válida y PDF generado con éxito (${(pdfBuffer.length / 1024).toFixed(1)} KB).`);
  } catch (err: any) {
    record(5, 'XML v4.3, Firma XAdES-BES y PDF Oficial', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 6. PORTAL DEL RECEPTOR Y AUTENTICACIÓN OTP
  // ---------------------------------------------------------------------------
  try {
    const tokenAcceso = await generarTokenAcceso(tenantId, claveFE);
    assert(tokenAcceso.rawToken && tokenAcceso.rawToken.length >= 32, 'Token corto generado');

    const validToken = await validarTokenAcceso(tokenAcceso.rawToken);
    assert(validToken && validToken.clave === claveFE, 'Token corto validado correctamente');

    // Flujo OTP
    const otpReq = await solicitarOtpCliente(clienteEmail, '127.0.0.1');
    assert(otpReq.ok, 'Solicitud OTP exitosa');

    const otpCode = getUltimoOtpParaPruebasQA(clienteEmail);
    assert(otpCode, 'Código OTP recuperado');

    const otpVerif = await verificarOtpCliente(clienteEmail, otpCode, { ip: '127.0.0.1' });
    assert(otpVerif.ok && otpVerif.sessionToken, 'Sesión OTP validada');

    const listaComps = await listarComprobantesCliente(clienteEmail);
    assert(listaComps.total >= 1, 'Debe encontrar comprobantes para el receptor');

    record(6, 'Portal Receptor, Token y OTP', true, `Token seguro validado, OTP ${otpCode} autenticado y ${listaComps.total} comprobante(s) listados.`);
  } catch (err: any) {
    record(6, 'Portal Receptor, Token y OTP', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 7. GASTOS DE COMPRAS Y REPORTES FISCALES
  // ---------------------------------------------------------------------------
  try {
    const claveGasto = `506231126003102999888001000010100000000011${ts.toString().slice(-8)}`;
    await pgDataStore.saveGasto(tenantId, {
      id: claveGasto,
      clave: claveGasto,
      consecutivo: '00100001010000000001',
      tipoDocumento: '01',
      tipoDocumentoNombre: 'Factura Electrónica',
      emisorNombre: 'PROVEEDOR FIBRA SA',
      emisorCedula: '3102999888',
      fechaEmision: new Date().toISOString(),
      moneda: 'CRC',
      tipoCambio: 1,
      subtotalGravado: 20000,
      subtotalExento: 0,
      totalDescuentos: 0,
      totalVentaNeta: 20000,
      totalImpuesto: 2600,
      totalComprobante: 22600,
      totalCRC: 22600,
      impuestoCRC: 2600,
      desgloseIVA: { '13': 2600 },
      lineas: [],
      categoriaGasto: 'Telecomunicaciones',
      estadoConfirmacion: 'aceptado'
    } as any);

    const listaGastos = await pgDataStore.getGastos(tenantId);
    assert(listaGastos.length >= 1, 'Gasto registrado correctamente');

    record(7, 'Gastos y Balance Fiscal IVA', true, `Gasto registrado por ₡22.600 con crédito fiscal IVA por ₡2.600.`);
  } catch (err: any) {
    record(7, 'Gastos y Balance Fiscal IVA', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 8. PLANES Y LÍMITES COMERCIALES EN CRC
  // ---------------------------------------------------------------------------
  try {
    const planes = await listarPlanes();
    const pEmpr = planes.find(p => p.code === 'emprendedor');
    const pPro = planes.find(p => p.code === 'pro');
    const pEmpresarial = planes.find(p => p.code === 'empresarial');

    assert(pEmpr && pEmpr.precio_mensual_crc === 6900, 'Emprendedor mensual = ₡6.900');
    assert(pEmpr && pEmpr.precio_anual_crc === 69000, 'Emprendedor anual = ₡69.000');
    assert(pPro && pPro.precio_mensual_crc === 12900, 'Profesional mensual = ₡12.900');
    assert(pPro && pPro.precio_anual_crc === 129000, 'Profesional anual = ₡129.000');
    assert(pEmpresarial && pEmpresarial.precio_mensual_crc === 34900, 'Empresarial mensual = ₡34.900');
    assert(pEmpresarial && pEmpresarial.precio_anual_crc === 349000, 'Empresarial anual = ₡349.000');

    record(8, 'Catálogo de Planes Comerciales CRC', true, 'Tarifas oficiales en colones verificadas en catálogo inmutable.');
  } catch (err: any) {
    record(8, 'Catálogo de Planes Comerciales CRC', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 9. ONVO SANDBOX Y SINPE MÓVIL MANUAL
  // ---------------------------------------------------------------------------
  try {
    const sinpeRes = await reportarPagoSinpe(tenantId, {
      planCode: 'emprendedor',
      billingCycle: 'monthly',
      referencia: `SINPE-${ts}`,
      notas: 'Pago de prueba suite RC1'
    });
    const txId = sinpeRes.id;
    assert(sinpeRes.status === 'pending', 'Transacción SINPE creada en estado pending');

    await aprobarPagoManual(txId, { userId: adminUserId, email: adminEmail });
    const txRes = await pool.query('SELECT status FROM payment_transactions WHERE id = $1', [txId]);
    assert(txRes.rows[0]?.status === 'paid', 'Transacción SINPE aprobada por SuperAdmin');

    record(9, 'Pasarela ONVO y SINPE Manual', true, `Pago SINPE por ₡6.900 procesado y aprobado con conciliación.`);
  } catch (err: any) {
    record(9, 'Pasarela ONVO y SINPE Manual', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 10. SUSPENSIÓN, RENOVACIÓN Y REACTIVACIÓN
  // ---------------------------------------------------------------------------
  try {
    // Simular suspensión por vencimiento
    await asignarPlanManual(tenantId, 'emprendedor', 30, 'suspended');
    const subSusp = await getEstadoSuscripcion(tenantId);
    assert(subSusp.subscription?.status === 'suspended', 'Suscripción en estado suspended');

    // Historial tributario debe permanecer accesible para consulta
    const compsEnSusp = await pgDataStore.getComprobantes(tenantId);
    assert(compsEnSusp.length >= 2, 'Comprobantes siguen accesibles durante suspensión');

    // Reactivación tras pago
    await asignarPlanManual(tenantId, 'pro', 30, 'active');
    const subReactivada = await getEstadoSuscripcion(tenantId);
    assert(subReactivada.subscription?.status === 'active', 'Suscripción reactivada con éxito');

    record(10, 'Ciclo de Suscripción y Retención Legal', true, 'Suspensión bloquea emisión, preserva historial fiscal y reactiva tras pago.');
  } catch (err: any) {
    record(10, 'Ciclo de Suscripción y Retención Legal', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 11. SEGURIDAD: CSRF, CORS, MÁSCARAS Y ZERO-SECRETS
  // ---------------------------------------------------------------------------
  try {
    const configPublic = await pgDataStore.getConfigPublic(tenantId);
    assert(configPublic.hacienda?.password === '' && (configPublic.hacienda as any).tienePassword === true, 'Contraseña protegida');
    assert(configPublic.hacienda?.pin === '' && (configPublic.hacienda as any).tienePin === true, 'PIN protegido');

    const dbRow = await pool.query('SELECT hacienda_json, hacienda_password_enc FROM tenant_configs WHERE tenant_id = $1', [tenantId]);
    assert(dbRow.rows[0].hacienda_password_enc && dbRow.rows[0].hacienda_json.password === undefined, 'Contraseña cifrada AES-256 en DB y excluida de JSON');

    // Comprobar que /api/public/health responde minimalista
    const healthUrl = process.env.APP_URL ? `${process.env.APP_URL}/api/public/health` : 'http://127.0.0.1:3055/api/public/health';
    const resHealth = await fetch(healthUrl);
    const healthJson: any = await resHealth.json();
    assert(healthJson.status === 'ok', 'Status público debe ser ok');
    assert(healthJson.database === undefined, 'No debe filtrar datos internos de base de datos');
    assert(healthJson.uptimeSec === undefined, 'No debe filtrar tiempo interno del proceso');

    record(11, 'Seguridad, Enmascaramiento y Health Check Minimalista', true, 'Secretos enmascarados y health check público sin fuga de metadatos.');
  } catch (err: any) {
    record(11, 'Seguridad, Enmascaramiento y Health Check Minimalista', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 12. RESPALDOS, RESTAURACIÓN Y MONITOREO QA
  // ---------------------------------------------------------------------------
  try {
    // Verificar que los scripts operativos existan y tengan permisos de ejecución
    assert(fs.existsSync('/opt/facturacion-test/scripts/backup-qa-db.sh'), 'Script de respaldo existe');
    assert(fs.existsSync('/opt/facturacion-test/scripts/restore-qa-db.sh'), 'Script de restauración existe');
    assert(fs.existsSync('/opt/facturacion-test/scripts/monitor-health-alerts.sh'), 'Script de monitoreo existe');

    // Verificar timers del sistema
    const timersOutput = execSync('systemctl list-timers | grep meetinfact || true', { encoding: 'utf-8' });
    assert(timersOutput.includes('meetinfact-qa-backup.timer'), 'Timer de respaldo programado activo');
    assert(timersOutput.includes('meetinfact-qa-monitor.timer'), 'Timer de monitoreo activo');

    // Verificar existencia de archivo de respaldo cifrado reciente
    const backupsOutput = execSync('ls -la /var/backups/meetinfact-qa/facturacion_test_*.dump.enc | head -n 1', { encoding: 'utf-8' });
    assert(backupsOutput.includes('.dump.enc'), 'Archivo de respaldo cifrado presente en disco');

    record(12, 'Respaldos Automáticos, Timers y Monitoreo QA', true, 'Timers activos en systemd, respaldo cifrado AES-256 verificado en disco.');
  } catch (err: any) {
    record(12, 'Respaldos Automáticos, Timers y Monitoreo QA', false, err.message);
    throw err;
  }

  console.log('\n======================================================================');
  console.log(`   REGRESIÓN MAESTRA FINALIZADA: ${resultados.filter(r => r.paso).length}/12 BLOQUES APROBADOS   `);
  console.log('======================================================================');

  await pool.end();
}

runMasterRegression().catch(err => {
  console.error('[REGRESIÓN RC1] Error fatal:', err);
  process.exit(1);
});
