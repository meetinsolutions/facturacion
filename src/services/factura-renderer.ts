import QRCode from 'qrcode';
import { ComprobanteElectronico } from '../types/factura.types.js';
import {
  ConfiguracionSistema,
  DisenoEstiloTabla,
  DisenoFacturaConfig,
  DisenoFuente,
  DisenoLayoutHeader,
  DisenoTamanoPapel,
  EstiloFacturaPreset
} from './data-store.js';

export type EstiloFactura = EstiloFacturaPreset;

export interface FacturaRenderData {
  clave: string;
  consecutivo: string;
  doc: ComprobanteElectronico;
  config: ConfiguracionSistema;
  estilo?: EstiloFactura;
  disenoOverride?: Partial<DisenoFacturaConfig>;
  notas?: string;
  esBorrador?: boolean;
  ocultarBarraAcciones?: boolean;
}

export const ESTILOS_FACTURA_VALIDOS: EstiloFactura[] = [
  'ejecutivo',
  'corporativo',
  'noir',
  'minimalista',
  'moderno',
  'clasico-cr'
];

export const PLANTILLAS_FACTURA_PRESETS: Record<
  EstiloFactura,
  {
    nombre: string;
    descripcion: string;
    diseno: Required<DisenoFacturaConfig>;
  }
> = {
  minimalista: {
    nombre: 'Minimalista Limpio',
    descripcion: 'Blanco puro, líneas sutiles y ahorro de tinta',
    diseno: {
      plantillaBase: 'minimalista',
      layoutHeader: 'clasico',
      estiloTabla: 'minimalista',
      colorPrimario: '#111827',
      colorAcento: '#2563eb',
      colorFondoHeader: '#ffffff',
      colorTextoHeader: '#111827',
      colorFondoTablaHead: '#ffffff',
      colorTextoTablaHead: '#374151',
      colorFondoTarjetas: '#ffffff',
      colorBorde: '#e5e7eb',
      fuente: 'inter',
      tamanoBasePx: 12,
      radioBordesPx: 6,
      mostrarFranjaSuperior: false,
      grosorFranjaPx: 0,
      logoAltoPx: 54,
      logoAnchoMaxPx: 220,
      logoFondoBlanco: false,
      tamanoPapel: 'letter',
      margenImpresionMm: 12,
      mostrarLogo: true,
      mostrarRazonSocial: true,
      mostrarActividadEconomica: true,
      mostrarSucursalTerminal: false,
      mostrarDireccionEmisor: true,
      mostrarTelefonoCorreoEmisor: true,
      mostrarCabys: true,
      mostrarUnidadMedida: true,
      mostrarNumeroLinea: true,
      mostrarColumnaIVA: true,
      mostrarQR: true,
      mostrarClaveNumerica: true,
      mostrarDetallesOperacion: true,
      mostrarResolucionLegal: true,
      mostrarFirmaRecibido: false,
      mostrarMarcaAgua: false,
      textoMarcaAgua: '',
      tituloPersonalizado: '',
      etiquetaCliente: 'Facturado A / Cliente',
      etiquetaOperacion: 'Detalles de la Operación',
      etiquetaTotal: 'TOTAL A PAGAR',
      tituloCuentasBancarias: 'Datos Bancarios / SINPE Móvil',
      textoCuentasBancarias: '',
      textoNotasFijas: '',
      mensajePie: '¡Gracias por su preferencia!',
      textoResolucionLegal:
        'Autorizada mediante resolución DGT-R-48-2016 de la Dirección General de Tributación de Costa Rica. Documento electrónico firmado digitalmente bajo estándar XAdES-BES.'
    }
  },
  'clasico-cr': {
    nombre: 'Clásico CR Contable',
    descripcion: 'Cuadrícula formal tradicional con firmas de recibido',
    diseno: {
      plantillaBase: 'clasico-cr',
      layoutHeader: 'clasico',
      estiloTabla: 'cuadricula',
      colorPrimario: '#1e293b',
      colorAcento: '#1d4ed8',
      colorFondoHeader: '#f8fafc',
      colorTextoHeader: '#0f172a',
      colorFondoTablaHead: '#e2e8f0',
      colorTextoTablaHead: '#0f172a',
      colorFondoTarjetas: '#ffffff',
      colorBorde: '#94a3b8',
      fuente: 'inter',
      tamanoBasePx: 11,
      radioBordesPx: 0,
      mostrarFranjaSuperior: true,
      grosorFranjaPx: 4,
      logoAltoPx: 58,
      logoAnchoMaxPx: 230,
      logoFondoBlanco: false,
      tamanoPapel: 'letter',
      margenImpresionMm: 10,
      mostrarLogo: true,
      mostrarRazonSocial: true,
      mostrarActividadEconomica: true,
      mostrarSucursalTerminal: true,
      mostrarDireccionEmisor: true,
      mostrarTelefonoCorreoEmisor: true,
      mostrarCabys: true,
      mostrarUnidadMedida: true,
      mostrarNumeroLinea: true,
      mostrarColumnaIVA: true,
      mostrarQR: true,
      mostrarClaveNumerica: true,
      mostrarDetallesOperacion: true,
      mostrarResolucionLegal: true,
      mostrarFirmaRecibido: true,
      mostrarMarcaAgua: false,
      textoMarcaAgua: '',
      tituloPersonalizado: '',
      etiquetaCliente: 'Datos del Receptor / Cliente',
      etiquetaOperacion: 'Condiciones del Documento',
      etiquetaTotal: 'TOTAL COMPROBANTE',
      tituloCuentasBancarias: 'Cuentas Bancarias y SINPE Móvil',
      textoCuentasBancarias: '',
      textoNotasFijas: '',
      mensajePie: '¡Gracias por su preferencia!',
      textoResolucionLegal:
        'Autorizada mediante resolución DGT-R-48-2016 de la Dirección General de Tributación de Costa Rica. Documento electrónico firmado digitalmente bajo estándar XAdES-BES.'
    }
  },
  ejecutivo: {
    nombre: 'Ejecutivo Esmeralda',
    descripcion: 'Blanco puro con acento verde esmeralda moderno',
    diseno: {
      plantillaBase: 'ejecutivo',
      layoutHeader: 'clasico',
      estiloTabla: 'moderno',
      colorPrimario: '#059669',
      colorAcento: '#047857',
      colorFondoHeader: '#ffffff',
      colorTextoHeader: '#0f172a',
      colorFondoTablaHead: '#f8fafc',
      colorTextoTablaHead: '#475569',
      colorFondoTarjetas: '#f8fafc',
      colorBorde: '#e2e8f0',
      fuente: 'jakarta',
      tamanoBasePx: 12,
      radioBordesPx: 16,
      mostrarFranjaSuperior: true,
      grosorFranjaPx: 6,
      logoAltoPx: 54,
      logoAnchoMaxPx: 240,
      logoFondoBlanco: false,
      tamanoPapel: 'letter',
      margenImpresionMm: 12,
      mostrarLogo: true,
      mostrarRazonSocial: true,
      mostrarActividadEconomica: true,
      mostrarSucursalTerminal: true,
      mostrarDireccionEmisor: true,
      mostrarTelefonoCorreoEmisor: true,
      mostrarCabys: true,
      mostrarUnidadMedida: true,
      mostrarNumeroLinea: true,
      mostrarColumnaIVA: true,
      mostrarQR: true,
      mostrarClaveNumerica: true,
      mostrarDetallesOperacion: true,
      mostrarResolucionLegal: true,
      mostrarFirmaRecibido: false,
      mostrarMarcaAgua: false,
      textoMarcaAgua: '',
      tituloPersonalizado: '',
      etiquetaCliente: 'Facturado A / Receptor',
      etiquetaOperacion: 'Detalles de la Operación',
      etiquetaTotal: 'TOTAL A PAGAR',
      tituloCuentasBancarias: 'Datos Bancarios / SINPE Móvil',
      textoCuentasBancarias: '',
      textoNotasFijas: '',
      mensajePie: '¡Gracias por su preferencia!',
      textoResolucionLegal:
        'Autorizada mediante resolución DGT-R-48-2016 de la Dirección General de Tributación de Costa Rica. Documento electrónico firmado digitalmente bajo estándar XAdES-BES.'
    }
  },
  corporativo: {
    nombre: 'Corporativo Azul',
    descripcion: 'Encabezado azul marino de alto contraste',
    diseno: {
      plantillaBase: 'corporativo',
      layoutHeader: 'clasico',
      estiloTabla: 'rayado',
      colorPrimario: '#0f172a',
      colorAcento: '#0284c7',
      colorFondoHeader: '#0f172a',
      colorTextoHeader: '#ffffff',
      colorFondoTablaHead: '#0f172a',
      colorTextoTablaHead: '#f8fafc',
      colorFondoTarjetas: '#f8fafc',
      colorBorde: '#cbd5e1',
      fuente: 'jakarta',
      tamanoBasePx: 12,
      radioBordesPx: 16,
      mostrarFranjaSuperior: false,
      grosorFranjaPx: 0,
      logoAltoPx: 54,
      logoAnchoMaxPx: 240,
      logoFondoBlanco: true,
      tamanoPapel: 'letter',
      margenImpresionMm: 12,
      mostrarLogo: true,
      mostrarRazonSocial: true,
      mostrarActividadEconomica: true,
      mostrarSucursalTerminal: true,
      mostrarDireccionEmisor: true,
      mostrarTelefonoCorreoEmisor: true,
      mostrarCabys: true,
      mostrarUnidadMedida: true,
      mostrarNumeroLinea: true,
      mostrarColumnaIVA: true,
      mostrarQR: true,
      mostrarClaveNumerica: true,
      mostrarDetallesOperacion: true,
      mostrarResolucionLegal: true,
      mostrarFirmaRecibido: false,
      mostrarMarcaAgua: false,
      textoMarcaAgua: '',
      tituloPersonalizado: '',
      etiquetaCliente: 'Facturado A / Receptor',
      etiquetaOperacion: 'Detalles de la Operación',
      etiquetaTotal: 'TOTAL A PAGAR',
      tituloCuentasBancarias: 'Datos Bancarios / SINPE Móvil',
      textoCuentasBancarias: '',
      textoNotasFijas: '',
      mensajePie: '¡Gracias por su preferencia!',
      textoResolucionLegal:
        'Autorizada mediante resolución DGT-R-48-2016 de la Dirección General de Tributación de Costa Rica. Documento electrónico firmado digitalmente bajo estándar XAdES-BES.'
    }
  },
  moderno: {
    nombre: 'Moderno Editorial',
    descripcion: 'Banda lateral de acento y diseño vanguardista',
    diseno: {
      plantillaBase: 'moderno',
      layoutHeader: 'banda-lateral',
      estiloTabla: 'rayado',
      colorPrimario: '#4f46e5',
      colorAcento: '#6366f1',
      colorFondoHeader: '#ffffff',
      colorTextoHeader: '#0f172a',
      colorFondoTablaHead: '#eef2ff',
      colorTextoTablaHead: '#312e81',
      colorFondoTarjetas: '#f8fafc',
      colorBorde: '#e0e7ff',
      fuente: 'poppins',
      tamanoBasePx: 12,
      radioBordesPx: 14,
      mostrarFranjaSuperior: false,
      grosorFranjaPx: 0,
      logoAltoPx: 56,
      logoAnchoMaxPx: 230,
      logoFondoBlanco: false,
      tamanoPapel: 'letter',
      margenImpresionMm: 12,
      mostrarLogo: true,
      mostrarRazonSocial: true,
      mostrarActividadEconomica: true,
      mostrarSucursalTerminal: false,
      mostrarDireccionEmisor: true,
      mostrarTelefonoCorreoEmisor: true,
      mostrarCabys: true,
      mostrarUnidadMedida: true,
      mostrarNumeroLinea: true,
      mostrarColumnaIVA: true,
      mostrarQR: true,
      mostrarClaveNumerica: true,
      mostrarDetallesOperacion: true,
      mostrarResolucionLegal: true,
      mostrarFirmaRecibido: false,
      mostrarMarcaAgua: false,
      textoMarcaAgua: '',
      tituloPersonalizado: '',
      etiquetaCliente: 'Cliente / Facturado A',
      etiquetaOperacion: 'Información Fiscal',
      etiquetaTotal: 'TOTAL A PAGAR',
      tituloCuentasBancarias: 'Datos Bancarios / SINPE Móvil',
      textoCuentasBancarias: '',
      textoNotasFijas: '',
      mensajePie: '¡Gracias por confiar en nosotros!',
      textoResolucionLegal:
        'Autorizada mediante resolución DGT-R-48-2016 de la Dirección General de Tributación de Costa Rica. Documento electrónico firmado digitalmente bajo estándar XAdES-BES.'
    }
  },
  noir: {
    nombre: 'Noir & Dorado',
    descripcion: 'Boutique elegante negro carbón y acento oro',
    diseno: {
      plantillaBase: 'noir',
      layoutHeader: 'centrado',
      estiloTabla: 'moderno',
      colorPrimario: '#111827',
      colorAcento: '#b48a1e',
      colorFondoHeader: '#111827',
      colorTextoHeader: '#fafaf9',
      colorFondoTablaHead: '#1c1917',
      colorTextoTablaHead: '#f3d06b',
      colorFondoTarjetas: '#faf8f5',
      colorBorde: '#e5dcc5',
      fuente: 'playfair',
      tamanoBasePx: 12,
      radioBordesPx: 12,
      mostrarFranjaSuperior: true,
      grosorFranjaPx: 4,
      logoAltoPx: 58,
      logoAnchoMaxPx: 240,
      logoFondoBlanco: true,
      tamanoPapel: 'letter',
      margenImpresionMm: 12,
      mostrarLogo: true,
      mostrarRazonSocial: true,
      mostrarActividadEconomica: true,
      mostrarSucursalTerminal: true,
      mostrarDireccionEmisor: true,
      mostrarTelefonoCorreoEmisor: true,
      mostrarCabys: true,
      mostrarUnidadMedida: true,
      mostrarNumeroLinea: true,
      mostrarColumnaIVA: true,
      mostrarQR: true,
      mostrarClaveNumerica: true,
      mostrarDetallesOperacion: true,
      mostrarResolucionLegal: true,
      mostrarFirmaRecibido: false,
      mostrarMarcaAgua: false,
      textoMarcaAgua: '',
      tituloPersonalizado: '',
      etiquetaCliente: 'Facturado A / Receptor',
      etiquetaOperacion: 'Detalles de la Operación',
      etiquetaTotal: 'TOTAL A PAGAR',
      tituloCuentasBancarias: 'Datos Bancarios / SINPE Móvil',
      textoCuentasBancarias: '',
      textoNotasFijas: '',
      mensajePie: '¡Gracias por su preferencia!',
      textoResolucionLegal:
        'Autorizada mediante resolución DGT-R-48-2016 de la Dirección General de Tributación de Costa Rica. Documento electrónico firmado digitalmente bajo estándar XAdES-BES.'
    }
  }
};

const TIPO_DOC_LABELS: Record<string, string> = {
  '01': 'FACTURA ELECTRÓNICA',
  '02': 'NOTA DE DÉBITO ELECTRÓNICA',
  '03': 'NOTA DE CRÉDITO ELECTRÓNICA',
  '04': 'TIQUETE ELECTRÓNICO',
  '05': 'FACTURA DE EXPORTACIÓN',
  '06': 'FACTURA DE COMPRA'
};

const CONDICION_VENTA_LABELS: Record<string, string> = {
  '01': 'Contado',
  '02': 'Crédito',
  '03': 'Consignación',
  '04': 'Apartado',
  '05': 'Arrendamiento c/ opción de compra',
  '06': 'Arrendamiento en función financiera',
  '99': 'Otros'
};

const MEDIO_PAGO_LABELS: Record<string, string> = {
  '01': 'Efectivo',
  '02': 'Tarjeta',
  '03': 'Cheque',
  '04': 'Transferencia / SINPE',
  '05': 'Recaudado por terceros',
  '99': 'Otros'
};

const TIPO_ID_LABELS: Record<string, string> = {
  '01': 'Cédula Física',
  '02': 'Cédula Jurídica',
  '03': 'DIMEX',
  '04': 'NITE'
};

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeHexColor(value: unknown, fallback: string): string {
  if (typeof value === 'string' && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value.trim())) {
    return value.trim();
  }
  return fallback;
}

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function isDarkHex(hex: string): boolean {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  if (full.length !== 6) return false;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.55;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  if (full.length !== 6) return `rgba(15, 23, 42, ${alpha})`;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getFontStacks(fuente: DisenoFuente): { body: string; heading: string } {
  switch (fuente) {
    case 'inter':
      return {
        body: "'Inter', system-ui, -apple-system, sans-serif",
        heading: "'Inter', system-ui, sans-serif"
      };
    case 'poppins':
      return {
        body: "'Poppins', system-ui, -apple-system, sans-serif",
        heading: "'Poppins', system-ui, sans-serif"
      };
    case 'playfair':
      return {
        body: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
        heading: "'Playfair Display', Georgia, serif"
      };
    case 'merriweather':
      return {
        body: "'Merriweather', Georgia, serif",
        heading: "'Merriweather', Georgia, serif"
      };
    case 'mono':
      return {
        body: "'JetBrains Mono', ui-monospace, monospace",
        heading: "'JetBrains Mono', ui-monospace, monospace"
      };
    case 'jakarta':
    default:
      return {
        body: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
        heading: "'Plus Jakarta Sans', system-ui, sans-serif"
      };
  }
}

export function resolverDisenoFactura(
  config: ConfiguracionSistema,
  estiloOverride?: EstiloFactura,
  disenoOverride?: Partial<DisenoFacturaConfig>
): Required<DisenoFacturaConfig> {
  const saved = config.sitio?.disenoFactura;
  const baseKeyCandidate =
    disenoOverride?.plantillaBase ||
    estiloOverride ||
    saved?.plantillaBase ||
    config.sitio?.estiloFactura ||
    'ejecutivo';

  const baseKey: EstiloFactura = ESTILOS_FACTURA_VALIDOS.includes(baseKeyCandidate as EstiloFactura)
    ? (baseKeyCandidate as EstiloFactura)
    : 'ejecutivo';

  const preset = PLANTILLAS_FACTURA_PRESETS[baseKey].diseno;
  const mergedRaw: DisenoFacturaConfig = {
    ...preset,
    // Si el usuario pasó un estiloOverride explícito distinto al guardado y no pasó disenoOverride, respetamos el preset visual de ese estilo pero conservando textos bancarios/notas del negocio
    ...(estiloOverride && !disenoOverride && saved && saved.plantillaBase && estiloOverride !== saved.plantillaBase
      ? {
          tituloCuentasBancarias: saved.tituloCuentasBancarias,
          textoCuentasBancarias: saved.textoCuentasBancarias,
          textoNotasFijas: saved.textoNotasFijas,
          mensajePie: saved.mensajePie,
          textoResolucionLegal: saved.textoResolucionLegal,
          mostrarFirmaRecibido: saved.mostrarFirmaRecibido
        }
      : saved || {}),
    ...(disenoOverride || {})
  };

  const layoutsValidos: DisenoLayoutHeader[] = ['clasico', 'centrado', 'compacto', 'banda-lateral'];
  const tablasValidas: DisenoEstiloTabla[] = ['moderno', 'rayado', 'cuadricula', 'minimalista'];
  const fuentesValidas: DisenoFuente[] = ['jakarta', 'inter', 'poppins', 'playfair', 'merriweather', 'mono'];
  const papelesValidos: DisenoTamanoPapel[] = ['letter', 'a4'];

  const pickBool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);
  const pickStr = (v: unknown, def: string): string => (typeof v === 'string' ? v : def);

  return {
    plantillaBase: baseKey,
    layoutHeader: layoutsValidos.includes(mergedRaw.layoutHeader as DisenoLayoutHeader)
      ? (mergedRaw.layoutHeader as DisenoLayoutHeader)
      : preset.layoutHeader,
    estiloTabla: tablasValidas.includes(mergedRaw.estiloTabla as DisenoEstiloTabla)
      ? (mergedRaw.estiloTabla as DisenoEstiloTabla)
      : preset.estiloTabla,

    colorPrimario: sanitizeHexColor(mergedRaw.colorPrimario, preset.colorPrimario),
    colorAcento: sanitizeHexColor(mergedRaw.colorAcento, preset.colorAcento),
    colorFondoHeader: sanitizeHexColor(mergedRaw.colorFondoHeader, preset.colorFondoHeader),
    colorTextoHeader: sanitizeHexColor(mergedRaw.colorTextoHeader, preset.colorTextoHeader),
    colorFondoTablaHead: sanitizeHexColor(mergedRaw.colorFondoTablaHead, preset.colorFondoTablaHead),
    colorTextoTablaHead: sanitizeHexColor(mergedRaw.colorTextoTablaHead, preset.colorTextoTablaHead),
    colorFondoTarjetas: sanitizeHexColor(mergedRaw.colorFondoTarjetas, preset.colorFondoTarjetas),
    colorBorde: sanitizeHexColor(mergedRaw.colorBorde, preset.colorBorde),

    fuente: fuentesValidas.includes(mergedRaw.fuente as DisenoFuente)
      ? (mergedRaw.fuente as DisenoFuente)
      : preset.fuente,
    tamanoBasePx: clampNum(mergedRaw.tamanoBasePx, 10, 14, preset.tamanoBasePx),
    radioBordesPx: clampNum(mergedRaw.radioBordesPx, 0, 24, preset.radioBordesPx),
    mostrarFranjaSuperior: pickBool(mergedRaw.mostrarFranjaSuperior, preset.mostrarFranjaSuperior),
    grosorFranjaPx: clampNum(mergedRaw.grosorFranjaPx, 0, 14, preset.grosorFranjaPx),
    logoAltoPx: clampNum(mergedRaw.logoAltoPx, 28, 120, preset.logoAltoPx),
    logoAnchoMaxPx: clampNum(mergedRaw.logoAnchoMaxPx, 100, 360, preset.logoAnchoMaxPx),
    logoFondoBlanco: pickBool(mergedRaw.logoFondoBlanco, preset.logoFondoBlanco),
    tamanoPapel: papelesValidos.includes(mergedRaw.tamanoPapel as DisenoTamanoPapel)
      ? (mergedRaw.tamanoPapel as DisenoTamanoPapel)
      : preset.tamanoPapel,
    margenImpresionMm: clampNum(mergedRaw.margenImpresionMm, 6, 20, preset.margenImpresionMm),

    mostrarLogo: pickBool(mergedRaw.mostrarLogo, preset.mostrarLogo),
    mostrarRazonSocial: pickBool(mergedRaw.mostrarRazonSocial, preset.mostrarRazonSocial),
    mostrarActividadEconomica: pickBool(mergedRaw.mostrarActividadEconomica, preset.mostrarActividadEconomica),
    mostrarSucursalTerminal: pickBool(mergedRaw.mostrarSucursalTerminal, preset.mostrarSucursalTerminal),
    mostrarDireccionEmisor: pickBool(mergedRaw.mostrarDireccionEmisor, preset.mostrarDireccionEmisor),
    mostrarTelefonoCorreoEmisor: pickBool(mergedRaw.mostrarTelefonoCorreoEmisor, preset.mostrarTelefonoCorreoEmisor),
    mostrarCabys: pickBool(mergedRaw.mostrarCabys, preset.mostrarCabys),
    mostrarUnidadMedida: pickBool(mergedRaw.mostrarUnidadMedida, preset.mostrarUnidadMedida),
    mostrarNumeroLinea: pickBool(mergedRaw.mostrarNumeroLinea, preset.mostrarNumeroLinea),
    mostrarColumnaIVA: pickBool(mergedRaw.mostrarColumnaIVA, preset.mostrarColumnaIVA),
    mostrarQR: pickBool(mergedRaw.mostrarQR, preset.mostrarQR),
    mostrarClaveNumerica: pickBool(mergedRaw.mostrarClaveNumerica, preset.mostrarClaveNumerica),
    mostrarDetallesOperacion: pickBool(mergedRaw.mostrarDetallesOperacion, preset.mostrarDetallesOperacion),
    mostrarResolucionLegal: pickBool(mergedRaw.mostrarResolucionLegal, preset.mostrarResolucionLegal),
    mostrarFirmaRecibido: pickBool(mergedRaw.mostrarFirmaRecibido, preset.mostrarFirmaRecibido),
    mostrarMarcaAgua: pickBool(mergedRaw.mostrarMarcaAgua, preset.mostrarMarcaAgua),
    textoMarcaAgua: pickStr(mergedRaw.textoMarcaAgua, preset.textoMarcaAgua),

    tituloPersonalizado: pickStr(mergedRaw.tituloPersonalizado, preset.tituloPersonalizado),
    etiquetaCliente: pickStr(mergedRaw.etiquetaCliente, preset.etiquetaCliente) || preset.etiquetaCliente,
    etiquetaOperacion: pickStr(mergedRaw.etiquetaOperacion, preset.etiquetaOperacion) || preset.etiquetaOperacion,
    etiquetaTotal: pickStr(mergedRaw.etiquetaTotal, preset.etiquetaTotal) || preset.etiquetaTotal,
    tituloCuentasBancarias:
      pickStr(mergedRaw.tituloCuentasBancarias, preset.tituloCuentasBancarias) || preset.tituloCuentasBancarias,
    textoCuentasBancarias: pickStr(mergedRaw.textoCuentasBancarias, preset.textoCuentasBancarias),
    textoNotasFijas: pickStr(mergedRaw.textoNotasFijas, preset.textoNotasFijas),
    mensajePie:
      pickStr(mergedRaw.mensajePie, config.sitio?.mensajePieTicket || preset.mensajePie) ||
      config.sitio?.mensajePieTicket ||
      preset.mensajePie,
    textoResolucionLegal:
      pickStr(mergedRaw.textoResolucionLegal, preset.textoResolucionLegal) || preset.textoResolucionLegal
  };
}

function formatCantidad(n: number): string {
  return Number(n || 0).toLocaleString('es-CR', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 3
  });
}

function formatMoney(n: number, simbolo: string): string {
  return `${simbolo} ${Number(n || 0).toLocaleString('es-CR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

/**
 * Genera el documento HTML personalizable optimizado para vista previa en tiempo real e impresión PDF.
 */
export async function generarFacturaEleganteHTML(data: FacturaRenderData): Promise<string> {
  const { clave, consecutivo, doc, config, notas, esBorrador = false, ocultarBarraAcciones = false } = data;
  const d = resolverDisenoFactura(config, data.estilo, data.disenoOverride);

  const baseConsultaUrl = 'https://atv.hacienda.go.cr/ATV/ComprobanteElectronico/ConsultaComprobante.aspx';
  const qrTarget = esBorrador
    ? baseConsultaUrl
    : `${baseConsultaUrl}?clave=${encodeURIComponent(clave)}`;

  const qrDataUrl = d.mostrarQR
    ? await QRCode.toDataURL(qrTarget, {
        width: 150,
        margin: 1,
        color: { dark: d.colorPrimario, light: '#ffffff' }
      })
    : '';

  const tipoNombre = d.tituloPersonalizado.trim()
    ? d.tituloPersonalizado.trim()
    : TIPO_DOC_LABELS[doc.tipoDocumento] || 'COMPROBANTE ELECTRÓNICO';
  const condicionTexto = CONDICION_VENTA_LABELS[doc.condicionVenta] || 'Contado';
  const plazoTexto =
    doc.condicionVenta === '02' && doc.plazoCredito ? ` (${escapeHtml(doc.plazoCredito)} días)` : '';
  const mediosPagoTexto = (doc.mediosPago || ['01']).map(m => MEDIO_PAGO_LABELS[m] || 'Otros').join(', ');

  const fechaObj = new Date(doc.fechaEmision);
  const fechaFormateada = Number.isNaN(fechaObj.getTime())
    ? ''
    : fechaObj.toLocaleString('es-CR', { dateStyle: 'medium', timeStyle: 'short' });

  const moneda = doc.resumen.codigoMoneda || 'CRC';
  const simboloMoneda = moneda === 'USD' ? '$' : moneda === 'EUR' ? '€' : '¢';
  const tipoCambio = doc.resumen.tipoCambio;

  const emisorNombreComercial = escapeHtml(
    config.emisor?.nombreComercial || config.emisor?.nombre || doc.emisor.nombreComercial || doc.emisor.nombre
  );
  const emisorRazonSocial = escapeHtml(config.emisor?.nombre || doc.emisor.nombre);
  const emisorCedula = escapeHtml(config.emisor?.cedula || doc.emisor.identificacion?.numero || '');
  const emisorActividad = escapeHtml(config.emisor?.actividadEconomica || doc.emisor.actividadEconomica || '');
  const emisorSucursal = escapeHtml(config.emisor?.sucursal || String(doc.emisor.sucursal || 1).padStart(3, '0'));
  const emisorTerminal = escapeHtml(config.emisor?.terminal || String(doc.emisor.terminal || 1).padStart(5, '0'));
  const emisorDireccion = escapeHtml(config.emisor?.direccion || doc.emisor.ubicacion?.senas || '');
  const emisorTelefono = escapeHtml(config.emisor?.telefono || doc.emisor.telefono?.numero || '');
  const emisorCorreo = escapeHtml(config.emisor?.correo || doc.emisor.correo || '');

  const receptorNombre = escapeHtml(doc.receptor?.nombre || 'Cliente de Contado / General');
  const receptorTipoId = doc.receptor?.identificacion?.tipo
    ? TIPO_ID_LABELS[doc.receptor.identificacion.tipo] || 'Identificación'
    : '';
  const receptorCedula = escapeHtml(doc.receptor?.identificacion?.numero || '');
  const receptorCorreo = escapeHtml(doc.receptor?.correo || '');
  const receptorTelefono = escapeHtml(doc.receptor?.telefono?.numero || '');
  const receptorDireccion = escapeHtml(doc.receptor?.ubicacion?.senas || '');

  const logoSrc =
    d.mostrarLogo && config.sitio?.logoBase64 && config.sitio.logoBase64.startsWith('data:image/')
      ? config.sitio.logoBase64
      : '';

  const tieneDescuentos =
    doc.lineas.some(l => (l.montoDescuento || 0) > 0) || (doc.resumen.totalDescuentos || 0) > 0;
  const notasLimpias = (notas || '').trim();
  const notasFijasLimpias = (d.textoNotasFijas || '').trim();
  const bancosLimpios = (d.textoCuentasBancarias || '').trim();
  const pieMensaje = escapeHtml(d.mensajePie || '¡Gracias por su preferencia!');
  const marcaAguaTexto = escapeHtml((d.textoMarcaAgua || '').trim() || emisorNombreComercial || 'DOCUMENTO');

  const headerEsOscuro = isDarkHex(d.colorFondoHeader);
  const headerMuted = headerEsOscuro ? 'rgba(255, 255, 255, 0.76)' : '#64748b';
  const pillBg = headerEsOscuro ? hexToRgba(d.colorAcento, 0.22) : hexToRgba(d.colorAcento, 0.1);
  const pillColor = headerEsOscuro ? '#ffffff' : d.colorAcento;
  const pillBorder = headerEsOscuro
    ? `1px solid ${hexToRgba('#ffffff', 0.32)}`
    : `1px solid ${hexToRgba(d.colorAcento, 0.35)}`;

  const fonts = getFontStacks(d.fuente);
  const cardRadius = Math.max(0, Math.min(d.radioBordesPx, 16));
  const smallRadius = Math.max(0, Math.min(Math.round(d.radioBordesPx * 0.5), 10));
  const headerPadding =
    d.layoutHeader === 'compacto'
      ? '22px 36px'
      : d.layoutHeader === 'centrado'
      ? '30px 42px 24px'
      : '34px 44px 28px';

  const bodyPadding = d.layoutHeader === 'compacto' ? '22px 36px 28px' : '28px 44px 36px';
  const topStripeCss =
    d.mostrarFranjaSuperior && d.grosorFranjaPx > 0 ? `${d.grosorFranjaPx}px solid ${d.colorPrimario}` : 'none';
  const leftBandCss = d.layoutHeader === 'banda-lateral' ? `10px solid ${d.colorPrimario}` : 'none';
  const headerBorderBottom =
    d.estiloTabla === 'cuadricula'
      ? `2px solid ${d.colorBorde}`
      : headerEsOscuro
      ? 'none'
      : `1px solid ${d.colorBorde}`;

  // Estilos específicos de tabla según modo elegido
  const tablaCss =
    d.estiloTabla === 'cuadricula'
      ? `
      .tabla-items { border: 1px solid ${d.colorBorde}; border-radius: ${smallRadius}px; }
      .tabla-items thead th { border: 1px solid ${d.colorBorde}; }
      .tabla-items tbody td { border: 1px solid ${d.colorBorde}; }
    `
      : d.estiloTabla === 'rayado'
      ? `
      .tabla-items tbody tr:nth-child(even) td { background: ${hexToRgba(d.colorFondoTarjetas, 0.75)}; }
      .tabla-items tbody td { border-bottom: 1px solid ${d.colorBorde}; }
    `
      : d.estiloTabla === 'minimalista'
      ? `
      .tabla-items thead th { background: transparent !important; color: ${d.colorPrimario} !important; border-top: 2px solid ${d.colorPrimario}; border-bottom: 2px solid ${d.colorPrimario}; }
      .tabla-items tbody td { border-bottom: 1px solid ${d.colorBorde}; }
      .tabla-items tbody tr:last-child td { border-bottom: 2px solid ${d.colorPrimario}; }
    `
      : `
      .tabla-items tbody td { border-bottom: 1px solid ${d.colorBorde}; }
      .tabla-items tbody tr:last-child td { border-bottom: 2px solid ${d.colorBorde}; }
    `;

  const emisorLineas: string[] = [];
  if (d.mostrarRazonSocial && emisorRazonSocial && emisorRazonSocial !== emisorNombreComercial) {
    emisorLineas.push(`<strong>${emisorRazonSocial}</strong>`);
  }
  const cedActParts: string[] = [];
  if (emisorCedula) cedActParts.push(`Cédula: ${emisorCedula}`);
  if (d.mostrarActividadEconomica && emisorActividad) cedActParts.push(`Actividad DGT: ${emisorActividad}`);
  if (cedActParts.length > 0) emisorLineas.push(cedActParts.join(' • '));
  if (d.mostrarSucursalTerminal) {
    emisorLineas.push(`Sucursal ${emisorSucursal} • Terminal ${emisorTerminal}`);
  }
  if (d.mostrarDireccionEmisor && emisorDireccion) emisorLineas.push(emisorDireccion);
  if (d.mostrarTelefonoCorreoEmisor && (emisorTelefono || emisorCorreo)) {
    const contactParts: string[] = [];
    if (emisorTelefono) contactParts.push(`Tel: ${emisorTelefono}`);
    if (emisorCorreo) contactParts.push(emisorCorreo);
    emisorLineas.push(contactParts.join(' • '));
  }

  const headerHtml =
    d.layoutHeader === 'centrado'
      ? `
    <header class="sheet-header header-centrado">
      ${logoSrc ? `<div class="logo-wrap"><img src="${logoSrc}" class="brand-logo" alt="Logotipo"></div>` : ''}
      <h1 class="brand-title">${emisorNombreComercial}</h1>
      <div class="brand-meta">${emisorLineas.join('<br>')}</div>
      <div class="doc-centrado-bar">
        <span class="doc-pill">${escapeHtml(tipoNombre)}</span>
        <span class="doc-consecutivo">${esBorrador ? `PRE-${escapeHtml(consecutivo)}` : escapeHtml(consecutivo)}</span>
        <span class="doc-submeta">Emisión: ${escapeHtml(fechaFormateada)} • Condición: ${escapeHtml(condicionTexto)}${plazoTexto}</span>
      </div>
    </header>`
      : `
    <header class="sheet-header ${d.layoutHeader === 'compacto' ? 'header-compacto' : ''}">
      <div class="brand-col">
        ${logoSrc ? `<div class="logo-wrap"><img src="${logoSrc}" class="brand-logo" alt="Logotipo"></div>` : ''}
        <div class="brand-text-wrap">
          <h1 class="brand-title">${emisorNombreComercial}</h1>
          <div class="brand-meta">${emisorLineas.join('<br>')}</div>
        </div>
      </div>
      <div class="doc-col">
        <span class="doc-pill">${escapeHtml(tipoNombre)}</span>
        <div class="doc-consecutivo">${esBorrador ? `PRE-${escapeHtml(consecutivo)}` : escapeHtml(consecutivo)}</div>
        <div class="doc-submeta">Emisión: ${escapeHtml(fechaFormateada)}</div>
        <div class="doc-submeta">Condición: ${escapeHtml(condicionTexto)}${plazoTexto}</div>
      </div>
    </header>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(tipoNombre)} - ${escapeHtml(consecutivo)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700&family=Merriweather:wght@400;700;900&family=Playfair+Display:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Poppins:wght@400;500;600;700;800&display=swap');

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: ${fonts.body};
      font-size: ${d.tamanoBasePx}px;
      color: #1e293b;
      background: #e2e8f0;
      padding: ${ocultarBarraAcciones ? '16px 12px 24px' : '28px 16px 80px'};
      -webkit-font-smoothing: antialiased;
    }

    .factura-sheet {
      max-width: 840px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: ${d.radioBordesPx}px;
      border-top: ${topStripeCss};
      border-left: ${leftBandCss};
      box-shadow: 0 22px 46px -18px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(15, 23, 42, 0.06);
      overflow: hidden;
      position: relative;
    }

    .watermark-layer {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      z-index: 1;
      overflow: hidden;
    }

    .watermark-text {
      font-family: ${fonts.heading};
      font-size: 72px;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: ${hexToRgba(d.colorPrimario, 0.06)};
      transform: rotate(-32deg);
      white-space: nowrap;
      user-select: none;
    }

    .sheet-content-layer {
      position: relative;
      z-index: 2;
    }

    .draft-ribbon {
      position: absolute;
      top: 18px;
      left: -38px;
      background: #f59e0b;
      color: #ffffff;
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.1em;
      padding: 5px 46px;
      transform: rotate(-45deg);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
      z-index: 10;
    }

    .sheet-header {
      background: ${d.colorFondoHeader};
      color: ${d.colorTextoHeader};
      padding: ${headerPadding};
      border-bottom: ${headerBorderBottom};
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
    }

    .sheet-header.header-centrado {
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 8px;
    }

    .doc-centrado-bar {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid ${headerEsOscuro ? 'rgba(255,255,255,0.18)' : d.colorBorde};
      width: 100%;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 10px 18px;
    }

    .sheet-header.header-compacto .brand-col {
      display: flex;
      align-items: center;
      gap: 16px;
      max-width: 500px;
    }

    .sheet-header.header-compacto .logo-wrap {
      margin-bottom: 0;
      flex-shrink: 0;
    }

    .brand-col {
      max-width: 460px;
    }

    .logo-wrap {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: ${d.logoFondoBlanco ? 'rgba(255, 255, 255, 0.96)' : 'transparent'};
      padding: ${d.logoFondoBlanco ? '8px 12px' : '0'};
      border-radius: ${smallRadius}px;
      margin-bottom: 10px;
    }

    .brand-logo {
      max-height: ${d.logoAltoPx}px;
      max-width: ${d.logoAnchoMaxPx}px;
      object-fit: contain;
      display: block;
    }

    .brand-title {
      font-family: ${fonts.heading};
      font-size: ${Math.round(d.tamanoBasePx * 1.85)}px;
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1.15;
    }

    .brand-meta {
      font-size: ${Math.max(9.5, d.tamanoBasePx - 1)}px;
      color: ${headerMuted};
      line-height: 1.6;
      margin-top: 5px;
    }

    .doc-col {
      text-align: right;
      flex-shrink: 0;
    }

    .doc-pill {
      display: inline-block;
      background: ${pillBg};
      color: ${pillColor};
      border: ${pillBorder};
      padding: 5px 13px;
      border-radius: ${d.radioBordesPx === 0 ? '2px' : '9999px'};
      font-size: ${Math.max(9, d.tamanoBasePx - 2)}px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 8px;
    }

    .header-centrado .doc-pill {
      margin-bottom: 0;
    }

    .doc-consecutivo {
      font-family: 'JetBrains Mono', monospace;
      font-size: ${Math.round(d.tamanoBasePx * 1.25)}px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }

    .doc-submeta {
      font-size: ${Math.max(9.5, d.tamanoBasePx - 1)}px;
      color: ${headerMuted};
      margin-top: 3px;
    }

    .sheet-body {
      padding: ${bodyPadding};
    }

    .info-grid {
      display: grid;
      grid-template-columns: ${d.mostrarDetallesOperacion ? '1.15fr 0.85fr' : '1fr'};
      gap: 20px;
      background: ${d.colorFondoTarjetas};
      border: 1px solid ${d.colorBorde};
      border-radius: ${cardRadius}px;
      padding: 16px 20px;
      margin-bottom: 22px;
    }

    .info-block h4 {
      font-size: ${Math.max(9, d.tamanoBasePx - 2)}px;
      text-transform: uppercase;
      font-weight: 800;
      letter-spacing: 0.07em;
      color: ${d.colorAcento};
      margin-bottom: 6px;
    }

    .info-block .primary-val {
      font-size: ${d.tamanoBasePx + 2}px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 4px;
    }

    .info-block .sub-line {
      font-size: ${Math.max(10, d.tamanoBasePx - 1)}px;
      color: #475569;
      line-height: 1.55;
    }

    .tabla-items {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 22px;
      border-radius: ${smallRadius}px;
      overflow: hidden;
    }

    .tabla-items thead th {
      background: ${d.colorFondoTablaHead};
      color: ${d.colorTextoTablaHead};
      font-size: ${Math.max(9, d.tamanoBasePx - 2)}px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 10px 11px;
      text-align: left;
      border-bottom: 2px solid ${d.colorBorde};
    }

    .tabla-items tbody td {
      padding: 10px 11px;
      font-size: ${d.tamanoBasePx}px;
      color: #334155;
      vertical-align: top;
    }

    ${tablaCss}

    .item-title {
      font-weight: 600;
      color: #0f172a;
    }

    .item-meta {
      font-family: 'JetBrains Mono', monospace;
      font-size: ${Math.max(9, d.tamanoBasePx - 2)}px;
      color: #94a3b8;
      margin-top: 2px;
    }

    .item-discount {
      display: inline-block;
      font-size: ${Math.max(9, d.tamanoBasePx - 2)}px;
      color: #dc2626;
      font-weight: 600;
      margin-top: 2px;
    }

    .text-right { text-align: right !important; }
    .text-center { text-align: center !important; }
    .mono { font-family: 'JetBrains Mono', monospace; }

    .bottom-grid {
      display: flex;
      justify-content: ${d.mostrarQR || d.mostrarClaveNumerica ? 'space-between' : 'flex-end'};
      align-items: flex-start;
      gap: 22px;
      margin-bottom: 20px;
    }

    .qr-panel {
      display: flex;
      align-items: center;
      gap: 14px;
      max-width: 420px;
      background: ${d.colorFondoTarjetas};
      border: 1px solid ${d.colorBorde};
      border-radius: ${cardRadius}px;
      padding: 12px 14px;
    }

    .qr-img {
      width: 92px;
      height: 92px;
      border-radius: ${smallRadius}px;
      border: 1px solid ${d.colorBorde};
      background: #ffffff;
      padding: 3px;
      flex-shrink: 0;
    }

    .qr-info {
      font-size: ${Math.max(9, d.tamanoBasePx - 2)}px;
      color: #64748b;
      line-height: 1.5;
    }

    .clave-box {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      color: #0f172a;
      background: #ffffff;
      padding: 5px 8px;
      border-radius: ${Math.min(smallRadius, 6)}px;
      word-break: break-all;
      margin-top: 6px;
      display: block;
      border: 1px solid ${d.colorBorde};
    }

    .totales-card {
      width: 310px;
      background: ${d.colorFondoTarjetas};
      border: 1px solid ${d.colorBorde};
      border-radius: ${cardRadius}px;
      padding: 15px 18px;
      flex-shrink: 0;
    }

    .tot-row {
      display: flex;
      justify-content: space-between;
      font-size: ${d.tamanoBasePx}px;
      color: #475569;
      margin-bottom: 8px;
    }

    .tot-row.final {
      border-top: 2px solid ${d.colorBorde};
      padding-top: 10px;
      margin-top: 10px;
      margin-bottom: 0;
      font-size: ${Math.round(d.tamanoBasePx * 1.32)}px;
      font-weight: 800;
      color: #0f172a;
    }

    .tot-row.final .amount {
      color: ${d.colorAcento};
    }

    .extra-box {
      background: ${hexToRgba(d.colorAcento, 0.06)};
      border: 1px solid ${hexToRgba(d.colorAcento, 0.28)};
      border-left: 4px solid ${d.colorAcento};
      border-radius: ${smallRadius}px;
      padding: 11px 15px;
      margin-bottom: 16px;
      font-size: ${Math.max(10, d.tamanoBasePx - 1)}px;
      color: #334155;
      line-height: 1.55;
    }

    .extra-box strong {
      display: block;
      font-size: ${Math.max(9, d.tamanoBasePx - 2)}px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: ${d.colorAcento};
      margin-bottom: 4px;
    }

    .bank-box {
      background: ${d.colorFondoTarjetas};
      border: 1px solid ${d.colorBorde};
      border-left: 4px solid ${d.colorPrimario};
      border-radius: ${smallRadius}px;
      padding: 11px 15px;
      margin-bottom: 16px;
      font-size: ${Math.max(10, d.tamanoBasePx - 1)}px;
      color: #334155;
      line-height: 1.55;
    }

    .bank-box strong {
      display: block;
      font-size: ${Math.max(9, d.tamanoBasePx - 2)}px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: ${d.colorPrimario};
      margin-bottom: 4px;
    }

    .signature-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 0.7fr;
      gap: 24px;
      margin-top: 24px;
      margin-bottom: 20px;
      padding-top: 10px;
    }

    .signature-line {
      border-top: 1px solid ${d.colorBorde};
      padding-top: 6px;
      text-align: center;
      font-size: ${Math.max(9, d.tamanoBasePx - 2)}px;
      color: #64748b;
      margin-top: 26px;
    }

    .factura-footer {
      border-top: 1px solid ${d.colorBorde};
      padding-top: 14px;
      text-align: center;
      font-size: ${Math.max(10, d.tamanoBasePx - 1)}px;
      color: #64748b;
      line-height: 1.6;
    }

    .factura-legal {
      margin-top: 4px;
      font-size: 9px;
      color: #94a3b8;
    }

    .action-bar {
      position: fixed;
      bottom: 22px;
      right: 22px;
      display: flex;
      gap: 10px;
      z-index: 100;
    }

    .btn-action {
      background: #0f172a;
      color: #ffffff;
      padding: 12px 20px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      border: none;
      text-decoration: none;
      box-shadow: 0 12px 24px rgba(15, 23, 42, 0.22);
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: transform 0.15s ease, background 0.15s ease;
    }

    .btn-action.secondary {
      background: #059669;
    }

    .btn-action:hover {
      transform: translateY(-2px);
      filter: brightness(1.1);
    }

    @page {
      size: ${d.tamanoPapel};
      margin: ${d.margenImpresionMm}mm;
    }

    @media print {
      body { background: #ffffff !important; padding: 0 !important; }
      .factura-sheet {
        box-shadow: none !important;
        border-radius: 0 !important;
        max-width: 100% !important;
      }
      .sheet-header { padding: 20px 26px !important; }
      .sheet-body { padding: 18px 26px !important; }
      .action-bar { display: none !important; }
    }
  </style>
</head>
<body>

  ${!ocultarBarraAcciones ? `
  <div class="action-bar">
    ${!esBorrador ? `
      <a href="/api/facturas/${encodeURIComponent(clave)}/xml" class="btn-action secondary">
        <span>⬇ Descargar XML Firmado</span>
      </a>
    ` : ''}
    <button onclick="window.print()" class="btn-action">
      <span>🖨️ Imprimir / Guardar en PDF</span>
    </button>
  </div>
  ` : ''}

  <div class="factura-sheet">
    ${esBorrador ? `<div class="draft-ribbon">BORRADOR</div>` : ''}
    ${d.mostrarMarcaAgua ? `<div class="watermark-layer"><div class="watermark-text">${marcaAguaTexto}</div></div>` : ''}

    <div class="sheet-content-layer">
      ${headerHtml}

      <div class="sheet-body">
        <section class="info-grid">
          <div class="info-block">
            <h4>${escapeHtml(d.etiquetaCliente)}</h4>
            <div class="primary-val">${receptorNombre}</div>
            ${receptorCedula ? `<div class="sub-line">${escapeHtml(receptorTipoId)}: <span class="mono">${receptorCedula}</span></div>` : ''}
            ${receptorCorreo ? `<div class="sub-line">Correo: ${receptorCorreo}</div>` : ''}
            ${receptorTelefono ? `<div class="sub-line">Teléfono: ${receptorTelefono}</div>` : ''}
            ${receptorDireccion ? `<div class="sub-line">Dirección: ${receptorDireccion}</div>` : ''}
          </div>
          ${d.mostrarDetallesOperacion ? `
          <div class="info-block">
            <h4>${escapeHtml(d.etiquetaOperacion)}</h4>
            <div class="primary-val">${escapeHtml(moneda)} (${simboloMoneda})${tipoCambio && moneda !== 'CRC' ? ` • T.C. ¢${Number(tipoCambio).toFixed(2)}` : ''}</div>
            <div class="sub-line">Medio de Pago: ${escapeHtml(mediosPagoTexto)}</div>
            <div class="sub-line">Normativa: Ministerio de Hacienda DGT v4.4</div>
            <div class="sub-line">Estado: ${esBorrador ? 'Vista Previa sin emitir' : 'Firmado Digitalmente XAdES-BES'}</div>
          </div>
          ` : ''}
        </section>

        <table class="tabla-items">
          <thead>
            <tr>
              ${d.mostrarNumeroLinea ? `<th class="text-center" style="width: 40px;">#</th>` : ''}
              <th>Descripción del Bien o Servicio</th>
              <th class="text-center" style="width: 68px;">Cant.</th>
              <th class="text-right" style="width: 112px;">Precio Unit.</th>
              ${tieneDescuentos ? `<th class="text-right" style="width: 90px;">Desc.</th>` : ''}
              ${d.mostrarColumnaIVA ? `<th class="text-right" style="width: 64px;">IVA</th>` : ''}
              <th class="text-right" style="width: 118px;">Total Línea</th>
            </tr>
          </thead>
          <tbody>
            ${doc.lineas.map(item => {
              const metaParts: string[] = [];
              if (d.mostrarCabys && item.codigoCabys) metaParts.push(`CAByS: ${escapeHtml(item.codigoCabys)}`);
              if (d.mostrarUnidadMedida && item.unidadMedida) metaParts.push(escapeHtml(item.unidadMedida));
              return `
              <tr>
                ${d.mostrarNumeroLinea ? `<td class="text-center mono" style="color: #94a3b8; font-weight: 700;">${item.numeroLinea}</td>` : ''}
                <td>
                  <div class="item-title">${escapeHtml(item.detalle)}</div>
                  ${metaParts.length > 0 ? `<div class="item-meta">${metaParts.join(' • ')}</div>` : ''}
                  ${item.naturalezaDescuento && (item.montoDescuento || 0) > 0 ? `<span class="item-discount">${escapeHtml(item.naturalezaDescuento)}</span>` : ''}
                </td>
                <td class="text-center mono" style="font-weight: 700;">${formatCantidad(item.cantidad)}</td>
                <td class="text-right mono">${formatMoney(item.precioUnitario, simboloMoneda)}</td>
                ${tieneDescuentos ? `<td class="text-right mono" style="color: ${(item.montoDescuento || 0) > 0 ? '#dc2626' : '#94a3b8'};">${(item.montoDescuento || 0) > 0 ? `-${formatMoney(item.montoDescuento || 0, simboloMoneda)}` : '—'}</td>` : ''}
                ${d.mostrarColumnaIVA ? `<td class="text-right mono" style="color: ${d.colorAcento}; font-weight: 700;">${item.tarifaIVA || 0}%</td>` : ''}
                <td class="text-right mono" style="font-weight: 700; color: #0f172a;">${formatMoney(item.montoTotalLinea, simboloMoneda)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>

        <section class="bottom-grid">
          ${d.mostrarQR || d.mostrarClaveNumerica ? `
          <div class="qr-panel">
            ${d.mostrarQR && qrDataUrl ? `<img src="${qrDataUrl}" class="qr-img" alt="Código QR DGT">` : ''}
            <div class="qr-info">
              <strong>Verificación Tributaria DGT</strong><br>
              ${esBorrador
                ? 'Al emitir el comprobante se asignará la clave numérica oficial de 50 dígitos y el enlace de verificación en Hacienda.'
                : 'Escanee el código QR para validar la autenticidad de este comprobante en la Dirección General de Tributación.'}
              ${d.mostrarClaveNumerica ? `<span class="clave-box">${esBorrador ? 'Clave pendiente de emisión definitiva' : `Clave: ${escapeHtml(clave)}`}</span>` : ''}
            </div>
          </div>
          ` : ''}

          <div class="totales-card">
            ${(doc.resumen.totalDescuentos || 0) > 0 ? `
              <div class="tot-row">
                <span>Subtotal Bruto:</span>
                <span class="mono">${formatMoney(doc.resumen.totalVenta, simboloMoneda)}</span>
              </div>
              <div class="tot-row" style="color: #dc2626;">
                <span>Descuentos:</span>
                <span class="mono">-${formatMoney(doc.resumen.totalDescuentos, simboloMoneda)}</span>
              </div>
            ` : ''}
            <div class="tot-row">
              <span>Subtotal Neto:</span>
              <span class="mono" style="font-weight: 600; color: #1e293b;">${formatMoney(doc.resumen.totalVentaNeta, simboloMoneda)}</span>
            </div>
            <div class="tot-row">
              <span>Impuesto IVA:</span>
              <span class="mono">${formatMoney(doc.resumen.totalImpuesto, simboloMoneda)}</span>
            </div>
            <div class="tot-row final">
              <span>${escapeHtml(d.etiquetaTotal)}:</span>
              <span class="mono amount">${formatMoney(doc.resumen.totalComprobante, simboloMoneda)}</span>
            </div>
          </div>
        </section>

        ${bancosLimpios ? `
          <section class="bank-box">
            <strong>${escapeHtml(d.tituloCuentasBancarias)}</strong>
            <div style="white-space: pre-line;">${escapeHtml(bancosLimpios)}</div>
          </section>
        ` : ''}

        ${notasLimpias ? `
          <section class="extra-box">
            <strong>Observaciones / Instrucciones de Pago</strong>
            <div style="white-space: pre-line;">${escapeHtml(notasLimpias)}</div>
          </section>
        ` : ''}

        ${notasFijasLimpias ? `
          <section class="extra-box">
            <strong>Términos y Condiciones</strong>
            <div style="white-space: pre-line;">${escapeHtml(notasFijasLimpias)}</div>
          </section>
        ` : ''}

        ${d.mostrarFirmaRecibido ? `
          <section class="signature-grid">
            <div class="signature-line">Entregado por (Firma)</div>
            <div class="signature-line">Recibido Conforme (Nombre y Cédula)</div>
            <div class="signature-line">Fecha de Recibido</div>
          </section>
        ` : ''}

        <footer class="factura-footer">
          <p>${pieMensaje}</p>
          ${d.mostrarResolucionLegal ? `<p class="factura-legal">${escapeHtml(d.textoResolucionLegal)}</p>` : ''}
        </footer>
      </div>
    </div>
  </div>

</body>
</html>`;
}
