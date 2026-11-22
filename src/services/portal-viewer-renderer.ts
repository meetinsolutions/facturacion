/**
 * MEETINFACT — PORTAL DE COMPROBANTES (INCREMENTO 1)
 * Renderizador de Visualizador Web Responsive y Seguro para Clientes
 */
import QRCode from 'qrcode';
import { ComprobanteAccesoValido } from './comprobante-token-service.js';
import { formatoFechaLegibleCR } from '../utils/cr-date.js';

function escapeHtml(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatoMoneda(monto: number, moneda: string): string {
  const sim = moneda === 'USD' ? '$' : '₡';
  return `${sim}${Number(monto || 0).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function generarPortalComprobanteHTML(
  comp: ComprobanteAccesoValido,
  rawToken: string
): Promise<string> {
  const doc = comp.docOriginalJson || {};
  const emisor = comp.emisorJson?.emisor || doc.emisor || {};
  const receptor = doc.receptor || {};
  const lineas = Array.isArray(doc.lineas) ? doc.lineas : [];
  const resumen = doc.resumen || {};

  const isTest = process.env.NODE_ENV !== 'production' || 
                 (process.env.APP_URL || '').includes('test-') || 
                 process.env.ALLOW_SANDBOX_CHECKOUT === 'true';

  // 1. Estado oficial de Hacienda
  let estadoBadgeHtml = '';
  const estadoNorm = (comp.estadoHacienda || '').toLowerCase();

  if (estadoNorm === 'aceptado') {
    const textoAceptado = isTest
      ? 'Autorizado por Ministerio de Hacienda (Simulación Sandbox / QA)'
      : 'Autorizado por Ministerio de Hacienda';
    estadoBadgeHtml = `
      <div style="display:inline-flex;align-items:center;gap:6px;background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;padding:6px 14px;border-radius:9999px;font-size:13px;font-weight:600;">
        <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
        ${textoAceptado}
      </div>`;
  } else if (estadoNorm === 'procesando') {
    estadoBadgeHtml = `
      <div style="display:inline-flex;align-items:center;gap:6px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;padding:6px 14px;border-radius:9999px;font-size:13px;font-weight:600;">
        <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/></svg>
        En Proceso de Validación Tributaria
      </div>`;
  } else if (estadoNorm === 'rechazado') {
    estadoBadgeHtml = `
      <div style="display:inline-flex;align-items:center;gap:6px;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:6px 14px;border-radius:9999px;font-size:13px;font-weight:600;">
        <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>
        Comprobante Rechazado por Hacienda
      </div>`;
  } else {
    estadoBadgeHtml = `
      <div style="display:inline-flex;align-items:center;gap:6px;background:#f3f4f6;border:1px solid #e5e7eb;color:#374151;padding:6px 14px;border-radius:9999px;font-size:13px;font-weight:600;">
        Comprobante Registrado
      </div>`;
  }

  // 2. Generar Código QR Oficial
  const haciendaQrUrl = `https://atv.hacienda.go.cr/ATV/comprobanteElectronico/comprobante.html?clave=${comp.clave}`;
  let qrDataUrl = '';
  try {
    qrDataUrl = await QRCode.toDataURL(haciendaQrUrl, {
      margin: 1,
      width: 140,
      color: { dark: '#0f172a', light: '#ffffff' }
    });
  } catch (err: any) {
    console.warn('[QR] Error generando QR:', err.message);
  }

  // Nombre legible del tipo de comprobante
  const tipoDocNombres: Record<string, string> = {
    '01': 'Factura Electrónica',
    '02': 'Nota de Débito Electrónica',
    '03': 'Nota de Crédito Electrónica',
    '04': 'Tiquete Electrónico',
    '05': 'Factura Electrónica de Exportación',
    '06': 'Factura Electrónica de Compra'
  };
  const tipoDocNombre = tipoDocNombres[comp.tipoDocumento] || 'Comprobante Electrónico';

  const fechaFormateada = formatoFechaLegibleCR(comp.fecha, { formatoLargo: true });

  // Renderizar filas de la tabla de líneas
  const filasLineasHtml = lineas.map((l: any, idx: number) => `
    <tr style="border-bottom:1px solid #f1f5f9;">
      <td style="padding:12px 8px;font-size:13px;color:#64748b;text-align:center;">${idx + 1}</td>
      <td style="padding:12px 8px;">
        <div style="font-weight:600;font-size:14px;color:#1e293b;">${escapeHtml(l.detalle)}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px;">CAByS: ${escapeHtml(l.codigoCabys || 'N/A')}</div>
      </td>
      <td style="padding:12px 8px;text-align:center;font-size:13px;color:#334155;">${escapeHtml(l.cantidad)} ${escapeHtml(l.unidadMedida || 'Unid')}</td>
      <td style="padding:12px 8px;text-align:right;font-size:13px;color:#334155;">${formatoMoneda(l.precioUnitario, comp.moneda)}</td>
      <td style="padding:12px 8px;text-align:center;font-size:12px;color:#64748b;">${escapeHtml(l.tarifaIVA ?? 13)}%</td>
      <td style="padding:12px 8px;text-align:right;font-weight:600;font-size:14px;color:#0f172a;">${formatoMoneda(l.montoTotalLinea ?? l.montoTotal, comp.moneda)}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(tipoDocNombre)} - ${escapeHtml(comp.consecutivo)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #f8fafc;
      color: #0f172a;
      line-height: 1.5;
      padding: 16px;
    }
    .container {
      max-width: 860px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.08);
      overflow: hidden;
      border: 1px solid #e2e8f0;
    }
    .header-bar {
      background: #0f172a;
      color: #ffffff;
      padding: 24px;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      text-decoration: none;
      transition: all 0.15s ease;
      cursor: pointer;
    }
    .btn-pdf {
      background: #dc2626;
      color: #ffffff;
    }
    .btn-pdf:hover { background: #b91c1c; }
    .btn-xml {
      background: #2563eb;
      color: #ffffff;
    }
    .btn-xml:hover { background: #1d4ed8; }
    .content-body { padding: 32px 24px; }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      margin-bottom: 28px;
    }
    @media (max-width: 640px) {
      .grid-2 { grid-template-columns: 1fr; }
      .header-bar { flex-direction: column; align-items: flex-start; }
      .actions-group { width: 100%; display: flex; flex-direction: column; gap: 8px; }
      .btn { width: 100%; justify-content: center; }
    }
    .box-info {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px;
    }
    .table-container {
      overflow-x: auto;
      margin: 24px 0;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
    }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th {
      background: #f1f5f9;
      color: #475569;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 12px 8px;
    }
    .totals-box {
      margin-left: auto;
      max-width: 340px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px;
    }
    .tot-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 14px; color: #475569; }
    .tot-grand { font-size: 18px; font-weight: 800; color: #0f172a; border-top: 1px solid #cbd5e1; margin-top: 8px; padding-top: 8px; }
    .clave-box {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      background: #f1f5f9;
      color: #334155;
      padding: 10px;
      border-radius: 6px;
      word-break: break-all;
      margin-top: 6px;
    }
    .footer {
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      padding: 20px 24px;
      text-align: center;
      font-size: 12px;
      color: #64748b;
    }
  </style>
</head>
<body>
  ${isTest ? `
  <div style="background:#fffbeb;border-bottom:1px solid #fde68a;color:#92400e;padding:10px 16px;text-align:center;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px;">
    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
    ENTORNO DE PRUEBAS / QA SANDBOX — DOCUMENTO SIMULADO SIN VALIDEZ TRIBUTARIA
  </div>
  ` : ''}

  <div class="container">
    <!-- Header -->
    <div class="header-bar">
      <div>
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:#94a3b8;">MeetinFact Portal Seguro</div>
        <h1 style="font-size:20px;font-weight:700;margin-top:2px;">${escapeHtml(tipoDocNombre)}</h1>
        <div style="font-size:13px;color:#cbd5e1;">Consecutivo: ${escapeHtml(comp.consecutivo)}</div>
      </div>
      <div class="actions-group" style="display:flex;gap:10px;">
        <a href="/c/${rawToken}/pdf" class="btn btn-pdf" download>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
          Descargar PDF
        </a>
        <a href="/c/${rawToken}/xml" class="btn btn-xml" download>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="10 13 8 15 10 17"/><polyline points="14 13 16 15 14 17"/></svg>
          Descargar XML
        </a>
      </div>
    </div>

    <!-- Body -->
    <div class="content-body">
      <!-- Estado Hacienda -->
      <div style="margin-bottom:24px;">
        ${estadoBadgeHtml}
        <div style="font-size:13px;color:#64748b;margin-top:6px;">Emitido el ${fechaFormateada}</div>
      </div>

      <!-- Emisor y Receptor -->
      <div class="grid-2">
        <div class="box-info">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:4px;">Emisor</div>
          <div style="font-weight:700;font-size:15px;color:#0f172a;">${escapeHtml(emisor.nombre || 'Emisor')}</div>
          ${emisor.nombreComercial ? `<div style="font-size:13px;color:#475569;">${escapeHtml(emisor.nombreComercial)}</div>` : ''}
          <div style="font-size:13px;color:#64748b;margin-top:4px;">Identificación: ${escapeHtml(emisor.identificacion?.numero || 'N/A')}</div>
          ${emisor.correo ? `<div style="font-size:13px;color:#64748b;">${escapeHtml(emisor.correo)}</div>` : ''}
        </div>

        <div class="box-info">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:4px;">Receptor (Cliente)</div>
          <div style="font-weight:700;font-size:15px;color:#0f172a;">${escapeHtml(receptor.nombre || comp.cliente || 'Cliente')}</div>
          ${receptor.identificacion?.numero ? `<div style="font-size:13px;color:#64748b;margin-top:4px;">Identificación: ${escapeHtml(receptor.identificacion.numero)}</div>` : ''}
          ${receptor.correo ? `<div style="font-size:13px;color:#64748b;">${escapeHtml(receptor.correo)}</div>` : ''}
        </div>
      </div>

      <!-- Detalle de Líneas -->
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th style="text-align:center;width:40px;">#</th>
              <th>Detalle / CAByS</th>
              <th style="text-align:center;">Cant</th>
              <th style="text-align:right;">Precio Unit</th>
              <th style="text-align:center;">IVA</th>
              <th style="text-align:right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${filasLineasHtml}
          </tbody>
        </table>
      </div>

      <!-- Totales y QR -->
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:20px;margin-top:24px;">
        <div style="display:flex;align-items:center;gap:16px;">
          ${qrDataUrl ? `<img src="${qrDataUrl}" alt="Código QR Comprobante" style="width:110px;height:110px;border:1px solid #e2e8f0;border-radius:8px;">` : ''}
          <div>
            <div style="font-size:12px;font-weight:600;color:#334155;">Verificación Digital</div>
            <div style="font-size:11px;color:#64748b;max-width:200px;margin-top:2px;">Escanee el código para contrastar la validez del comprobante directamente en el Ministerio de Hacienda.</div>
          </div>
        </div>

        <div class="totals-box">
          <div class="tot-row"><span>Total Servicios Gravados:</span> <span>${formatoMoneda(resumen.totalServGravados || 0, comp.moneda)}</span></div>
          <div class="tot-row"><span>Total Mercancías Gravadas:</span> <span>${formatoMoneda(resumen.totalMercanciasGravadas || 0, comp.moneda)}</span></div>
          <div class="tot-row"><span>Total Impuesto (IVA):</span> <span>${formatoMoneda(resumen.totalImpuesto || 0, comp.moneda)}</span></div>
          <div class="tot-row tot-grand"><span>Total a Pagar:</span> <span>${formatoMoneda(comp.total, comp.moneda)}</span></div>
        </div>
      </div>

      <!-- Clave Numérica -->
      <div style="margin-top:32px;">
        <div style="font-size:12px;font-weight:600;color:#475569;">Clave Numérica de Hacienda (50 dígitos):</div>
        <div class="clave-box">${escapeHtml(comp.clave)}</div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      Documento electrónico generado conforme a las especificaciones de la Dirección General de Tributación de Costa Rica.
      <br>Portal protegido por MeetinFact SaaS.
    </div>
  </div>

</body>
</html>`;
}
