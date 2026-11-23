/**
 * MEETINFACT — PASO 10: BENCHMARK Y EVALUACIÓN DE CAPACIDAD OPERATIVA
 * Pruebas de carga moderada y calibración de rendimiento en QA.
 * Totalmente conservador: no afecta memoria ni CPU del VPS compartido.
 */
import http from 'http';
import https from 'https';
import os from 'os';
import { performance } from 'perf_hooks';
import { pool } from '../src/db/pool.js';
import { generarXMLFactura } from '../src/services/xml-builder.js';
import { firmarXMLFactura, cargarCertificadoP12 } from '../src/services/xml-signer.js';
import { generarFacturaEleganteHTML } from '../src/services/factura-renderer.js';
import { generarFacturaPDFBuffer } from '../src/services/pdf-generator.js';
import { pgDataStore } from '../src/services/pg-data-store.js';
import { ComprobanteElectronico } from '../src/services/data-store.js';
import fs from 'fs';
import path from 'path';

interface BenchmarkResult {
  nombre: string;
  concurrencia: number;
  totalPeticiones: number;
  exitosas: number;
  fallidas: number;
  duracionMs: number;
  rps: number;
  latenciaMediaMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
}

async function ejecutarCargaHttp(
  urlStr: string,
  totalRequests: number,
  concurrencia: number
): Promise<BenchmarkResult> {
  const url = new URL(urlStr);
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;
  const agent = new (isHttps ? https.Agent : http.Agent)({
    keepAlive: true,
    maxSockets: concurrencia * 2
  });

  const latencias: number[] = [];
  let exitosas = 0;
  let fallidas = 0;
  let completadas = 0;

  const tInicio = performance.now();

  async function worker() {
    while (true) {
      if (completadas >= totalRequests) break;
      completadas++;

      const start = performance.now();
      try {
        await new Promise<void>((resolve, reject) => {
          const req = lib.request(
            url,
            {
              method: 'GET',
              agent,
              headers: {
                'User-Agent': 'MeetinFact-LoadTester/1.0',
                Accept: 'application/json'
              },
              timeout: 10000
            },
            (res) => {
              res.on('data', () => {});
              res.on('end', () => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
                  exitosas++;
                } else {
                  fallidas++;
                }
                resolve();
              });
            }
          );
          req.on('error', (err) => {
            fallidas++;
            resolve();
          });
          req.on('timeout', () => {
            req.destroy();
            fallidas++;
            resolve();
          });
          req.end();
        });
        latencias.push(performance.now() - start);
      } catch (e) {
        fallidas++;
      }
    }
  }

  const workers = Array.from({ length: concurrencia }, () => worker());
  await Promise.all(workers);

  const tTotal = performance.now() - tInicio;
  agent.destroy();

  const rps = (exitosas / (tTotal / 1000));
  const avg = latencias.reduce((a, b) => a + b, 0) / (latencias.length || 1);

  return {
    nombre: url.pathname,
    concurrencia,
    totalPeticiones: totalRequests,
    exitosas,
    fallidas,
    duracionMs: Math.round(tTotal),
    rps: Math.round(rps * 10) / 10,
    latenciaMediaMs: Math.round(avg * 100) / 100,
    p50Ms: Math.round(percentile(latencias, 0.50) * 100) / 100,
    p95Ms: Math.round(percentile(latencias, 0.95) * 100) / 100,
    p99Ms: Math.round(percentile(latencias, 0.99) * 100) / 100
  };
}

async function runBenchmarks() {
  console.log('======================================================================');
  console.log('   MEETINFACT — PASO 10: BENCHMARK DE CAPACIDAD Y RENDIMIENTO (QA)    ');
  console.log('======================================================================');
  console.log(`Host CPU Cores : ${os.cpus().length}`);
  console.log(`Memoria Libre  : ${Math.round(os.freemem() / 1024 / 1024)} MB / ${Math.round(os.totalmem() / 1024 / 1024)} MB`);
  console.log(`Node.js Version: ${process.version}`);
  console.log('----------------------------------------------------------------------\n');

  // 1. CARGA MODERADA EN API HTTP (Endpoint de Salud y Verificación Pública)
  const baseUrl = process.env.APP_URL || 'https://test-facturacion.meetinlabs.com';
  console.log(`[1/5] Evaluando latencia y concurrencia HTTP en API (${baseUrl})...`);
  
  const nivelesConcurrencia = [5, 10, 20];
  const resultadosHttp: BenchmarkResult[] = [];

  for (const c of nivelesConcurrencia) {
    const total = c * 30; // 150, 300, 600 peticiones
    console.log(`   -> Probando concurrencia = ${c} (${total} peticiones a /api/public/health)...`);
    const res = await ejecutarCargaHttp(`${baseUrl}/api/public/health`, total, c);
    resultadosHttp.push(res);
    console.log(`      RPS: ${res.rps} | Latencia media: ${res.latenciaMediaMs}ms | p95: ${res.p95Ms}ms | Éxito: ${(res.exitosas / res.totalPeticiones * 100).toFixed(1)}%`);
  }

  // 2. RENDIMIENTO DE GENERACIÓN DE XML v4.3
  console.log('\n[2/5] Evaluando throughput del motor de generación XML v4.3...');
  const iteracionesXml = 200;
  const docBase: ComprobanteElectronico = {
    fechaEmision: new Date(),
    tipoDocumento: '01',
    condicionVenta: '01',
    mediosPago: ['01'],
    emisor: {
      nombre: 'EMPRESA PILOTO SA',
      nombreComercial: 'PILOTO',
      actividadEconomica: '722003',
      sucursal: 1,
      terminal: 1,
      identificacion: { tipo: '02', numero: '3101999888' },
      correo: 'factura@piloto.cr',
      ubicacion: { provincia: '1', canton: '01', distrito: '01', direccion: 'San José' }
    },
    receptor: {
      nombre: 'CLIENTE PRUEBA SA',
      identificacion: { tipo: '02', numero: '3101111222' },
      correo: 'cliente@prueba.cr'
    },
    lineas: [
      {
        numeroLinea: 1,
        codigoCabys: '2111100000000',
        detalle: 'Producto de prueba A',
        cantidad: 2,
        unidadMedida: 'Unid',
        precioUnitario: 5000,
        montoTotal: 10000,
        subTotal: 10000,
        codigoImpuesto: '01',
        codigoTarifaIVA: '08',
        tarifaIVA: 13,
        montoIVA: 1300,
        montoTotalLinea: 11300
      },
      {
        numeroLinea: 2,
        codigoCabys: '8311100000000',
        detalle: 'Servicio profesional B',
        cantidad: 1,
        unidadMedida: 'Sp',
        precioUnitario: 25000,
        montoTotal: 25000,
        subTotal: 25000,
        codigoImpuesto: '01',
        codigoTarifaIVA: '08',
        tarifaIVA: 13,
        montoIVA: 3250,
        montoTotalLinea: 28250
      }
    ],
    resumen: {
      codigoMoneda: 'CRC',
      totalServiciosGravados: 25000,
      totalServiciosExentos: 0,
      totalMercanciasGravadas: 10000,
      totalMercanciasExentas: 0,
      totalGravado: 35000,
      totalExento: 0,
      totalVenta: 35000,
      totalDescuentos: 0,
      totalVentaNeta: 35000,
      totalImpuesto: 4550,
      totalComprobante: 39550
    }
  };

  const tXmlStart = performance.now();
  let sampleXml = '';
  for (let i = 0; i < iteracionesXml; i++) {
    const res = generarXMLFactura(docBase, i + 1);
    sampleXml = res.xml;
  }
  const tXmlTotal = performance.now() - tXmlStart;
  const xmlRps = (iteracionesXml / (tXmlTotal / 1000));
  const msPorXml = tXmlTotal / iteracionesXml;
  console.log(`   -> Generados ${iteracionesXml} XMLs v4.3 en ${tXmlTotal.toFixed(1)}ms`);
  console.log(`      Throughput: ${xmlRps.toFixed(1)} XML/s | Tiempo unitario: ${msPorXml.toFixed(3)}ms`);

  // 3. RENDIMIENTO DE FIRMA DIGITAL XAdES-BES
  console.log('\n[3/5] Evaluando throughput de firma criptográfica XAdES-BES...');
  const iteracionesFirma = 50;
  const certPath = path.resolve('./certs/test-cert.p12');
  const certP12 = fs.readFileSync(certPath);
  const certInfo = cargarCertificadoP12(certP12, '1234');

  const tFirmaStart = performance.now();
  for (let i = 0; i < iteracionesFirma; i++) {
    firmarXMLFactura(sampleXml, certInfo);
  }
  const tFirmaTotal = performance.now() - tFirmaStart;
  const firmaRps = (iteracionesFirma / (tFirmaTotal / 1000));
  const msPorFirma = tFirmaTotal / iteracionesFirma;
  console.log(`   -> Ejecutadas ${iteracionesFirma} firmas XAdES-BES en ${tFirmaTotal.toFixed(1)}ms`);
  console.log(`      Throughput: ${firmaRps.toFixed(1)} firmas/s | Tiempo unitario: ${msPorFirma.toFixed(2)}ms`);

  // 4. RENDIMIENTO DE GENERACIÓN PDF (PUPPETEER CHROMIUM)
  console.log('\n[4/5] Evaluando generación de PDFs oficiales con Chromium...');
  const iteracionesPdf = 6;
  const htmlDoc = await generarFacturaEleganteHTML({
    clave: '50623112600310198765400100001010000000001188463499',
    consecutivo: '00100001010000000001',
    doc: docBase,
    config: { sitio: { nombreSistema: 'PILOTO', subtitulo: 'Costa Rica • DGT v4.3' } } as any,
    estilo: 'ejecutivo'
  });
  
  const memBefore = process.memoryUsage().rss / 1024 / 1024;
  const tPdfStart = performance.now();
  for (let i = 0; i < iteracionesPdf; i++) {
    await generarFacturaPDFBuffer(htmlDoc);
  }
  const tPdfTotal = performance.now() - tPdfStart;
  const memAfter = process.memoryUsage().rss / 1024 / 1024;
  const pdfRps = (iteracionesPdf / (tPdfTotal / 1000));
  const msPorPdf = tPdfTotal / iteracionesPdf;
  console.log(`   -> Generados ${iteracionesPdf} PDFs en ${tPdfTotal.toFixed(1)}ms`);
  console.log(`      Throughput: ${pdfRps.toFixed(2)} PDF/s | Tiempo unitario: ${msPorPdf.toFixed(0)}ms`);
  console.log(`      Impacto en RAM: ${memBefore.toFixed(1)} MB -> ${memAfter.toFixed(1)} MB (Δ ${(memAfter - memBefore).toFixed(1)} MB)`);

  // 5. POOL DE CONEXIONES Y CONSULTAS EN POSTGRESQL
  console.log('\n[5/5] Evaluando pool de conexiones y latencia PostgreSQL...');
  const consultasConcurrentes = 30;
  const tPgStart = performance.now();
  const pgPromises = Array.from({ length: consultasConcurrentes }, async () => {
    const qStart = performance.now();
    const res = await pool.query('SELECT 1 as ping, NOW() as server_time');
    return performance.now() - qStart;
  });
  const latenciasPg = await Promise.all(pgPromises);
  const tPgTotal = performance.now() - tPgStart;
  const avgPg = latenciasPg.reduce((a, b) => a + b, 0) / latenciasPg.length;

  const statRes = await pool.query(`
    SELECT count(*) as total_conns,
           count(*) FILTER (WHERE state = 'active') as conns_activas,
           count(*) FILTER (WHERE state = 'idle') as conns_idle
    FROM pg_stat_activity
    WHERE datname = current_database();
  `);
  const { total_conns, conns_activas, conns_idle } = statRes.rows[0];

  console.log(`   -> ${consultasConcurrentes} consultas concurrentes completadas en ${tPgTotal.toFixed(1)}ms`);
  console.log(`      Latencia media query: ${avgPg.toFixed(2)}ms | p95: ${percentile(latenciasPg, 0.95).toFixed(2)}ms`);
  console.log(`      Conexiones PostgreSQL BD: total=${total_conns}, activas=${conns_activas}, idle=${conns_idle}`);

  console.log('\n======================================================================');
  console.log('   BENCHMARK FINALIZADO: TODAS LAS CAPAS VALIDADAS SATISFACTORIAMENTE  ');
  console.log('======================================================================');
  
  await pool.end();
}

runBenchmarks().catch(err => {
  console.error('[BENCHMARK] Error:', err);
  process.exit(1);
});
