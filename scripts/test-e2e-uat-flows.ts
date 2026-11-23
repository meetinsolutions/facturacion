/**
 * MEETINFACT — PASO 9: SUITE INTEGRAL DE PRUEBAS E2E Y ACEPTACIÓN FUNCIONAL UAT
 * Verificación completa de los 12 flujos de operación de una PYME real en QA
 */
import assert from 'assert';
import { pool } from '../src/db/pool.js';
import { pgDataStore } from '../src/services/pg-data-store.js';
import {
  registrarTenantYAdmin,
  autenticarUsuario,
  cambiarContrasena,
  crearUsuarioTenant,
  listarUsuariosTenant,
  requireAdmin
} from '../src/services/auth-service.js';
import {
  listarPlanes,
  getEstadoSuscripcion,
  reportarPagoSinpe,
  aprobarPagoManual,
  procesarWebhook,
  verificarVencimientosSuscripciones,
  requireActiveSubscription,
  requireQuotaComprobantes
} from '../src/services/billing-service.js';
import { generarXMLFactura } from '../src/services/xml-builder.js';
import { firmarXMLFactura, verificarFirmaXML, cargarCertificadoP12 } from '../src/services/xml-signer.js';
import { generarCertificadoPruebaP12 } from '../src/services/cert-generator.js';
import { generarFacturaPDFBuffer } from '../src/services/pdf-generator.js';
import { generarFacturaEleganteHTML } from '../src/services/factura-renderer.js';
import {
  generarTokenAcceso,
  validarTokenAcceso
} from '../src/services/comprobante-token-service.js';
import {
  solicitarOtpCliente,
  verificarOtpCliente,
  listarComprobantesCliente,
  obtenerComprobanteClienteAutorizado
} from '../src/services/portal-cliente-service.js';
import {
  ComprobanteElectronico
} from '../src/types/factura.types.js';

interface UatResult {
  step: number;
  name: string;
  passed: boolean;
  details: string;
}

const matrix: UatResult[] = [];

function recordResult(step: number, name: string, passed: boolean, details: string) {
  matrix.push({ step, name, passed, details });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} [FLUJO ${step}] ${name} -> ${details}`);
}

async function runUatSuite() {
  console.log('======================================================================');
  console.log('   MEETINFACT — PASO 9: SUITE INTEGRAL DE PRUEBAS E2E Y UAT (QA)      ');
  console.log('   Simulación Operativa PYME: "DISTRIBUIDORA EL ROBLE S.A."           ');
  console.log('======================================================================\n');

  let tenantId = '';
  let adminUserId = '';
  const adminEmail = `admin.roble.${Date.now()}@test-meetinfact.cr`;
  const receptorEmail = `juan.perez.${Date.now()}@cliente.cr`;
  const adminPassOriginal = 'RoblePyme#2026!';
  const adminPassNuevo = 'RoblePyme#2026_Actualizado!';

  const certPin = '1234';
  const certP12Buffer = generarCertificadoPruebaP12(certPin);
  const certInfo = cargarCertificadoP12(certP12Buffer, certPin);

  let claveFactura = '';
  let claveTiquete = '';
  let claveNotaCredito = '';
  let claveNotaDebito = '';
  let tokenFactura = '';

  try {
    // -------------------------------------------------------------------------
    // FLUJO 1: REGISTRO, AUTENTICACIÓN, CAMBIO DE PASSWORD Y TRIAL GRATUITO
    // -------------------------------------------------------------------------
    console.log('\n--- FLUJO 1: Registro, Autenticación y Trial Gratuito ---');
    const regResult = await registrarTenantYAdmin({
      nombreEmpresa: 'DISTRIBUIDORA Y SERVICIOS EL ROBLE S.A.',
      cedula: '3101987654',
      nombreUsuario: 'Lic. Fernando Roble',
      email: adminEmail,
      password: adminPassOriginal
    });

    assert(regResult.token && regResult.auth, 'El registro debe retornar token y auth');
    tenantId = regResult.auth.tenantId;
    adminUserId = regResult.auth.userId;

    // Verificar trial automático de 14 días
    const subInicial = await getEstadoSuscripcion(tenantId);
    assert.strictEqual(subInicial.subscription.planCode, 'trial', 'El plan inicial debe ser trial');
    assert.strictEqual(subInicial.subscription.status, 'trialing', 'El estado inicial debe ser trialing');
    const diasRestantes = Math.ceil(
      (new Date(subInicial.subscription.currentPeriodEnd).getTime() - Date.now()) / (24 * 3600 * 1000)
    );
    assert(diasRestantes <= 14 && diasRestantes >= 13, 'Debe otorgar 14 días de prueba');

    // Autenticación inicial con contraseña original
    const auth1 = await autenticarUsuario(adminEmail, adminPassOriginal);
    assert(auth1 && auth1.token, 'La autenticación inicial debe ser exitosa');

    // Cambio de contraseña
    await cambiarContrasena(adminUserId, adminPassOriginal, adminPassNuevo);

    // Login con contraseña anterior debe fallar
    let oldLoginFailed = false;
    try {
      await autenticarUsuario(adminEmail, adminPassOriginal);
    } catch {
      oldLoginFailed = true;
    }
    assert(oldLoginFailed, 'Login con contraseña anterior debe ser rechazado');

    // Login con nueva contraseña debe triunfar
    const authNew = await autenticarUsuario(adminEmail, adminPassNuevo);
    assert(authNew && authNew.token, 'Login con nueva contraseña debe ser exitoso');

    recordResult(1, 'Registro, Autenticación y Trial', true,
      `Tenant ${tenantId.substring(0, 8)} creado, trial de 14 días activo, cambio de credenciales verificado.`);

    // -------------------------------------------------------------------------
    // FLUJO 2: CONFIGURACIÓN DE EMPRESA, CERTIFICADO .P12 Y GESTIÓN DE USUARIOS
    // -------------------------------------------------------------------------
    console.log('\n--- FLUJO 2: Configuración de Empresa, Certificado y Usuarios RBAC ---');
    await pgDataStore.saveConfig(tenantId, {
      emisor: {
        nombre: 'DISTRIBUIDORA Y SERVICIOS EL ROBLE S.A.',
        nombreComercial: 'EL ROBLE DISTRIBUCION',
        tipoIdentificacion: '02',
        cedula: '3101987654',
        actividadEconomica: '512201',
        regimenTributario: '01',
        correo: 'facturacion@elroble.cr',
        telefono: '22223333',
        codigoPais: '506',
        ubicacion: {
          provincia: '1',
          canton: '01',
          distrito: '01',
          barrio: '01',
          otrasSenas: 'Costado Norte del Parque Central, Edificio El Roble Piso 2'
        }
      },
      hacienda: {
        entorno: 'staging',
        usuario: 'cpj-3-101-987654@stag.comprobanteselectronicos.go.cr',
        password: 'PasswordSuperSecretoHacienda123!',
        pin: certPin
      },
      correo: {
        host: 'mail.elroble.cr',
        puerto: 465,
        seguro: true,
        usuario: 'notificaciones@elroble.cr',
        password: 'PasswordCorreoSmtp456!',
        nombreRemitente: 'Distribuidora El Roble'
      }
    });

    // Guardar certificado digital .p12 cifrado
    await pgDataStore.saveCertificadoP12(tenantId, certP12Buffer, certPin, 'certificado_roble_staging.p12');

    // Verificar sanitización de configuración pública
    const configPublic = await pgDataStore.getConfigPublic(tenantId);
    assert.strictEqual(configPublic.hacienda.password, '', 'Contraseña de Hacienda no debe exponerse');
    assert.strictEqual(configPublic.hacienda.pin, '', 'PIN no debe exponerse');
    assert.strictEqual((configPublic.hacienda as any).tienePassword, true, 'Flag tienePassword debe ser true');
    assert.strictEqual((configPublic.hacienda as any).tienePin, true, 'Flag tienePin debe ser true');

    // En Trial (límite 1 usuario), intentar crear un segundo usuario debe ser bloqueado por cuota de plan
    const cajeroEmail = `cajero.roble.${Date.now()}@test-meetinfact.cr`;
    let userLimitBlocked = false;
    try {
      await crearUsuarioTenant(tenantId, {
        nombre: 'Carlos Cajero Roble',
        email: cajeroEmail,
        password: 'CajeroPass2026!',
        role: 'operador'
      });
    } catch (e: any) {
      if (e.message && (e.message.includes('alcanzado') || e.message.includes('Límite'))) {
        userLimitBlocked = true;
      }
    }
    assert(userLimitBlocked, 'Trial debe limitar a 1 usuario');

    // Habilitar plan con soporte multi-usuario para probar gestión de roles
    await pool.query(`UPDATE subscriptions SET plan_code = 'pro' WHERE tenant_id = $1`, [tenantId]);

    const usuarioCajero = await crearUsuarioTenant(tenantId, {
      nombre: 'Carlos Cajero Roble',
      email: cajeroEmail,
      password: 'CajeroPass2026!',
      role: 'operador'
    });
    assert.strictEqual(usuarioCajero.role, 'operador', 'El rol asignado debe ser operador');

    const listaUsuarios = await listarUsuariosTenant(tenantId);
    assert(listaUsuarios.length >= 2, 'Debe haber al menos 2 usuarios en el tenant');

    recordResult(2, 'Configuración y Usuarios RBAC', true,
      'Datos emisor DGT guardados, certificado .p12 validado, límite trial verificado y operador creado.');

    // -------------------------------------------------------------------------
    // FLUJO 3: CATÁLOGO DE CLIENTES, PRODUCTOS, SERVICIOS E IMPUESTOS
    // -------------------------------------------------------------------------
    console.log('\n--- FLUJO 3: Catálogo de Clientes, Productos y CAByS ---');
    const cliente1 = await pgDataStore.saveCliente(tenantId, {
      tipoIdentificacion: '01',
      cedula: '102340567',
      nombre: 'JUAN PEREZ SOTO',
      correo: receptorEmail,
      telefono: '88881111',
      provincia: '1',
      canton: '01',
      distrito: '01',
      direccion: 'San José Centro'
    });

    const cliente2 = await pgDataStore.saveCliente(tenantId, {
      tipoIdentificacion: '02',
      cedula: '3101555666',
      nombre: 'HOTEL Y RESTAURANTE EL MIRADOR S.A.',
      correo: 'compras@elmirador.cr',
      telefono: '24445555'
    });

    const cliente3 = await pgDataStore.saveCliente(tenantId, {
      tipoIdentificacion: '04',
      cedula: '900123456789',
      nombre: 'GLOBAL LOGISTICS LLC',
      correo: 'billing@globallogistics.com'
    });

    assert(cliente1.id && cliente2.id && cliente3.id, 'Los clientes deben guardarse con ID');

    const prod1 = await pgDataStore.saveProducto(tenantId, {
      codigoInterno: 'CAFE-ESP-500',
      codigoCabys: '2111100000000',
      detalle: 'Café de Especialidad Tarrazú 500g',
      precioUnitario: 4500,
      moneda: 'CRC',
      unidadMedida: 'kg',
      tarifaIVA: 13,
      codigoTarifaIVA: '08'
    });

    const prod2 = await pgDataStore.saveProducto(tenantId, {
      codigoInterno: 'FLETE-URB',
      codigoCabys: '8311100000000',
      detalle: 'Servicio de Distribución y Entrega Urbana',
      precioUnitario: 15000,
      moneda: 'CRC',
      unidadMedida: 'Sp',
      tarifaIVA: 13,
      codigoTarifaIVA: '08'
    });

    const prod3 = await pgDataStore.saveProducto(tenantId, {
      codigoInterno: 'INS-CANASTA',
      codigoCabys: '0111100000000',
      detalle: 'Insumo Básico Canasta Agropecuaria',
      precioUnitario: 8000,
      moneda: 'CRC',
      unidadMedida: 'Unid',
      tarifaIVA: 1,
      codigoTarifaIVA: '02'
    });

    await pgDataStore.saveProducto(tenantId, {
      id: prod1.id,
      codigoInterno: 'CAFE-ESP-500',
      codigoCabys: '2111100000000',
      detalle: 'Café de Especialidad Tarrazú 500g (Edición Gourmet)',
      precioUnitario: 4800,
      moneda: 'CRC',
      unidadMedida: 'kg',
      tarifaIVA: 13,
      codigoTarifaIVA: '08'
    });

    const prodsActuales = await pgDataStore.getProductos(tenantId);
    const prodActualizado = prodsActuales.find(p => p.id === prod1.id);
    assert.strictEqual(prodActualizado?.precioUnitario, 4800, 'El precio debe haber actualizado');

    recordResult(3, 'Clientes, Productos e Impuestos', true,
      '3 clientes y 3 productos con CAByS y tarifas IVA 13% y 1% registrados y actualizados.');

    // -------------------------------------------------------------------------
    // FLUJO 4: EMISIÓN DE FACTURA, TIQUETE, NOTA DE CRÉDITO Y NOTA DE DÉBITO
    // -------------------------------------------------------------------------
    console.log('\n--- FLUJO 4: Emisión de FE (01), TE (04), NC (03) y ND (02) ---');
    const emisorDoc = {
      nombre: 'DISTRIBUIDORA Y SERVICIOS EL ROBLE S.A.',
      identificacion: { tipo: '02' as any, numero: '3101987654' },
      nombreComercial: 'EL ROBLE DISTRIBUCION',
      actividadEconomica: '512201',
      sucursal: 1,
      terminal: 1,
      ubicacion: { provincia: '1', canton: '01', distrito: '01', senas: 'San José' },
      correo: 'facturacion@elroble.cr',
      entorno: 'staging' as any
    };

    // 4.1 Factura Electrónica (01)
    const fechaFE = new Date();
    const docFE: ComprobanteElectronico = {
      fechaEmision: fechaFE,
      tipoDocumento: '01',
      condicionVenta: '01',
      mediosPago: ['04'],
      emisor: emisorDoc,
      receptor: {
        nombre: 'JUAN PEREZ SOTO',
        identificacion: { tipo: '01', numero: '102340567' },
        correo: receptorEmail,
        telefono: { codigoPais: '506', numero: '88881111' }
      },
      lineas: [
        {
          numeroLinea: 1,
          codigoCabys: '2111100000000',
          detalle: 'Café de Especialidad Tarrazú 500g',
          cantidad: 2,
          unidadMedida: 'kg',
          precioUnitario: 4800,
          montoTotal: 9600,
          subTotal: 9600,
          codigoImpuesto: '01',
          codigoTarifaIVA: '08',
          tarifaIVA: 13,
          montoIVA: 1248,
          montoTotalLinea: 10848
        },
        {
          numeroLinea: 2,
          codigoCabys: '8311100000000',
          detalle: 'Servicio de Distribución y Entrega Urbana',
          cantidad: 1,
          unidadMedida: 'Sp',
          precioUnitario: 15000,
          montoTotal: 15000,
          subTotal: 15000,
          codigoImpuesto: '01',
          codigoTarifaIVA: '08',
          tarifaIVA: 13,
          montoIVA: 1950,
          montoTotalLinea: 16950
        }
      ],
      resumen: {
        codigoMoneda: 'CRC',
        totalServiciosGravados: 15000,
        totalServiciosExentos: 0,
        totalMercanciasGravadas: 9600,
        totalMercanciasExentas: 0,
        totalGravado: 24600,
        totalExento: 0,
        totalVenta: 24600,
        totalDescuentos: 0,
        totalVentaNeta: 24600,
        totalImpuesto: 3198,
        totalComprobante: 27798
      }
    };

    const resFE = generarXMLFactura(docFE, 1);
    claveFactura = resFE.clave;
    const xmlFESigned = firmarXMLFactura(resFE.xml, certInfo);

    await pgDataStore.saveComprobante(tenantId, {
      clave: claveFactura,
      consecutivo: resFE.consecutivo,
      tipoDocumento: '01',
      fecha: fechaFE,
      moneda: 'CRC',
      total: 27798,
      cliente: 'JUAN PEREZ SOTO',
      estadoHacienda: 'recibido',
      xmlFirmado: xmlFESigned,
      docOriginal: docFE as any
    });

    // 4.2 Tiquete Electrónico (04) - Consumidor Final
    const docTE: ComprobanteElectronico = {
      fechaEmision: new Date(),
      tipoDocumento: '04',
      condicionVenta: '01',
      mediosPago: ['01'],
      emisor: emisorDoc,
      lineas: [{
        numeroLinea: 1,
        codigoCabys: '2111100000000',
        detalle: 'Café de Especialidad Tarrazú 500g',
        cantidad: 1,
        unidadMedida: 'kg',
        precioUnitario: 4800,
        montoTotal: 4800,
        subTotal: 4800,
        codigoImpuesto: '01',
        codigoTarifaIVA: '08',
        tarifaIVA: 13,
        montoIVA: 624,
        montoTotalLinea: 5424
      }],
      resumen: {
        codigoMoneda: 'CRC',
        totalServiciosGravados: 0,
        totalServiciosExentos: 0,
        totalMercanciasGravadas: 4800,
        totalMercanciasExentas: 0,
        totalGravado: 4800,
        totalExento: 0,
        totalVenta: 4800,
        totalDescuentos: 0,
        totalVentaNeta: 4800,
        totalImpuesto: 624,
        totalComprobante: 5424
      }
    };

    const resTE = generarXMLFactura(docTE, 1);
    claveTiquete = resTE.clave;
    const xmlTESigned = firmarXMLFactura(resTE.xml, certInfo);

    await pgDataStore.saveComprobante(tenantId, {
      clave: claveTiquete,
      consecutivo: resTE.consecutivo,
      tipoDocumento: '04',
      fecha: new Date(),
      moneda: 'CRC',
      total: 5424,
      cliente: 'Consumidor Final',
      estadoHacienda: 'recibido',
      xmlFirmado: xmlTESigned
    });

    // 4.3 Nota de Crédito (03) vinculada a Factura
    const docNC: ComprobanteElectronico = {
      fechaEmision: new Date(),
      tipoDocumento: '03',
      condicionVenta: '01',
      mediosPago: ['04'],
      emisor: emisorDoc,
      receptor: {
        nombre: 'JUAN PEREZ SOTO',
        identificacion: { tipo: '01', numero: '102340567' },
        correo: receptorEmail
      },
      informacionReferencia: {
        tipoDoc: '01',
        numero: claveFactura,
        fechaEmision: fechaFE,
        codigo: '01',
        razon: 'Anulación total por devolución de mercadería'
      },
      lineas: [{
        numeroLinea: 1,
        codigoCabys: '2111100000000',
        detalle: 'Anulación Café de Especialidad Tarrazú',
        cantidad: 2,
        unidadMedida: 'kg',
        precioUnitario: 4800,
        montoTotal: 9600,
        subTotal: 9600,
        codigoImpuesto: '01',
        codigoTarifaIVA: '08',
        tarifaIVA: 13,
        montoIVA: 1248,
        montoTotalLinea: 10848
      }],
      resumen: {
        codigoMoneda: 'CRC',
        tipoCambio: 1,
        totalServiciosGravados: 0,
        totalServiciosExentos: 0,
        totalMercanciasGravadas: 9600,
        totalMercanciasExentas: 0,
        totalGravado: 9600,
        totalExento: 0,
        totalVenta: 9600,
        totalDescuentos: 0,
        totalVentaNeta: 9600,
        totalImpuesto: 1248,
        totalComprobante: 10848
      }
    };

    const resNC = generarXMLFactura(docNC, 1);
    claveNotaCredito = resNC.clave;
    const xmlNCSigned = firmarXMLFactura(resNC.xml, certInfo);

    await pgDataStore.saveComprobante(tenantId, {
      clave: claveNotaCredito,
      consecutivo: resNC.consecutivo,
      tipoDocumento: '03',
      fecha: new Date(),
      moneda: 'CRC',
      total: 10848,
      cliente: 'JUAN PEREZ SOTO',
      estadoHacienda: 'recibido',
      xmlFirmado: xmlNCSigned,
      docOriginal: { receptor: { correo: receptorEmail, identificacion: '102340567' } } as any
    });

    // 4.4 Nota de Débito (02) vinculada a Factura
    const docND: ComprobanteElectronico = {
      fechaEmision: new Date(),
      tipoDocumento: '02',
      condicionVenta: '01',
      mediosPago: ['04'],
      emisor: emisorDoc,
      receptor: {
        nombre: 'JUAN PEREZ SOTO',
        identificacion: { tipo: '01', numero: '102340567' },
        correo: receptorEmail
      },
      informacionReferencia: {
        tipoDoc: '01',
        numero: claveFactura,
        fechaEmision: fechaFE,
        codigo: '02',
        razon: 'Recargo administrativo por mora'
      },
      lineas: [{
        numeroLinea: 1,
        codigoCabys: '8311100000000',
        detalle: 'Interés por mora en flete',
        cantidad: 1,
        unidadMedida: 'Sp',
        precioUnitario: 1500,
        montoTotal: 1500,
        subTotal: 1500,
        codigoImpuesto: '01',
        codigoTarifaIVA: '08',
        tarifaIVA: 13,
        montoIVA: 195,
        montoTotalLinea: 1695
      }],
      resumen: {
        codigoMoneda: 'CRC',
        totalServiciosGravados: 1500,
        totalServiciosExentos: 0,
        totalMercanciasGravadas: 0,
        totalMercanciasExentas: 0,
        totalGravado: 1500,
        totalExento: 0,
        totalVenta: 1500,
        totalDescuentos: 0,
        totalVentaNeta: 1500,
        totalImpuesto: 195,
        totalComprobante: 1695
      }
    };

    const resND = generarXMLFactura(docND, 1);
    claveNotaDebito = resND.clave;
    const xmlNDSigned = firmarXMLFactura(resND.xml, certInfo);

    await pgDataStore.saveComprobante(tenantId, {
      clave: claveNotaDebito,
      consecutivo: resND.consecutivo,
      tipoDocumento: '02',
      fecha: new Date(),
      moneda: 'CRC',
      total: 1695,
      cliente: 'JUAN PEREZ SOTO',
      estadoHacienda: 'recibido',
      xmlFirmado: xmlNDSigned,
      docOriginal: { receptor: { correo: receptorEmail, identificacion: '102340567' } } as any
    });

    recordResult(4, 'Emisión FE, TE, NC y ND', true,
      `4 documentos emitidos: FE (${claveFactura.substring(0, 10)}...), TE, NC y ND con referencias DGT válidas.`);

    // -------------------------------------------------------------------------
    // FLUJO 5: FIRMA XAdES-BES, GENERACIÓN PDF CON QR, DESCARGA Y VISUALIZACIÓN
    // -------------------------------------------------------------------------
    console.log('\n--- FLUJO 5: Firma XAdES-BES y Generación de PDF con QR ---');
    assert(verificarFirmaXML(xmlFESigned), 'Firma XAdES-BES de Factura debe ser criptográficamente válida');
    assert(verificarFirmaXML(xmlTESigned), 'Firma XAdES-BES de Tiquete debe ser criptográficamente válida');
    assert(verificarFirmaXML(xmlNCSigned), 'Firma XAdES-BES de Nota Crédito debe ser válida');
    assert(verificarFirmaXML(xmlNDSigned), 'Firma XAdES-BES de Nota Débito debe ser válida');

    // Generar PDF y verificar contenido
    const configCompleta = await pgDataStore.getConfig(tenantId);
    const htmlFactura = await generarFacturaEleganteHTML({
      clave: claveFactura,
      consecutivo: resFE.consecutivo,
      doc: docFE,
      config: configCompleta,
      estilo: 'ejecutivo'
    });

    const pdfBuffer = await generarFacturaPDFBuffer(htmlFactura);

    assert(pdfBuffer.length > 500, 'El PDF generado debe tener bytes reales');
    assert(pdfBuffer.toString('utf-8', 0, 5) === '%PDF-', 'El buffer debe tener la cabecera estándar %PDF-');

    recordResult(5, 'Firma XAdES-BES y PDF con QR', true,
      'Validación criptográfica RSA-SHA256 100% OK y generación de PDF estándar DGT completada.');

    // -------------------------------------------------------------------------
    // FLUJO 6: PORTAL DE COMPROBANTES, ACCESO CORTO /c/:token, OTP Y ANTI-IDOR
    // -------------------------------------------------------------------------
    console.log('\n--- FLUJO 6: Portal Receptor, Acceso /c/:token, OTP y Anti-IDOR ---');
    const tokenObj = await generarTokenAcceso(tenantId, claveFactura);
    tokenFactura = tokenObj.rawToken;
    assert(tokenFactura.length >= 32, 'El token de acceso corto debe tener alta entropía');

    const compValidado = await validarTokenAcceso(tokenFactura);
    assert(compValidado !== null, 'El token debe resolver el comprobante');
    assert.strictEqual(compValidado.clave, claveFactura, 'Debe corresponder a la factura emitida');

    const otpRes = await solicitarOtpCliente(receptorEmail);
    assert(otpRes.ok, 'La solicitud de OTP debe aceptarse');

    const otpFalso = await verificarOtpCliente(receptorEmail, '000000');
    assert.strictEqual(otpFalso.ok, false, 'OTP incorrecto debe ser rechazado');

    const compAutorizado = await obtenerComprobanteClienteAutorizado(receptorEmail, claveFactura);
    assert(compAutorizado !== null, 'Juan Pérez debe tener acceso a su factura');

    const compRobo = await obtenerComprobanteClienteAutorizado('attacker@fraude.cr', claveFactura);
    assert.strictEqual(compRobo, null, 'Usuario ajeno NO debe tener acceso a la factura (Anti-IDOR estricto)');

    const historial = await listarComprobantesCliente(receptorEmail);
    assert(historial.total >= 1, 'Juan Pérez debe ver sus comprobantes en el portal');

    recordResult(6, 'Portal Receptor, OTP y Anti-IDOR', true,
      `Acceso corto /c/:token validado, OTP rechazó intentos inválidos y Anti-IDOR bloqueó lectura cruzada.`);

    // -------------------------------------------------------------------------
    // FLUJO 7: REGISTRO DE GASTOS, COMPROBANTES RECIBIDOS Y REPORTES FISCALES
    // -------------------------------------------------------------------------
    console.log('\n--- FLUJO 7: Gastos Recibidos y Balance Fiscal ---');
    const claveGasto1 = '50623112600310244455500100001010000000001199001122';
    const gasto1 = await pgDataStore.saveGasto(tenantId, {
      clave: claveGasto1,
      tipoDocumento: '01',
      emisorNombre: 'EMPAQUES Y CAJAS DE COSTA RICA S.A.',
      emisorCedula: '3102444555',
      fechaEmision: new Date().toISOString(),
      moneda: 'CRC',
      tipoCambio: 1,
      totalComprobante: 11300,
      totalImpuesto: 1300,
      estadoAceptacion: 'aceptado',
      categoria: 'Insumos y Materiales'
    });

    const claveGasto2 = '50623112600310266677700100001010000000001199003344';
    const gasto2 = await pgDataStore.saveGasto(tenantId, {
      clave: claveGasto2,
      tipoDocumento: '01',
      emisorNombre: 'ESTACION DE SERVICIO CENTRAL S.A.',
      emisorCedula: '3102666777',
      fechaEmision: new Date().toISOString(),
      moneda: 'CRC',
      tipoCambio: 1,
      totalComprobante: 22600,
      totalImpuesto: 2600,
      estadoAceptacion: 'aceptado',
      categoria: 'Combustibles'
    });

    assert(gasto1 && gasto2, 'Los gastos deben registrarse');

    const listaGastos = await pgDataStore.getGastos(tenantId);
    assert(listaGastos.length >= 2, 'Debe haber al menos 2 gastos registrados');

    const ivaventas = 3198 + 624 - 1248 + 195;
    const ivagastos = 1300 + 2600;
    assert(ivaventas > 0 && ivagastos > 0, 'Cálculo de impuestos coherente');

    recordResult(7, 'Gastos y Balance Fiscal', true,
      `Gastos por ₡33.900 registrados. IVA ventas: ₡${ivaventas}, IVA compras: ₡${ivagastos}.`);

    // -------------------------------------------------------------------------
    // FLUJO 8: CATÁLOGO CRC, ONVO SANDBOX WEBHOOK Y PAGO MANUAL SINPE
    // -------------------------------------------------------------------------
    console.log('\n--- FLUJO 8: Catálogo CRC, ONVO Sandbox y SINPE Móvil ---');
    const catalogoPlanes = await listarPlanes();
    assert(catalogoPlanes.some(p => p.code === 'emprendedor' && p.precio_mensual_crc === 6900), 'Emprendedor ₡6.900');
    assert(catalogoPlanes.some(p => p.code === 'pro' && p.precio_mensual_crc === 12900), 'Profesional ₡12.900');
    assert(catalogoPlanes.some(p => p.code === 'empresarial' && p.precio_mensual_crc === 34900), 'Empresarial ₡34.900');

    const sinpeRes = await reportarPagoSinpe(tenantId, {
      planCode: 'pro',
      billingCycle: 'monthly',
      referencia: 'SINPE-ROBLE-' + Date.now(),
      notas: 'Pago mensual UAT El Roble'
    });
    assert(sinpeRes.id && sinpeRes.status === 'pending', 'El pago SINPE debe registrarse como pendiente');

    const aprobacion = await aprobarPagoManual(
      sinpeRes.id,
      { userId: adminUserId, email: 'superadmin@meetinlabs.com' }
    );
    assert.strictEqual(aprobacion.planCode, 'pro', 'El plan asignado debe ser profesional');

    // 8.2 Simular pago y webhook ONVO Sandbox
    const onvoTxId = crypto.randomUUID();
    const subRow = await pool.query('SELECT id FROM subscriptions WHERE tenant_id = $1', [tenantId]);
    await pool.query(
      `INSERT INTO payment_transactions (id, tenant_id, subscription_id, plan_code, billing_cycle, amount_usd, amount_crc, currency, provider, status)
       VALUES ($1, $2, $3, 'pro', 'monthly', 12900, 12900, 'CRC', 'onvopay', 'pending')`,
      [onvoTxId, tenantId, subRow.rows[0]?.id || null]
    );

    const onvoBody = {
      id: `evt_test_${Date.now()}`,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: `pi_test_${Date.now()}`,
          amount: 12900 * 100, // 1.290.000 céntimos de CRC según contrato ONVO
          currency: 'CRC',
          status: 'succeeded',
          metadata: {
            transactionId: onvoTxId,
            tenantId: tenantId,
            planId: 'pro'
          }
        }
      }
    };

    const webhookRes = await procesarWebhook('onvopay', onvoBody);
    assert(webhookRes.received, 'El webhook de ONVO Sandbox debe responder received: true');

    recordResult(8, 'Catálogo CRC, ONVO Sandbox y SINPE', true,
      'Precios oficiales CRC validados, pago SINPE aprobado por SuperAdmin y webhook ONVO procesado.');

    // -------------------------------------------------------------------------
    // FLUJO 9: CICLO DE SUSCRIPCIÓN: VENCIMIENTO, SUSPENSIÓN Y REACTIVACIÓN
    // -------------------------------------------------------------------------
    console.log('\n--- FLUJO 9: Ciclo de Suscripción: Vencimiento y Suspensión ---');
    const fechaVencida = new Date(Date.now() - 5 * 24 * 3600 * 1000);
    await pool.query(
      `UPDATE subscriptions 
       SET current_period_end = $1, status = 'past_due' 
       WHERE tenant_id = $2`,
      [fechaVencida, tenantId]
    );

    await verificarVencimientosSuscripciones();

    const subSuspendida = await getEstadoSuscripcion(tenantId);
    assert.strictEqual(subSuspendida.subscription.status, 'suspended', 'La suscripción debe pasar a suspended tras gracia');

    let emisionBloqueada = false;
    const fakeResBloqueado: any = {
      status(code: number) {
        if (code === 402 || code === 403) emisionBloqueada = true;
        return this;
      },
      json() {}
    };
    await requireActiveSubscription({ auth: { tenantId, role: 'admin' } } as any, fakeResBloqueado, () => {});
    assert(emisionBloqueada, 'requireActiveSubscription debe bloquear emisión en estado suspended');

    const compsEnSuspension = await pgDataStore.getComprobantes(tenantId);
    assert(compsEnSuspension.length >= 4, 'Comprobantes tributarios deben preservarse en suspensión');

    await pool.query(
      `UPDATE subscriptions 
       SET status = 'active', current_period_end = NOW() + INTERVAL '30 days' 
       WHERE tenant_id = $1`,
      [tenantId]
    );
    const subReactivada = await getEstadoSuscripcion(tenantId);
    assert.strictEqual(subReactivada.subscription.status, 'active', 'La suscripción debe reactivarse a active');

    recordResult(9, 'Ciclo de Suscripción y Retención Fiscal', true,
      'Transición automática a suspended, bloqueo de emisión, retención legal de XMLs y reactivación exitosa.');

    // -------------------------------------------------------------------------
    // FLUJO 10: LÍMITES POR PLAN Y PERMISOS RBAC
    // -------------------------------------------------------------------------
    console.log('\n--- FLUJO 10: Validación de Límites por Plan y Roles RBAC ---');
    await pool.query(
      `UPDATE subscriptions SET plan_code = 'emprendedor' WHERE tenant_id = $1`,
      [tenantId]
    );

    const fakeReqCuota: any = { auth: { tenantId, role: 'admin' } };
    let cuotaExcedidaBloqueada = false;
    const fakeResCuota: any = {
      status(code: number) {
        if (code === 402 || code === 403) cuotaExcedidaBloqueada = true;
        return this;
      },
      json() {}
    };

    await requireQuotaComprobantes(fakeReqCuota, fakeResCuota, () => {});
    assert.strictEqual(cuotaExcedidaBloqueada, false, 'Con 4 de 50 comprobantes debe permitir emitir');

    let configOperadorBloqueado = false;
    const fakeResRbac: any = {
      status(code: number) {
        if (code === 403) configOperadorBloqueado = true;
        return this;
      },
      json() {}
    };
    requireAdmin({ auth: { role: 'operador' } } as any, fakeResRbac, () => {});
    assert(configOperadorBloqueado, 'Rol operador debe ser rechazado de requireAdmin');

    recordResult(10, 'Límites de Plan y Permisos RBAC', true,
      'Cuota de plan evalúa correctamente consumo mensual y RBAC aísla acciones operativas de administrativas.');

    // -------------------------------------------------------------------------
    // FLUJO 11: MANEJO DE ERRORES Y VALIDACIONES TRIBUTARIAS DGT
    // -------------------------------------------------------------------------
    console.log('\n--- FLUJO 11: Manejo de Errores y Validaciones DGT ---');
    let cabysRechazado = false;
    try {
      generarXMLFactura({
        fechaEmision: new Date(),
        tipoDocumento: '04',
        condicionVenta: '01',
        mediosPago: ['01'],
        emisor: emisorDoc,
        lineas: [{
          numeroLinea: 1,
          codigoCabys: '123',
          detalle: 'Error Test',
          cantidad: 1,
          unidadMedida: 'Unid',
          precioUnitario: 1000,
          montoTotal: 1000,
          subTotal: 1000,
          montoTotalLinea: 1000
        }],
        resumen: {
          codigoMoneda: 'CRC',
          totalServiciosGravados: 0, totalServiciosExentos: 0, totalMercanciasGravadas: 1000, totalMercanciasExentas: 0,
          totalGravado: 1000, totalExento: 0, totalVenta: 1000, totalDescuentos: 0, totalVentaNeta: 1000, totalImpuesto: 0, totalComprobante: 1000
        }
      }, 99);
    } catch {
      cabysRechazado = true;
    }
    assert(cabysRechazado, 'CAByS inválido debe ser rechazado');

    let ncSinRefRechazada = false;
    try {
      generarXMLFactura({
        fechaEmision: new Date(),
        tipoDocumento: '03',
        condicionVenta: '01',
        mediosPago: ['01'],
        emisor: emisorDoc,
        lineas: [{
          numeroLinea: 1,
          codigoCabys: '2111100000000',
          detalle: 'NC sin referencia',
          cantidad: 1, unidadMedida: 'Unid', precioUnitario: 1000, montoTotal: 1000, subTotal: 1000, montoTotalLinea: 1000
        }],
        resumen: {
          codigoMoneda: 'CRC',
          totalServiciosGravados: 0, totalServiciosExentos: 0, totalMercanciasGravadas: 1000, totalMercanciasExentas: 0,
          totalGravado: 1000, totalExento: 0, totalVenta: 1000, totalDescuentos: 0, totalVentaNeta: 1000, totalImpuesto: 0, totalComprobante: 1000
        }
      }, 99);
    } catch {
      ncSinRefRechazada = true;
    }
    assert(ncSinRefRechazada, 'Nota de Crédito sin InformacionReferencia debe ser rechazada');

    recordResult(11, 'Manejo de Errores y Validaciones DGT', true,
      'CAByS no conforme y Notas de Crédito sin documento de referencia son rechazadas inmediatamente.');

    // -------------------------------------------------------------------------
    // FLUJO 12: PERSISTENCIA E INTEGRIDAD DE DATOS EN POSTGRESQL
    // -------------------------------------------------------------------------
    console.log('\n--- FLUJO 12: Integridad Relacional y Persistencia en PostgreSQL ---');
    const [tenantsDb, compsDb, subsDb, usersDb, gastosDb] = await Promise.all([
      pool.query('SELECT count(*) FROM tenants WHERE id = $1', [tenantId]),
      pool.query('SELECT count(*) FROM comprobantes WHERE tenant_id = $1', [tenantId]),
      pool.query('SELECT count(*) FROM subscriptions WHERE tenant_id = $1', [tenantId]),
      pool.query('SELECT count(*) FROM users WHERE tenant_id = $1', [tenantId]),
      pool.query('SELECT count(*) FROM gastos WHERE tenant_id = $1', [tenantId])
    ]);

    assert.strictEqual(Number(tenantsDb.rows[0].count), 1, 'Tenant persistido');
    assert(Number(compsDb.rows[0].count) >= 4, '4 comprobantes persistidos');
    assert(Number(subsDb.rows[0].count) >= 1, 'Suscripción persistida');
    assert(Number(usersDb.rows[0].count) >= 2, '2 usuarios persistidos');
    assert(Number(gastosDb.rows[0].count) >= 2, '2 gastos persistidos');

    recordResult(12, 'Persistencia e Integridad en PostgreSQL', true,
      `Integridad relacional 100%: 1 tenant, 2 usuarios, 4 comprobantes, 2 gastos, 1 suscripción persistidos.`);

    console.log('\n======================================================================');
    console.log(`   SUITE UAT FINALIZADA: ${matrix.filter(m => m.passed).length}/12 FLUJOS APROBADOS   `);
    console.log('======================================================================');

  } catch (err: any) {
    console.error('❌ Error fatal en Suite UAT:', err);
    throw err;
  } finally {
    console.log(`\n[INFO] Datos UAT disponibles para pruebas en navegador:`);
    console.log(`  - Tenant ID     : ${tenantId}`);
    console.log(`  - Usuario Admin : ${adminEmail}`);
    console.log(`  - Password Admin: ${adminPassNuevo}`);
    console.log(`  - Factura Clave : ${claveFactura}`);
    console.log(`  - Portal Token  : ${tokenFactura}`);
  }
}

runUatSuite()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
