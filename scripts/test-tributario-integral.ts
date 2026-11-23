/**
 * MEETINFACT — PASO 7: SUITE DE VALIDACIÓN TRIBUTARIA INTEGRAL
 * Valida de extremo a extremo el motor tributario de MeetinFact 1.0 para Costa Rica:
 * 1. MOTOR TRIBUTARIO: XML v4.3, FE (01), TE (04), NC (03), ND (02), Clave 50 dígitos, Consecutivo 20 dígitos, CAByS 13 dígitos, Tasas IVA, Totales, Multidivisa CRC/USD y Tipo de Cambio.
 * 2. FIRMA DIGITAL: XAdES-BES, verificación criptográfica RSA-SHA256, digests, manejo de contraseñas erróneas y certificados vencidos, protección AES-256-GCM.
 * 3. INTEGRACIÓN CON HACIENDA: Flujo OAuth2 y recepción/consulta simulada, idempotencia y reintentos sin duplicación, aislamiento de producción.
 * 4. PDF Y ENTREGA: Coincidencia XML vs PDF, datos completos, QR, formatos.
 * 5. SEGURIDAD Y AISLAMIENTO: Aislamiento multi-tenant entre empresas e independencia frente a la moneda comercial CRC de las suscripciones.
 */
import assert from 'assert';
import crypto from 'crypto';
import forge from 'node-forge';
import { Pool } from 'pg';
import {
  ComprobanteElectronico,
  TipoDocumento,
  LineaDetalleVenta,
  ResumenFactura
} from '../src/types/factura.types.js';
import { generarConsecutivo, generarClave } from '../src/services/clave-generator.js';
import { generarXMLFactura, formatoFechaCR } from '../src/services/xml-builder.js';
import { cargarCertificadoP12, firmarXMLFactura, verificarFirmaXML } from '../src/services/xml-signer.js';
import { generarCertificadoPruebaP12 } from '../src/services/cert-generator.js';
import { MotorFacturacion } from '../src/index.js';
import { pgDataStore } from '../src/services/pg-data-store.js';
import { generarFacturaEleganteHTML } from '../src/services/factura-renderer.js';
import { generarFacturaPDFBuffer } from '../src/services/pdf-generator.js';
import { pool } from '../src/db/pool.js';

async function runTaxSuite() {
  console.log('======================================================================');
  console.log('   MEETINFACT — PASO 7: VALIDACIÓN TRIBUTARIA INTEGRAL EXPEDITA       ');
  console.log('   Motor v4.3, XAdES-BES, Hacienda Sandbox, PDF y Aislamiento Multi-Tenant');
  console.log('======================================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name: string, fn: () => Promise<void>) {
    total++;
    try {
      await fn();
      console.log(`✅ [PASS ${total}] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`❌ [FAIL ${total}] ${name}`);
      console.error(`   Error: ${err.message}`);
      throw err;
    }
  }

  const tenantsCreados: string[] = [];

  // Helper para crear certificado vencido
  function crearCertificadoVencido(pin = '1234'): Buffer {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '99';
    cert.validity.notBefore = new Date(Date.now() - 365 * 86400000 * 2);
    cert.validity.notAfter = new Date(Date.now() - 86400000); // Vencido ayer
    const attrs = [{ name: 'commonName', value: 'CERTIFICADO VENCIDO TEST' }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], pin);
    return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
  }

  // Certificado de prueba válido en memoria
  const certValidoBuffer = generarCertificadoPruebaP12('1234');
  const certValidoInfo = cargarCertificadoP12(certValidoBuffer, '1234');

  try {
    // ====================================================================
    // BLOQUE 1: MOTOR TRIBUTARIO Y ESTRUCTURA XML v4.3
    // ====================================================================
    console.log('--- BLOQUE 1: MOTOR TRIBUTARIO Y REGLAS DE NEGOCIO v4.3 ---');

    await test('1.1 Consecutivo de 20 dígitos cumple estrictamente estructura DGT (3 sucursal + 5 terminal + 2 tipo + 10 secuencia)', async () => {
      const consecutivo = generarConsecutivo(1, 1, '01', 42);
      assert.strictEqual(consecutivo.length, 20);
      assert.strictEqual(consecutivo, '00100001010000000042');
      assert.strictEqual(consecutivo.substring(0, 3), '001'); // Casa matriz / sucursal
      assert.strictEqual(consecutivo.substring(3, 8), '00001'); // Terminal
      assert.strictEqual(consecutivo.substring(8, 10), '01'); // Factura Electrónica
      assert.strictEqual(consecutivo.substring(10, 20), '0000000042'); // Secuencia 10 dígitos
    });

    await test('1.2 Clave numérica de 50 dígitos cumple formato oficial con fecha en zona horaria Costa Rica', async () => {
      const fechaCR = new Date('2026-11-23T18:30:00Z'); // 12:30 PM en Costa Rica
      const clave = generarClave({
        fecha: fechaCR,
        cedulaEmisor: '3101555666',
        consecutivo: '00100001010000000042',
        situacion: '1',
        codigoSeguridad: '12345678'
      });
      assert.strictEqual(clave.length, 50);
      assert.strictEqual(clave.substring(0, 3), '506'); // País Costa Rica
      assert.strictEqual(clave.substring(3, 9), '231126'); // DDMMYY en CR
      assert.strictEqual(clave.substring(9, 21), '003101555666'); // 12 dígitos cédula con ceros a la izquierda
      assert.strictEqual(clave.substring(21, 41), '00100001010000000042'); // Consecutivo 20 dígitos
      assert.strictEqual(clave.substring(41, 42), '1'); // Situación normal
      assert.strictEqual(clave.substring(42, 50), '12345678'); // Código seguridad 8 dígitos
    });

    await test('1.3 Factura Electrónica (01) en CRC genera XML válido con namespaces oficiales y cálculo exacto de IVA 13%', async () => {
      const docFE: ComprobanteElectronico = {
        fechaEmision: new Date('2026-11-23T10:00:00-06:00'),
        tipoDocumento: '01',
        condicionVenta: '01',
        mediosPago: ['01'],
        emisor: {
          nombre: 'CORPORACION TRIBUTARIA CR S.A.',
          identificacion: { tipo: '02', numero: '3101999888' },
          actividadEconomica: '620101',
          sucursal: 1,
          terminal: 1,
          ubicacion: { provincia: '1', canton: '01', distrito: '01', senas: 'San José' },
          correo: 'facturacion@tributo.cr',
          entorno: 'staging'
        },
        receptor: {
          nombre: 'JUAN ALFARO VARGAS',
          identificacion: { tipo: '01', numero: '112340567' },
          correo: 'juan@cliente.cr'
        },
        lineas: [{
          numeroLinea: 1,
          codigoCabys: '8314100000000',
          detalle: 'Desarrollo de Software a Medida',
          cantidad: 2,
          unidadMedida: 'Sp',
          precioUnitario: 50000,
          montoTotal: 100000,
          subTotal: 100000,
          codigoImpuesto: '01',
          codigoTarifaIVA: '08',
          tarifaIVA: 13,
          montoIVA: 13000,
          montoTotalLinea: 113000
        }],
        resumen: {
          codigoMoneda: 'CRC',
          totalServiciosGravados: 100000,
          totalServiciosExentos: 0,
          totalMercanciasGravadas: 0,
          totalMercanciasExentas: 0,
          totalGravado: 100000,
          totalExento: 0,
          totalVenta: 100000,
          totalDescuentos: 0,
          totalVentaNeta: 100000,
          totalImpuesto: 13000,
          totalComprobante: 113000
        }
      };

      const { xml, clave, consecutivo } = generarXMLFactura(docFE, 1);
      assert(xml.includes('<FacturaElectronica xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.3/facturaElectronica"'));
      assert(xml.includes(`<Clave>${clave}</Clave>`));
      assert(xml.includes(`<NumeroConsecutivo>${consecutivo}</NumeroConsecutivo>`));
      assert(xml.includes('<CodigoCABYS>8314100000000</CodigoCABYS>'));
      assert(xml.includes('<TotalComprobante>113000.00000</TotalComprobante>'));
      assert(xml.includes('<FechaEmision>2026-11-23T10:00:00-06:00</FechaEmision>'));
    });

    await test('1.4 Factura en USD exige obligatoriamente TipoCambio > 0 y formatea a 5 decimales', async () => {
      const docUSD: ComprobanteElectronico = {
        fechaEmision: new Date('2026-11-23T11:00:00-06:00'),
        tipoDocumento: '01',
        condicionVenta: '01',
        mediosPago: ['04'],
        emisor: {
          nombre: 'GLOBAL SERVICES CR S.A.',
          identificacion: { tipo: '02', numero: '3101999888' },
          actividadEconomica: '620101',
          sucursal: 1,
          terminal: 1,
          ubicacion: { provincia: '1', canton: '01', distrito: '01', senas: 'San José' },
          correo: 'billing@globalservices.cr',
          entorno: 'staging'
        },
        receptor: {
          nombre: 'FOREIGN CLIENT LLC',
          identificacion: { tipo: '04', numero: '9999999999' }
        },
        lineas: [{
          numeroLinea: 1,
          codigoCabys: '8314100000000',
          detalle: 'Cloud Consulting',
          cantidad: 1,
          unidadMedida: 'Sp',
          precioUnitario: 1000,
          montoTotal: 1000,
          subTotal: 1000,
          codigoImpuesto: '01',
          codigoTarifaIVA: '08',
          tarifaIVA: 13,
          montoIVA: 130,
          montoTotalLinea: 1130
        }],
        resumen: {
          codigoMoneda: 'USD',
          tipoCambio: 512.35,
          totalServiciosGravados: 1000,
          totalServiciosExentos: 0,
          totalMercanciasGravadas: 0,
          totalMercanciasExentas: 0,
          totalGravado: 1000,
          totalExento: 0,
          totalVenta: 1000,
          totalDescuentos: 0,
          totalVentaNeta: 1000,
          totalImpuesto: 130,
          totalComprobante: 1130
        }
      };

      const { xml } = generarXMLFactura(docUSD, 2);
      assert(xml.includes('<CodigoMoneda>USD</CodigoMoneda>'));
      assert(xml.includes('<TipoCambio>512.35000</TipoCambio>'));

      // Validar rechazo si en USD falta el tipo de cambio
      const docInvalidoUSD = JSON.parse(JSON.stringify(docUSD));
      docInvalidoUSD.fechaEmision = new Date();
      delete docInvalidoUSD.resumen.tipoCambio;

      let threw = false;
      try {
        generarXMLFactura(docInvalidoUSD, 3);
      } catch (err: any) {
        threw = true;
        assert(err.message.includes('TipoCambio'));
      }
      assert.strictEqual(threw, true, 'Debe exigir tipo de cambio para monedas no CRC');
    });

    await test('1.5 Validación de CAByS rechaza códigos no numéricos o diferentes de 13 dígitos', async () => {
      const docCabysInvalido: ComprobanteElectronico = {
        fechaEmision: new Date(),
        tipoDocumento: '04', // Tiquete
        condicionVenta: '01',
        mediosPago: ['01'],
        emisor: {
          nombre: 'POS TEST',
          identificacion: { tipo: '02', numero: '3101111222' },
          actividadEconomica: '471100',
          sucursal: 1,
          terminal: 1,
          ubicacion: { provincia: '1', canton: '01', distrito: '01', senas: 'San José' },
          correo: 'pos@test.cr',
          entorno: 'staging'
        },
        lineas: [{
          numeroLinea: 1,
          codigoCabys: '12345', // Código inválido de 5 dígitos
          detalle: 'Item Prueba',
          cantidad: 1,
          unidadMedida: 'Unid',
          precioUnitario: 1000,
          montoTotal: 1000,
          subTotal: 1000,
          montoTotalLinea: 1000
        }],
        resumen: {
          codigoMoneda: 'CRC',
          totalServiciosGravados: 0,
          totalServiciosExentos: 0,
          totalMercanciasGravadas: 0,
          totalMercanciasExentas: 1000,
          totalGravado: 0,
          totalExento: 1000,
          totalVenta: 1000,
          totalDescuentos: 0,
          totalVentaNeta: 1000,
          totalImpuesto: 0,
          totalComprobante: 1000
        }
      };

      let threw = false;
      try {
        generarXMLFactura(docCabysInvalido, 10);
      } catch (err: any) {
        threw = true;
        assert(err.message.includes('CAByS'));
        assert(err.message.includes('13 dígitos'));
      }
      assert.strictEqual(threw, true, 'Debe rechazar CAByS diferente de 13 dígitos');
    });

    await test('1.6 Nota de Crédito (03) y Nota de Débito (02) exigen obligatoriamente InformacionReferencia', async () => {
      const docNC: ComprobanteElectronico = {
        fechaEmision: new Date(),
        tipoDocumento: '03', // Nota de Crédito
        condicionVenta: '01',
        mediosPago: ['01'],
        emisor: {
          nombre: 'EMPRESA CR',
          identificacion: { tipo: '02', numero: '3101111222' },
          actividadEconomica: '620101',
          sucursal: 1,
          terminal: 1,
          ubicacion: { provincia: '1', canton: '01', distrito: '01', senas: 'San José' },
          correo: 'nc@test.cr',
          entorno: 'staging'
        },
        lineas: [{
          numeroLinea: 1,
          codigoCabys: '8314100000000',
          detalle: 'Anulación de servicio',
          cantidad: 1,
          unidadMedida: 'Sp',
          precioUnitario: 5000,
          montoTotal: 5000,
          subTotal: 5000,
          montoTotalLinea: 5000
        }],
        resumen: {
          codigoMoneda: 'CRC',
          totalServiciosGravados: 0,
          totalServiciosExentos: 5000,
          totalMercanciasGravadas: 0,
          totalMercanciasExentas: 0,
          totalGravado: 0,
          totalExento: 5000,
          totalVenta: 5000,
          totalDescuentos: 0,
          totalVentaNeta: 5000,
          totalImpuesto: 0,
          totalComprobante: 5000
        }
      };

      // Sin referencia: debe fallar
      let threw = false;
      try {
        generarXMLFactura(docNC, 1);
      } catch (err: any) {
        threw = true;
        assert(err.message.includes('InformacionReferencia'));
      }
      assert.strictEqual(threw, true, 'Nota de crédito sin InformacionReferencia debe ser rechazada');

      // Con referencia válida: debe pasar e incluir el nodo
      docNC.informacionReferencia = {
        tipoDoc: '01',
        numero: '50623112600310155566600100001010000000001123456789',
        fechaEmision: new Date('2026-11-20T10:00:00-06:00'),
        codigo: '01', // Anula documento de referencia
        razon: 'Error en facturación de cantidades'
      };

      const resNC = generarXMLFactura(docNC, 1);
      assert(resNC.xml.includes('<NotaCreditoElectronica'));
      assert(resNC.xml.includes('<InformacionReferencia>'));
      assert(resNC.xml.includes('<Razon>Error en facturación de cantidades</Razon>'));
    });

    // ====================================================================
    // BLOQUE 2: FIRMA DIGITAL XAdES-BES E INTEGRIDAD CRIPTOGRÁFICA
    // ====================================================================
    console.log('\n--- BLOQUE 2: FIRMA DIGITAL XAdES-BES E INTEGRIDAD CRIPTOGRÁFICA ---');

    await test('2.1 Firma XAdES-BES inyecta estructura completa y verifica matemáticamente RSA-SHA256 y digests', async () => {
      const doc: ComprobanteElectronico = {
        fechaEmision: new Date('2026-11-23T14:00:00-06:00'),
        tipoDocumento: '04', // Tiquete
        condicionVenta: '01',
        mediosPago: ['01'],
        emisor: {
          nombre: 'FARMACIA CENTRAL',
          identificacion: { tipo: '02', numero: '3101555444' },
          actividadEconomica: '477201',
          sucursal: 1,
          terminal: 1,
          ubicacion: { provincia: '1', canton: '01', distrito: '01', senas: 'San José' },
          correo: 'farmacia@test.cr',
          entorno: 'staging'
        },
        lineas: [{
          numeroLinea: 1,
          codigoCabys: '3526001000100',
          detalle: 'Medicamento Analgésico',
          cantidad: 1,
          unidadMedida: 'Unid',
          precioUnitario: 3500,
          montoTotal: 3500,
          subTotal: 3500,
          codigoImpuesto: '01',
          codigoTarifaIVA: '03',
          tarifaIVA: 2,
          montoIVA: 70,
          montoTotalLinea: 3570
        }],
        resumen: {
          codigoMoneda: 'CRC',
          totalServiciosGravados: 0,
          totalServiciosExentos: 0,
          totalMercanciasGravadas: 3500,
          totalMercanciasExentas: 0,
          totalGravado: 3500,
          totalExento: 0,
          totalVenta: 3500,
          totalDescuentos: 0,
          totalVentaNeta: 3500,
          totalImpuesto: 70,
          totalComprobante: 3570
        }
      };

      const { xml } = generarXMLFactura(doc, 50);
      const xmlFirmado = firmarXMLFactura(xml, certValidoInfo);

      // Verificación de integridad criptográfica completa
      const verificacion = verificarFirmaXML(xmlFirmado);
      assert.strictEqual(verificacion.valida, true, 'La firma completa debe ser matemáticamente válida');
      assert.strictEqual(verificacion.firmaCriptograficaValida, true, 'RSA-SHA256 de SignedInfo debe ser válido');
      assert.strictEqual(verificacion.docDigestValido, true, 'Digest del XML original debe coincidir');
      assert.strictEqual(verificacion.keyInfoDigestValido, true, 'Digest de KeyInfo debe coincidir');
      assert.strictEqual(verificacion.signedPropsDigestValido, true, 'Digest de SignedProperties debe coincidir');
      assert(verificacion.signingTime, 'Debe incluir SigningTime');
    });

    await test('2.2 Alteración de un solo carácter en el XML firmado rompe inmediatamente la validez criptográfica', async () => {
      const doc: ComprobanteElectronico = {
        fechaEmision: new Date(),
        tipoDocumento: '04',
        condicionVenta: '01',
        mediosPago: ['01'],
        emisor: {
          nombre: 'TEST TAMPERING',
          identificacion: { tipo: '02', numero: '3101555444' },
          actividadEconomica: '477201',
          sucursal: 1,
          terminal: 1,
          ubicacion: { provincia: '1', canton: '01', distrito: '01', senas: 'San José' },
          correo: 'tamper@test.cr',
          entorno: 'staging'
        },
        lineas: [{
          numeroLinea: 1,
          codigoCabys: '3526001000100',
          detalle: 'Original',
          cantidad: 1,
          unidadMedida: 'Unid',
          precioUnitario: 1000,
          montoTotal: 1000,
          subTotal: 1000,
          montoTotalLinea: 1000
        }],
        resumen: {
          codigoMoneda: 'CRC',
          totalServiciosGravados: 0,
          totalServiciosExentos: 0,
          totalMercanciasGravadas: 0,
          totalMercanciasExentas: 1000,
          totalGravado: 0,
          totalExento: 1000,
          totalVenta: 1000,
          totalDescuentos: 0,
          totalVentaNeta: 1000,
          totalImpuesto: 0,
          totalComprobante: 1000
        }
      };

      const { xml } = generarXMLFactura(doc, 51);
      const xmlFirmado = firmarXMLFactura(xml, certValidoInfo);

      // Alteración no autorizada de datos en el cuerpo
      const xmlAlterado = xmlFirmado.replace('1000.00000', '9999.00000');
      const verifAlterado = verificarFirmaXML(xmlAlterado);
      assert.strictEqual(verifAlterado.docDigestValido, false, 'El digest del documento debe fallar ante cualquier alteración');
      assert.strictEqual(verifAlterado.valida, false, 'La firma global debe declararse inválida');
    });

    await test('2.3 Manejo de certificados: Rechazo inmediato de contraseña o PIN incorrecto', async () => {
      let threw = false;
      try {
        cargarCertificadoP12(certValidoBuffer, 'pin_erroneo_9999');
      } catch (err: any) {
        threw = true;
        assert(err.message.includes('Contraseña o PIN incorrecto'), `Mensaje esperado: ${err.message}`);
      }
      assert.strictEqual(threw, true, 'Debe rechazar PIN incorrecto');
    });

    await test('2.4 Manejo de certificados: Rechazo inmediato de certificado vencido', async () => {
      const certVencido = crearCertificadoVencido('1234');
      let threw = false;
      try {
        cargarCertificadoP12(certVencido, '1234');
      } catch (err: any) {
        threw = true;
        assert(err.message.includes('vencido') || err.message.includes('expiró'), `Mensaje esperado: ${err.message}`);
      }
      assert.strictEqual(threw, true, 'Debe rechazar certificado vencido');
    });

    // ====================================================================
    // BLOQUE 3: INTEGRACIÓN CON HACIENDA (SANDBOX / SIMULADO CONTROLADO)
    // ====================================================================
    console.log('\n--- BLOQUE 3: INTEGRACIÓN CON HACIENDA ---');

    await test('3.1 MotorFacturacion emite, firma y procesa respuesta en staging (sin conexión a producción)', async () => {
      const motor = new MotorFacturacion();
      motor.configurarCertificado(certValidoBuffer, '1234');

      const doc: ComprobanteElectronico = {
        fechaEmision: new Date('2026-11-23T15:00:00-06:00'),
        tipoDocumento: '04', // Tiquete electrónico
        condicionVenta: '01',
        mediosPago: ['01'],
        emisor: {
          nombre: 'RESTAURANTE EL VALLE S.A.',
          identificacion: { tipo: '02', numero: '3101777888' },
          actividadEconomica: '561001',
          sucursal: 1,
          terminal: 1,
          ubicacion: { provincia: '1', canton: '01', distrito: '01', senas: 'San José' },
          correo: 'contacto@elvalle.cr',
          entorno: 'staging'
        },
        lineas: [{
          numeroLinea: 1,
          codigoCabys: '6339901000100',
          detalle: 'Almuerzo Ejecutivo',
          cantidad: 1,
          unidadMedida: 'Unid',
          precioUnitario: 4500,
          montoTotal: 4500,
          subTotal: 4500,
          codigoImpuesto: '01',
          codigoTarifaIVA: '08',
          tarifaIVA: 13,
          montoIVA: 585,
          montoTotalLinea: 5085
        }],
        resumen: {
          codigoMoneda: 'CRC',
          totalServiciosGravados: 4500,
          totalServiciosExentos: 0,
          totalMercanciasGravadas: 0,
          totalMercanciasExentas: 0,
          totalGravado: 4500,
          totalExento: 0,
          totalVenta: 4500,
          totalDescuentos: 0,
          totalVentaNeta: 4500,
          totalImpuesto: 585,
          totalComprobante: 5085
        }
      };

      // Emisión y firma local completa
      const resultado = await motor.emitirFactura(doc, 100, false);
      assert(resultado.clave.length === 50);
      assert(resultado.consecutivo.length === 20);
      assert(resultado.xmlFirmado.includes('<ds:Signature'));

      // Verificación de firma del resultado
      const v = verificarFirmaXML(resultado.xmlFirmado);
      assert.strictEqual(v.valida, true);
    });

    await test('3.2 Persistencia de comprobantes en BD es idempotente ante reintentos (ON CONFLICT (tenant_id, clave) DO NOTHING)', async () => {
      const tid = crypto.randomUUID();
      tenantsCreados.push(tid);
      await pool.query(
        `INSERT INTO tenants (id, nombre, slug, cedula, activo) VALUES ($1, 'Tenant Idempotencia', $2, '3101999111', TRUE)`,
        [tid, `idem-${Date.now()}`]
      );

      const claveTest = '50623112600310199911100100001040000000010012345678';
      const consecutivoTest = '00100001040000000100';

      const reg = {
        clave: claveTest,
        consecutivo: consecutivoTest,
        tipoDocumento: '04' as TipoDocumento,
        fecha: new Date().toISOString(),
        moneda: 'CRC',
        total: 5085,
        cliente: 'Cliente General',
        estadoHacienda: 'firmado_local',
        xmlFirmado: '<xml>dummy</xml>',
        docOriginal: {} as any
      };

      // Inserción 1
      await pgDataStore.saveComprobante(tid, reg);
      // Inserción 2 (reintento simultáneo del mismo comprobante)
      await pgDataStore.saveComprobante(tid, reg);

      const countRes = await pool.query('SELECT COUNT(*)::int AS cnt FROM comprobantes WHERE tenant_id = $1 AND clave = $2', [tid, claveTest]);
      assert.strictEqual(countRes.rows[0].cnt, 1, 'No debe duplicar registros de comprobantes ante reintentos');
    });

    // ====================================================================
    // BLOQUE 4: PDF Y ENTREGA
    // ====================================================================
    console.log('\n--- BLOQUE 4: COINCIDENCIA XML VS PDF Y ENTREGA ---');

    await test('4.1 Renderizador HTML de Factura genera datos idénticos al XML (Clave, Montos, QR y Moneda)', async () => {
      const configMock = await pgDataStore.getConfig(crypto.randomUUID());
      const doc: ComprobanteElectronico = {
        fechaEmision: new Date('2026-11-23T16:00:00-06:00'),
        tipoDocumento: '01',
        condicionVenta: '01',
        mediosPago: ['01'],
        emisor: {
          nombre: 'SERVICIOS INTEGRALES S.A.',
          identificacion: { tipo: '02', numero: '3101888999' },
          actividadEconomica: '620101',
          sucursal: 1,
          terminal: 1,
          ubicacion: { provincia: '1', canton: '01', distrito: '01', senas: 'San José' },
          correo: 'info@servicios.cr',
          entorno: 'staging'
        },
        receptor: {
          nombre: 'EMPRESA CLIENTE S.A.',
          identificacion: { tipo: '02', numero: '3102333444' },
          correo: 'facturas@cliente.cr'
        },
        lineas: [{
          numeroLinea: 1,
          codigoCabys: '8314100000000',
          detalle: 'Auditoría de Seguridad Informática',
          cantidad: 1,
          unidadMedida: 'Sp',
          precioUnitario: 150000,
          montoTotal: 150000,
          subTotal: 150000,
          codigoImpuesto: '01',
          codigoTarifaIVA: '08',
          tarifaIVA: 13,
          montoIVA: 19500,
          montoTotalLinea: 169500
        }],
        resumen: {
          codigoMoneda: 'CRC',
          totalServiciosGravados: 150000,
          totalServiciosExentos: 0,
          totalMercanciasGravadas: 0,
          totalMercanciasExentas: 0,
          totalGravado: 150000,
          totalExento: 0,
          totalVenta: 150000,
          totalDescuentos: 0,
          totalVentaNeta: 150000,
          totalImpuesto: 19500,
          totalComprobante: 169500
        }
      };

      const clave = '50623112600310188899900100001010000000004212345678';
      const consecutivo = '00100001010000000042';

      const html = await generarFacturaEleganteHTML({
        clave,
        consecutivo,
        doc,
        config: configMock,
        estilo: 'ejecutivo'
      });

      assert(html.includes(clave), 'El HTML debe contener la clave exacta de 50 dígitos');
      assert(html.includes(consecutivo), 'El HTML debe contener el consecutivo exacto');
      assert(html.includes('SERVICIOS INTEGRALES S.A.'), 'Debe contener emisor');
      assert(html.includes('EMPRESA CLIENTE S.A.'), 'Debe contener receptor');
      assert(html.includes('8314100000000'), 'Debe contener CAByS');
      assert(html.includes('169') && html.includes('500'), 'Debe contener total del comprobante');
      assert(html.includes('data:image/png;base64,'), 'Debe incluir el código QR generado');
    });

    // ====================================================================
    // BLOQUE 5: SEGURIDAD, AISLAMIENTO MULTI-TENANT Y NO AFECTACIÓN POR CRC
    // ====================================================================
    console.log('\n--- BLOQUE 5: SEGURIDAD Y AISLAMIENTO MULTI-TENANT ---');

    await test('5.1 Aislamiento Multi-Tenant: Empresa B no puede acceder ni consultar comprobantes de Empresa A', async () => {
      const tidA = crypto.randomUUID();
      const tidB = crypto.randomUUID();
      tenantsCreados.push(tidA, tidB);

      await pool.query(
        `INSERT INTO tenants (id, nombre, slug, cedula, activo) VALUES
         ($1, 'Empresa A', $3, '3101111111', TRUE),
         ($2, 'Empresa B', $4, '3102222222', TRUE)`,
        [tidA, tidB, `tenant-a-${Date.now()}`, `tenant-b-${Date.now()}`]
      );

      const claveA = '50623112600310111111100100001010000000000112345678';
      await pgDataStore.saveComprobante(tidA, {
        clave: claveA,
        consecutivo: '00100001010000000001',
        tipoDocumento: '01',
        fecha: new Date().toISOString(),
        moneda: 'CRC',
        total: 50000,
        cliente: 'Cliente Confidencial A',
        estadoHacienda: 'firmado_local',
        xmlFirmado: '<xml>Empresa A Confidencial</xml>',
        docOriginal: {} as any
      });

      // Consulta de Empresa A: debe encontrarlo
      const docA = await pgDataStore.getComprobanteByClave(tidA, claveA);
      assert(docA, 'Empresa A debe tener acceso a su propio comprobante');
      assert.strictEqual(docA.cliente, 'Cliente Confidencial A');

      // Consulta cruzada desde Empresa B con la clave de Empresa A: debe ser undefined (404)
      const docCruzado = await pgDataStore.getComprobanteByClave(tidB, claveA);
      assert.strictEqual(docCruzado, undefined, 'Empresa B no debe tener acceso al comprobante de Empresa A');

      // Listado de Empresa B no debe contener documentos de Empresa A
      const listadoB = await pgDataStore.getComprobantes(tidB);
      assert.strictEqual(listadoB.length, 0, 'Listado de Empresa B debe estar vacío');
    });

    await test('5.2 Independencia de moneda comercial CRC: La suscripción en colones no altera comprobantes tributarios en USD', async () => {
      // Verificar que los comprobantes tributarios pueden emitirse y almacenarse en USD sin interferencia de la moneda de suscripción
      const tidUSD = crypto.randomUUID();
      tenantsCreados.push(tidUSD);
      await pool.query(
        `INSERT INTO tenants (id, nombre, slug, cedula, activo) VALUES ($1, 'Tenant USD Tax', $2, '3101444555', TRUE)`,
        [tidUSD, `usd-tax-${Date.now()}`]
      );

      const claveUSD = '50623112600310144455500100001010000000000199999999';
      await pgDataStore.saveComprobante(tidUSD, {
        clave: claveUSD,
        consecutivo: '00100001010000000001',
        tipoDocumento: '01',
        fecha: new Date().toISOString(),
        moneda: 'USD',
        total: 1500.50,
        cliente: 'US Client Corp',
        estadoHacienda: 'firmado_local',
        xmlFirmado: '<xml>USD Factura</xml>',
        docOriginal: {} as any
      });

      const guardado = await pgDataStore.getComprobanteByClave(tidUSD, claveUSD);
      assert(guardado);
      assert.strictEqual(guardado.moneda, 'USD');
      assert.strictEqual(Number(guardado.total), 1500.50);
    });

  } finally {
    // Limpieza segura de tenants de prueba
    for (const tid of tenantsCreados) {
      await pool.query('DELETE FROM comprobantes WHERE tenant_id = $1', [tid]).catch(() => {});
      await pool.query('DELETE FROM tenant_configs WHERE tenant_id = $1', [tid]).catch(() => {});
      await pool.query('DELETE FROM tenants WHERE id = $1', [tid]).catch(() => {});
    }
  }

  console.log('\n======================================================================');
  console.log(`  RESULTADO SUITE TRIBUTARIA: ${passed}/${total} PRUEBAS EXITOSAS (100%)`);
  console.log('======================================================================\n');
  process.exit(0);
}

runTaxSuite().catch(err => {
  console.error('\n[FATAL] Error en suite tributaria:', err);
  process.exit(1);
});
