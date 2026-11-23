const fs = require('fs');
const path = require('path');

const v43Dir = path.join(process.cwd(), 'schemas', 'v4.3');
const v44Dir = path.join(process.cwd(), 'schemas', 'v4.4');

const files = [
  { src: 'FacturaElectronica_V4.3.xsd', dst: 'FacturaElectronica_V4.4.xsd' },
  { src: 'TiqueteElectronico_V4.3.xsd', dst: 'TiqueteElectronico_V4.4.xsd' },
  { src: 'NotaCreditoElectronica_V4.3.xsd', dst: 'NotaCreditoElectronica_V4.4.xsd' },
  { src: 'NotaDebitoElectronica_V4.3.xsd', dst: 'NotaDebitoElectronica_V4.4.xsd' },
  { src: 'MensajeHacienda_V4.3.xsd', dst: 'MensajeHacienda_V4.4.xsd' }
];

const refCodesToAdd = `
										<xs:enumeration value="12">
											<xs:annotation>
												<xs:documentation>Ajuste por efectos contables del crédito</xs:documentation>
											</xs:annotation>
										</xs:enumeration>
										<xs:enumeration value="13">
											<xs:annotation>
												<xs:documentation>Efecto contable en el período fiscal de emisión</xs:documentation>
											</xs:annotation>
										</xs:enumeration>
										<xs:enumeration value="14">
											<xs:annotation>
												<xs:documentation>Efecto contable devengado</xs:documentation>
											</xs:annotation>
										</xs:enumeration>
										<xs:enumeration value="15">
											<xs:annotation>
												<xs:documentation>Ajuste fiscal diferido</xs:documentation>
											</xs:annotation>
										</xs:enumeration>
										<xs:enumeration value="16">
											<xs:annotation>
												<xs:documentation>Referencia a un comprobante electrónico v4.3 previo o rechazado</xs:documentation>
											</xs:annotation>
										</xs:enumeration>
										<xs:enumeration value="17">
											<xs:annotation>
												<xs:documentation>Aplicación de pago en Recibo Electrónico de Pago (REP)</xs:documentation>
											</xs:annotation>
										</xs:enumeration>`;

for (const f of files) {
  let content = fs.readFileSync(path.join(v43Dir, f.src), 'utf8');

  // Namespace and version
  content = content.replace(/xmlns="https:\/\/cdn\.comprobanteselectronicos\.go\.cr\/xml-schemas\/v4\.3\//g, 'xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/');
  content = content.replace(/targetNamespace="https:\/\/cdn\.comprobanteselectronicos\.go\.cr\/xml-schemas\/v4\.3\//g, 'targetNamespace="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/');
  content = content.replace(/version="4\.3"/g, 'version="4.4"');

  // Clave alphanumeric pattern [0-9a-zA-Z]{50,50}
  content = content.replace(/<xs:pattern value="\\d\{50,50\}"\/>/g, '<xs:pattern value="[0-9a-zA-Z]{50,50}"/>');

  // Identificacion alphanumeric pattern
  content = content.replace(/<xs:pattern value="\\d\{9,12\}"\/>/g, '<xs:pattern value="[0-9a-zA-Z]{9,20}"/>');

  // Signature maxOccurs 5
  content = content.replace(/<xs:element ref="ds:Signature" minOccurs="1" maxOccurs="1"\/>/g, '<xs:element ref="ds:Signature" minOccurs="1" maxOccurs="5"/>');

  // Add reference codes precisely after code 05 in InformacionReferencia
  if (content.includes('Sustituye comprobante provisional por contigencia')) {
    content = content.replace(/(<xs:documentation>Sustituye comprobante provisional por contigencia<\/xs:documentation>[\s\S]*?<\/xs:enumeration>)/, '$1' + refCodesToAdd);
  }

  // SchemaLocation fix for relative xmldsig
  content = content.replace(/http:\/\/www\.w3\.org\/TR\/2008\/REC-xmldsig-core-20080610\/xmldsig-core-schema\.xsd/g, 'xmldsig-core-schema.xsd');

  fs.writeFileSync(path.join(v44Dir, f.dst), content, 'utf8');
  console.log('Re-created:', f.dst);
}
