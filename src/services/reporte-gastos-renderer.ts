import { GastoRecibido, ConfiguracionSistema } from './data-store.js';
import { formatoFechaLegibleCR } from '../utils/cr-date.js';

export interface ParametrosReporteGastos {
  gastos: GastoRecibido[];
  config: ConfiguracionSistema;
  filtros: {
    mes?: string;
    categoria?: string;
    estado?: string;
    busqueda?: string;
  };
  usuario?: string;
}

function fmtMoney(amount: number, currency: string = 'CRC'): string {
  const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '¢';
  const formatted = Math.abs(amount).toLocaleString('es-CR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return amount < 0 ? `-${sym}${formatted}` : `${sym}${formatted}`;
}

function fmtNum(n: number): string {
  return n.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function generarReporteGastosHTML(params: ParametrosReporteGastos): string {
  const { gastos, config, filtros, usuario } = params;

  // Cálculos consolidados
  let totalComprobanteCRC = 0;
  let totalVentaNetaCRC = 0;
  let totalImpuestoCRC = 0;
  let totalGravadoCRC = 0;
  let totalExentoCRC = 0;
  let totalNoSujetoCRC = 0;

  const desgloseTarifas: Record<string, { base: number; monto: number }> = {
    '13%': { base: 0, monto: 0 },
    '8%': { base: 0, monto: 0 },
    '4%': { base: 0, monto: 0 },
    '2%': { base: 0, monto: 0 },
    '1%': { base: 0, monto: 0 },
    '0% / No Sujeto / Exento': { base: 0, monto: 0 }
  };

  const categoriasMap: Record<string, { cantidad: number; totalCRC: number; ivaCRC: number }> = {};
  const proveedoresMap: Record<string, { nombre: string; cedula: string; cantidad: number; totalCRC: number; ivaCRC: number }> = {};

  let conteoFacturas = 0;
  let conteoTiquetes = 0;
  let conteoNotasCredito = 0;

  for (const g of gastos) {
    const signo = g.tipoDocumento === '03' ? -1 : 1;
    if (g.tipoDocumento === '03') conteoNotasCredito++;
    else if (g.tipoDocumento === '04') conteoTiquetes++;
    else conteoFacturas++;

    const tc = g.moneda === 'CRC' ? 1 : (Number(g.tipoCambio) > 0 ? Number(g.tipoCambio) : 1);
    const gTotCRC = Number(g.totalCRC || (g.totalComprobante * tc));
    const gIvaCRC = Number(g.impuestoCRC || (g.totalImpuesto * tc));
    const gNetaCRC = Number((g.totalVentaNeta || (g.totalComprobante - g.totalImpuesto)) * tc);

    totalComprobanteCRC += signo * gTotCRC;
    totalImpuestoCRC += signo * gIvaCRC;
    totalVentaNetaCRC += signo * gNetaCRC;

    totalGravadoCRC += signo * Number(g.subtotalGravado * tc || 0);
    totalExentoCRC += signo * Number(g.subtotalExento * tc || 0);

    // Desglose por categoría
    const cat = g.categoriaGasto || 'General';
    if (!categoriasMap[cat]) {
      categoriasMap[cat] = { cantidad: 0, totalCRC: 0, ivaCRC: 0 };
    }
    categoriasMap[cat].cantidad += 1;
    categoriasMap[cat].totalCRC += signo * gTotCRC;
    categoriasMap[cat].ivaCRC += signo * gIvaCRC;

    // Desglose por proveedor
    const provKey = g.emisorCedula || g.emisorNombre;
    if (!proveedoresMap[provKey]) {
      proveedoresMap[provKey] = {
        nombre: g.emisorNombre || 'Proveedor sin nombre',
        cedula: g.emisorCedula || '',
        cantidad: 0,
        totalCRC: 0,
        ivaCRC: 0
      };
    }
    proveedoresMap[provKey].cantidad += 1;
    proveedoresMap[provKey].totalCRC += signo * gTotCRC;
    proveedoresMap[provKey].ivaCRC += signo * gIvaCRC;

    // Desglose por tarifa de IVA
    if (g.desgloseIVA && Object.keys(g.desgloseIVA).length > 0) {
      for (const [tarifaKey, montoIva] of Object.entries(g.desgloseIVA)) {
        const tNum = parseFloat(tarifaKey);
        const montoTarifaCRC = montoIva * tc * signo;
        if (tNum >= 12.5 && tNum <= 13.5) {
          desgloseTarifas['13%'].monto += montoTarifaCRC;
          desgloseTarifas['13%'].base += (montoTarifaCRC / 0.13);
        } else if (tNum >= 7.5 && tNum <= 8.5) {
          desgloseTarifas['8%'].monto += montoTarifaCRC;
          desgloseTarifas['8%'].base += (montoTarifaCRC / 0.08);
        } else if (tNum >= 3.5 && tNum <= 4.5) {
          desgloseTarifas['4%'].monto += montoTarifaCRC;
          desgloseTarifas['4%'].base += (montoTarifaCRC / 0.04);
        } else if (tNum >= 1.5 && tNum <= 2.5) {
          desgloseTarifas['2%'].monto += montoTarifaCRC;
          desgloseTarifas['2%'].base += (montoTarifaCRC / 0.02);
        } else if (tNum >= 0.5 && tNum <= 1.5) {
          desgloseTarifas['1%'].monto += montoTarifaCRC;
          desgloseTarifas['1%'].base += (montoTarifaCRC / 0.01);
        } else {
          desgloseTarifas['0% / No Sujeto / Exento'].monto += montoTarifaCRC;
          desgloseTarifas['0% / No Sujeto / Exento'].base += (signo * (gNetaCRC));
        }
      }
    } else if (gIvaCRC === 0) {
      desgloseTarifas['0% / No Sujeto / Exento'].base += (signo * gNetaCRC);
    } else {
      desgloseTarifas['13%'].monto += (signo * gIvaCRC);
      desgloseTarifas['13%'].base += (signo * (gIvaCRC / 0.13));
    }
  }

  // Top categorías ordenadas por monto descendente
  const listaCategorias = Object.entries(categoriasMap)
    .map(([nombre, d]) => ({ nombre, ...d }))
    .sort((a, b) => b.totalCRC - a.totalCRC);

  // Top proveedores ordenados por monto descendente
  const listaProveedores = Object.values(proveedoresMap)
    .sort((a, b) => b.totalCRC - a.totalCRC)
    .slice(0, 5);

  const nombreEmpresa = config.emisor?.nombre || config.sitio?.nombreSistema || 'Empresa';
  const cedulaEmpresa = config.emisor?.cedula || '';
  const correoEmpresa = config.emisor?.correo || '';
  const telEmpresa = config.emisor?.telefono || '';
  const logo = config.sitio?.logoBase64 || '';

  const fechaGeneracion = formatoFechaLegibleCR(new Date());

  const periodoTexto = filtros.mes
    ? (() => {
        const [yyyy, mm] = filtros.mes.split('-');
        const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const mIdx = parseInt(mm, 10) - 1;
        return `${meses[mIdx] || mm} ${yyyy}`;
      })()
    : 'Todos los periodos registrados';

  const estadoBadge = (estado: string) => {
    switch (estado) {
      case 'aceptado':
        return `<span class="badge badge-success">Aceptado DGT</span>`;
      case 'aceptado_parcial':
        return `<span class="badge badge-warning">Aceptado Parcial</span>`;
      case 'rechazado':
        return `<span class="badge badge-danger">Rechazado</span>`;
      default:
        return `<span class="badge badge-neutral">Pendiente</span>`;
    }
  };

  const tipoDocBadge = (tipo: string, nombre?: string) => {
    if (tipo === '03') {
      return `<span class="badge badge-nc">Nota Crédito</span>`;
    }
    if (tipo === '04') {
      return `<span class="badge badge-te">Tiquete Elect.</span>`;
    }
    return `<span class="badge badge-fe">${escapeHtml(nombre || 'Factura Elect.')}</span>`;
  };

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reporte Ejecutivo de Gastos - ${escapeHtml(nombreEmpresa)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #0f172a;
      --primary-light: #1e293b;
      --accent: #059669;
      --accent-light: #ecfdf5;
      --text: #0f172a;
      --text-muted: #64748b;
      --border: #e2e8f0;
      --bg-subtle: #f8fafc;
      --card-bg: #ffffff;
      --danger: #dc2626;
      --danger-light: #fef2f2;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: var(--text);
      background-color: #f1f5f9;
      font-size: 12px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    .toolbar {
      position: sticky;
      top: 0;
      z-index: 100;
      background: rgba(15, 23, 42, 0.95);
      backdrop-filter: blur(8px);
      color: white;
      padding: 12px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .toolbar-title {
      font-weight: 700;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .toolbar-badge {
      background: var(--accent);
      color: white;
      font-size: 10px;
      font-weight: 800;
      padding: 2px 8px;
      border-radius: 9999px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .toolbar-actions {
      display: flex;
      gap: 10px;
    }

    .btn {
      font-family: inherit;
      font-size: 12px;
      font-weight: 700;
      padding: 8px 16px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s ease;
      text-decoration: none;
    }

    .btn-primary {
      background: var(--accent);
      color: white;
    }
    .btn-primary:hover {
      background: #047857;
      transform: translateY(-1px);
    }

    .btn-secondary {
      background: #334155;
      color: white;
    }
    .btn-secondary:hover {
      background: #475569;
    }

    .btn-outline {
      background: transparent;
      color: #94a3b8;
      border: 1px solid #475569;
    }
    .btn-outline:hover {
      background: #1e293b;
      color: white;
    }

    .report-sheet {
      max-width: 1200px;
      margin: 24px auto;
      background: white;
      border-radius: 16px;
      padding: 36px 40px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
      border: 1px solid var(--border);
    }

    /* HEADER */
    .report-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 24px;
      border-bottom: 2px solid var(--border);
      margin-bottom: 28px;
    }

    .header-company {
      display: flex;
      align-items: center;
      gap: 20px;
    }

    .company-logo {
      max-width: 150px;
      max-height: 60px;
      object-fit: contain;
    }

    .company-monogram {
      width: 56px;
      height: 56px;
      border-radius: 12px;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: white;
      font-size: 24px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 10px rgba(15, 23, 42, 0.15);
    }

    .company-details h1 {
      font-size: 18px;
      font-weight: 800;
      color: var(--primary);
      margin-bottom: 4px;
      line-height: 1.2;
    }

    .company-meta {
      font-size: 11px;
      color: var(--text-muted);
      line-height: 1.4;
    }

    .header-doc {
      text-align: right;
    }

    .doc-title {
      font-size: 20px;
      font-weight: 800;
      color: var(--primary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }

    .doc-subtitle {
      display: inline-block;
      background: var(--accent-light);
      color: var(--accent);
      font-size: 11px;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 6px;
      margin-bottom: 8px;
    }

    .doc-dates {
      font-size: 10.5px;
      color: var(--text-muted);
    }

    /* KPI CARDS */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 28px;
    }

    .kpi-card {
      background: var(--bg-subtle);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      position: relative;
      overflow: hidden;
    }

    .kpi-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: var(--border);
    }

    .kpi-card.highlight-accent::before {
      background: var(--accent);
    }
    .kpi-card.highlight-primary::before {
      background: var(--primary);
    }
    .kpi-card.highlight-sky::before {
      background: #0284c7;
    }

    .kpi-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 6px;
    }

    .kpi-value {
      font-family: 'JetBrains Mono', monospace;
      font-size: 20px;
      font-weight: 800;
      color: var(--primary);
      margin-bottom: 4px;
    }

    .kpi-value.accent {
      color: var(--accent);
    }

    .kpi-footnote {
      font-size: 10px;
      color: var(--text-muted);
    }

    /* SECTION TITLES */
    .section-title {
      font-size: 13px;
      font-weight: 800;
      color: var(--primary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .section-title::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--border);
    }

    /* ANALYTICS SECTION (GRID 2 COLS) */
    .analytics-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 30px;
    }

    .analytics-card {
      background: white;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
    }

    .mini-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }

    .mini-table th {
      text-align: left;
      padding: 6px 8px;
      font-size: 10px;
      font-weight: 700;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border);
      text-transform: uppercase;
    }

    .mini-table td {
      padding: 6px 8px;
      border-bottom: 1px solid #f1f5f9;
      color: var(--text);
    }

    .mini-table tr:last-child td {
      border-bottom: none;
    }

    .text-right { text-align: right; }
    .font-mono { font-family: 'JetBrains Mono', monospace; }
    .font-bold { font-weight: 700; }

    /* TRANSACTIONS TABLE */
    .table-container {
      margin-bottom: 32px;
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }

    .report-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }

    .report-table thead {
      background: #0f172a;
      color: white;
    }

    .report-table th {
      padding: 10px 10px;
      font-weight: 700;
      font-size: 9.5px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border: none;
      white-space: nowrap;
    }

    .report-table tbody tr {
      border-bottom: 1px solid var(--border);
      transition: background 0.15s ease;
    }

    .report-table tbody tr:nth-child(even) {
      background: #f8fafc;
    }

    .report-table td {
      padding: 9px 10px;
      vertical-align: middle;
    }

    .report-table tfoot {
      background: #f1f5f9;
      font-weight: 800;
      border-top: 2px solid var(--primary);
    }

    .report-table tfoot td {
      padding: 12px 10px;
      color: var(--primary);
      font-size: 12px;
    }

    /* BADGES */
    .badge {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      white-space: nowrap;
    }

    .badge-fe { background: #e0e7ff; color: #3730a3; }
    .badge-te { background: #e0f2fe; color: #0369a1; }
    .badge-nc { background: #fef3c7; color: #92400e; }

    .badge-success { background: #dcfce7; color: #15803d; }
    .badge-warning { background: #fef9c3; color: #a16207; }
    .badge-danger { background: #fee2e2; color: #b91c1c; }
    .badge-neutral { background: #f1f5f9; color: #475569; }

    /* AUDIT & SIGNATURES */
    .report-footer {
      border-top: 1px solid var(--border);
      padding-top: 24px;
      margin-top: 36px;
    }

    .audit-note {
      font-size: 10.5px;
      color: var(--text-muted);
      line-height: 1.5;
      margin-bottom: 30px;
      background: #f8fafc;
      padding: 12px 16px;
      border-radius: 8px;
      border-left: 3px solid #64748b;
    }

    .signatures-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 40px;
      margin-top: 40px;
      padding: 0 20px;
    }

    .signature-block {
      text-align: center;
    }

    .signature-line {
      border-bottom: 1px solid #94a3b8;
      height: 40px;
      margin-bottom: 8px;
    }

    .signature-name {
      font-weight: 700;
      font-size: 11px;
      color: var(--primary);
    }

    .signature-role {
      font-size: 10px;
      color: var(--text-muted);
    }

    /* PRINT RULES */
    @media print {
      body {
        background: white;
        font-size: 10px;
      }
      .no-print, .toolbar {
        display: none !important;
      }
      .report-sheet {
        margin: 0;
        padding: 0;
        border: none;
        box-shadow: none;
        border-radius: 0;
        max-width: 100%;
      }
      .report-header {
        padding-bottom: 14px;
        margin-bottom: 16px;
      }
      .kpi-grid {
        gap: 10px;
        margin-bottom: 16px;
      }
      .kpi-card {
        padding: 10px;
      }
      .kpi-value {
        font-size: 16px;
      }
      .analytics-grid {
        gap: 12px;
        margin-bottom: 18px;
      }
      .report-table th, .report-table td {
        padding: 6px 6px;
      }
      tr {
        page-break-inside: avoid;
      }
      @page {
        size: letter landscape;
        margin: 10mm 8mm;
      }
    }
  </style>
</head>
<body>

  <!-- TOOLBAR EXCLUSIVA PARA PANTALLA -->
  <aside class="toolbar no-print" aria-label="Acciones de reporte">
    <div class="toolbar-title">
      <span>Reporte Ejecutivo de Gastos</span>
      <span class="toolbar-badge">Fiscal CR</span>
      <span style="font-size: 11px; color: #94a3b8; font-weight: normal;">• ${gastos.length} comprobantes</span>
    </div>
    <div class="toolbar-actions">
      <button type="button" class="btn btn-primary" onclick="window.print()">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
        <span>Imprimir / Guardar en PDF</span>
      </button>
      <a href="/api/gastos/reporte-pdf${filtros.mes ? `?mes=${encodeURIComponent(filtros.mes)}` : ''}" class="btn btn-secondary">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
        <span>Descargar PDF Directo</span>
      </a>
      <button type="button" class="btn btn-outline" onclick="window.close()">Cerrar</button>
    </div>
  </aside>

  <main class="report-sheet">

    <!-- ENCABEZADO CORPORATIVO -->
    <header class="report-header">
      <div class="header-company">
        ${logo ? `<img src="${logo}" alt="Logo" class="company-logo">` : `<div class="company-monogram">${escapeHtml((nombreEmpresa[0] || 'E').toUpperCase())}</div>`}
        <div class="company-details">
          <h1>${escapeHtml(nombreEmpresa)}</h1>
          <div class="company-meta">
            ${cedulaEmpresa ? `<div><strong>Cédula:</strong> ${escapeHtml(cedulaEmpresa)}</div>` : ''}
            ${correoEmpresa ? `<div><strong>Email:</strong> ${escapeHtml(correoEmpresa)}</div>` : ''}
            ${telEmpresa ? `<div><strong>Teléfono:</strong> ${escapeHtml(telEmpresa)}</div>` : ''}
            <div><strong>Sistema:</strong> Facturación Electrónica v4.4 DGT</div>
          </div>
        </div>
      </div>

      <div class="header-doc">
        <div class="doc-title">Reporte de Gastos y Compras</div>
        <div class="doc-subtitle">Período: ${escapeHtml(periodoTexto)}</div>
        <div class="doc-dates">
          <div><strong>Generado:</strong> ${escapeHtml(fechaGeneracion)}</div>
          ${usuario ? `<div><strong>Usuario:</strong> ${escapeHtml(usuario)}</div>` : ''}
          ${filtros.categoria ? `<div><strong>Categoría:</strong> ${escapeHtml(filtros.categoria)}</div>` : ''}
          ${filtros.estado ? `<div><strong>Estado:</strong> ${escapeHtml(filtros.estado.toUpperCase())}</div>` : ''}
        </div>
      </div>
    </header>

    <!-- CARDS DE RESUMEN EJECUTIVO (KPIs) -->
    <section class="kpi-grid">
      <div class="kpi-card highlight-primary">
        <div class="kpi-label">Total Facturado (CRC)</div>
        <div class="kpi-value">${fmtMoney(totalComprobanteCRC, 'CRC')}</div>
        <div class="kpi-footnote">Monto total neto recibido</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">Base Imponible / Venta Neta</div>
        <div class="kpi-value">${fmtMoney(totalVentaNetaCRC, 'CRC')}</div>
        <div class="kpi-footnote">Subtotal gravado y exento</div>
      </div>

      <div class="kpi-card highlight-accent">
        <div class="kpi-label">IVA Crédito Fiscal (CRC)</div>
        <div class="kpi-value accent">${fmtMoney(totalImpuestoCRC, 'CRC')}</div>
        <div class="kpi-footnote">Impuesto deducible soportado</div>
      </div>

      <div class="kpi-card highlight-sky">
        <div class="kpi-label">Total Documentos</div>
        <div class="kpi-value" style="color: #0369a1;">${gastos.length}</div>
        <div class="kpi-footnote">${conteoFacturas} FE • ${conteoTiquetes} TE • ${conteoNotasCredito} NC</div>
      </div>
    </section>

    <!-- ANÁLISIS TRIBUTARIO Y DE GASTOS -->
    <section class="analytics-grid">

      <!-- DESGLOSE DE IVA POR TARIFA -->
      <div class="analytics-card">
        <div class="section-title">Desglose de IVA Soportado (D-104)</div>
        <table class="mini-table">
          <thead>
            <tr>
              <th>Tarifa IVA</th>
              <th class="text-right">Base Imponible (Est.)</th>
              <th class="text-right">IVA Acreditable (CRC)</th>
            </tr>
          </thead>
          <tbody>
            ${Object.entries(desgloseTarifas).map(([tarifa, val]) => `
              <tr>
                <td><strong>${escapeHtml(tarifa)}</strong></td>
                <td class="text-right font-mono">${fmtMoney(val.base, 'CRC')}</td>
                <td class="text-right font-mono font-bold" style="color: ${val.monto > 0 ? 'var(--accent)' : 'inherit'};">
                  ${fmtMoney(val.monto, 'CRC')}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- DESGLOSE POR CATEGORÍA DE GASTO -->
      <div class="analytics-card">
        <div class="section-title">Distribución por Categoría</div>
        <table class="mini-table">
          <thead>
            <tr>
              <th>Categoría</th>
              <th class="text-right">Docs</th>
              <th class="text-right">Total IVA</th>
              <th class="text-right">Total (CRC)</th>
            </tr>
          </thead>
          <tbody>
            ${listaCategorias.length === 0 ? `<tr><td colspan="4" class="text-muted">Sin categorías asignadas</td></tr>` : ''}
            ${listaCategorias.slice(0, 6).map(c => `
              <tr>
                <td><strong>${escapeHtml(c.nombre)}</strong></td>
                <td class="text-right">${c.cantidad}</td>
                <td class="text-right font-mono">${fmtMoney(c.ivaCRC, 'CRC')}</td>
                <td class="text-right font-mono font-bold">${fmtMoney(c.totalCRC, 'CRC')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

    </section>

    <!-- TABLA DETALLADA DE GASTOS -->
    <div class="section-title">Detalle de Comprobantes Recibidos</div>
    <div class="table-container">
      <table class="report-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Tipo</th>
            <th>Consecutivo</th>
            <th>Proveedor</th>
            <th>Cédula</th>
            <th>Categoría</th>
            <th>Mon</th>
            <th class="text-right">Subtotal</th>
            <th class="text-right">IVA (CRC)</th>
            <th class="text-right">Total (CRC)</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          ${gastos.length === 0 ? `
            <tr>
              <td colspan="11" style="text-align: center; padding: 30px; color: #94a3b8;">
                No se encontraron comprobantes para los filtros seleccionados.
              </td>
            </tr>
          ` : ''}
          ${gastos.map(g => {
            const signo = g.tipoDocumento === '03' ? -1 : 1;
            const tc = g.moneda === 'CRC' ? 1 : (Number(g.tipoCambio) > 0 ? Number(g.tipoCambio) : 1);
            const totCRC = signo * Number(g.totalCRC || (g.totalComprobante * tc));
            const ivaCRC = signo * Number(g.impuestoCRC || (g.totalImpuesto * tc));
            const subCRC = signo * Number((g.totalVentaNeta || (g.totalComprobante - g.totalImpuesto)) * tc);
            const fDate = g.fechaEmision ? formatoFechaLegibleCR(g.fechaEmision, { soloFecha: true, formatoCorto: true }) : 'N/D';

            return `
              <tr>
                <td style="white-space: nowrap;">${escapeHtml(fDate)}</td>
                <td>${tipoDocBadge(g.tipoDocumento, g.tipoDocumentoNombre)}</td>
                <td class="font-mono" style="font-size: 10px;">${escapeHtml(g.consecutivo || g.clave.slice(21, 41))}</td>
                <td style="font-weight: 600; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  ${escapeHtml(g.emisorNombre)}
                </td>
                <td class="font-mono" style="font-size: 10px;">${escapeHtml(g.emisorCedula || '')}</td>
                <td><span style="color: #475569; font-weight: 500;">${escapeHtml(g.categoriaGasto || 'General')}</span></td>
                <td class="font-mono" style="font-size: 10px;">${escapeHtml(g.moneda || 'CRC')}</td>
                <td class="text-right font-mono">${fmtMoney(subCRC, 'CRC')}</td>
                <td class="text-right font-mono" style="color: ${ivaCRC > 0 ? 'var(--accent)' : 'inherit'}; font-weight: 600;">
                  ${fmtMoney(ivaCRC, 'CRC')}
                </td>
                <td class="text-right font-mono font-bold">${fmtMoney(totCRC, 'CRC')}</td>
                <td>${estadoBadge(g.estadoConfirmacion)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="7">TOTAL CONSOLIDADO (${gastos.length} comprobantes)</td>
            <td class="text-right font-mono">${fmtMoney(totalVentaNetaCRC, 'CRC')}</td>
            <td class="text-right font-mono" style="color: var(--accent);">${fmtMoney(totalImpuestoCRC, 'CRC')}</td>
            <td class="text-right font-mono">${fmtMoney(totalComprobanteCRC, 'CRC')}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- CERTIFICACIÓN Y FIRMAS -->
    <footer class="report-footer">
      <div class="audit-note">
        <strong>Declaración de Conciliación y Cumplimiento Tributario:</strong>
        El presente reporte resume los comprobantes electrónicos procesados, validados y certificados bajo los esquemas oficiales v4.4 del Ministerio de Hacienda de Costa Rica (con soporte de históricos v4.3). La información aquí contenida respalda la liquidación de créditos fiscales del Impuesto sobre el Valor Agregado (IVA) y deducciones aplicables al Impuesto sobre la Renta.
      </div>

      <div class="signatures-grid">
        <div class="signature-block">
          <div class="signature-line"></div>
          <div class="signature-name">Elaborado por</div>
          <div class="signature-role">Administración / Contabilidad</div>
        </div>
        <div class="signature-block">
          <div class="signature-line"></div>
          <div class="signature-name">Revisado por</div>
          <div class="signature-role">Auditoría Interna / Fiscal</div>
        </div>
        <div class="signature-block">
          <div class="signature-line"></div>
          <div class="signature-name">Aprobado por</div>
          <div class="signature-role">Gerencia Financiera / Representante Legal</div>
        </div>
      </div>
    </footer>

  </main>

</body>
</html>`;
}
