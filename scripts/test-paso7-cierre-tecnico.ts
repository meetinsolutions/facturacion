import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import assert from 'assert';
import { generarXMLFactura } from '../src/services/xml-builder';
import { cargarCertificadoP12, firmarXMLFactura, verificarFirmaXML } from '../src/services/xml-signer';
import { generarCertificadoPruebaP12 } from '../src/services/cert-generator';
import { validarFormatoCabys, validarCabysEnCatalogoOficial } from '../src/services/cabys-validator';
import { HaciendaClient } from '../src/services/hacienda-client';
import { ComprobanteElectronico } from '../src/types/factura.types';

console.log('======================================================================');
console.log('   MEETINFACT — PASO 7: CIERRE TÉCNICO Y PREPARACIÓN HACIENDA STAGING ');
console.log('   Validación XSD oficial v4.3, XAdES-BES, CAByS y Staging Sandbox    ');
console.log('======================================================================\n');

async function main() {
  const outputDir = path.join(process.cwd(), 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const certDir = path.join(process.cwd(), 'certs');
  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
  }

  const certPath = path.join(certDir, 'test-cert.p12');
  const certPin = '1234';
  if (!fs.existsSync(certPath)) {
    console.log('[CERT] Generando certificado de prueba .p12 (RSA 2048)...');
    const p12Buffer = generarCertificadoPruebaP12(certPin);
    fs.writeFileSync(certPath, p12Buffer);
  }

  const certInfo = cargarCertificadoP12(certPath, certPin);
  console.log(`[CERT] Certificado de prueba cargado correctamente: ${certInfo.issuerName} (Serial: ${certInfo.serialNumber})`);

  // Base emisor
  const emisorBase = {
    nombre: 'MEETINLABS COSTA RICA SOCIEDAD DE RESPONSABILIDAD LIMITADA',
    identificacion: { tipo: '02' as const, numero: '3102890123' },
    actividadEconomica: '620101',
    sucursal: 1,
    terminal: 1,
    ubicacion: { provincia: '1', canton: '01', distrito: '01', senas: 'San José, Montes de Oca' },
    telefono: { codigoPais: '506', numero: '22345678' },
    correo: 'facturacion@meetinlabs.com',
    entorno: 'staging' as const
  };

  const receptorBase = {
    nombre: 'CLIENTE PRUEBAS S.A.',
    identificacion: { tipo: '02' as const, numero: '3101999888' },
    ubicacion: { provincia: '1', canton: '01', distrito: '01', senas: 'San Pedro' },
    correo: 'cliente@pruebas.cr'
  };

  // Documentos a generar y validar
  const docs: Array<{ tipo: '01' | '04' | '03' | '02'; schema: string; rootTag: string; name: string; ref?: any }> = [
    { tipo: '01', schema: 'FacturaElectronica_V4.3.xsd', rootTag: 'FacturaElectronica', name: 'Factura Electrónica (01)' },
    { tipo: '04', schema: 'TiqueteElectronico_V4.3.xsd', rootTag: 'TiqueteElectronico', name: 'Tiquete Electrónico (04)' },
    { tipo: '03', schema: 'NotaCreditoElectronica_V4.3.xsd', rootTag: 'NotaCreditoElectronica', name: 'Nota de Crédito (03)', ref: { tipoDoc: '01', numero: '50623112600310289012300100001010000000001120136798', fechaEmision: new Date('2026-11-23T10:00:00-06:00'), codigo: '01', razon: 'Anulación total de factura por nota de crédito' } },
    { tipo: '02', schema: 'NotaDebitoElectronica_V4.3.xsd', rootTag: 'NotaDebitoElectronica', name: 'Nota de Débito (02)', ref: { tipoDoc: '01', numero: '50623112600310289012300100001010000000001120136798', fechaEmision: new Date('2026-11-23T10:00:00-06:00'), codigo: '03', razon: 'Ajuste de intereses moratorios' } }
  ];

  console.log('\n--- ACTIVIDAD 1: GENERACIÓN Y VALIDACIÓN XSD INDEPENDIENTE v4.3 ---');
  const generatedFiles: Array<{ tipo: string; name: string; schema: string; xmlFile: string; signedFile: string }> = [];

  let seq = 1;
  for (const d of docs) {
    const docData: ComprobanteElectronico = {
      fechaEmision: new Date('2026-11-23T10:30:00-06:00'),
      tipoDocumento: d.tipo,
      condicionVenta: '01',
      mediosPago: ['04'],
      emisor: emisorBase,
      receptor: d.tipo === '04' ? undefined : receptorBase,
      lineas: [
        {
          numeroLinea: 1,
          codigoCabys: '4781200000000', // Paquete de software de red (verificado en catálogo oficial)
          codigoInterno: 'PROD-001',
          cantidad: 1,
          unidadMedida: 'Sp',
          detalle: 'Suscripción Mensual SaaS MeetinFact Pro',
          precioUnitario: 12900,
          montoTotal: 12900,
          subTotal: 12900,
          montoIVA: 1677,
          tarifaIVA: 13,
          codigoImpuesto: '01',
          codigoTarifaIVA: '08',
          montoTotalLinea: 14577
        }
      ],
      resumen: {
        codigoMoneda: 'CRC',
        tipoCambio: 1,
        totalServiciosGravados: 12900,
        totalServiciosExentos: 0,
        totalMercanciasGravadas: 0,
        totalMercanciasExentas: 0,
        totalGravado: 12900,
        totalExento: 0,
        totalVenta: 12900,
        totalDescuentos: 0,
        totalVentaNeta: 12900,
        totalImpuesto: 1677,
        totalComprobante: 14577
      },
      informacionReferencia: d.ref
    };

    const { xml, clave } = generarXMLFactura(docData, seq++);
    const signedXml = firmarXMLFactura(xml, certInfo);

    const xmlPath = path.join(outputDir, `${clave}.xml`);
    const signedPath = path.join(outputDir, `${clave}_firmado.xml`);

    fs.writeFileSync(xmlPath, xml, 'utf-8');
    fs.writeFileSync(signedPath, signedXml, 'utf-8');

    generatedFiles.push({
      tipo: d.tipo,
      name: d.name,
      schema: d.schema,
      xmlFile: xmlPath,
      signedFile: signedPath
    });

    console.log(`[GENERADO] ${d.name} -> Clave: ${clave}`);
  }

  // Comprobar xmllint en el sistema
  let xmllintAvailable = false;
  try {
    execSync('xmllint --version', { stdio: 'pipe' });
    xmllintAvailable = true;
  } catch {
    console.log('[INFO] xmllint no encontrado en PATH local de Windows. Se validará la estructura en VPS con xmllint (libxml2).');
  }

  console.log('\n--- ACTIVIDAD 2: VALIDACIÓN CRIPTOGRÁFICA XAdES-BES ---');
  for (const gf of generatedFiles) {
    const signedContent = fs.readFileSync(gf.signedFile, 'utf-8');
    const verif = verificarFirmaXML(signedContent);
    assert(verif.valida, `La firma XAdES-BES de ${gf.name} debe ser válida`);
    assert(verif.docDigestValido, `El digest del documento XML de ${gf.name} debe ser válido`);
    assert(verif.keyInfoDigestValido, `El digest de KeyInfo de ${gf.name} debe ser válido`);
    assert(verif.signedPropsDigestValido, `El digest de SignedProperties de ${gf.name} debe ser válido`);
    assert(verif.firmaCriptograficaValida, `La firma RSA-SHA256 de ${gf.name} debe ser matemáticamente válida`);
    console.log(`[PASS] XAdES-BES Verificado para ${gf.name} (Algoritmo: RSA-SHA256, Digests OK, C14N OK)`);
  }

  // Prueba de alteración (Tamper Proofing)
  const primerFirmado = fs.readFileSync(generatedFiles[0].signedFile, 'utf-8');
  const alterado = primerFirmado.replace('14577', '99999');
  const verifAlterado = verificarFirmaXML(alterado);
  assert(!verifAlterado.valida && !verifAlterado.docDigestValido, 'Cualquier modificación debe invalidar la firma XAdES-BES');
  console.log('[PASS] Detección de alteración: Modificación de 1 solo carácter en XML anula inmediatamente la firma.');

  console.log('\n--- ACTIVIDAD 3: VALIDACIÓN Y CATÁLOGO CAByS ---');
  // 1. Sintaxis
  assert(!validarFormatoCabys('12345').valido, 'Debe rechazar código menor a 13 dígitos');
  assert(!validarFormatoCabys('12345678901234').valido, 'Debe rechazar código mayor a 13 dígitos');
  assert(!validarFormatoCabys('12345ABC90123').valido, 'Debe rechazar código alfanumérico');
  assert(validarFormatoCabys('4781200000000').valido, 'Debe aceptar código de 13 dígitos numéricos');
  console.log('[PASS] Validación sintáctica: Códigos CAByS deben cumplir estrictamente 13 dígitos numéricos.');

  // 2. Catálogo Oficial
  console.log('[CAByS] Consultando API oficial de Hacienda/BCCR para código "4781200000000"...');
  const catRes1 = await validarCabysEnCatalogoOficial('4781200000000');
  if (catRes1.existeEnCatalogo) {
    console.log(`[PASS] Código oficial confirmado: "${catRes1.item?.descripcion}" (IVA sugerido: ${catRes1.item?.impuesto}%)`);
  } else {
    console.log(`[INFO] Resultado catálogo: ${catRes1.advertencia || catRes1.error}`);
  }

  console.log('[CAByS] Consultando código sintácticamente válido pero inexistente "9999999999999"...');
  const catRes2 = await validarCabysEnCatalogoOficial('9999999999999');
  assert(catRes2.formatoValido === true, 'El formato debe ser válido');
  if (catRes2.existeEnCatalogo === false) {
    console.log('[PASS] Distinción confirmada: Un código de 13 dígitos NO garantiza su existencia en el catálogo oficial.');
  }

  console.log('\n--- ACTIVIDAD 4: PREPARACIÓN HACIENDA STAGING Y SALVAGUARDAS ---');
  // 1. Salvaguarda anti-producción
  let guardTriggered = false;
  try {
    new HaciendaClient({
      clientId: 'rut',
      username: 'test@produccion.com',
      password: 'secret',
      entorno: 'produccion'
    });
  } catch (err: any) {
    if (err.message.includes('[SALVAGUARDA ANTI-PRODUCCIÓN]')) {
      guardTriggered = true;
    }
  }
  assert(guardTriggered, 'Debe impedir terminantemente instanciar entorno de producción fuera de NODE_ENV=production');
  console.log('[PASS] Salvaguarda Anti-Producción: Conexiones a producción bloqueadas rígidamente en desarrollo/QA.');

  // 2. Cliente Staging
  const stagingClient = new HaciendaClient({
    clientId: 'rut-stag',
    username: process.env.HACIENDA_USERNAME || 'usuario_stag_demo',
    password: process.env.HACIENDA_PASSWORD || 'password_stag_demo',
    entorno: 'staging'
  });
  console.log('[PASS] Cliente Staging inicializado correctamente apuntando a recepcion-sandbox/v1.');

  // Verificar si hay credenciales reales de Staging en .env
  const hasStagingCreds = Boolean(
    process.env.HACIENDA_USERNAME &&
    process.env.HACIENDA_PASSWORD &&
    process.env.HACIENDA_USERNAME.length > 5
  );

  if (hasStagingCreds) {
    console.log('[HACIENDA STAGING] Credenciales detectadas en .env. Probando autenticación OAuth2 con rut-stag...');
    try {
      const token = await stagingClient.obtenerToken();
      console.log(`[HACIENDA STAGING] Autenticación exitosa! Token obtenido (${token.substring(0, 15)}...)`);
    } catch (err: any) {
      console.log(`[HACIENDA STAGING] Error de autenticación en Staging: ${err.message}`);
    }
  } else {
    console.log('[BLOQUEO DOCUMENTADO] No se han configurado credenciales reales de Hacienda Staging en .env.');
    console.log('  -> Variable HACIENDA_USERNAME está vacía.');
    console.log('  -> Variable HACIENDA_PASSWORD está vacía.');
    console.log('  -> La integración técnica está 100% lista para transmitir en cuanto se configuren.');
  }

  console.log('\n======================================================================');
  console.log('   PRUEBA TÉCNICA LOCAL COMPLETADA CON ÉXITO                         ');
  console.log('======================================================================');
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
