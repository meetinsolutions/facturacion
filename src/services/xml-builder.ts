import { create } from 'xmlbuilder2';
import { ComprobanteElectronico, TipoDocumento } from '../types/factura.types.js';
import { generarConsecutivo, generarClave } from './clave-generator.js';
import { formatoFechaIsoCR } from '../utils/cr-date.js';

/**
 * Formatea un número a un string con la cantidad especificada de decimales (DGT usa hasta 5 decimales).
 */
export function formatoMonto(monto: number, decimales: number = 5): string {
  return Number(monto).toFixed(decimales);
}

/**
 * Formatea una fecha a formato ISO 8601 con zona horaria de Costa Rica (-06:00)
 * Requerido por la estructura XML v4.3 del Ministerio de Hacienda.
 * Ejemplo: 2026-11-19T17:05:00-06:00
 */
export function formatoFechaCR(fecha: Date): string {
  return formatoFechaIsoCR(fecha);
}

/**
 * Mapea el tipo de documento a la etiqueta raíz XML según v4.3
 */
function getRootElement(tipoDoc: TipoDocumento): { rootName: string; schemaUrl: string } {
  switch (tipoDoc) {
    case '01':
      return {
        rootName: 'FacturaElectronica',
        schemaUrl: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.3/facturaElectronica'
      };
    case '02':
      return {
        rootName: 'NotaDebitoElectronica',
        schemaUrl: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.3/notaDebitoElectronica'
      };
    case '03':
      return {
        rootName: 'NotaCreditoElectronica',
        schemaUrl: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.3/notaCreditoElectronica'
      };
    case '04':
      return {
        rootName: 'TiqueteElectronico',
        schemaUrl: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.3/tiqueteElectronico'
      };
    case '05':
      return {
        rootName: 'FacturaElectronicaExportacion',
        schemaUrl: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.3/facturaElectronicaExportacion'
      };
    case '06':
      return {
        rootName: 'FacturaElectronicaCompra',
        schemaUrl: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.3/facturaElectronicaCompra'
      };
    default:
      throw new Error(`Tipo de documento no soportado: ${tipoDoc}`);
  }
}

/**
 * Construye el XML oficial según la especificación DGT v4.3 de Costa Rica
 */
export function generarXMLFactura(doc: ComprobanteElectronico, secuencia: number): { xml: string; clave: string; consecutivo: string } {
  // 0. Validaciones normativas DGT v4.3
  if (!(doc.fechaEmision instanceof Date) || Number.isNaN(doc.fechaEmision.getTime())) {
    throw new Error('La fecha de emisión del comprobante es inválida.');
  }

  if (!doc.emisor?.identificacion?.numero) {
    throw new Error('El emisor debe tener un número de identificación válido.');
  }

  if (!doc.emisor.actividadEconomica || !/^\d{6}$/.test(doc.emisor.actividadEconomica)) {
    throw new Error(`El código de actividad económica del emisor debe tener exactamente 6 dígitos numéricos. Recibido: "${doc.emisor.actividadEconomica}"`);
  }

  if (doc.tipoDocumento === '01' && (!doc.receptor || !doc.receptor.identificacion?.numero)) {
    throw new Error('La Factura Electrónica (01) requiere obligatoriamente la identificación del Receptor según la normativa DGT v4.3.');
  }

  if ((doc.tipoDocumento === '02' || doc.tipoDocumento === '03') && !doc.informacionReferencia) {
    throw new Error(`Las notas de débito y crédito (${doc.tipoDocumento}) requieren obligatoriamente el nodo InformacionReferencia según la normativa DGT v4.3.`);
  }

  if (doc.resumen?.codigoMoneda && doc.resumen.codigoMoneda !== 'CRC' && (!doc.resumen.tipoCambio || doc.resumen.tipoCambio <= 0)) {
    throw new Error(`El comprobante en moneda ${doc.resumen.codigoMoneda} requiere obligatoriamente un TipoCambio válido mayor a cero.`);
  }

  if (!Array.isArray(doc.lineas) || doc.lineas.length === 0) {
    throw new Error('El comprobante debe contener al menos una línea de detalle.');
  }

  for (const item of doc.lineas) {
    if (!item.codigoCabys || !/^\d{13}$/.test(item.codigoCabys)) {
      throw new Error(`El código CAByS de la línea ${item.numeroLinea} debe tener exactamente 13 dígitos numéricos. Recibido: "${item.codigoCabys}"`);
    }
  }

  const { rootName, schemaUrl } = getRootElement(doc.tipoDocumento);

  // 1. Asegurar consecutivo y clave si no vienen asignados
  const consecutivo = doc.consecutivo || generarConsecutivo(
    doc.emisor.sucursal,
    doc.emisor.terminal,
    doc.tipoDocumento,
    secuencia
  );

  const clave = doc.clave || generarClave({
    fecha: doc.fechaEmision,
    cedulaEmisor: doc.emisor.identificacion.numero,
    consecutivo
  });

  const fechaEmisionStr = formatoFechaCR(doc.fechaEmision);

  // 2. Crear documento XML con namespaces
  const root = create({ version: '1.0', encoding: 'UTF-8' })
    .ele(rootName, {
      xmlns: schemaUrl,
      'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
      'xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
      'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      'xsi:schemaLocation': `${schemaUrl} ${schemaUrl}.xsd`
    });

  // Cabecera del comprobante
  root.ele('Clave').txt(clave).up();
  root.ele('CodigoActividad').txt(doc.emisor.actividadEconomica).up();
  root.ele('NumeroConsecutivo').txt(consecutivo).up();
  root.ele('FechaEmision').txt(fechaEmisionStr).up();

  // Emisor
  const emisorNode = root.ele('Emisor');
  emisorNode.ele('Nombre').txt(doc.emisor.nombre).up();
  const emisorId = emisorNode.ele('Identificacion');
  emisorId.ele('Tipo').txt(doc.emisor.identificacion.tipo).up();
  emisorId.ele('Numero').txt(doc.emisor.identificacion.numero.replace(/\D/g, '')).up();
  if (doc.emisor.nombreComercial) {
    emisorNode.ele('NombreComercial').txt(doc.emisor.nombreComercial).up();
  }
  const emisorUbicacion = emisorNode.ele('Ubicacion');
  emisorUbicacion.ele('Provincia').txt(doc.emisor.ubicacion.provincia).up();
  emisorUbicacion.ele('Canton').txt(doc.emisor.ubicacion.canton).up();
  emisorUbicacion.ele('Distrito').txt(doc.emisor.ubicacion.distrito).up();
  if (doc.emisor.ubicacion.barrio) {
    emisorUbicacion.ele('Barrio').txt(doc.emisor.ubicacion.barrio).up();
  }
  emisorUbicacion.ele('OtrasSenas').txt(doc.emisor.ubicacion.senas).up();

  if (doc.emisor.telefono) {
    const tel = emisorNode.ele('Telefono');
    tel.ele('CodigoPais').txt(doc.emisor.telefono.codigoPais).up();
    tel.ele('NumTelefono').txt(doc.emisor.telefono.numero).up();
  }
  emisorNode.ele('CorreoElectronico').txt(doc.emisor.correo).up();

  // Receptor (Opcional en Tiquete Electrónico 04, Obligatorio en Factura 01)
  if (doc.receptor) {
    const receptorNode = root.ele('Receptor');
    receptorNode.ele('Nombre').txt(doc.receptor.nombre).up();
    if (doc.receptor.identificacion) {
      const recId = receptorNode.ele('Identificacion');
      recId.ele('Tipo').txt(doc.receptor.identificacion.tipo).up();
      recId.ele('Numero').txt(doc.receptor.identificacion.numero.replace(/\D/g, '')).up();
    }
    if (doc.receptor.nombreComercial) {
      receptorNode.ele('NombreComercial').txt(doc.receptor.nombreComercial).up();
    }
    if (doc.receptor.ubicacion) {
      const recUbic = receptorNode.ele('Ubicacion');
      recUbic.ele('Provincia').txt(doc.receptor.ubicacion.provincia).up();
      recUbic.ele('Canton').txt(doc.receptor.ubicacion.canton).up();
      recUbic.ele('Distrito').txt(doc.receptor.ubicacion.distrito).up();
      recUbic.ele('OtrasSenas').txt(doc.receptor.ubicacion.senas).up();
    }
    if (doc.receptor.telefono) {
      const recTel = receptorNode.ele('Telefono');
      recTel.ele('CodigoPais').txt(doc.receptor.telefono.codigoPais).up();
      recTel.ele('NumTelefono').txt(doc.receptor.telefono.numero).up();
    }
    if (doc.receptor.correo) {
      receptorNode.ele('CorreoElectronico').txt(doc.receptor.correo).up();
    }
  }

  // Condiciones de la Venta
  root.ele('CondicionVenta').txt(doc.condicionVenta).up();
  if (doc.condicionVenta === '02' && doc.plazoCredito) {
    root.ele('PlazoCredito').txt(doc.plazoCredito).up();
  }

  // Medios de pago
  for (const medio of doc.mediosPago) {
    root.ele('MedioPago').txt(medio).up();
  }

  // Detalle del Servicio o Mercancía
  const detalleServicio = root.ele('DetalleServicio');
  for (const item of doc.lineas) {
    const linea = detalleServicio.ele('LineaDetalle');
    linea.ele('NumeroLinea').txt(item.numeroLinea.toString()).up();
    linea.ele('Codigo').txt(item.codigoCabys).up();
    if (item.codigoInterno) {
      const cod = linea.ele('CodigoComercial');
      cod.ele('Tipo').txt('04').up(); // 04 = Código interno del vendedor
      cod.ele('Codigo').txt(item.codigoInterno).up();
    }
    linea.ele('Cantidad').txt(formatoMonto(item.cantidad, 3)).up();
    linea.ele('UnidadMedida').txt(item.unidadMedida).up();
    linea.ele('Detalle').txt(item.detalle).up();
    linea.ele('PrecioUnitario').txt(formatoMonto(item.precioUnitario, 5)).up();
    linea.ele('MontoTotal').txt(formatoMonto(item.montoTotal, 5)).up();

    if (item.montoDescuento && item.montoDescuento > 0) {
      const desc = linea.ele('Descuento');
      desc.ele('MontoDescuento').txt(formatoMonto(item.montoDescuento, 5)).up();
      desc.ele('NaturalezaDescuento').txt(item.naturalezaDescuento || 'Descuento Comercial').up();
    }

    linea.ele('SubTotal').txt(formatoMonto(item.subTotal, 5)).up();

    // Impuesto IVA
    if (item.montoIVA && item.montoIVA > 0) {
      const imp = linea.ele('Impuesto');
      imp.ele('Codigo').txt(item.codigoImpuesto || '01').up(); // 01 = IVA
      imp.ele('CodigoTarifa').txt(item.codigoTarifaIVA || '08').up(); // 08 = 13% General
      imp.ele('Tarifa').txt(formatoMonto(item.tarifaIVA || 13, 2)).up();
      imp.ele('Monto').txt(formatoMonto(item.montoIVA, 5)).up();

      if (item.exoneracion) {
        const exo = imp.ele('Exoneracion');
        exo.ele('TipoDocumento').txt(item.exoneracion.tipoDocumento).up();
        exo.ele('NumeroDocumento').txt(item.exoneracion.numeroDocumento).up();
        exo.ele('NombreInstitucion').txt(item.exoneracion.nombreInstitucion).up();
        exo.ele('FechaEmision').txt(item.exoneracion.fechaEmision).up();
        exo.ele('PorcentajeExoneracion').txt(item.exoneracion.porcentajeExoneracion.toString()).up();
        exo.ele('MontoExoneracion').txt(formatoMonto(item.exoneracion.montoExoneracion, 5)).up();
      }
    }

    linea.ele('MontoTotalLinea').txt(formatoMonto(item.montoTotalLinea, 5)).up();
  }

  // Resumen de la Factura
  const resumen = root.ele('ResumenFactura');
  if (doc.resumen.codigoMoneda) {
    const codMoneda = resumen.ele('CodigoTipoMoneda');
    codMoneda.ele('CodigoMoneda').txt(doc.resumen.codigoMoneda).up();
    codMoneda.ele('TipoCambio').txt(formatoMonto(doc.resumen.tipoCambio || 1, 5)).up();
  }

  resumen.ele('TotalServGravados').txt(formatoMonto(doc.resumen.totalServiciosGravados, 5)).up();
  resumen.ele('TotalServExentos').txt(formatoMonto(doc.resumen.totalServiciosExentos, 5)).up();
  resumen.ele('TotalMercanciasGravadas').txt(formatoMonto(doc.resumen.totalMercanciasGravadas, 5)).up();
  resumen.ele('TotalMercanciasExentas').txt(formatoMonto(doc.resumen.totalMercanciasExentas, 5)).up();
  resumen.ele('TotalGravado').txt(formatoMonto(doc.resumen.totalGravado, 5)).up();
  resumen.ele('TotalExento').txt(formatoMonto(doc.resumen.totalExento, 5)).up();
  resumen.ele('TotalVenta').txt(formatoMonto(doc.resumen.totalVenta, 5)).up();
  resumen.ele('TotalDescuentos').txt(formatoMonto(doc.resumen.totalDescuentos, 5)).up();
  resumen.ele('TotalVentaNeta').txt(formatoMonto(doc.resumen.totalVentaNeta, 5)).up();
  resumen.ele('TotalImpuesto').txt(formatoMonto(doc.resumen.totalImpuesto, 5)).up();
  resumen.ele('TotalComprobante').txt(formatoMonto(doc.resumen.totalComprobante, 5)).up();

  // Información de Referencia (si aplica para Nota de Crédito/Débito)
  if (doc.informacionReferencia) {
    const infoRef = root.ele('InformacionReferencia');
    infoRef.ele('TipoDoc').txt(doc.informacionReferencia.tipoDoc).up();
    infoRef.ele('Numero').txt(doc.informacionReferencia.numero).up();
    infoRef.ele('FechaEmision').txt(formatoFechaCR(doc.informacionReferencia.fechaEmision)).up();
    infoRef.ele('Codigo').txt(doc.informacionReferencia.codigo).up();
    infoRef.ele('Razon').txt(doc.informacionReferencia.razon).up();
  }

  const xml = root.end({ prettyPrint: true });
  return { xml, clave, consecutivo };
}
