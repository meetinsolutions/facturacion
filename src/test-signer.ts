import { generarCertificadoPruebaP12 } from './services/cert-generator.js';
import { cargarCertificadoP12, firmarXMLFactura } from './services/xml-signer.js';
import * as fs from 'fs';
import * as path from 'path';

console.log('=== PRUEBA DE FIRMA DIGITAL XAdES-BES (DGT COSTA RICA) ===\n');

const pinPrueba = '1234';

// 1. Generar y guardar certificado .p12 de prueba si no existe
const certDir = path.join(process.cwd(), 'certs');
if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir, { recursive: true });
}

const certPath = path.join(certDir, 'test-cert.p12');
if (!fs.existsSync(certPath)) {
  console.log('Generando certificado .p12 de prueba con RSA 2048...');
  const p12Buffer = generarCertificadoPruebaP12(pinPrueba);
  fs.writeFileSync(certPath, p12Buffer);
  console.log(`Certificado guardado en: ${certPath}`);
}

// 2. Cargar certificado y extraer claves
console.log('Cargando certificado y extrayendo metadatos...');
const certInfo = cargarCertificadoP12(certPath, pinPrueba);
console.log(`- Emisor: ${certInfo.issuerName}`);
console.log(`- Serial: ${certInfo.serialNumber}`);
console.log(`- Cert Digest SHA-256 (Base64): ${certInfo.certDigestB64}`);

// 3. Leer un XML generado en el paso anterior
const outputDir = path.join(process.cwd(), 'output');
const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.xml') && !f.includes('_firmado'));

if (files.length === 0) {
  console.error('No se encontró ningún XML para firmar. Ejecute primero npm run test:xml');
  process.exit(1);
}

const xmlFilePath = path.join(outputDir, files[0]);
console.log(`\nLeyendo XML original de: ${xmlFilePath}`);
const xmlOriginal = fs.readFileSync(xmlFilePath, 'utf-8');

// 4. Firmar con XAdES-BES
console.log('Aplicando firma XAdES-BES...');
const xmlFirmado = firmarXMLFactura(xmlOriginal, certInfo);

// Guardar archivo firmado
const signedFilePath = path.join(outputDir, files[0].replace('.xml', '_firmado.xml'));
fs.writeFileSync(signedFilePath, xmlFirmado, 'utf-8');
console.log(`\nXML Firmado exitosamente guardado en:\n${signedFilePath}`);

console.log('\n--- VISTA PREVIA DEL BLOQUE DE FIRMA INYECTADO ---');
const signatureLines = xmlFirmado.split('\n');
const startIndex = signatureLines.findIndex(l => l.includes('<ds:Signature'));
if (startIndex !== -1) {
  console.log(signatureLines.slice(startIndex, startIndex + 25).join('\n'));
  console.log('...\n<ds:Signature>');
}
