/**
 * MEETINFACT 1.0 — BL-02: SUITE DE TRANSMISIÓN Y VALIDACIÓN HACIENDA STAGING
 * 
 * Permite ejecutar la prueba oficial de transmisión y consulta en el entorno
 * Staging / Sandbox del Ministerio de Hacienda de Costa Rica (DGT).
 * 
 * SALVAGUARDAS:
 * 1. Utiliza única y exclusivamente los endpoints de Sandbox / Staging.
 * 2. Bloquea de raíz cualquier llamada a endpoints de producción.
 * 3. Modo Dry-Run por defecto: No transmite a Hacienda a menos que se pase el flag '--execute'.
 * 4. Sanitización completa: No imprime contraseñas, PIN ni tokens en consola ni en logs.
 * 5. Manejo robusto de códigos HTTP: 202, 400, 401, 403, 429 y reintentos ante fallas de red.
 */
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { generarXMLFactura } from '../src/services/xml-builder.js';
import { firmarXMLFactura, verificarFirmaXML, cargarCertificadoP12, CertificadoInfo } from '../src/services/xml-signer.js';
import { generarCertificadoPruebaP12 } from '../src/services/cert-generator.js';
import { ComprobanteElectronico } from '../src/types/factura.types.js';

// Configuración de Endpoints Oficiales de Hacienda Staging
const STAGING_CONFIG = {
  idpUrl: 'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token',
  apiUrl: 'https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1',
  clientId: 'api-stag'
};

interface ExecutionReport {
  timestamp: string;
  modo: 'dry-run' | 'live-staging';
  entorno: 'staging';
  emisor: {
    nombre: string;
    identificacion: string;
    actividadEconomica: string;
  };
  comprobante: {
    clave: string;
    consecutivo: string;
    total: number;
    moneda: string;
  };
  autenticacion: {
    estado: 'pendiente' | 'exitosa' | 'fallida';
    servidorIdP: string;
    error?: string;
  };
  recepcion: {
    estado: 'pendiente' | 'aceptada_202' | 'error_400' | 'error_401' | 'error_403' | 'rate_limit_429' | 'error_red';
    httpStatus?: number;
    locationHeader?: string;
    error?: string;
  };
  consultaEstado: {
    estadoFinal?: 'aceptado' | 'rechazado' | 'procesando' | 'tiempo_agotado' | 'no_consultado';
    intentos: number;
    mensajeHacienda?: string;
    detalleError?: string;
  };
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('======================================================================');
  console.log('   MEETINFACT 1.0 — SUITE DE INTEGRACIÓN HACIENDA STAGING (OFICIAL)   ');
  console.log('   Ambiente: STAGING / SANDBOX DGT (CERO impacto en Producción)      ');
  console.log('======================================================================\n');

  // 1. Verificación de Salvaguarda Anti-Producción
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_HACIENDA_PROD === 'true') {
    console.error('❌ ERROR CRÍTICO: Este script está diseñado exclusivamente para pruebas Staging. Abortado.');
    process.exit(1);
  }

  const isLive = process.argv.includes('--execute') || process.env.HACIENDA_STAGING_CONFIRMED === 'true';
  const modoTexto = isLive ? '🔴 TRANSMISIÓN REAL A STAGING ACTIVADA (--execute)' : '🟡 MODO SECO / VERIFICACIÓN (DRY-RUN)';
  console.log(`[MODO]: ${modoTexto}\n`);

  // 2. Comprobar Credenciales Staging en Entorno
  const username = process.env.HACIENDA_USERNAME;
  const password = process.env.HACIENDA_PASSWORD;
  const pin = process.env.HACIENDA_PIN;
  const p12Path = process.env.HACIENDA_P12_PATH;
  const emisorCedula = process.env.HACIENDA_EMISOR_CEDULA || '3102890123';
  const emisorNombre = process.env.HACIENDA_EMISOR_NOMBRE || 'MEETINLABS COSTA RICA S.R.L. (PRUEBAS)';
  const emisorActividad = process.env.HACIENDA_EMISOR_ACTIVIDAD || '620101';

  const faltantes: string[] = [];
  if (!username) faltantes.push('HACIENDA_USERNAME');
  if (!password) faltantes.push('HACIENDA_PASSWORD');
  if (!pin) faltantes.push('HACIENDA_PIN');
  if (!p12Path || !fs.existsSync(p12Path)) faltantes.push('HACIENDA_P12_PATH (archivo .p12 existente)');

  console.log('--- ESTADO DE CREDENCIALES STAGING ---');
  console.log(`- Usuario Técnico ATV: ${username ? 'Configurado (oculto)' : '⚠️ NO CONFIGURADO'}`);
  console.log(`- Contraseña ATV:      ${password ? 'Configurada (oculta)' : '⚠️ NO CONFIGURADA'}`);
  console.log(`- PIN Llave .p12:      ${pin ? 'Configurado (oculto)' : '⚠️ NO CONFIGURADO'}`);
  console.log(`- Archivo Llave .p12:  ${p12Path && fs.existsSync(p12Path) ? `Presente en ${p12Path}` : '⚠️ ARCHIVO NO ENCONTRADO'}`);
  console.log(`- Cédula Emisor:       ${emisorCedula}`);
  console.log(`- Razón Social Emisor: ${emisorNombre}`);
  console.log(`- Actividad Económica: ${emisorActividad}\n`);

  // 3. Cargar o simular certificado
  let certInfo: CertificadoInfo;
  if (p12Path && fs.existsSync(p12Path) && pin) {
    try {
      certInfo = cargarCertificadoP12(p12Path, pin);
      console.log(`✅ Certificado .p12 cargado con éxito: Emisor "${certInfo.issuerName}", Serial "${certInfo.serialNumber}"`);
    } catch (e: any) {
      console.error(`❌ Error cargando archivo .p12: ${e.message}`);
      process.exit(1);
    }
  } else {
    console.log('ℹ️ Utilizando certificado criptográfico de prueba local para validar estructura y firma (sin envío real).');
    const p12Buffer = generarCertificadoPruebaP12('1234');
    certInfo = cargarCertificadoP12(p12Buffer, '1234');
  }

  // 4. Construcción del Comprobante Factura Electrónica v4.4
  console.log('\n--- GENERACIÓN DE COMPROBANTE FACTURA ELECTRÓNICA v4.4 ---');
  const docFactura: ComprobanteElectronico = {
    fechaEmision: new Date(),
    tipoDocumento: '01',
    condicionVenta: '01',
    mediosPago: ['04'],
    versionNormativa: 'v4.4',
    emisor: {
      nombre: emisorNombre,
      identificacion: { tipo: '02', numero: emisorCedula },
      actividadEconomica: emisorActividad,
      sucursal: 1,
      terminal: 1,
      ubicacion: { provincia: '1', canton: '01', distrito: '01', senas: 'San José, Montes de Oca' },
      correo: 'facturacion@meetinlabs.com',
      telefono: { codigoPais: '506', numero: '22345678' },
      entorno: 'staging'
    },
    receptor: {
      nombre: 'RECEPTOR PRUEBAS STAGING DGT',
      identificacion: { tipo: '02', numero: '3101999888' },
      ubicacion: { provincia: '1', canton: '01', distrito: '01', senas: 'San José Centro' },
      correo: 'receptor@staging-meetinlabs.cr'
    },
    lineas: [
      {
        numeroLinea: 1,
        codigoCabys: '4781200000000', // Paquete de software de red verificado
        codigoInterno: 'PILOTO-001',
        cantidad: 1,
        unidadMedida: 'Sp',
        detalle: 'Validación Técnica Piloto MeetinFact Staging',
        precioUnitario: 1000,
        montoTotal: 1000,
        subTotal: 1000,
        montoIVA: 130,
        tarifaIVA: 13,
        codigoImpuesto: '01',
        codigoTarifaIVA: '08',
        montoTotalLinea: 1130
      }
    ],
    resumen: {
      codigoMoneda: 'CRC',
      tipoCambio: 1,
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

  const { xml, clave, consecutivo } = generarXMLFactura(docFactura, Math.floor(Math.random() * 90000 + 10000));
  const signedXml = firmarXMLFactura(xml, certInfo);

  // Verificación de integridad criptográfica
  const vFirma = verificarFirmaXML(signedXml);
  if (!vFirma.valida) {
    console.error('❌ ERROR: La firma criptográfica generada no es válida.');
    process.exit(1);
  }

  console.log(`✅ Factura v4.4 generada y firmada exitosamente.`);
  console.log(`   - Clave DGT:       ${clave}`);
  console.log(`   - Consecutivo:     ${consecutivo}`);
  console.log(`   - Monto Total:     CRC 1,130.00`);
  console.log(`   - Namespace:       https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica`);
  console.log(`   - Firma XAdES-BES: VÁLIDA (RSA-SHA256, C14N, Digests OK)`);

  // Guardar archivo preparado en carpeta de evidencia aislada
  const evidenceDir = path.join(process.cwd(), 'output', 'hacienda-staging', clave);
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'comprobante_enviado.xml'), signedXml, 'utf8');

  const report: ExecutionReport = {
    timestamp: new Date().toISOString(),
    modo: isLive ? 'live-staging' : 'dry-run',
    entorno: 'staging',
    emisor: {
      nombre: emisorNombre,
      identificacion: emisorCedula,
      actividadEconomica: emisorActividad
    },
    comprobante: {
      clave,
      consecutivo,
      total: 1130,
      moneda: 'CRC'
    },
    autenticacion: {
      estado: 'pendiente',
      servidorIdP: STAGING_CONFIG.idpUrl
    },
    recepcion: {
      estado: 'pendiente'
    },
    consultaEstado: {
      intentos: 0
    }
  };

  if (!isLive) {
    console.log('\n======================================================================');
    console.log('🟡 REVISIÓN DRY-RUN COMPLETADA: EL COMPROBANTE ESTÁ LISTO PARA ENVÍO');
    console.log('======================================================================');
    console.log(`Evidencia previa almacenada en: output/hacienda-staging/${clave}/`);

    if (faltantes.length > 0) {
      console.log('\n⚠️ Para ejecutar la prueba real en Staging se requieren las siguientes variables en .env:');
      for (const f of faltantes) {
        console.log(`   - ${f}`);
      }
      console.log('\nInstrucciones: Configurar dichas variables en el entorno de QA y luego ejecutar con el comando:');
      console.log('npm run build && npx tsx scripts/test-hacienda-staging-live.ts --execute');
    } else {
      console.log('\n✅ Todas las credenciales están configuradas. Para transmitir oficialmente a Staging, ejecute:');
      console.log('npm run build && npx tsx scripts/test-hacienda-staging-live.ts --execute');
    }

    fs.writeFileSync(path.join(evidenceDir, 'reporte_dry_run.json'), JSON.stringify(report, null, 2), 'utf8');
    return;
  }

  // ===========================================================================
  // TRANSMISIÓN REAL CONTROLADA A HACIENDA STAGING
  // ===========================================================================
  console.log('\n--- PASO 1: AUTENTICACIÓN OAUTH2 ANTE IDP STAGING ---');
  if (faltantes.length > 0) {
    console.error(`❌ Transmisión abortada: faltan variables requeridas: ${faltantes.join(', ')}`);
    process.exit(1);
  }

  let accessToken = '';
  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('client_id', STAGING_CONFIG.clientId);
    params.append('username', username!);
    params.append('password', password!);

    const authRes = await axios.post(STAGING_CONFIG.idpUrl, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000
    });

    accessToken = authRes.data.access_token;
    report.autenticacion.estado = 'exitosa';
    console.log('✅ Autenticación OAuth2 exitosa ante IdP Staging (Token Bearer obtenido).');
  } catch (err: any) {
    const status = err.response?.status;
    const desc = err.response?.data?.error_description || err.message;
    report.autenticacion.estado = 'fallida';
    report.autenticacion.error = `HTTP ${status}: ${desc}`;
    console.error(`❌ Fallo de autenticación en IdP Staging (${report.autenticacion.error})`);
    fs.writeFileSync(path.join(evidenceDir, 'reporte_error.json'), JSON.stringify(report, null, 2), 'utf8');
    process.exit(1);
  }

  console.log('\n--- PASO 2: ENVÍO DEL COMPROBANTE AL ENDPOINT DE RECEPCIÓN ---');
  const payloadEnvio = {
    clave,
    fecha: new Date().toISOString(),
    emisor: {
      tipoIdentificacion: '02',
      numeroIdentificacion: emisorCedula
    },
    receptor: {
      tipoIdentificacion: '02',
      numeroIdentificacion: '3101999888'
    },
    comprobanteXml: Buffer.from(signedXml, 'utf8').toString('base64')
  };

  let locationHeader = '';
  try {
    const resRecepcion = await axios.post(`${STAGING_CONFIG.apiUrl}/recepcion`, payloadEnvio, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    if (resRecepcion.status === 202) {
      report.recepcion.estado = 'aceptada_202';
      report.recepcion.httpStatus = 202;
      locationHeader = resRecepcion.headers['location'] || '';
      report.recepcion.locationHeader = locationHeader;
      console.log(`✅ Comprobante recibido por Hacienda Staging (HTTP 202 Accepted).`);
      if (locationHeader) console.log(`   Location: ${locationHeader}`);
    }
  } catch (err: any) {
    const status = err.response?.status;
    const dataErr = err.response?.data ? JSON.stringify(err.response.data) : err.message;

    if (status === 400) {
      report.recepcion.estado = 'error_400';
    } else if (status === 401) {
      report.recepcion.estado = 'error_401';
    } else if (status === 403) {
      report.recepcion.estado = 'error_403';
    } else if (status === 429) {
      report.recepcion.estado = 'rate_limit_429';
    } else {
      report.recepcion.estado = 'error_red';
    }

    report.recepcion.httpStatus = status;
    report.recepcion.error = dataErr;
    console.error(`❌ Error en endpoint de recepción (${status}): ${dataErr}`);
    fs.writeFileSync(path.join(evidenceDir, 'reporte_error.json'), JSON.stringify(report, null, 2), 'utf8');
    process.exit(1);
  }

  // --- PASO 3: CONSULTA DE ESTADO CON POLLING Y RETRIES ---
  console.log('\n--- PASO 3: CONSULTA DE ESTADO EN COLA DGT (POLLING) ---');
  const maxIntentos = 12;
  const intervaloMs = 5000;
  let estadoFinal = 'tiempo_agotado';

  for (let intento = 1; intento <= maxIntentos; intento++) {
    report.consultaEstado.intentos = intento;
    console.log(`[Consulta ${intento}/${maxIntentos}] Consultando estado para clave ${clave}...`);

    try {
      const resConsulta = await axios.get(`${STAGING_CONFIG.apiUrl}/recepcion/${clave}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        timeout: 10000
      });

      const indEstado = resConsulta.data['ind-estado'];
      const respuestaXmlB64 = resConsulta.data['respuesta-xml'];

      console.log(`   -> Estado en Hacienda: "${indEstado}"`);

      if (indEstado === 'aceptado') {
        estadoFinal = 'aceptado';
        report.consultaEstado.estadoFinal = 'aceptado';

        if (respuestaXmlB64) {
          const respuestaXml = Buffer.from(respuestaXmlB64, 'base64').toString('utf8');
          fs.writeFileSync(path.join(evidenceDir, 'mensaje_hacienda.xml'), respuestaXml, 'utf8');
          report.consultaEstado.mensajeHacienda = 'mensaje_hacienda.xml guardado';
        }
        console.log('🎉 COMPROBANTE ACEPTADO OFICIALMENTE POR HACIENDA STAGING!');
        break;
      } else if (indEstado === 'rechazado') {
        estadoFinal = 'rechazado';
        report.consultaEstado.estadoFinal = 'rechazado';

        if (respuestaXmlB64) {
          const respuestaXml = Buffer.from(respuestaXmlB64, 'base64').toString('utf8');
          fs.writeFileSync(path.join(evidenceDir, 'mensaje_hacienda_rechazo.xml'), respuestaXml, 'utf8');
          report.consultaEstado.mensajeHacienda = 'mensaje_hacienda_rechazo.xml guardado';
        }
        console.warn('⚠️ COMPROBANTE RECHAZADO POR HACIENDA STAGING. Verifique mensaje_hacienda_rechazo.xml.');
        break;
      } else {
        // Estado 'procesando' o 'recibido'
        if (intento < maxIntentos) {
          await sleep(intervaloMs);
        }
      }
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 404) {
        console.log('   -> Comprobante aún en cola de enrutamiento (HTTP 404 temporal)...');
      } else if (status === 429) {
        console.log('   -> Rate limit detectado (HTTP 429). Esperando 10s con backoff...');
        await sleep(10000);
      } else {
        console.warn(`   -> Advertencia transitoria en consulta: ${err.message}`);
      }

      if (intento < maxIntentos) {
        await sleep(intervaloMs);
      }
    }
  }

  report.consultaEstado.estadoFinal = estadoFinal as any;
  fs.writeFileSync(path.join(evidenceDir, 'resultado_hacienda.json'), JSON.stringify(report, null, 2), 'utf8');

  console.log('\n======================================================================');
  console.log(`RESULTADO FINAL DE LA PRUEBA EN STAGING: ${estadoFinal.toUpperCase()}`);
  console.log(`Evidencia completa registrada en: output/hacienda-staging/${clave}/`);
  console.log('======================================================================\n');
}

main().catch(err => {
  console.error('❌ ERROR FATAL:', err);
  process.exit(1);
});
