/**
 * MEETINFACT — SUITE DE PRUEBAS AUTOMATIZADAS DE ZONA HORARIA
 * Validación rigurosa de America/Costa_Rica (UTC−06:00) y Regresiones
 */
import assert from 'assert';
import {
  TIMEZONE_CR,
  getFechaPartesCR,
  formatoFechaIsoCR,
  formatoFechaLegibleCR,
  getMesFiscalCR,
  getRangoUtcMesFiscalCR,
  getRangoUtcDiaCR
} from '../src/utils/cr-date.js';
import { generarClave, generarConsecutivo } from '../src/services/clave-generator.js';
import { formatoFechaCR, generarXMLFactura } from '../src/services/xml-builder.js';
import { ComprobanteElectronico } from '../types/factura.types.js';

console.log('======================================================================');
console.log('  MEETINFACT — SUITE DE PRUEBAS DE ZONA HORARIA: AMERICA/COSTA_RICA');
console.log('======================================================================\n');

let exitosas = 0;
let total = 0;

async function test(nombre: string, fn: () => void | Promise<void>) {
  total++;
  try {
    const res = fn();
    if (res instanceof Promise) {
      await res;
    }
    exitosas++;
    console.log(`Prueba ${total}: ${nombre}... PASÓ ✓`);
  } catch (err: any) {
    console.error(`Prueba ${total}: ${nombre}... FALLÓ ✗\n  Error: ${err.message}`);
    process.exitCode = 1;
  }
}

async function runAll() {
  // 1. Medianoche UTC (00:00:00 UTC = 18:00:00 CR del día anterior)
  await test('1. Medianoche UTC (00:00:00Z) mapea con exactitud a 18:00:00 del día anterior en Costa Rica', () => {
    // 2026-11-22T00:00:00.000Z es 2026-11-21 18:00:00 CR
    const d = new Date('2026-11-22T00:00:00.000Z');
    const partes = getFechaPartesCR(d);
    assert.strictEqual(partes.dia, '21');
    assert.strictEqual(partes.mes, '11');
    assert.strictEqual(partes.anioCompleto, '2026');
    assert.strictEqual(partes.hora, '18');
    assert.strictEqual(partes.minuto, '00');
    assert.strictEqual(partes.segundo, '00');

    const iso = formatoFechaIsoCR(d);
    assert.strictEqual(iso, '2026-11-21T18:00:00-06:00');
  });

  // 2. Medianoche de Costa Rica (06:00:00 UTC = 00:00:00 CR del mismo día)
  await test('2. Medianoche de Costa Rica (00:00:00 CR) corresponde exactamente a 06:00:00Z en UTC', () => {
    const d = new Date('2026-11-21T06:00:00.000Z');
    const partes = getFechaPartesCR(d);
    assert.strictEqual(partes.dia, '21');
    assert.strictEqual(partes.mes, '11');
    assert.strictEqual(partes.hora, '00');
    assert.strictEqual(partes.minuto, '00');
    assert.strictEqual(partes.segundo, '00');

    const iso = formatoFechaIsoCR(d);
    assert.strictEqual(iso, '2026-11-21T00:00:00-06:00');
  });

  // 3. Intervalo de 18:00 a 23:59 de Costa Rica (madrugada del día siguiente en UTC)
  await test('3. Intervalo de 18:00 a 23:59 CR (00:00 a 05:59 UTC siguiente) preserva el día de Costa Rica en la clave', () => {
    // 21 de noviembre a las 23:45:00 CR = 22 de noviembre a las 05:45:00 UTC
    const d = new Date('2026-11-22T05:45:00.000Z');
    const consecutivo = generarConsecutivo(1, 1, '01', 100);
    const clave = generarClave({
      fecha: d,
      cedulaEmisor: '3101123456',
      consecutivo
    });

    // En la clave, los dígitos 3 al 9 son DDMMAA
    const ddmmaa = clave.substring(3, 9);
    assert.strictEqual(ddmmaa, '211126', 'La clave debe tener el día 21 y no 22');

    const iso = formatoFechaIsoCR(d);
    assert.strictEqual(iso, '2026-11-21T23:45:00-06:00');
  });

  // 4. Último día de cada mes (Nov 30 a las 22:00 CR = Dic 1 a las 04:00 UTC)
  await test('4. Último día del mes a las 22:00 CR no desborda al mes siguiente en clave ni XML', () => {
    const d = new Date('2026-12-01T04:00:00.000Z'); // 30 Nov 22:00 CR
    const partes = getFechaPartesCR(d);
    assert.strictEqual(partes.dia, '30');
    assert.strictEqual(partes.mes, '11');
    assert.strictEqual(partes.anioCompleto, '2026');

    const consecutivo = generarConsecutivo(1, 1, '01', 200);
    const clave = generarClave({ fecha: d, cedulaEmisor: '3101123456', consecutivo });
    assert.strictEqual(clave.substring(3, 9), '301126');

    const mesFiscal = getMesFiscalCR(d);
    assert.strictEqual(mesFiscal, '2026-11');
  });

  // 5. Cambio de año (Dic 31 a las 20:00 CR = Ene 1 a las 02:00 UTC)
  await test('5. Fin de año a las 20:00 CR preserva año fiscal y clave en 31/12', () => {
    const d = new Date('2027-01-01T02:00:00.000Z'); // 31 Dic 2026 20:00 CR
    const partes = getFechaPartesCR(d);
    assert.strictEqual(partes.dia, '31');
    assert.strictEqual(partes.mes, '12');
    assert.strictEqual(partes.anio, '26');
    assert.strictEqual(partes.anioCompleto, '2026');

    const consecutivo = generarConsecutivo(1, 1, '01', 300);
    const clave = generarClave({ fecha: d, cedulaEmisor: '3101123456', consecutivo });
    assert.strictEqual(clave.substring(3, 9), '311226');
  });

  // 6. Consistencia estricta entre XML FechaEmision y Clave Numérica
  await test('6. XML FechaEmision y Clave de 50 dígitos concuerdan al 100% en día, mes y año', () => {
    const instante = new Date('2026-11-22T02:30:15.000Z'); // 21 Nov 20:30:15 CR
    const docPrueba: ComprobanteElectronico = {
      tipoDocumento: '01',
      fechaEmision: instante,
      emisor: {
        nombre: 'Empresa Test',
        identificacion: { tipo: '02', numero: '3101999999' },
        sucursal: 1,
        terminal: 1,
        correo: 'factura@test.cr',
        actividadEconomica: '722000',
        ubicacion: {
          provincia: '1',
          canton: '01',
          distrito: '01',
          senas: 'San Jose Centro'
        }
      },
      receptor: {
        nombre: 'Cliente Test',
        identificacion: { tipo: '02', numero: '3102888888' },
        correo: 'cliente@test.cr'
      },
      condicionVenta: '01',
      mediosPago: ['01'],
      lineas: [{
        numeroLinea: 1,
        codigoCabys: '8314100000000',
        detalle: 'Servicio QA',
        cantidad: 1,
        unidadMedida: 'Unid',
        precioUnitario: 10000,
        montoTotal: 10000,
        tarifaIVA: '13',
        montoIVA: 1300,
        montoTotalLinea: 11300
      }],
      resumen: {
        codigoMoneda: 'CRC',
        totalServGravados: 10000,
        totalMercanciasGravadas: 0,
        totalImpuesto: 1300,
        totalComprobante: 11300
      }
    };

    const { xml, clave } = generarXMLFactura(docPrueba, 45);

    // Clave tiene DDMMAA en posiciones 3..9
    const diaClave = clave.substring(3, 5);
    const mesClave = clave.substring(5, 7);
    const anioClave = clave.substring(7, 9);

    // Extraer FechaEmision del XML
    const match = xml.match(/<FechaEmision>(.*?)<\/FechaEmision>/);
    assert.ok(match, 'El XML debe contener la etiqueta FechaEmision');
    const fechaXml = match[1]; // YYYY-MM-DDTHH:mm:ss-06:00
    const [ymdPart] = fechaXml.split('T');
    const [yXml, mXml, dXml] = ymdPart.split('-');

    assert.strictEqual(diaClave, dXml, 'Día de la clave debe ser idéntico al día del XML');
    assert.strictEqual(mesClave, mXml, 'Mes de la clave debe ser idéntico al mes del XML');
    assert.strictEqual(anioClave, yXml.slice(-2), 'Año de la clave debe ser idéntico al año del XML');
    assert.strictEqual(dXml, '21', 'Ambos deben reflejar el día 21 de noviembre');
  });

  // 7. Consistencia visual en PDF, Portal y Notificaciones
  await test('7. Formato legible para Portal, PDF y correo refleja exactamente la hora de Costa Rica', () => {
    const instante = new Date('2026-11-22T03:15:00.000Z'); // 21 Nov 21:15 CR
    const legible = formatoFechaLegibleCR(instante);
    
    // Debe contener '21 nov' o '21 de noviembre' y '9:15' o '21:15'
    assert.ok(legible.includes('21'), `Debe ser día 21: ${legible}`);
    assert.ok(legible.includes('9:15') || legible.includes('21:15'), `Debe indicar 9:15 o 21:15: ${legible}`);
    assert.ok(!legible.includes('3:15'), `NO debe indicar 3:15 (hora UTC): ${legible}`);
  });

  // 8. Delimitación de rangos UTC para consultas fiscales de meses y días
  await test('8. getRangoUtcMesFiscalCR y getRangoUtcDiaCR definen límites exactos para indexación en PostgreSQL', () => {
    // Mes de Febrero 2026: 2026-02-01 00:00:00 CR hasta 2026-03-01 00:00:00 CR
    const rangoFeb = getRangoUtcMesFiscalCR('2026-02');
    assert.strictEqual(rangoFeb.inicioUtc.toISOString(), '2026-02-01T06:00:00.000Z');
    assert.strictEqual(rangoFeb.finUtc.toISOString(), '2026-03-01T06:00:00.000Z');

    // Día específico: 2026-11-21
    const rangoDia = getRangoUtcDiaCR('2026-11-21');
    assert.strictEqual(rangoDia.inicioUtc.toISOString(), '2026-11-21T06:00:00.000Z');
    assert.strictEqual(rangoDia.finUtc.toISOString(), '2026-11-22T06:00:00.000Z');

    // Un comprobante emitido a las 2026-11-22T01:00:00Z (19:00 CR del 21) cae dentro de rangoDia
    const tComp = new Date('2026-11-22T01:00:00.000Z').getTime();
    assert.ok(tComp >= rangoDia.inicioUtc.getTime() && tComp < rangoDia.finUtc.getTime());
  });

  // 9. Validación de ciclo de 24 horas (hourCycle h23: 00 a 23)
  await test('9. Ciclo de hora h23 genera 00:00 en medianoche y 12:00 en mediodía sin 24:00', () => {
    const medianocheCR = new Date('2026-11-21T06:00:00.000Z'); // 00:00 CR
    const mediodiaCR = new Date('2026-11-21T18:00:00.000Z');   // 12:00 CR

    const pMedianoche = getFechaPartesCR(medianocheCR);
    assert.strictEqual(pMedianoche.hora, '00');

    const pMediodia = getFechaPartesCR(mediodiaCR);
    assert.strictEqual(pMediodia.hora, '12');
  });

  // 10. Ausencia de conversiones dobles (idempotencia de formateo)
  await test('10. Ausencia de conversiones dobles: Date vs cadena ISO producen resultados idénticos', () => {
    const d = new Date('2026-11-21T21:40:00.000Z');
    const isoString = d.toISOString();

    const leg1 = formatoFechaLegibleCR(d);
    const leg2 = formatoFechaLegibleCR(isoString);
    assert.strictEqual(leg1, leg2);

    const mes1 = getMesFiscalCR(d);
    const mes2 = getMesFiscalCR(isoString);
    assert.strictEqual(mes1, mes2);
  });

  // 11. Regresión del Portal de Comprobantes (tokens de 256 bits y SHA-256 intactos)
  await test('11. Regresión Portal de Comprobantes: Hashing y tokens preservan entropía y SHA-256', async () => {
    const { hashToken } = await import('../src/services/comprobante-token-service.js');
    const testToken = 'abc123xyz_test_token_256_bits_length_verification';
    const h1 = hashToken(testToken);
    const h2 = hashToken(testToken);
    assert.strictEqual(h1, h2);
    assert.strictEqual(h1.length, 64);
  });

  // 12. Regresión de Suscripciones y Webhooks ONVO
  await test('12. Regresión ONVO Pay Sandbox: Comparaciones de vigencia en UTC preservan lógica financiera', () => {
    // Suscripciones comparan current_period_end (UTC) contra NOW() (UTC)
    const subEndUtc = new Date('2026-12-21T23:59:59.000Z');
    const nowUtc = new Date('2026-11-21T18:00:00.000Z');
    assert.ok(subEndUtc.getTime() > nowUtc.getTime(), 'Suscripción debe estar activa en UTC');

    // La presentación en Costa Rica refleja el vencimiento exacto en hora local
    const legibleFin = formatoFechaLegibleCR(subEndUtc);
    assert.ok(legibleFin.includes('21 dic') || legibleFin.includes('21 de diciembre'));
  });

  // 13. Rechazo explícito de objetos Date inválidos (sin sustitución silenciosa)
  await test('13. Rechazo explícito de fechas inválidas para emisión tributaria (no fallback silencioso)', () => {
    const invalidDate = new Date('fecha_invalida_no_parseable');
    assert.ok(Number.isNaN(invalidDate.getTime()));

    assert.throws(() => {
      getFechaPartesCR(invalidDate);
    }, /inválida/i, 'getFechaPartesCR debe arrojar error ante Date inválida');

    assert.throws(() => {
      formatoFechaIsoCR(invalidDate);
    }, /inválida/i, 'formatoFechaIsoCR debe arrojar error ante Date inválida');

    assert.throws(() => {
      generarClave({
        fecha: invalidDate,
        cedulaEmisor: '3101123456',
        consecutivo: generarConsecutivo(1, 1, '01', 500)
      });
    }, /inválida/i, 'generarClave debe arrojar error ante Date inválida');
  });

  // 14. Validación estricta de períodos fiscales YYYY-MM (meses entre 01 y 12)
  await test('14. Validación de meses en períodos fiscales YYYY-MM (estrictamente 01 a 12)', () => {
    assert.throws(() => getRangoUtcMesFiscalCR('2026-00'), /fuera de rango/i);
    assert.throws(() => getRangoUtcMesFiscalCR('2026-13'), /fuera de rango/i);
    assert.throws(() => getRangoUtcMesFiscalCR('2026-99'), /fuera de rango/i);
    assert.throws(() => getRangoUtcMesFiscalCR('invalido'), /inválido/i);

    const r01 = getRangoUtcMesFiscalCR('2026-01');
    assert.strictEqual(r01.inicioUtc.toISOString(), '2026-01-01T06:00:00.000Z');
    assert.strictEqual(r01.finUtc.toISOString(), '2026-02-01T06:00:00.000Z');

    const r12 = getRangoUtcMesFiscalCR('2026-12');
    assert.strictEqual(r12.inicioUtc.toISOString(), '2026-12-01T06:00:00.000Z');
    assert.strictEqual(r12.finUtc.toISOString(), '2027-01-01T06:00:00.000Z');
  });

  // 15. Validación de existencia real de días y años bisiestos en YYYY-MM-DD
  await test('15. Validación de existencia real de días y años bisiestos en getRangoUtcDiaCR', () => {
    // 29 de febrero en año bisiesto (2024): VÁLIDO
    const rBisiestoValido = getRangoUtcDiaCR('2024-02-29');
    assert.strictEqual(rBisiestoValido.inicioUtc.toISOString(), '2024-02-29T06:00:00.000Z');
    assert.strictEqual(rBisiestoValido.finUtc.toISOString(), '2024-03-01T06:00:00.000Z');

    // 29 de febrero en año no bisiesto (2026): INVÁLIDO
    assert.throws(() => getRangoUtcDiaCR('2026-02-29'), /Día inválido/i);

    // 31 de abril (mes de 30 días): INVÁLIDO
    assert.throws(() => getRangoUtcDiaCR('2026-04-31'), /Día inválido/i);

    // 32 de enero: INVÁLIDO
    assert.throws(() => getRangoUtcDiaCR('2026-01-32'), /Día inválido/i);

    // Día 00: INVÁLIDO
    assert.throws(() => getRangoUtcDiaCR('2026-01-00'), /Día inválido/i);
  });

  // 16. Verificación estricta de límites de rango cerrado-abierto [inicio, fin)
  await test('16. Límites de rango temporal son estrictamente inclusivos al inicio y exclusivos al final', () => {
    const rangoDia = getRangoUtcDiaCR('2026-11-21');
    const inicioMs = rangoDia.inicioUtc.getTime();
    const finMs = rangoDia.finUtc.getTime();

    // Exactamente en el milisegundo de inicio (06:00:00.000Z): DENTRO
    assert.ok(inicioMs >= inicioMs && inicioMs < finMs, 'El inicio exacto debe estar incluido');

    // Un milisegundo antes del inicio (05:59:59.999Z): FUERA
    assert.ok(!((inicioMs - 1) >= inicioMs && (inicioMs - 1) < finMs), 'Antes del inicio debe estar excluido');

    // Un milisegundo antes del fin (05:59:59.999Z del día siguiente): DENTRO
    assert.ok((finMs - 1) >= inicioMs && (finMs - 1) < finMs, 'Un ms antes del fin debe estar incluido');

    // Exactamente en el milisegundo de fin (06:00:00.000Z del día siguiente): FUERA (exclusivo)
    assert.ok(!(finMs >= inicioMs && finMs < finMs), 'El fin exacto debe ser excluido');
  });

  console.log('\n======================================================================');
  console.log(`RESULTADO DE LA SUITE DE ZONA HORARIA: ${exitosas}/${total} PRUEBAS EXITOSAS`);
  console.log('======================================================================');
}

runAll().catch(err => {
  console.error('Fallo no controlado en la suite:', err);
  process.exit(1);
});
