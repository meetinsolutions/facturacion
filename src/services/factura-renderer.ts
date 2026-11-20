import QRCode from 'qrcode';
import { ComprobanteElectronico } from '../types/factura.types.js';
import { ConfiguracionSistema } from './data-store.js';

export type EstiloFactura = 'ejecutivo' | 'corporativo' | 'noir';

export interface FacturaRenderData {
  clave: string;
  consecutivo: string;
  doc: ComprobanteElectronico;
  config: ConfiguracionSistema;
  estilo?: EstiloFactura;
  notas?: string;
  esBorrador?: boolean;
}

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

/**
 * Escapa caracteres HTML especiales para prevenir XSS o ruptura de plantilla.
 */
function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
 * Genera el documento HTML elegante multi-tema optimizado para vista previa e impresión PDF.
 */
export async function generarFacturaEleganteHTML(data: FacturaRenderData): Promise<string> {
  const { clave, consecutivo, doc, config, notas, esBorrador = false } = data;
  const estilo: EstiloFactura = data.estilo || config.sitio?.estiloFactura || 'ejecutivo';

  const baseConsultaUrl = 'https://atv.hacienda.go.cr/ATV/ComprobanteElectronico/ConsultaComprobante.aspx';
  const qrTarget = esBorrador
    ? baseConsultaUrl
    : `${baseConsultaUrl}?clave=${encodeURIComponent(clave)}`;

  const qrDarkColor = estilo === 'corporativo' ? '#0f172a' : estilo === 'noir' ? '#111827' : '#064e3b';
  const qrDataUrl = await QRCode.toDataURL(qrTarget, {
    width: 150,
    margin: 1,
    color: { dark: qrDarkColor, light: '#ffffff' }
  });

  const tipoNombre = TIPO_DOC_LABELS[doc.tipoDocumento] || 'COMPROBANTE ELECTRÓNICO';
  const condicionTexto = CONDICION_VENTA_LABELS[doc.condicionVenta] || 'Contado';
  const plazoTexto = doc.condicionVenta === '02' && doc.plazoCredito
    ? ` (${escapeHtml(doc.plazoCredito)} días)`
    : '';
  const mediosPagoTexto = (doc.mediosPago || ['01'])
    .map(m => MEDIO_PAGO_LABELS[m] || 'Otros')
    .join(', ');

  const fechaObj = new Date(doc.fechaEmision);
  const fechaFormateada = Number.isNaN(fechaObj.getTime())
    ? ''
    : fechaObj.toLocaleString('es-CR', { dateStyle: 'medium', timeStyle: 'short' });

  const moneda = doc.resumen.codigoMoneda || 'CRC';
  const simboloMoneda = moneda === 'USD' ? '$' : moneda === 'EUR' ? '€' : '¢';
  const tipoCambio = doc.resumen.tipoCambio;

  const emisorNombreComercial = escapeHtml(config.emisor?.nombreComercial || config.emisor?.nombre || doc.emisor.nombreComercial || doc.emisor.nombre);
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

  const logoSrc = config.sitio?.logoBase64 && config.sitio.logoBase64.startsWith('data:image/')
    ? config.sitio.logoBase64
    : '';

  const tieneDescuentos = doc.lineas.some(l => (l.montoDescuento || 0) > 0) || (doc.resumen.totalDescuentos || 0) > 0;
  const notasLimpias = (notas || '').trim();
  const pieMensaje = escapeHtml(config.sitio?.mensajePieTicket || '¡Gracias por su preferencia!');

  const themeVars = estilo === 'corporativo'
    ? {
        pageBg: '#e2e8f0',
        sheetRadius: '18px',
        topStripe: 'none',
        headerBg: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)',
        headerColor: '#ffffff',
        headerMuted: '#cbd5e1',
        headerBorder: 'none',
        headerPadding: '38px 46px',
        logoWrapBg: 'rgba(255, 255, 255, 0.94)',
        logoWrapPad: '10px 14px',
        logoWrapRadius: '12px',
        pillBg: 'rgba(56, 189, 248, 0.16)',
        pillColor: '#7dd3fc',
        pillBorder: '1px solid rgba(125, 211, 252, 0.4)',
        cardBg: '#f8fafc',
        cardBorder: '#cbd5e1',
        labelColor: '#475569',
        thBg: '#0f172a',
        thColor: '#f8fafc',
        accentColor: '#0284c7',
        totalHighlight: '#0369a1',
        headingFont: "'Plus Jakarta Sans', system-ui, sans-serif",
        notesBg: '#f0f9ff',
        notesBorder: '#bae6fd'
      }
    : estilo === 'noir'
    ? {
        pageBg: '#e7e5e4',
        sheetRadius: '14px',
        topStripe: '4px solid #c9a227',
        headerBg: '#111827',
        headerColor: '#fafaf9',
        headerMuted: '#a8a29e',
        headerBorder: '2px solid #c9a227',
        headerPadding: '38px 46px',
        logoWrapBg: 'rgba(255, 255, 255, 0.96)',
        logoWrapPad: '10px 14px',
        logoWrapRadius: '10px',
        pillBg: 'rgba(201, 162, 39, 0.15)',
        pillColor: '#f3d06b',
        pillBorder: '1px solid #c9a227',
        cardBg: '#faf8f5',
        cardBorder: '#e5dcc5',
        labelColor: '#78716c',
        thBg: '#1c1917',
        thColor: '#f3d06b',
        accentColor: '#b48a1e',
        totalHighlight: '#9a7310',
        headingFont: "'Playfair Display', Georgia, serif",
        notesBg: '#faf8f5',
        notesBorder: '#e5dcc5'
      }
    : {
        pageBg: '#f1f5f9',
        sheetRadius: '20px',
        topStripe: '6px solid #059669',
        headerBg: '#ffffff',
        headerColor: '#0f172a',
        headerMuted: '#64748b',
        headerBorder: '2px solid #f1f5f9',
        headerPadding: '40px 46px 28px',
        logoWrapBg: 'transparent',
        logoWrapPad: '0',
        logoWrapRadius: '8px',
        pillBg: '#ecfdf5',
        pillColor: '#047857',
        pillBorder: '1px solid #a7f3d0',
        cardBg: '#f8fafc',
        cardBorder: '#e2e8f0',
        labelColor: '#64748b',
        thBg: '#f8fafc',
        thColor: '#475569',
        accentColor: '#059669',
        totalHighlight: '#047857',
        headingFont: "'Plus Jakarta Sans', system-ui, sans-serif",
        notesBg: '#f0fdf4',
        notesBorder: '#bbf7d0'
      };

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(tipoNombre)} - ${escapeHtml(consecutivo)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Playfair+Display:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      color: #1e293b;
      background: ${themeVars.pageBg};
      padding: 28px 16px 80px;
      -webkit-font-smoothing: antialiased;
    }

    .factura-sheet {
      max-width: 840px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: ${themeVars.sheetRadius};
      border-top: ${themeVars.topStripe};
      box-shadow: 0 24px 48px -18px rgba(15, 23, 42, 0.16), 0 0 0 1px rgba(15, 23, 42, 0.05);
      overflow: hidden;
      position: relative;
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
      background: ${themeVars.headerBg};
      color: ${themeVars.headerColor};
      padding: ${themeVars.headerPadding};
      border-bottom: ${themeVars.headerBorder};
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
    }

    .brand-col {
      max-width: 450px;
    }

    .logo-wrap {
      display: inline-flex;
      align-items: center;
      background: ${themeVars.logoWrapBg};
      padding: ${themeVars.logoWrapPad};
      border-radius: ${themeVars.logoWrapRadius};
      margin-bottom: 12px;
    }

    .brand-logo {
      max-height: 54px;
      max-width: 240px;
      object-fit: contain;
      display: block;
    }

    .brand-title {
      font-family: ${themeVars.headingFont};
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1.15;
    }

    .brand-meta {
      font-size: 11px;
      color: ${themeVars.headerMuted};
      line-height: 1.65;
      margin-top: 6px;
    }

    .doc-col {
      text-align: right;
      flex-shrink: 0;
    }

    .doc-pill {
      display: inline-block;
      background: ${themeVars.pillBg};
      color: ${themeVars.pillColor};
      border: ${themeVars.pillBorder};
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 10px;
    }

    .doc-consecutivo {
      font-family: 'JetBrains Mono', monospace;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }

    .doc-submeta {
      font-size: 11px;
      color: ${themeVars.headerMuted};
      margin-top: 4px;
    }

    .sheet-body {
      padding: 32px 46px 40px;
    }

    .info-grid {
      display: grid;
      grid-template-columns: 1.15fr 0.85fr;
      gap: 20px;
      background: ${themeVars.cardBg};
      border: 1px solid ${themeVars.cardBorder};
      border-radius: 14px;
      padding: 18px 22px;
      margin-bottom: 26px;
    }

    .info-block h4 {
      font-size: 10px;
      text-transform: uppercase;
      font-weight: 800;
      letter-spacing: 0.07em;
      color: ${themeVars.labelColor};
      margin-bottom: 6px;
    }

    .info-block .primary-val {
      font-size: 14px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 4px;
    }

    .info-block .sub-line {
      font-size: 11px;
      color: #475569;
      line-height: 1.55;
    }

    .tabla-items {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 26px;
      border-radius: 10px;
      overflow: hidden;
    }

    .tabla-items thead th {
      background: ${themeVars.thBg};
      color: ${themeVars.thColor};
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 11px 12px;
      text-align: left;
      border-bottom: 2px solid ${themeVars.cardBorder};
    }

    .tabla-items tbody td {
      padding: 12px;
      font-size: 12px;
      border-bottom: 1px solid #f1f5f9;
      color: #334155;
      vertical-align: top;
    }

    .tabla-items tbody tr:last-child td {
      border-bottom: 2px solid ${themeVars.cardBorder};
    }

    .item-title {
      font-weight: 600;
      color: #0f172a;
    }

    .item-meta {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      color: #94a3b8;
      margin-top: 2px;
    }

    .item-discount {
      display: inline-block;
      font-size: 10px;
      color: #dc2626;
      font-weight: 600;
      margin-top: 2px;
    }

    .text-right { text-align: right !important; }
    .text-center { text-align: center !important; }
    .mono { font-family: 'JetBrains Mono', monospace; }

    .bottom-grid {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      margin-bottom: 24px;
    }

    .qr-panel {
      display: flex;
      align-items: center;
      gap: 14px;
      max-width: 420px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 12px 14px;
    }

    .qr-img {
      width: 96px;
      height: 96px;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      background: #ffffff;
      padding: 3px;
      flex-shrink: 0;
    }

    .qr-info {
      font-size: 10px;
      color: #64748b;
      line-height: 1.5;
    }

    .clave-box {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px;
      color: #0f172a;
      background: #ffffff;
      padding: 5px 8px;
      border-radius: 6px;
      word-break: break-all;
      margin-top: 6px;
      display: block;
      border: 1px solid #e2e8f0;
    }

    .totales-card {
      width: 310px;
      background: ${themeVars.cardBg};
      border: 1px solid ${themeVars.cardBorder};
      border-radius: 14px;
      padding: 16px 20px;
      flex-shrink: 0;
    }

    .tot-row {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #475569;
      margin-bottom: 8px;
    }

    .tot-row.final {
      border-top: 2px solid ${themeVars.cardBorder};
      padding-top: 10px;
      margin-top: 10px;
      margin-bottom: 0;
      font-size: 16px;
      font-weight: 800;
      color: #0f172a;
    }

    .tot-row.final .amount {
      color: ${themeVars.totalHighlight};
    }

    .notes-box {
      background: ${themeVars.notesBg};
      border: 1px solid ${themeVars.notesBorder};
      border-left: 4px solid ${themeVars.accentColor};
      border-radius: 10px;
      padding: 12px 16px;
      margin-bottom: 22px;
      font-size: 11px;
      color: #334155;
      line-height: 1.55;
    }

    .notes-box strong {
      display: block;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: ${themeVars.accentColor};
      margin-bottom: 4px;
    }

    .factura-footer {
      border-top: 1px solid #e2e8f0;
      padding-top: 18px;
      text-align: center;
      font-size: 11px;
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
      size: letter;
      margin: 12mm;
    }

    @media print {
      body { background: #ffffff !important; padding: 0 !important; }
      .factura-sheet {
        box-shadow: none !important;
        border-radius: 0 !important;
        max-width: 100% !important;
      }
      .sheet-header { padding: 24px 28px !important; }
      .sheet-body { padding: 20px 28px !important; }
      .action-bar { display: none !important; }
    }
  </style>
</head>
<body>

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

  <div class="factura-sheet">
    ${esBorrador ? `<div class="draft-ribbon">BORRADOR</div>` : ''}

    <header class="sheet-header">
      <div class="brand-col">
        ${logoSrc ? `<div class="logo-wrap"><img src="${logoSrc}" class="brand-logo" alt="Logotipo"></div>` : ''}
        <h1 class="brand-title">${emisorNombreComercial}</h1>
        <div class="brand-meta">
          <strong>${emisorRazonSocial}</strong><br>
          Cédula: ${emisorCedula} • Actividad DGT: ${emisorActividad}<br>
          Sucursal ${emisorSucursal} • Terminal ${emisorTerminal}<br>
          ${emisorDireccion ? `${emisorDireccion}<br>` : ''}
          ${emisorTelefono ? `Tel: ${emisorTelefono} • ` : ''}${emisorCorreo}
        </div>
      </div>

      <div class="doc-col">
        <span class="doc-pill">${escapeHtml(tipoNombre)}</span>
        <div class="doc-consecutivo">${esBorrador ? `PRE-${escapeHtml(consecutivo)}` : escapeHtml(consecutivo)}</div>
        <div class="doc-submeta">Emisión: ${escapeHtml(fechaFormateada)}</div>
        <div class="doc-submeta">Condición: ${escapeHtml(condicionTexto)}${plazoTexto}</div>
      </div>
    </header>

    <div class="sheet-body">
      <section class="info-grid">
        <div class="info-block">
          <h4>Facturado A / Receptor</h4>
          <div class="primary-val">${receptorNombre}</div>
          ${receptorCedula ? `<div class="sub-line">${escapeHtml(receptorTipoId)}: <span class="mono">${receptorCedula}</span></div>` : ''}
          ${receptorCorreo ? `<div class="sub-line">Correo: ${receptorCorreo}</div>` : ''}
          ${receptorTelefono ? `<div class="sub-line">Teléfono: ${receptorTelefono}</div>` : ''}
          ${receptorDireccion ? `<div class="sub-line">Dirección: ${receptorDireccion}</div>` : ''}
        </div>
        <div class="info-block">
          <h4>Detalles de la Operación</h4>
          <div class="primary-val">${escapeHtml(moneda)} (${simboloMoneda})${tipoCambio && moneda !== 'CRC' ? ` • T.C. ¢${Number(tipoCambio).toFixed(2)}` : ''}</div>
          <div class="sub-line">Medio de Pago: ${escapeHtml(mediosPagoTexto)}</div>
          <div class="sub-line">Normativa: Ministerio de Hacienda DGT v4.3</div>
          <div class="sub-line">Estado: ${esBorrador ? 'Vista Previa sin emitir' : 'Firmado Digitalmente XAdES-BES'}</div>
        </div>
      </section>

      <table class="tabla-items">
        <thead>
          <tr>
            <th class="text-center" style="width: 42px;">#</th>
            <th>Descripción del Bien o Servicio</th>
            <th class="text-center" style="width: 72px;">Cant.</th>
            <th class="text-right" style="width: 112px;">Precio Unit.</th>
            ${tieneDescuentos ? `<th class="text-right" style="width: 92px;">Desc.</th>` : ''}
            <th class="text-right" style="width: 68px;">IVA</th>
            <th class="text-right" style="width: 118px;">Total Línea</th>
          </tr>
        </thead>
        <tbody>
          ${doc.lineas.map(item => `
            <tr>
              <td class="text-center mono" style="color: #94a3b8; font-weight: 700;">${item.numeroLinea}</td>
              <td>
                <div class="item-title">${escapeHtml(item.detalle)}</div>
                <div class="item-meta">CAByS: ${escapeHtml(item.codigoCabys)}${item.unidadMedida ? ` • ${escapeHtml(item.unidadMedida)}` : ''}</div>
                ${item.naturalezaDescuento && (item.montoDescuento || 0) > 0 ? `<span class="item-discount">${escapeHtml(item.naturalezaDescuento)}</span>` : ''}
              </td>
              <td class="text-center mono" style="font-weight: 700;">${formatCantidad(item.cantidad)}</td>
              <td class="text-right mono">${formatMoney(item.precioUnitario, simboloMoneda)}</td>
              ${tieneDescuentos ? `<td class="text-right mono" style="color: ${(item.montoDescuento || 0) > 0 ? '#dc2626' : '#94a3b8'};">${(item.montoDescuento || 0) > 0 ? `-${formatMoney(item.montoDescuento || 0, simboloMoneda)}` : '—'}</td>` : ''}
              <td class="text-right mono" style="color: ${themeVars.accentColor}; font-weight: 700;">${item.tarifaIVA || 0}%</td>
              <td class="text-right mono" style="font-weight: 700; color: #0f172a;">${formatMoney(item.montoTotalLinea, simboloMoneda)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <section class="bottom-grid">
        <div class="qr-panel">
          <img src="${qrDataUrl}" class="qr-img" alt="Código QR DGT">
          <div class="qr-info">
            <strong>Verificación Tributaria DGT</strong><br>
            ${esBorrador
              ? 'Al emitir el comprobante se asignará la clave numérica oficial de 50 dígitos y el enlace de verificación en Hacienda.'
              : 'Escanee el código QR para validar la autenticidad de este comprobante en la Dirección General de Tributación.'}
            <span class="clave-box">${esBorrador ? 'Clave pendiente de emisión definitiva' : `Clave: ${escapeHtml(clave)}`}</span>
          </div>
        </div>

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
            <span>TOTAL A PAGAR:</span>
            <span class="mono amount">${formatMoney(doc.resumen.totalComprobante, simboloMoneda)}</span>
          </div>
        </div>
      </section>

      ${notasLimpias ? `
        <section class="notes-box">
          <strong>Observaciones / Instrucciones de Pago</strong>
          <div style="white-space: pre-line;">${escapeHtml(notasLimpias)}</div>
        </section>
      ` : ''}

      <footer class="factura-footer">
        <p>${pieMensaje}</p>
        <p class="factura-legal">
          Autorizada mediante resolución DGT-R-48-2016 de la Dirección General de Tributación de Costa Rica. Documento electrónico firmado digitalmente bajo estándar XAdES-BES.
        </p>
      </footer>
    </div>
  </div>

</body>
</html>`;
}
