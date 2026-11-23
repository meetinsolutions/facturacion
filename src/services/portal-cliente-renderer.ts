/**
 * MEETINFACT — PORTAL DE COMPROBANTES: INCREMENTO 2
 * Renderer del portal web responsive para autenticación OTP y visualización de historial de clientes
 */
export function renderPortalClienteAppHTML(esQA: boolean = true): string {
  const badgeHtml = esQA
    ? `<div class="bg-amber-500/10 border-b border-amber-500/20 text-amber-300 px-4 py-2 text-xs font-medium text-center flex items-center justify-center gap-2">
         <span class="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
         <span>ENTORNO DE SIMULACIÓN Y PRUEBAS QA — Los comprobantes mostrados son con fines demostrativos y de auditoría técnica.</span>
       </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="es" class="h-full bg-slate-950 text-slate-100">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
  <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <meta name="referrer" content="no-referrer">
  <title>Portal de Comprobantes para Clientes — MeetinFact</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; }
    .font-mono { font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body class="min-h-full flex flex-col bg-slate-950 text-slate-100 antialiased selection:bg-indigo-500 selection:text-white">
  ${badgeHtml}

  <!-- Header Global -->
  <header class="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div>
          <h1 class="text-base font-semibold tracking-tight text-white flex items-center gap-2">
            MeetinFact <span class="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">Portal Clientes</span>
          </h1>
          <p class="text-xs text-slate-400">Consulta y descarga segura de comprobantes electrónicos</p>
        </div>
      </div>

      <div id="userSessionBadge" class="hidden items-center gap-3">
        <span class="text-xs px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700 flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span id="sessionEmailText" class="font-mono"></span>
        </span>
        <button id="btnLogout" onclick="portalApp.cerrarSesion()" class="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 transition">
          Cerrar Sesión
        </button>
      </div>
    </div>
  </header>

  <!-- Main Container -->
  <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
    
    <!-- VISTA 1: Solicitud de OTP -->
    <div id="viewSolicitarOtp" class="max-w-md mx-auto pt-8 sm:pt-16">
      <div class="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-sm">
        <div class="text-center mb-6">
          <div class="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 mx-auto flex items-center justify-center mb-3">
            <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 class="text-xl font-bold text-white tracking-tight">Acceso a sus Facturas</h2>
          <p class="text-sm text-slate-400 mt-1">Ingrese su correo electrónico para recibir un código de acceso único.</p>
        </div>

        <form id="formSolicitarOtp" onsubmit="portalApp.solicitarOtp(event)" class="space-y-4">
          <div>
            <label for="inputEmail" class="block text-xs font-medium text-slate-300 mb-1.5">Correo Electrónico del Receptor</label>
            <input type="email" id="inputEmail" required placeholder="ejemplo@empresa.com" class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition">
          </div>

          <div>
            <label for="inputCedula" class="block text-xs font-medium text-slate-400 mb-1.5">Cédula / Identificación del Receptor <span class="text-slate-500 text-[11px]">(Opcional)</span></label>
            <input type="text" id="inputCedula" placeholder="Ej: 3-101-123456" class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition">
          </div>

          <div id="alertSolicitar" class="hidden rounded-xl p-3 text-xs"></div>

          <button type="submit" id="btnSolicitarOtp" class="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm shadow-lg shadow-indigo-600/25 transition flex items-center justify-center gap-2">
            <span>Enviar Código de Verificación</span>
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </form>

        <p class="text-center text-xs text-slate-500 mt-6">
          Por privacidad y seguridad, no revelamos si un correo está registrado en el sistema.
        </p>
      </div>
    </div>

    <!-- VISTA 2: Verificación de OTP -->
    <div id="viewVerificarOtp" class="hidden max-w-md mx-auto pt-8 sm:pt-16">
      <div class="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-sm">
        <div class="text-center mb-6">
          <div class="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mx-auto flex items-center justify-center mb-3">
            <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 class="text-xl font-bold text-white tracking-tight">Verificar Código</h2>
          <p class="text-sm text-slate-400 mt-1">
            Enviamos un código de 6 dígitos a <span id="targetEmailLabel" class="text-slate-200 font-mono font-medium"></span>
          </p>
        </div>

        <form id="formVerificarOtp" onsubmit="portalApp.verificarOtp(event)" class="space-y-4">
          <div>
            <label for="inputOtp" class="block text-xs font-medium text-slate-300 mb-1.5">Código de 6 dígitos</label>
            <input type="text" id="inputOtp" maxlength="6" pattern="\\d{6}" required placeholder="123456" class="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-600 text-center text-2xl font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition">
          </div>

          <div id="alertVerificar" class="hidden rounded-xl p-3 text-xs"></div>

          <button type="submit" id="btnVerificarOtp" class="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm shadow-lg shadow-emerald-600/25 transition">
            Ingresar al Portal
          </button>
        </form>

        <div class="flex items-center justify-between text-xs text-slate-400 mt-6 pt-4 border-t border-slate-800">
          <button type="button" onclick="portalApp.cambiarCorreo()" class="hover:text-white transition">← Cambiar correo</button>
          <button type="button" id="btnReenviar" onclick="portalApp.reenviarOtp()" class="hover:text-indigo-400 transition">Reenviar código</button>
        </div>
      </div>
    </div>

    <!-- VISTA 3: Historial de Comprobantes -->
    <div id="viewHistorial" class="hidden space-y-6">
      
      <!-- Barra superior de filtros -->
      <div class="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 sm:p-5 backdrop-blur-sm">
        <form id="formFiltros" onsubmit="portalApp.aplicarFiltros(event)" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label class="block text-xs text-slate-400 mb-1 font-medium">Fecha Desde</label>
            <input type="date" id="filtroDesde" class="w-full px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:ring-1 focus:ring-indigo-500 focus:outline-none">
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1 font-medium">Fecha Hasta</label>
            <input type="date" id="filtroHasta" class="w-full px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:ring-1 focus:ring-indigo-500 focus:outline-none">
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1 font-medium">Tipo de Documento</label>
            <select id="filtroTipo" class="w-full px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:ring-1 focus:ring-indigo-500 focus:outline-none">
              <option value="">Todos los tipos</option>
              <option value="01">Factura Electrónica (01)</option>
              <option value="04">Tiquete Electrónico (04)</option>
              <option value="03">Nota de Crédito (03)</option>
              <option value="02">Nota de Débito (02)</option>
              <option value="08">Factura Compra (08)</option>
              <option value="09">Factura Exportación (09)</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1 font-medium">Estado Hacienda</label>
            <select id="filtroEstado" class="w-full px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:ring-1 focus:ring-indigo-500 focus:outline-none">
              <option value="">Todos los estados</option>
              <option value="aceptado">Aceptado</option>
              <option value="rechazado">Rechazado</option>
              <option value="enviado">Enviado / Procesando</option>
            </select>
          </div>
          <div class="flex items-end gap-2">
            <button type="submit" class="flex-1 py-1.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition shadow-sm">
              Filtrar
            </button>
            <button type="button" onclick="portalApp.limpiarFiltros()" class="py-1.5 px-3 rounded-xl border border-slate-700 hover:bg-slate-800 text-xs text-slate-300 transition">
              Limpiar
            </button>
          </div>
        </form>
      </div>

      <!-- Resumen estadístico -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4" id="statsContainer">
        <div class="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
          <p class="text-xs text-slate-400">Total Documentos</p>
          <p id="statTotalDocs" class="text-xl font-bold text-white mt-1">0</p>
        </div>
        <div class="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
          <p class="text-xs text-slate-400">Total en Colones (CRC)</p>
          <p id="statTotalCrc" class="text-xl font-bold text-emerald-400 mt-1">₡ 0.00</p>
        </div>
        <div class="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
          <p class="text-xs text-slate-400">Total en Dólares (USD)</p>
          <p id="statTotalUsd" class="text-xl font-bold text-cyan-400 mt-1">$ 0.00</p>
        </div>
        <div class="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
          <p class="text-xs text-slate-400">Zona Horaria Oficial</p>
          <p class="text-xs font-mono font-medium text-slate-300 mt-2">UTC-06:00 (Costa Rica)</p>
        </div>
      </div>

      <!-- Listado de Comprobantes -->
      <div class="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden backdrop-blur-sm">
        
        <!-- Vista Desktop (Tabla) -->
        <div class="hidden md:block overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-950/70 text-slate-400 border-b border-slate-800 uppercase font-semibold">
              <tr>
                <th class="px-4 py-3">Fecha y Hora (CR)</th>
                <th class="px-4 py-3">Emisor</th>
                <th class="px-4 py-3">Tipo / Consecutivo</th>
                <th class="px-4 py-3">Clave</th>
                <th class="px-4 py-3 text-right">Total</th>
                <th class="px-4 py-3 text-center">Estado</th>
                <th class="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody id="comprobantesTableBody" class="divide-y divide-slate-800">
              <tr>
                <td colspan="7" class="px-4 py-8 text-center text-slate-500">Cargando comprobantes...</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Vista Mobile (Tarjetas) -->
        <div id="comprobantesCardsContainer" class="md:hidden divide-y divide-slate-800">
          <div class="p-6 text-center text-slate-500 text-xs">Cargando comprobantes...</div>
        </div>

        <!-- Paginador -->
        <div id="paginacionContainer" class="px-4 py-3 border-t border-slate-800 bg-slate-950/40 flex items-center justify-between text-xs text-slate-400">
          <span id="paginacionInfo">Mostrando 0 comprobantes</span>
          <div class="flex items-center gap-1.5" id="paginacionBotones"></div>
        </div>

      </div>

    </div>

  </main>

  <!-- Modal para Visualización de Comprobante -->
  <div id="modalVisualizador" class="hidden fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
      <div class="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
        <h3 id="modalTitulo" class="text-sm font-semibold text-white">Visualizador de Comprobante</h3>
        <button onclick="portalApp.cerrarModal()" class="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="flex-1 overflow-auto bg-slate-950" id="modalFrameContainer">
        <iframe id="modalIframe" class="w-full h-full min-h-[500px] border-0"></iframe>
      </div>
    </div>
  </div>

  <!-- Script de la Aplicación -->
  <script>
    const TIPOS_DOC = {
      '01': 'Factura Electrónica',
      '02': 'Nota de Débito',
      '03': 'Nota de Crédito',
      '04': 'Tiquete Electrónico',
      '08': 'Factura Electrónica Compra',
      '09': 'Factura Electrónica Exportación'
    };

    const portalApp = {
      email: '',
      cooldownTimer: null,
      cooldownSeconds: 0,

      async init() {
        try {
          const res = await fetch('/api/public/portal/auth/check', { credentials: 'same-origin' });
          const data = await res.json();
          if (data.authenticated && data.email) {
            this.email = data.email;
            this.mostrarHistorial();
            return;
          }
        } catch {}
        this.mostrarVistaSolicitar();
      },

      mostrarVistaSolicitar() {
        document.getElementById('viewSolicitarOtp').classList.remove('hidden');
        document.getElementById('viewVerificarOtp').classList.add('hidden');
        document.getElementById('viewHistorial').classList.add('hidden');
        document.getElementById('userSessionBadge').classList.add('hidden');
      },

      mostrarVistaVerificar(email) {
        this.email = email;
        document.getElementById('targetEmailLabel').innerText = email;
        document.getElementById('viewSolicitarOtp').classList.add('hidden');
        document.getElementById('viewVerificarOtp').classList.remove('hidden');
        document.getElementById('viewHistorial').classList.add('hidden');
        document.getElementById('inputOtp').value = '';
        document.getElementById('inputOtp').focus();
      },

      mostrarHistorial() {
        document.getElementById('viewSolicitarOtp').classList.add('hidden');
        document.getElementById('viewVerificarOtp').classList.add('hidden');
        document.getElementById('viewHistorial').classList.remove('hidden');
        document.getElementById('userSessionBadge').classList.remove('hidden');
        document.getElementById('userSessionBadge').classList.add('flex');
        document.getElementById('sessionEmailText').innerText = this.email;
        this.cargarComprobantes();
      },

      async solicitarOtp(e) {
        e.preventDefault();
        const email = document.getElementById('inputEmail').value.trim();
        const cedulaReceptor = (document.getElementById('inputCedula')?.value || '').trim();
        const btn = document.getElementById('btnSolicitarOtp');
        const alertEl = document.getElementById('alertSolicitar');

        btn.disabled = true;
        btn.classList.add('opacity-50');
        alertEl.classList.add('hidden');

        try {
          const res = await fetch('/api/public/portal/auth/solicitar-otp', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, cedulaReceptor })
          });
          const data = await res.json();

          if (data.ok) {
            this.mostrarVistaVerificar(email);
            this.iniciarCooldown(60);
          } else {
            alertEl.className = 'rounded-xl p-3 text-xs bg-rose-500/10 border border-rose-500/20 text-rose-300';
            alertEl.innerText = data.mensaje || 'Error al solicitar código.';
            alertEl.classList.remove('hidden');
          }
        } catch (err) {
          alertEl.className = 'rounded-xl p-3 text-xs bg-rose-500/10 border border-rose-500/20 text-rose-300';
          alertEl.innerText = 'Error de conexión. Intente nuevamente.';
          alertEl.classList.remove('hidden');
        } finally {
          btn.disabled = false;
          btn.classList.remove('opacity-50');
        }
      },

      async verificarOtp(e) {
        e.preventDefault();
        const otp = document.getElementById('inputOtp').value.trim();
        const btn = document.getElementById('btnVerificarOtp');
        const alertEl = document.getElementById('alertVerificar');

        btn.disabled = true;
        btn.classList.add('opacity-50');
        alertEl.classList.add('hidden');

        try {
          const res = await fetch('/api/public/portal/auth/verificar-otp', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: this.email, otp })
          });
          const data = await res.json();

          if (data.ok) {
            this.mostrarHistorial();
          } else {
            alertEl.className = 'rounded-xl p-3 text-xs bg-rose-500/10 border border-rose-500/20 text-rose-300';
            alertEl.innerText = data.error || 'Código incorrecto.';
            alertEl.classList.remove('hidden');
          }
        } catch (err) {
          alertEl.className = 'rounded-xl p-3 text-xs bg-rose-500/10 border border-rose-500/20 text-rose-300';
          alertEl.innerText = 'Error de conexión al verificar el código.';
          alertEl.classList.remove('hidden');
        } finally {
          btn.disabled = false;
          btn.classList.remove('opacity-50');
        }
      },

      async cargarComprobantes(pagina = 1) {
        const tbody = document.getElementById('comprobantesTableBody');
        const cards = document.getElementById('comprobantesCardsContainer');

        const params = new URLSearchParams({
          pagina: pagina.toString(),
          limite: '20'
        });

        const fDesde = document.getElementById('filtroDesde').value;
        const fHasta = document.getElementById('filtroHasta').value;
        const fTipo = document.getElementById('filtroTipo').value;
        const fEstado = document.getElementById('filtroEstado').value;

        if (fDesde) params.append('fechaDesde', fDesde);
        if (fHasta) params.append('fechaHasta', fHasta);
        if (fTipo) params.append('tipoDocumento', fTipo);
        if (fEstado) params.append('estado', fEstado);

        try {
          const res = await fetch('/api/public/portal/comprobantes?' + params.toString(), {
            credentials: 'same-origin'
          });

          if (res.status === 401) {
            this.cerrarSesion();
            return;
          }

          const data = await res.json();
          if (!data.ok) throw new Error(data.error);

          this.renderizarListado(data.comprobantes || []);
          this.renderizarEstadisticas(data.comprobantes || [], data.total || 0);
          this.renderizarPaginador(data.total || 0, data.pagina || 1, data.totalPaginas || 1);
        } catch (err) {
          tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-rose-400">Error al cargar comprobantes.</td></tr>';
          cards.innerHTML = '<div class="p-6 text-center text-rose-400 text-xs">Error al cargar comprobantes.</div>';
        }
      },

          if (res.status === 401) {
            this.cerrarSesion();
            return;
          }

          const data = await res.json();
          if (!data.ok) throw new Error(data.error);

          this.renderizarListado(data.comprobantes || []);
          this.renderizarEstadisticas(data.comprobantes || [], data.total || 0);
          this.renderizarPaginador(data.total || 0, data.pagina || 1, data.totalPaginas || 1);
        } catch (err) {
          tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-rose-400">Error al cargar comprobantes.</td></tr>';
          cards.innerHTML = '<div class="p-6 text-center text-rose-400 text-xs">Error al cargar comprobantes.</div>';
        }
      },

      renderizarListado(items) {
        const tbody = document.getElementById('comprobantesTableBody');
        const cards = document.getElementById('comprobantesCardsContainer');

        if (!items || items.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-slate-500">No se encontraron comprobantes para el receptor.</td></tr>';
          cards.innerHTML = '<div class="p-6 text-center text-slate-500 text-xs">No se encontraron comprobantes.</div>';
          return;
        }

        // Tabla Desktop
        tbody.innerHTML = items.map(c => {
          const tipoTexto = TIPOS_DOC[c.tipoDocumento] || c.tipoDocumento;
          const estadoClase = c.estadoHacienda === 'aceptado'
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            : c.estadoHacienda === 'rechazado'
            ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
            : 'bg-amber-500/10 text-amber-400 border border-amber-500/20';

          const claveCorta = c.clave.substring(0, 8) + '...' + c.clave.substring(c.clave.length - 8);

          return \`<tr class="hover:bg-slate-800/40 transition">
            <td class="px-4 py-3 font-mono text-slate-300">\${c.fechaLegible}</td>
            <td class="px-4 py-3 font-medium text-white">\${c.emisorNombre}</td>
            <td class="px-4 py-3">
              <span class="text-slate-300 font-medium">\${tipoTexto}</span>
              <span class="block text-slate-500 font-mono text-[11px]">\${c.consecutivo}</span>
            </td>
            <td class="px-4 py-3 font-mono text-slate-400 text-[11px]" title="\${c.clave}">\${claveCorta}</td>
            <td class="px-4 py-3 font-mono font-semibold text-right text-white">\${c.moneda} \${Number(c.total).toLocaleString('es-CR', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
            <td class="px-4 py-3 text-center">
              <span class="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium uppercase \${estadoClase}">\${c.estadoHacienda}</span>
            </td>
            <td class="px-4 py-3 text-right whitespace-nowrap">
              <div class="inline-flex items-center gap-1.5">
                <button onclick="portalApp.verComprobante('\${c.clave}')" title="Ver" class="p-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white transition">
                  👁
                </button>
                <a href="/api/public/portal/comprobante/\${c.clave}/xml" target="_blank" title="XML" class="px-2 py-1 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white text-[11px] font-mono transition">
                  XML
                </a>
                <a href="/api/public/portal/comprobante/\${c.clave}/pdf" target="_blank" title="PDF" class="px-2 py-1 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white text-[11px] font-mono transition">
                  PDF
                </a>
              </div>
            </td>
          </tr>\`;
        }).join('');

        // Tarjetas Mobile
        cards.innerHTML = items.map(c => {
          const tipoTexto = TIPOS_DOC[c.tipoDocumento] || c.tipoDocumento;
          const estadoClase = c.estadoHacienda === 'aceptado'
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            : c.estadoHacienda === 'rechazado'
            ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
            : 'bg-amber-500/10 text-amber-400 border border-amber-500/20';

          return \`<div class="p-4 space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-white">\${c.emisorNombre}</span>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-medium uppercase \${estadoClase}">\${c.estadoHacienda}</span>
            </div>
            <div class="flex items-center justify-between text-xs">
              <span class="text-slate-300">\${tipoTexto}</span>
              <span class="font-mono font-bold text-white">\${c.moneda} \${Number(c.total).toLocaleString('es-CR', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
            </div>
            <div class="text-[11px] font-mono text-slate-500 flex justify-between">
              <span>\${c.fechaLegible}</span>
              <span>\${c.consecutivo}</span>
            </div>
            <div class="pt-2 flex items-center justify-end gap-2 border-t border-slate-800/60">
              <button onclick="portalApp.verComprobante('\${c.clave}')" class="px-3 py-1 rounded-lg border border-slate-700 text-xs text-slate-300 hover:text-white">Ver</button>
              <a href="/api/public/portal/comprobante/\${c.clave}/xml" class="px-3 py-1 rounded-lg border border-slate-700 text-xs text-slate-300 hover:text-white font-mono">XML</a>
              <a href="/api/public/portal/comprobante/\${c.clave}/pdf" class="px-3 py-1 rounded-lg border border-slate-700 text-xs text-slate-300 hover:text-white font-mono">PDF</a>
            </div>
          </div>\`;
        }).join('');
      },

      renderizarEstadisticas(items, total) {
        document.getElementById('statTotalDocs').innerText = total.toString();
        let crc = 0;
        let usd = 0;
        for (const it of items) {
          if (it.moneda === 'USD') usd += it.total;
          else crc += it.total;
        }
        document.getElementById('statTotalCrc').innerText = '₡ ' + crc.toLocaleString('es-CR', {minimumFractionDigits:2, maximumFractionDigits:2});
        document.getElementById('statTotalUsd').innerText = '$ ' + usd.toLocaleString('es-CR', {minimumFractionDigits:2, maximumFractionDigits:2});
      },

      renderizarPaginador(total, pagina, totalPaginas) {
        document.getElementById('paginacionInfo').innerText = \`Página \${pagina} de \${totalPaginas} (\${total} comprobantes)\`;
        const botonesEl = document.getElementById('paginacionBotones');
        if (totalPaginas <= 1) {
          botonesEl.innerHTML = '';
          return;
        }
        botonesEl.innerHTML = \`
          <button \${pagina <= 1 ? 'disabled' : ''} onclick="portalApp.cargarComprobantes(\${pagina - 1})" class="px-2.5 py-1 rounded-lg border border-slate-700 hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none">Anterior</button>
          <button \${pagina >= totalPaginas ? 'disabled' : ''} onclick="portalApp.cargarComprobantes(\${pagina + 1})" class="px-2.5 py-1 rounded-lg border border-slate-700 hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none">Siguiente</button>
        \`;
      },

      verComprobante(clave) {
        const modal = document.getElementById('modalVisualizador');
        const iframe = document.getElementById('modalIframe');
        document.getElementById('modalTitulo').innerText = 'Comprobante ' + clave;
        iframe.src = '/api/public/portal/comprobante/' + encodeURIComponent(clave);
        modal.classList.remove('hidden');
      },

      cerrarModal() {
        const modal = document.getElementById('modalVisualizador');
        const iframe = document.getElementById('modalIframe');
        iframe.src = 'about:blank';
        modal.classList.add('hidden');
      },

      aplicarFiltros(e) {
        e.preventDefault();
        this.cargarComprobantes(1);
      },

      limpiarFiltros() {
        document.getElementById('filtroDesde').value = '';
        document.getElementById('filtroHasta').value = '';
        document.getElementById('filtroTipo').value = '';
        document.getElementById('filtroEstado').value = '';
        this.cargarComprobantes(1);
      },

      cambiarCorreo() {
        this.mostrarVistaSolicitar();
      },

      reenviarOtp() {
        if (this.cooldownSeconds > 0) return;
        document.getElementById('inputEmail').value = this.email;
        this.solicitarOtp(new Event('submit'));
      },

      iniciarCooldown(segundos) {
        this.cooldownSeconds = segundos;
        const btn = document.getElementById('btnReenviar');
        if (this.cooldownTimer) clearInterval(this.cooldownTimer);

        btn.disabled = true;
        btn.classList.add('text-slate-600', 'cursor-not-allowed');

        this.cooldownTimer = setInterval(() => {
          this.cooldownSeconds--;
          if (this.cooldownSeconds <= 0) {
            clearInterval(this.cooldownTimer);
            btn.disabled = false;
            btn.classList.remove('text-slate-600', 'cursor-not-allowed');
            btn.innerText = 'Reenviar código';
          } else {
            btn.innerText = \`Reenviar en \${this.cooldownSeconds}s\`;
          }
        }, 1000);
      },

      async cerrarSesion() {
        try {
          await fetch('/api/public/portal/auth/logout', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json'
            }
          });
        } catch {}

        this.email = '';
        this.mostrarVistaSolicitar();
      }
    };

    document.addEventListener('DOMContentLoaded', () => portalApp.init());
  </script>
</body>
</html>`;
}
