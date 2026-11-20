import { DOMParser } from '@xmldom/xmldom';
import { GastoRecibido, LineaGasto } from './data-store.js';

export interface ParseXmlResult {
  tipo: 'comprobante' | 'mensaje_hacienda' | 'invalido';
  gasto?: GastoRecibido;
  motivo?: string;
}

const TIPO_DOC_DESDE_ROOT: Record<string, { codigo: string; nombre: string }> = {
  FacturaElectronica: { codigo: '01', nombre: 'Factura Electrónica' },
  NotaDebitoElectronica: { codigo: '02', nombre: 'Nota de Débito' },
  NotaCreditoElectronica: { codigo: '03', nombre: 'Nota de Crédito' },
  TiqueteElectronico: { codigo: '04', nombre: 'Tiquete Electrónico' },
  FacturaElectronicaExportacion: { codigo: '05', nombre: 'Factura de Exportación' },
  FacturaElectronicaCompra: { codigo: '06', nombre: 'Factura de Compra' }
};

function getLocalName(node: any): string {
  return String(node?.localName || node?.nodeName || '').replace(/^.*:/, '');
}

function getDirectChildren(parent: any, localName: string): any[] {
  const result: any[] = [];
  if (!parent || !parent.childNodes) return result;
  for (let i = 0; i < parent.childNodes.length; i++) {
    const child = parent.childNodes[i];
    if (child && child.nodeType === 1 && getLocalName(child) === localName) {
      result.push(child);
    }
  }
  return result;
}

function getDirectChild(parent: any, localName: string): any | null {
  const matches = getDirectChildren(parent, localName);
  return matches.length > 0 ? matches[0] : null;
}

function getChildText(parent: any, localName: string): string {
  const el = getDirectChild(parent, localName);
  return el && el.textContent ? el.textContent.trim() : '';
}

function toNumber(val: string | undefined): number {
  if (!val) return 0;
  const n = Number(val.replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

export function clasificarCategoriaGasto(
  emisorNombre: string,
  emisorNombreComercial: string | undefined,
  lineas: LineaGasto[]
): string {
  const texto = [emisorNombre, emisorNombreComercial || '', ...lineas.map(l => l.detalle)]
    .join(' ')
    .toLowerCase();

  const reglas: Array<{ categoria: string; keywords: string[] }> = [
    {
      categoria: 'Servicios Públicos & Telecom',
      keywords: ['ice', 'cnfl', 'aya', 'kolbi', 'kölbi', 'claro', 'liberty', 'telecable', 'tigo', 'electricidad', 'agua', 'internet', 'telefon']
    },
    {
      categoria: 'Software & Tecnología',
      keywords: ['hostinger', 'google', 'microsoft', 'amazon', 'aws', 'adobe', 'apple', 'hosting', 'dominio', 'software', 'licencia', 'cloud', 'comput', 'tecnolog']
    },
    {
      categoria: 'Transporte & Combustible',
      keywords: ['gasolinera', 'combustible', 'diesel', 'diésel', 'recope', 'uber', 'peaje', 'parqueo', 'taller', 'llantas', 'repuesto', 'estacionamiento']
    },
    {
      categoria: 'Servicios Profesionales',
      keywords: ['honorarios', 'contabilidad', 'contador', 'legal', 'abogado', 'consultor', 'asesor', 'auditor']
    },
    {
      categoria: 'Educación & Capacitación',
      keywords: ['universidad', 'curso', 'capacitacion', 'capacitación', 'colegio', 'educacion', 'educación', 'academia', 'libro']
    },
    {
      categoria: 'Salud & Farmacia',
      keywords: ['farmacia', 'clinica', 'clínica', 'hospital', 'medico', 'médico', 'laboratorio', 'dental']
    },
    {
      categoria: 'Alimentación & Suministros',
      keywords: ['supermercado', 'automercado', 'pricesmart', 'walmart', 'masxmenos', 'restaurante', 'cafe', 'café', 'libreria', 'librería', 'papeleria', 'papelería', 'oficina', 'ferreteria', 'ferretería']
    }
  ];

  for (const r of reglas) {
    if (r.keywords.some(kw => texto.includes(kw))) {
      return r.categoria;
    }
  }

  return 'General / Sin Clasificar';
}

export function parsearFacturaXMLCostaRica(
  xmlRaw: string,
  opciones?: {
    tipoCambioDefault?: number;
    origen?: 'correo_imap' | 'carga_manual';
    correoMeta?: { uid?: number; asunto?: string; remitente?: string; fecha?: string };
    tienePdf?: boolean;
  }
): ParseXmlResult {
  const xml = String(xmlRaw || '').replace(/^\uFEFF/, '').trim();
  if (!xml || !xml.startsWith('<')) {
    return { tipo: 'invalido', motivo: 'El archivo no contiene XML válido.' };
  }

  let doc: any;
  try {
    doc = new DOMParser({ onError: () => {} }).parseFromString(xml, 'text/xml');
  } catch (err: any) {
    return { tipo: 'invalido', motivo: err?.message || 'Error al analizar XML.' };
  }

  const root = doc?.documentElement;
  if (!root) {
    return { tipo: 'invalido', motivo: 'Documento XML sin nodo raíz.' };
  }

  const rootName = getLocalName(root);
  if (rootName === 'MensajeHacienda' || rootName === 'MensajeReceptor') {
    return { tipo: 'mensaje_hacienda' };
  }

  const tipoDocInfo = TIPO_DOC_DESDE_ROOT[rootName];
  if (!tipoDocInfo) {
    return { tipo: 'invalido', motivo: `Elemento raíz '${rootName}' no es un comprobante electrónico DGT.` };
  }

  const clave = getChildText(root, 'Clave').replace(/\s+/g, '');
  if (!clave || !/^\d{50}$/.test(clave)) {
    return { tipo: 'invalido', motivo: 'El XML no contiene una Clave Numérica válida de 50 dígitos.' };
  }

  const consecutivo = getChildText(root, 'NumeroConsecutivo') || clave.slice(21, 41);
  const fechaEmision = getChildText(root, 'FechaEmision') || new Date().toISOString();

  const emisorEl = getDirectChild(root, 'Emisor');
  const emisorIdEl = emisorEl ? getDirectChild(emisorEl, 'Identificacion') : null;
  const emisorNombre = (emisorEl && getChildText(emisorEl, 'Nombre')) || 'Proveedor sin nombre';
  const emisorNombreComercial = (emisorEl && getChildText(emisorEl, 'NombreComercial')) || undefined;
  const emisorTipoId = (emisorIdEl && getChildText(emisorIdEl, 'Tipo')) || undefined;
  const emisorCedula = ((emisorIdEl && getChildText(emisorIdEl, 'Numero')) || '').replace(/\D/g, '');
  const emisorCorreo = (emisorEl && getChildText(emisorEl, 'CorreoElectronico')) || undefined;

  const receptorEl = getDirectChild(root, 'Receptor');
  const receptorIdEl = receptorEl ? getDirectChild(receptorEl, 'Identificacion') : null;
  const receptorNombre = (receptorEl && getChildText(receptorEl, 'Nombre')) || undefined;
  const receptorCedula = ((receptorIdEl && getChildText(receptorIdEl, 'Numero')) || '').replace(/\D/g, '') || undefined;

  const resumenEl = getDirectChild(root, 'ResumenFactura');
  const monedaEl = resumenEl ? getDirectChild(resumenEl, 'CodigoTipoMoneda') : null;
  const monedaRaw =
    (monedaEl && getChildText(monedaEl, 'CodigoMoneda')) ||
    (resumenEl && getChildText(resumenEl, 'CodigoMoneda')) ||
    'CRC';
  const moneda: 'CRC' | 'USD' | 'EUR' = monedaRaw === 'USD' ? 'USD' : monedaRaw === 'EUR' ? 'EUR' : 'CRC';

  const tcXml =
    toNumber(monedaEl ? getChildText(monedaEl, 'TipoCambio') : '') ||
    toNumber(resumenEl ? getChildText(resumenEl, 'TipoCambio') : '');
  const tipoCambio = moneda === 'CRC' ? 1 : tcXml > 0 ? tcXml : opciones?.tipoCambioDefault || 510;

  const subtotalGravado = resumenEl ? toNumber(getChildText(resumenEl, 'TotalGravado')) : 0;
  const subtotalExento = resumenEl ? toNumber(getChildText(resumenEl, 'TotalExento')) : 0;
  const totalDescuentos = resumenEl ? toNumber(getChildText(resumenEl, 'TotalDescuentos')) : 0;
  const totalVentaNeta = resumenEl ? toNumber(getChildText(resumenEl, 'TotalVentaNeta')) : 0;
  const totalImpuesto = resumenEl ? toNumber(getChildText(resumenEl, 'TotalImpuesto')) : 0;
  const totalComprobante = resumenEl ? toNumber(getChildText(resumenEl, 'TotalComprobante')) : 0;

  const desgloseIVA: Record<string, number> = {};
  const detalleServicioEl = getDirectChild(root, 'DetalleServicio');
  const lineaNodes = detalleServicioEl ? getDirectChildren(detalleServicioEl, 'LineaDetalle') : [];

  const lineas: LineaGasto[] = lineaNodes.map((ln, idx) => {
    const numeroLinea = toNumber(getChildText(ln, 'NumeroLinea')) || idx + 1;
    let codigoCabys = getChildText(ln, 'CodigoCABYS');
    if (!codigoCabys) {
      const codEl = getDirectChild(ln, 'Codigo');
      codigoCabys = codEl ? getChildText(codEl, 'Codigo') || (codEl.textContent || '').trim() : '';
    }
    const detalle = getChildText(ln, 'Detalle') || 'Línea de detalle';
    const cantidad = toNumber(getChildText(ln, 'Cantidad')) || 1;
    const unidadMedida = getChildText(ln, 'UnidadMedida') || 'Unid';
    const precioUnitario = toNumber(getChildText(ln, 'PrecioUnitario'));
    const subTotal = toNumber(getChildText(ln, 'SubTotal')) || toNumber(getChildText(ln, 'MontoTotal'));

    const impuestos = getDirectChildren(ln, 'Impuesto');
    let montoIVA = 0;
    let tarifaLinea = 0;

    if (impuestos.length > 0) {
      for (const imp of impuestos) {
        const t = toNumber(getChildText(imp, 'Tarifa'));
        const m = toNumber(getChildText(imp, 'Monto'));
        const mNeto = getDirectChild(ln, 'ImpuestoNeto') ? toNumber(getChildText(ln, 'ImpuestoNeto')) : m;
        const montoUsado = m > 0 ? m : mNeto;
        montoIVA += montoUsado;
        tarifaLinea = t;
        const key = String(Number(t.toFixed(2)));
        desgloseIVA[key] = Number(((desgloseIVA[key] || 0) + montoUsado).toFixed(2));
      }
    }

    const montoTotalLinea = toNumber(getChildText(ln, 'MontoTotalLinea')) || Number((subTotal + montoIVA).toFixed(2));

    return {
      numeroLinea,
      codigoCabys,
      detalle,
      cantidad,
      unidadMedida,
      precioUnitario,
      subTotal,
      tarifaIVA: tarifaLinea,
      montoIVA: Number(montoIVA.toFixed(2)),
      montoTotalLinea
    };
  });

  if (totalImpuesto > 0 && Object.keys(desgloseIVA).length === 0) {
    desgloseIVA['IVA'] = Number(totalImpuesto.toFixed(2));
  }

  const totalCRC = Number((totalComprobante * (moneda === 'CRC' ? 1 : tipoCambio)).toFixed(2));
  const impuestoCRC = Number((totalImpuesto * (moneda === 'CRC' ? 1 : tipoCambio)).toFixed(2));
  const categoriaGasto = clasificarCategoriaGasto(emisorNombre, emisorNombreComercial, lineas);

  const gasto: GastoRecibido = {
    id: clave,
    clave,
    consecutivo,
    tipoDocumento: tipoDocInfo.codigo,
    tipoDocumentoNombre: tipoDocInfo.nombre,
    fechaEmision,
    emisorNombre,
    emisorNombreComercial,
    emisorCedula,
    emisorTipoId,
    emisorCorreo,
    receptorNombre,
    receptorCedula,
    moneda,
    tipoCambio,
    subtotalGravado,
    subtotalExento,
    totalDescuentos,
    totalVentaNeta,
    totalImpuesto,
    totalComprobante,
    totalCRC,
    impuestoCRC,
    desgloseIVA,
    lineas,
    categoriaGasto,
    estadoConfirmacion: 'pendiente',
    origen: opciones?.origen || 'carga_manual',
    correoUid: opciones?.correoMeta?.uid,
    correoAsunto: opciones?.correoMeta?.asunto,
    correoRemitente: opciones?.correoMeta?.remitente,
    correoFecha: opciones?.correoMeta?.fecha,
    tieneXml: true,
    tienePdf: Boolean(opciones?.tienePdf),
    importadoEn: new Date().toISOString()
  };

  return {
    tipo: 'comprobante',
    gasto
  };
}
