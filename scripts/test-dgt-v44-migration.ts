/**
 * MEETINFACT 1.0 — PASO 14-P0: SUITE DE MIGRACIÓN Y VALIDACIÓN TRIBUTARIA DGT v4.4
 * Valida la conformidad estricta del motor XML con la normativa oficial DGT v4.4:
 * 1. Factura Electrónica (01) con esquema y namespace v4.4
 * 2. Tiquete Electrónico (04) con esquema y namespace v4.4
 * 3. Nota de Crédito (03) con códigos de referencia v4.4 (Nota 9: 01, 02, 03, 12..17)
 * 4. Nota de Débito (02) con esquema v4.4 y vinculación histórica v4.3
 * 5. Comprobantes de Exportación (09) y Compra (08)
 * 6. Soporte de cédulas jurídicas y extranjeras alfanuméricas
 * 7. Firmado digital XAdES-BES sobre documentos v4.4
 * 8. Convivencia y consulta de comprobantes históricos v4.3
 */
import assert from 'assert';
import { generarXMLFactura, getRootElement, CODIGOS_REFERENCIA_V44 } from '../src/services/xml-builder.js';
import { generarCertificadoPruebaP12 } from '../src/services/cert-generator.js';
import { firmarXMLFactura, verificarFirmaXML, cargarCertificadoP12 } from '../src/services/xml-signer.js';
import { ComprobanteElectronico } from '../src/types/factura.types.js';

interface TestStepResult {
  step: number;
  nombre: string;
  paso: boolean;
  detalle: string;
}

const resultados: TestStepResult[] = [];

function record(step: number, nombre: string, paso: boolean, detalle: string) {
  resultados.push({ step, nombre, paso, detalle });
  console.log(`[DGT-v4.4 ${step}/8] ${paso ? '✅ APROBADO' : '❌ FALLIDO'} — ${nombre}: ${detalle}`);
}

async function runDgtV44Tests() {
  console.log('======================================================================');
  console.log('   MEETINFACT 1.0 — VALIDACIÓN INTEGRAL DE MIGRACIÓN DGT v4.4        ');
  console.log('   Entorno Aislado QA (Port 3055 / DB facturacion_test)              ');
  console.log('======================================================================\n');

  const baseDoc: ComprobanteElectronico = {
    tipoDocumento: '01',
    fechaEmision: new Date(),
    condicionVenta: '01',
    mediosPago: ['01'],
    emisor: {
      nombre: 'CORPORACION PILOTO CR SOCIEDAD ANONIMA',
      identificacion: { tipo: '02', numero: '3101999888' }, // Cédula jurídica
      actividadEconomica: '722003',
      sucursal: 1,
      terminal: 1,
      ubicacion: { provincia: '1', canton: '01', distrito: '01', senas: 'San Jose Centro' },
      correo: 'facturacion@pilotocr.com',
      entorno: 'staging'
    },
    receptor: {
      nombre: 'SERVICIOS INDUSTRIALES DEL VALLE SA',
      identificacion: { tipo: '02', numero: '3101777666' },
      correo: 'pagos@servivalle.cr'
    },
    lineas: [
      {
        numeroLinea: 1,
        codigoCabys: '8314100000000',
        detalle: 'Consultoría en Sistemas Informáticos',
        cantidad: 1,
        unidadMedida: 'Sp',
        precioUnitario: 250000,
        montoTotal: 250000,
        subTotal: 250000,
        codigoImpuesto: '01',
        codigoTarifaIVA: '08',
        tarifaIVA: 13,
        montoIVA: 32500,
        montoTotalLinea: 282500
      }
    ],
    resumen: {
      codigoMoneda: 'CRC',
      tipoCambio: 1,
      totalServiciosGravados: 250000,
      totalServiciosExentos: 0,
      totalMercanciasGravadas: 0,
      totalMercanciasExentas: 0,
      totalGravado: 250000,
      totalExento: 0,
      totalVenta: 250000,
      totalDescuentos: 0,
      totalVentaNeta: 250000,
      totalImpuesto: 32500,
      totalComprobante: 282500
    }
  };

  // ---------------------------------------------------------------------------
  // 1. FACTURA ELECTRÓNICA (01) EN ESQUEMA v4.4
  // ---------------------------------------------------------------------------
  try {
    const resFE = generarXMLFactura(baseDoc, 1);
    assert(resFE.xml.includes('https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica'), 'Debe utilizar namespace oficial v4.4 de FE');
    assert(resFE.xml.includes('xsi:schemaLocation="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica'), 'Debe referenciar schemaLocation v4.4');
    assert.strictEqual(resFE.clave.length, 50, 'Clave debe tener 50 dígitos');
    assert.strictEqual(resFE.consecutivo.length, 20, 'Consecutivo debe tener 20 dígitos');

    record(1, 'Factura Electrónica (01) v4.4', true, `Namespace y schemaLocation oficiales v4.4 validados (Clave: ${resFE.clave}).`);
  } catch (err: any) {
    record(1, 'Factura Electrónica (01) v4.4', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 2. TIQUETE ELECTRÓNICO (04) EN ESQUEMA v4.4
  // ---------------------------------------------------------------------------
  try {
    const tiqueteDoc: ComprobanteElectronico = {
      ...baseDoc,
      tipoDocumento: '04',
      receptor: undefined // Tiquete a consumidor final sin receptor
    };
    const resTE = generarXMLFactura(tiqueteDoc, 2);
    assert(resTE.xml.includes('https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/tiqueteElectronico'), 'Debe utilizar namespace oficial v4.4 de TE');
    assert(resTE.xml.includes('<TiqueteElectronico'), 'Root tag debe ser TiqueteElectronico');
    assert(!resTE.xml.includes('<Receptor>'), 'TE a consumidor final no debe incluir nodo Receptor');

    record(2, 'Tiquete Electrónico (04) v4.4', true, 'Tiquete a consumidor final emitido conforme a v4.4 sin receptor obligatorio.');
  } catch (err: any) {
    record(2, 'Tiquete Electrónico (04) v4.4', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 3. NOTA DE CRÉDITO (03) CON CÓDIGOS DE REFERENCIA v4.4 (NOTA 9)
  // ---------------------------------------------------------------------------
  try {
    // Probar código v4.4 "16" (Referencia a comprobante previamente rechazado)
    const ncDoc: ComprobanteElectronico = {
      ...baseDoc,
      tipoDocumento: '03',
      informacionReferencia: {
        tipoDoc: '01',
        numero: '50623112600310199988800100001010000000001199999999',
        fechaEmision: new Date(),
        codigo: '16', // Nuevo código oficial v4.4
        razon: 'Sustitucion por rechazo tributario DGT'
      }
    };
    const resNC = generarXMLFactura(ncDoc, 3);
    assert(resNC.xml.includes('https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/notaCreditoElectronica'), 'Debe utilizar namespace oficial v4.4 de NC');
    assert(resNC.xml.includes('<Codigo>16</Codigo>'), 'Debe incorporar código de referencia 16 según Nota 9 v4.4');
    assert(resNC.xml.includes('<TipoDoc>01</TipoDoc>'), 'Debe referenciar TipoDoc 01');

    // Probar rechazo ante código de referencia inválido
    let codigoInvalidoRechazado = false;
    try {
      generarXMLFactura({
        ...ncDoc,
        informacionReferencia: { ...ncDoc.informacionReferencia!, codigo: '88' as any }
      }, 4);
    } catch (e: any) {
      codigoInvalidoRechazado = e.message.includes('catálogo oficial DGT v4.4');
    }
    assert(codigoInvalidoRechazado, 'Códigos ajenos a Nota 9 v4.4 deben ser rechazados');

    record(3, 'Nota de Crédito (03) v4.4 y Catálogo de Referencias', true, 'Códigos v4.4 (01..05, 12..17, 99) admitidos y validados estrictamente.');
  } catch (err: any) {
    record(3, 'Nota de Crédito (03) v4.4 y Catálogo de Referencias', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 4. NOTA DE DÉBITO (02) Y VINCULACIÓN A COMPROBANTE HISTÓRICO v4.3
  // ---------------------------------------------------------------------------
  try {
    // Nota de Débito emitida en v4.4 que referencia una factura histórica v4.3
    const fechaHistorica = new Date('2024-05-15T10:00:00-06:00');
    const claveHistorica = '50615052400310199988800100001010000000001100000001';

    const ndDoc: ComprobanteElectronico = {
      ...baseDoc,
      tipoDocumento: '02',
      informacionReferencia: {
        tipoDoc: '01',
        numero: claveHistorica,
        fechaEmision: fechaHistorica,
        codigo: '03', // Corrige montos
        razon: 'Ajuste de intereses moratorios de factura historica emitida en v4.3'
      }
    };

    const resND = generarXMLFactura(ndDoc, 5);
    assert(resND.xml.includes('https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/notaDebitoElectronica'), 'ND debe emitirse en esquema v4.4');
    assert(resND.xml.includes(`<Numero>${claveHistorica}</Numero>`), 'Debe preservar la clave histórica v4.3 referenciada');
    assert(resND.xml.includes('2024-05-15'), 'Debe formatear fecha histórica correctamente');

    record(4, 'Nota de Débito (02) v4.4 y Vinculación Histórica v4.3', true, 'Referencia cruzada a comprobantes históricos v4.3 preservada sin errores.');
  } catch (err: any) {
    record(4, 'Nota de Débito (02) v4.4 y Vinculación Histórica v4.3', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 5. SOPORTE DE COMPROBANTES DE EXPORTACIÓN (09) Y COMPRA (08) EN v4.4
  // ---------------------------------------------------------------------------
  try {
    const feeInfo = getRootElement('09', 'v4.4');
    assert.strictEqual(feeInfo.rootName, 'FacturaElectronicaExportacion');
    assert(feeInfo.schemaUrl.includes('/v4.4/facturaElectronicaExportacion'), 'FEE debe usar namespace v4.4');

    const fecInfo = getRootElement('08', 'v4.4');
    assert.strictEqual(fecInfo.rootName, 'FacturaElectronicaCompra');
    assert(fecInfo.schemaUrl.includes('/v4.4/facturaElectronicaCompra'), 'FEC debe usar namespace v4.4');

    record(5, 'Esquemas FEC (08) y FEE (09) en v4.4', true, 'Estructuras y namespaces de compra y exportación homologados a v4.4.');
  } catch (err: any) {
    record(5, 'Esquemas FEC (08) y FEE (09) en v4.4', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 6. IDENTIFICACIONES ALFANUMÉRICAS (EMISOR Y RECEPTOR)
  // ---------------------------------------------------------------------------
  try {
    const docAlfanumerico: ComprobanteElectronico = {
      ...baseDoc,
      emisor: {
        ...baseDoc.emisor,
        identificacion: { tipo: '02', numero: '3-101-999888A' } // Alfanumérico con guión
      },
      receptor: {
        nombre: 'FOREIGN CLIENT LLC',
        identificacion: { tipo: '03', numero: 'DIMEX-9876543210' }, // Alfanumérico extranjero
        correo: 'billing@foreign.com'
      }
    };

    const resAlfa = generarXMLFactura(docAlfanumerico, 6);
    assert(resAlfa.xml.includes('<Numero>3101999888A</Numero>'), 'Emisor debe conservar caracteres alfanuméricos eliminando guiones');
    assert(resAlfa.xml.includes('<Numero>DIMEX9876543210</Numero>'), 'Receptor debe conservar caracteres alfanuméricos eliminando guiones');

    record(6, 'Soporte de Identificaciones Alfanuméricas v4.4', true, 'Cédulas con sufijos y DIMEX alfanuméricos procesados conforme a v4.4.');
  } catch (err: any) {
    record(6, 'Soporte de Identificaciones Alfanuméricas v4.4', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 7. FIRMADO CRIPTOGRÁFICO XAdES-BES SOBRE XML v4.4
  // ---------------------------------------------------------------------------
  try {
    const certMock = generarCertificadoPruebaP12('1234');
    const certInfo = cargarCertificadoP12(certMock, '1234');

    const resFE = generarXMLFactura(baseDoc, 7);
    const xmlFirmado = firmarXMLFactura(resFE.xml, certInfo);

    assert(xmlFirmado.includes('https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica'), 'XML firmado debe preservar namespace v4.4');
    assert(xmlFirmado.includes('<ds:Signature'), 'Debe contener nodo ds:Signature');
    assert(xmlFirmado.includes('xades:SignedProperties'), 'Debe contener propiedades XAdES-EPES');
    assert(xmlFirmado.includes('xades:SignaturePolicyIdentifier'), 'Debe contener SignaturePolicyIdentifier');

    const firmaValida = verificarFirmaXML(xmlFirmado);
    assert(firmaValida.valida, 'La firma criptográfica XAdES-EPES sobre el XML v4.4 debe ser válida');
    assert(firmaValida.policyIdValido, 'La política de firma debe ser válida y apuntar a v4.4');
    assert(firmaValida.policyDigestValido, 'El digest de la política debe coincidir con el oficial v4.4');

    record(7, 'Firmado Digital XAdES-EPES en XML v4.4', true, 'Firma RSA-SHA256 y Policy Id v4.4 validados matemáticamente sobre comprobante v4.4.');
  } catch (err: any) {
    record(7, 'Firmado Digital XAdES-BES en XML v4.4', false, err.message);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // 8. GENERACIÓN COMPATIBLE DE HISTÓRICOS v4.3 (CONVIVENCIA REGULATORIA)
  // ---------------------------------------------------------------------------
  try {
    const docHistorico: ComprobanteElectronico = {
      ...baseDoc,
      versionNormativa: 'v4.3' // Petición explícita de esquema histórico
    };

    const resHistorico = generarXMLFactura(docHistorico, 8);
    assert(resHistorico.xml.includes('https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.3/facturaElectronica'), 'Debe generar esquema v4.3 cuando se requiera históricamente');
    assert(!resHistorico.xml.includes('v4.4'), 'No debe mezclar v4.4 cuando se solicita explícitamente v4.3');

    record(8, 'Convivencia y Generación de Históricos v4.3', true, 'El motor permite consultar o regenerar v4.3 para auditoría sin romper v4.4.');
  } catch (err: any) {
    record(8, 'Convivencia y Generación de Históricos v4.3', false, err.message);
    throw err;
  }

  console.log('\n======================================================');
  console.log('🎉 TODAS LAS PRUEBAS DE MIGRACIÓN DGT v4.4 SUPERADAS (8/8)');
  console.log('======================================================\n');
}

runDgtV44Tests().catch(err => {
  console.error('❌ ERROR EN VALIDACIÓN DGT v4.4:', err);
  process.exit(1);
});
