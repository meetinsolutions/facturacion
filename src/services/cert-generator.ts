import forge from 'node-forge';
import * as fs from 'fs';

/**
 * Genera un certificado autofirmado en formato PKCS#12 (.p12) para pruebas locales
 */
export function generarCertificadoPruebaP12(pin: string = '1234'): Buffer {
  // Generar par de llaves RSA 2048
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 2);

  const attrs = [
    { name: 'commonName', value: 'CERTIFICADO PRUEBAS POS' },
    { name: 'countryName', value: 'CR' },
    { shortName: 'ST', value: 'San Jose' },
    { name: 'localityName', value: 'San Jose' },
    { name: 'organizationName', value: 'Empresa Demo Costa Rica' },
    { shortName: 'OU', value: 'Facturacion Electronica' }
  ];

  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  // Autofirmar certificado
  cert.sign(keys.privateKey, forge.md.sha256.create());

  // Empaquetar a PKCS#12
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], pin, {
    generateLocalKeyId: true,
    friendlyName: 'Certificado de Pruebas'
  });

  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  return Buffer.from(p12Der, 'binary');
}
