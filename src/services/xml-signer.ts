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
  validity?: {
    notBefore: Date;
    notAfter: Date;
  };
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

  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, pin);
  } catch (err: any) {
    if (err.message?.includes('MAC') || err.message?.includes('password') || err.message?.includes('Invalid')) {
      throw new Error('Contraseña o PIN incorrecto para el archivo de certificado criptográfico (.p12).');
    }
    throw new Error(`Error al procesar el archivo .p12: ${err.message}`);
  }

  // Extraer bolsa de certificados
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBag = certBags[forge.pki.oids.certBag]?.[0];
  if (!certBag || !certBag.cert) {
    throw new Error('No se encontró el certificado en el archivo .p12');
  }
  const cert = certBag.cert;

  // Validación de vigencia del certificado
  const now = new Date();
  if (cert.validity.notAfter < now) {
    throw new Error(`El certificado criptográfico está vencido (expiró el ${cert.validity.notAfter.toISOString()}).`);
  }
  if (cert.validity.notBefore > now) {
    throw new Error(`El certificado criptográfico aún no es válido (vigente a partir de ${cert.validity.notBefore.toISOString()}).`);
  }

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
    serialNumber,
    validity: {
      notBefore: cert.validity.notBefore,
      notAfter: cert.validity.notAfter
    }
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

/**
 * Valida la integridad criptográfica y los digests de una firma XAdES-BES en un XML
 */
export function verificarFirmaXML(xmlFirmado: string): {
  valida: boolean;
  docDigestValido: boolean;
  keyInfoDigestValido: boolean;
  signedPropsDigestValido: boolean;
  firmaCriptograficaValida: boolean;
  signingTime?: string;
  issuerName?: string;
  serialNumber?: string;
  error?: string;
} {
  try {
    const sigMatch = xmlFirmado.match(/<ds:Signature[\s\S]*?<\/ds:Signature>/);
    if (!sigMatch) {
      return { valida: false, docDigestValido: false, keyInfoDigestValido: false, signedPropsDigestValido: false, firmaCriptograficaValida: false, error: 'No se encontró el nodo ds:Signature' };
    }
    const signatureXml = sigMatch[0];

    const signedInfoMatch = signatureXml.match(/<ds:SignedInfo[\s\S]*?<\/ds:SignedInfo>/);
    if (!signedInfoMatch) {
      return { valida: false, docDigestValido: false, keyInfoDigestValido: false, signedPropsDigestValido: false, firmaCriptograficaValida: false, error: 'No se encontró ds:SignedInfo' };
    }
    const signedInfoXml = signedInfoMatch[0];

    const sigValMatch = signatureXml.match(/<ds:SignatureValue[^>]*>([\s\S]*?)<\/ds:SignatureValue>/);
    if (!sigValMatch) {
      return { valida: false, docDigestValido: false, keyInfoDigestValido: false, signedPropsDigestValido: false, firmaCriptograficaValida: false, error: 'No se encontró ds:SignatureValue' };
    }
    const signatureValueB64 = sigValMatch[1].trim();

    const certMatch = signatureXml.match(/<ds:X509Certificate>([\s\S]*?)<\/ds:X509Certificate>/);
    if (!certMatch) {
      return { valida: false, docDigestValido: false, keyInfoDigestValido: false, signedPropsDigestValido: false, firmaCriptograficaValida: false, error: 'No se encontró ds:X509Certificate' };
    }
    const certB64 = certMatch[1].replace(/\s+/g, '');
    const certPem = `-----BEGIN CERTIFICATE-----\n${certB64.match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----\n`;

    // 1. Verificación criptográfica RSA-SHA256 de SignedInfo
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(signedInfoXml, 'utf8');
    const firmaCriptograficaValida = verifier.verify(certPem, signatureValueB64, 'base64');

    // 2. Verificación de Reference-Doc Digest
    const docRefMatch = signedInfoXml.match(/<ds:Reference Id="Reference-Doc-[^"]*"[^>]*>[\s\S]*?<ds:DigestValue>([\s\S]*?)<\/ds:DigestValue>/);
    const expectedDocDigest = docRefMatch ? docRefMatch[1].trim() : '';
    const xmlSinSig = xmlFirmado
      .replace(/<\?xml.*?\?>\n?/, '')
      .replace(`\n${signatureXml}\n`, '')
      .replace(signatureXml, '')
      .trim();
    const actualDocDigest = crypto.createHash('sha256').update(xmlSinSig, 'utf8').digest('base64');
    const docDigestValido = actualDocDigest === expectedDocDigest;

    // 3. Verificación de Reference-KeyInfo Digest
    const keyInfoMatch = signatureXml.match(/<ds:KeyInfo[\s\S]*?<\/ds:KeyInfo>/);
    const keyInfoRefMatch = signedInfoXml.match(/<ds:Reference Id="Reference-KeyInfo-[^"]*"[^>]*>[\s\S]*?<ds:DigestValue>([\s\S]*?)<\/ds:DigestValue>/);
    const expectedKeyInfoDigest = keyInfoRefMatch ? keyInfoRefMatch[1].trim() : '';
    const actualKeyInfoDigest = keyInfoMatch ? crypto.createHash('sha256').update(keyInfoMatch[0], 'utf8').digest('base64') : '';
    const keyInfoDigestValido = actualKeyInfoDigest === expectedKeyInfoDigest;

    // 4. Verificación de Reference-SignedProperties Digest
    const signedPropsMatch = signatureXml.match(/<xades:SignedProperties[\s\S]*?<\/xades:SignedProperties>/);
    const signedPropsRefMatch = signedInfoXml.match(/<ds:Reference Type="http:\/\/uri\.etsi\.org\/01903#SignedProperties"[^>]*>[\s\S]*?<ds:DigestValue>([\s\S]*?)<\/ds:DigestValue>/);
    const expectedSignedPropsDigest = signedPropsRefMatch ? signedPropsRefMatch[1].trim() : '';
    const actualSignedPropsDigest = signedPropsMatch ? crypto.createHash('sha256').update(signedPropsMatch[0], 'utf8').digest('base64') : '';
    const signedPropsDigestValido = actualSignedPropsDigest === expectedSignedPropsDigest;

    const signingTimeMatch = signatureXml.match(/<xades:SigningTime>([\s\S]*?)<\/xades:SigningTime>/);
    const issuerMatch = signatureXml.match(/<ds:X509IssuerName[^>]*>([\s\S]*?)<\/ds:X509IssuerName>/);
    const serialMatch = signatureXml.match(/<ds:X509SerialNumber[^>]*>([\s\S]*?)<\/ds:X509SerialNumber>/);

    const valida = firmaCriptograficaValida && docDigestValido && keyInfoDigestValido && signedPropsDigestValido;

    return {
      valida,
      docDigestValido,
      keyInfoDigestValido,
      signedPropsDigestValido,
      firmaCriptograficaValida,
      signingTime: signingTimeMatch ? signingTimeMatch[1].trim() : undefined,
      issuerName: issuerMatch ? issuerMatch[1].trim() : undefined,
      serialNumber: serialMatch ? serialMatch[1].trim() : undefined
    };
  } catch (err: any) {
    return {
      valida: false,
      docDigestValido: false,
      keyInfoDigestValido: false,
      signedPropsDigestValido: false,
      firmaCriptograficaValida: false,
      error: err.message
    };
  }
}
