import forge from 'node-forge';
import * as fs from 'fs';
import * as crypto from 'crypto';

export interface CertificadoInfo {
  certificatePem: string;
  privateKeyPem: string;
  x509CertificateB64: string;
  certDigestB64: string;
  issuerName: string;
  serialNumber: string;
}

/**
 * Carga y extrae los datos del archivo .p12 (PKCS#12) generado por el ATV de Hacienda
 */
export function cargarCertificadoP12(p12PathOrBuffer: string | Buffer, pin: string): CertificadoInfo {
  let p12Buffer: Buffer;
  if (typeof p12PathOrBuffer === 'string') {
    if (!fs.existsSync(p12PathOrBuffer)) {
      throw new Error(`El archivo de certificado no existe en: ${p12PathOrBuffer}`);
    }
    p12Buffer = fs.readFileSync(p12PathOrBuffer);
  } else {
    p12Buffer = p12PathOrBuffer;
  }

  const p12Der = p12Buffer.toString('binary');
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, pin);

  // Extraer bolsa de certificados
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBag = certBags[forge.pki.oids.certBag]?.[0];
  if (!certBag || !certBag.cert) {
    throw new Error('No se encontró el certificado en el archivo .p12');
  }
  const cert = certBag.cert;

  // Extraer bolsa de llave privada
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
  if (!keyBag || !keyBag.key) {
    throw new Error('No se encontró la llave privada en el archivo .p12');
  }
  const privateKey = keyBag.key;

  const certificatePem = forge.pki.certificateToPem(cert);
  const privateKeyPem = forge.pki.privateKeyToPem(privateKey);

  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const certBuffer = Buffer.from(certDer, 'binary');
  const x509CertificateB64 = certBuffer.toString('base64');

  // SHA-256 Digest del certificado para XAdES CertDigest
  const certDigestB64 = crypto.createHash('sha256').update(certBuffer).digest('base64');

  // Formato Issuer Name estándar RFC 4514 (e.g., CN=..., OU=..., O=..., C=...)
  const issuerAttributes = cert.issuer.attributes.map(attr => `${attr.shortName || attr.name}=${attr.value}`);
  const issuerName = issuerAttributes.reverse().join(',');

  const serialNumber = BigInt('0x' + cert.serialNumber).toString(10);

  return {
    certificatePem,
    privateKeyPem,
    x509CertificateB64,
    certDigestB64,
    issuerName,
    serialNumber
  };
}

/**
 * Canoniza de manera simplificada e idéntica a Canonical XML (C14N)
 */
function canonizarXML(xml: string): string {
  return xml.trim().replace(/>\s+</g, '><');
}

/**
 * Firma digitalmente un XML con formato XAdES-BES requerido por DGT Costa Rica
 */
export function firmarXMLFactura(xmlOriginal: string, certInfo: CertificadoInfo): string {
  // Limpiar XML previo
  const xmlLimpio = xmlOriginal.replace(/<\?xml.*?\?>/, '').trim();

  // IDs únicos para referencias XAdES
  const randomSuffix = Math.floor(Math.random() * 900000 + 100000).toString();
  const signatureId = `Signature-${randomSuffix}`;
  const signedInfoId = `SignedInfo-${randomSuffix}`;
  const signedPropertiesId = `SignedProperties-${randomSuffix}`;
  const keyInfoId = `KeyInfo-${randomSuffix}`;
  const signatureValueId = `SignatureValue-${randomSuffix}`;

  // 1. Digest del documento XML original (SHA-256)
  const docDigest = crypto.createHash('sha256').update(xmlLimpio, 'utf8').digest('base64');

  // 2. Fecha de firma en formato UTC ISO 8601
  const signingTime = new Date().toISOString();

  // 3. Estructura SignedProperties (XAdES-BES)
  const signedPropertiesXml = `<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="${signedPropertiesId}"><xades:SignedSignatureProperties><xades:SigningTime>${signingTime}</xades:SigningTime><xades:SigningCertificate><xades:Cert><xades:CertDigest><ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod><ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${certInfo.certDigestB64}</ds:DigestValue></xades:CertDigest><xades:IssuerSerial><ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${certInfo.issuerName}</ds:X509IssuerName><ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${certInfo.serialNumber}</ds:X509SerialNumber></xades:IssuerSerial></xades:Cert></xades:SigningCertificate></xades:SignedSignatureProperties></xades:SignedProperties>`;

  const signedPropertiesDigest = crypto.createHash('sha256').update(signedPropertiesXml, 'utf8').digest('base64');

  // 4. Estructura KeyInfo
  const keyInfoXml = `<ds:KeyInfo Id="${keyInfoId}"><ds:X509Data><ds:X509Certificate>${certInfo.x509CertificateB64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>`;
  const keyInfoDigest = crypto.createHash('sha256').update(keyInfoXml, 'utf8').digest('base64');

  // 5. Estructura SignedInfo
  const signedInfoXml = `<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="${signedInfoId}"><ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></ds:CanonicalizationMethod><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"></ds:SignatureMethod><ds:Reference Id="Reference-Doc-${randomSuffix}" URI=""><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></ds:Transform></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod><ds:DigestValue>${docDigest}</ds:DigestValue></ds:Reference><ds:Reference Id="Reference-KeyInfo-${randomSuffix}" URI="#${keyInfoId}"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod><ds:DigestValue>${keyInfoDigest}</ds:DigestValue></ds:Reference><ds:Reference Type="http://uri.etsi.org/01903#SignedProperties" URI="#${signedPropertiesId}"><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></ds:Transform></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod><ds:DigestValue>${signedPropertiesDigest}</ds:DigestValue></ds:Reference></ds:SignedInfo>`;

  // 6. Firmar SignedInfo con la Llave Privada RSA-SHA256
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signedInfoXml, 'utf8');
  const signatureValueB64 = signer.sign(certInfo.privateKeyPem, 'base64');

  // 7. Estructura completa Signature XAdES-BES
  const signatureXml = `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="${signatureId}">${signedInfoXml}<ds:SignatureValue Id="${signatureValueId}">${signatureValueB64}</ds:SignatureValue>${keyInfoXml}<ds:Object><xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="#${signatureId}">${signedPropertiesXml}</xades:QualifyingProperties></ds:Object></ds:Signature>`;

  // 8. Inyectar Signature antes del cierre de la etiqueta raíz
  const closingTagMatch = xmlLimpio.match(/<\/(FacturaElectronica|NotaDebitoElectronica|NotaCreditoElectronica|TiqueteElectronico|FacturaElectronicaExportacion|FacturaElectronicaCompra)>$/);
  if (!closingTagMatch) {
    throw new Error('No se encontró la etiqueta de cierre del documento XML');
  }

  const closingTag = closingTagMatch[0];
  const xmlSinCierre = xmlLimpio.substring(0, xmlLimpio.length - closingTag.length);

  return `<?xml version="1.0" encoding="UTF-8"?>\n${xmlSinCierre}\n${signatureXml}\n${closingTag}`;
}
