/**
 * MEETINFACT — VALIDACIÓN FUNCIONAL EN QA DE ZONA HORARIA
 * Comprobación en vivo de emisión nocturna (> 18:00 CR), reportes y límites
 */
import assert from 'assert';
import { Pool } from 'pg';
import { generarClave, generarConsecutivo } from '../src/services/clave-generator.js';
import { generarXMLFactura } from '../src/services/xml-builder.js';
import { generarPortalComprobanteHTML } from '../src/services/portal-viewer-renderer.js';
import { generarFacturaEleganteHTML } from '../src/services/factura-renderer.js';
import { getRangoUtcMesFiscalCR } from '../src/utils/cr-date.js';
import { ComprobanteElectronico } from '../types/factura.types.js';

const TEST_DB = 'facturacion_test';
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl || !databaseUrl.includes(TEST_DB)) {
  console.log(`[AVISO] Omitiendo ejecución en base no QA (${databaseUrl})`);
  process.exit(0);
}

const pool = new Pool({ connectionString: databaseUrl });

async function main() {
  console.log('======================================================================');
  console.log('  MEETINFACT — VALIDACIÓN FUNCIONAL EN QA DE ZONA HORARIA');
  console.log('  Base de datos: ' + TEST_DB);
  console.log('======================================================================\n');

  // 1. Instante posterior a las 18:00 de Costa Rica
  // 21 de noviembre a las 20:45:10 CR = 22 de noviembre a las 02:45:10 UTC
  const instanteNocturno = new Date('2026-11-22T02:45:10.000Z');

  const consecutivo = generarConsecutivo(1, 1, '01', 999);
  const doc: ComprobanteElectronico = {
    tipoDocumento: '01',
    fechaEmision: instanteNocturno,
    emisor: {
      nombre: 'QA Soluciones Tecnológicas S.A.',
      nombreComercial: 'QA Tech',
      identificacion: { tipo: '02', numero: '3101999888' },
      actividadEconomica: '722000',
      sucursal: 1,
      terminal: 1,
      correo: 'facturacion@qatech.cr',
      ubicacion: { provincia: '1', canton: '01', distrito: '01', senas: 'San Jose' }
    },
    receptor: {
      nombre: 'Cliente Nocturno S.A.',
      identificacion: { tipo: '02', numero: '3102777666' },
      correo: 'cliente@nocturno.cr'
    },
    condicionVenta: '01',
    mediosPago: ['01'],
    lineas: [{
      numeroLinea: 1,
      codigoCabys: '8314100000000',
      detalle: 'Desarrollo de Software QA',
      cantidad: 1,
      unidadMedida: 'Unid',
      precioUnitario: 80000,
      montoTotal: 80000,
      tarifaIVA: '13',
      montoIVA: 10400,
      montoTotalLinea: 90400
    }],
    resumen: {
      codigoMoneda: 'CRC',
      totalServGravados: 80000,
      totalMercanciasGravadas: 0,
      totalImpuesto: 10400,
      totalComprobante: 90400
    }
  };

  const { xml, clave } = generarXMLFactura(doc, 999);

  // A) Verificar Clave de 50 dígitos
  const ddmmaaClave = clave.substring(3, 9);
  console.log(`Clave Generada: ${clave}`);
  console.log(`Fecha en Clave (DDMMAA): ${ddmmaaClave}`);
  assert.strictEqual(ddmmaaClave, '211126', 'La clave debe registrar el día 21 de noviembre');

  // B) Verificar XML FechaEmision
  const xmlMatch = xml.match(/<FechaEmision>(.*?)<\/FechaEmision>/);
  assert.ok(xmlMatch, 'XML debe contener FechaEmision');
  const fechaXml = xmlMatch[1];
  console.log(`XML FechaEmision: ${fechaXml}`);
  assert.strictEqual(fechaXml, '2026-11-21T20:45:10-06:00', 'XML debe reflejar hora local de Costa Rica con offset -06:00');

  // C) Verificar Portal Web HTML
  const compMock = {
    tokenId: '00000000-0000-0000-0000-000000000001',
    tenantId: '00000000-0000-0000-0000-000000000001',
    clave,
    consecutivo,
    tipoDocumento: '01',
    fecha: instanteNocturno,
    moneda: 'CRC',
    total: 90400,
    cliente: 'Cliente Nocturno S.A.',
    estadoHacienda: 'aceptado',
    xmlFirmado: xml,
    docOriginalJson: doc,
    expiraEn: new Date(Date.now() + 86400000),
    revocado: false,
    accesosContador: 0
  };

  const portalHtml = await generarPortalComprobanteHTML(compMock, 'dummy_raw_token');
  console.log('Verificando texto en Portal Web HTML...');
  assert.ok(portalHtml.includes('21 de noviembre de 2026'), 'Portal debe decir 21 de noviembre');
  assert.ok(portalHtml.includes('20:45') || portalHtml.includes('8:45'), 'Portal debe decir 20:45 o 8:45 p. m.');
  assert.ok(!portalHtml.includes('22 de noviembre'), 'Portal NO debe decir 22 de noviembre');

  // D) Verificar Factura PDF HTML
  const configMock: any = {
    emisor: doc.emisor,
    sitio: { nombreComercial: 'QA Tech', estiloFactura: 'ejecutivo' }
  };
  const pdfHtml = await generarFacturaEleganteHTML({
    doc,
    config: configMock,
    clave,
    consecutivo
  });
  console.log('Verificando texto en PDF HTML...');
  assert.ok(pdfHtml.includes('21 nov') || pdfHtml.includes('21 de noviembre'), 'PDF debe decir 21 nov');
  assert.ok(pdfHtml.includes('20:45') || pdfHtml.includes('8:45'), 'PDF debe decir 20:45 o 8:45');
  assert.ok(!pdfHtml.includes('22 nov 2026, 02:45'), 'PDF NO debe decir 22 nov 02:45 UTC');

  // E) Verificación de reporte mensual y límites de fin de mes
  // Último día de noviembre a las 22:30 CR = 01 de diciembre a las 04:30 UTC
  const finNoviembreCR = new Date('2026-12-01T04:30:00.000Z');
  // Primer instante de diciembre a las 00:00:00 CR = 01 de diciembre a las 06:00 UTC
  const inicioDiciembreCR = new Date('2026-12-01T06:00:00.000Z');

  const rangoNov = getRangoUtcMesFiscalCR('2026-11');
  console.log(`Rango Fiscal Noviembre 2026: [${rangoNov.inicioUtc.toISOString()}, ${rangoNov.finUtc.toISOString()})`);

  // Operación del 30 de nov a las 22:30 CR debe caer DENTRO de noviembre
  assert.ok(
    finNoviembreCR.getTime() >= rangoNov.inicioUtc.getTime() &&
    finNoviembreCR.getTime() < rangoNov.finUtc.getTime(),
    'Operación nocturna del 30 nov debe incluirse en el mes fiscal de noviembre'
  );

  // Operación del 01 de dic a las 00:00 CR debe quedar FUERA de noviembre
  assert.ok(
    !(inicioDiciembreCR.getTime() >= rangoNov.inicioUtc.getTime() &&
      inicioDiciembreCR.getTime() < rangoNov.finUtc.getTime()),
    'Operación del 1 dic 00:00 CR debe excluirse del mes fiscal de noviembre'
  );

  console.log('\n======================================================================');
  console.log('TODAS LAS VALIDACIONES FUNCIONALES EN QA COMPLETADAS CON ÉXITO (5/5)');
  console.log('======================================================================');
  process.exit(0);
}

main().catch(err => {
  console.error('Error en validación funcional:', err);
  process.exit(1);
});
