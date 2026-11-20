import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

export type EstiloFacturaPreset =
  | 'ejecutivo'
  | 'corporativo'
  | 'noir'
  | 'minimalista'
  | 'moderno'
  | 'clasico-cr';

export type DisenoLayoutHeader = 'clasico' | 'centrado' | 'compacto' | 'banda-lateral';
export type DisenoEstiloTabla = 'moderno' | 'rayado' | 'cuadricula' | 'minimalista';
export type DisenoFuente = 'jakarta' | 'inter' | 'poppins' | 'playfair' | 'merriweather' | 'mono';
export type DisenoTamanoPapel = 'letter' | 'a4';

export interface DisenoFacturaConfig {
  plantillaBase?: EstiloFacturaPreset;
  layoutHeader?: DisenoLayoutHeader;
  estiloTabla?: DisenoEstiloTabla;

  colorPrimario?: string;
  colorAcento?: string;
  colorFondoHeader?: string;
  colorTextoHeader?: string;
  colorFondoTablaHead?: string;
  colorTextoTablaHead?: string;
  colorFondoTarjetas?: string;
  colorBorde?: string;

  fuente?: DisenoFuente;
  tamanoBasePx?: number;
  radioBordesPx?: number;
  mostrarFranjaSuperior?: boolean;
  grosorFranjaPx?: number;
  logoAltoPx?: number;
  logoAnchoMaxPx?: number;
  logoFondoBlanco?: boolean;
  tamanoPapel?: DisenoTamanoPapel;
  margenImpresionMm?: number;

  mostrarLogo?: boolean;
  mostrarRazonSocial?: boolean;
  mostrarActividadEconomica?: boolean;
  mostrarSucursalTerminal?: boolean;
  mostrarDireccionEmisor?: boolean;
  mostrarTelefonoCorreoEmisor?: boolean;
  mostrarCabys?: boolean;
  mostrarUnidadMedida?: boolean;
  mostrarNumeroLinea?: boolean;
  mostrarColumnaIVA?: boolean;
  mostrarQR?: boolean;
  mostrarClaveNumerica?: boolean;
  mostrarDetallesOperacion?: boolean;
  mostrarResolucionLegal?: boolean;
  mostrarFirmaRecibido?: boolean;
  mostrarMarcaAgua?: boolean;
  textoMarcaAgua?: string;

  tituloPersonalizado?: string;
  etiquetaCliente?: string;
  etiquetaOperacion?: string;
  etiquetaTotal?: string;
  tituloCuentasBancarias?: string;
  textoCuentasBancarias?: string;
  textoNotasFijas?: string;
  mensajePie?: string;
  textoResolucionLegal?: string;
}

export interface ConfiguracionSistema {
  emisor: {
    nombre: string;
    cedula: string;
    tipoIdentificacion: '01' | '02' | '03' | '04';
    nombreComercial: string;
    actividadEconomica: string;
    sucursal: string;
    terminal: string;
    correo: string;
    telefono: string;
    direccion: string;
  };
  sitio: {
    nombreSistema: string;
    subtitulo: string;
    moneda: string;
    simboloMoneda: string;
    logoBase64: string;
    colorPrimario: string;
    mensajePieTicket: string;
    estiloFactura?: EstiloFacturaPreset;
    disenoFactura?: DisenoFacturaConfig;
    tipoCambioDefault?: number;
  };
  hacienda: {
    entorno: 'staging' | 'produccion';
    usuario: string;
    password?: string;
    pin: string;
    enviarAHacienda?: boolean;
  };
  correo?: {
    proveedor?: 'hostinger' | 'gmail' | 'outlook' | 'custom';
    host: string;
    puerto: number;
    seguro: boolean;
    usuario: string;
    password?: string;
    nombreRemitente: string;
    copiaOculta?: string;
    asuntoTemplate?: string;
    mensajeTemplate?: string;
    envioAutomatico?: boolean;
    imapHost?: string;
    imapPuerto?: number;
    imapSeguro?: boolean;
    imapCarpeta?: string;
    imapAutoSync?: boolean;
    imapIntervaloMin?: number;
    imapDiasAtras?: number;
  };
}

export type SecuenciasPorTipo = Record<'01' | '02' | '03' | '04', number>;

export interface LineaGasto {
  numeroLinea: number;
  codigoCabys: string;
  detalle: string;
  cantidad: number;
  unidadMedida: string;
  precioUnitario: number;
  subTotal: number;
  tarifaIVA: number;
  montoIVA: number;
  montoTotalLinea: number;
}

export interface GastoRecibido {
  id: string;
  clave: string;
  consecutivo: string;
  tipoDocumento: string;
  tipoDocumentoNombre: string;
  fechaEmision: string;
  emisorNombre: string;
  emisorNombreComercial?: string;
  emisorCedula: string;
  emisorTipoId?: string;
  emisorCorreo?: string;
  receptorNombre?: string;
  receptorCedula?: string;
  moneda: 'CRC' | 'USD' | 'EUR';
  tipoCambio: number;
  subtotalGravado: number;
  subtotalExento: number;
  totalDescuentos: number;
  totalVentaNeta: number;
  totalImpuesto: number;
  totalComprobante: number;
  totalCRC: number;
  impuestoCRC: number;
  desgloseIVA: Record<string, number>;
  lineas: LineaGasto[];
  categoriaGasto: string;
  estadoConfirmacion: 'pendiente' | 'aceptado' | 'aceptado_parcial' | 'rechazado';
  notas?: string;
  origen: 'correo_imap' | 'carga_manual';
  correoUid?: number;
  correoAsunto?: string;
  correoRemitente?: string;
  correoFecha?: string;
  tieneXml: boolean;
  tienePdf: boolean;
  importadoEn: string;
}

export interface EstadoSyncGastos {
  ultimaSincronizacion?: string;
  ultimoResumen?: {
    revisados: number;
    candidatosConAdjuntos: number;
    importados: number;
    duplicados: number;
    omitidosPropios: number;
    omitidosOtroReceptor: number;
    errores: number;
  };
  ultimoError?: string;
}

interface GastosStoreData extends EstadoSyncGastos {
  items: GastoRecibido[];
}

export interface ComprobanteGuardado {
  clave: string;
  consecutivo: string;
  tipoDocumento: string;
  fecha: string | Date;
  moneda: string;
  total: number;
  cliente: string;
  estadoHacienda: string;
  estilo?: EstiloFacturaPreset;
  notas?: string;
  correoCliente?: string;
  correoEnviado?: boolean;
  correoEnviadoEn?: string;
  correoDestinatario?: string;
  correoError?: string;
  xmlFirmado: string;
  docOriginal: any;
}

interface ComprobantesStoreData {
  secuencia: number;
  secuencias?: Partial<Record<string, number>>;
  secuenciasIniciales?: Partial<Record<string, number>>;
  items: ComprobanteGuardado[];
}

export interface Producto {
  id: string;
  codigoInterno: string;
  codigoCabys: string;
  detalle: string;
  precioUnitario: number;
  moneda?: 'CRC' | 'USD';
  unidadMedida?: string;
  tarifaIVA: number;
  codigoTarifaIVA: string;
  categoria: string;
  stock: number;
}

export interface Cliente {
  id: string;
  nombre: string;
  nombreComercial?: string;
  tipoIdentificacion: '01' | '02' | '03' | '04';
  cedula: string;
  correo?: string;
  telefono?: string;
  direccion?: string;
  condicionVenta?: '01' | '02' | '03' | '04';
  plazoCredito?: number;
  monedaPreferida?: 'CRC' | 'USD';
  notas?: string;
  creadoEn?: string;
}

export class DataStore {
  private configPath = path.join(DATA_DIR, 'configuracion.json');
  private productosPath = path.join(DATA_DIR, 'productos.json');
  private categoriasPath = path.join(DATA_DIR, 'categorias.json');
  private clientesPath = path.join(DATA_DIR, 'clientes.json');
  private comprobantesPath = path.join(DATA_DIR, 'comprobantes.json');
  private gastosPath = path.join(DATA_DIR, 'gastos.json');
  private gastosArchivosDir = path.join(DATA_DIR, 'gastos_archivos');

  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(this.gastosArchivosDir)) {
      fs.mkdirSync(this.gastosArchivosDir, { recursive: true });
    }
  }

  private normalizeSecuencias(map?: Partial<Record<string, number>>, fallback01: number = 0): SecuenciasPorTipo {
    const val = (k: '01' | '02' | '03' | '04', def: number) => {
      const raw = map ? map[k] : undefined;
      return typeof raw === 'number' && !Number.isNaN(raw) && raw >= 0 ? Math.floor(raw) : def;
    };
    return {
      '01': val('01', fallback01),
      '02': val('02', 0),
      '03': val('03', 0),
      '04': val('04', 0)
    };
  }

  private readComprobantesStore(): ComprobantesStoreData & {
    secuencias: SecuenciasPorTipo;
    secuenciasIniciales: SecuenciasPorTipo;
  } {
    const emptySec = (): SecuenciasPorTipo => ({ '01': 0, '02': 0, '03': 0, '04': 0 });
    if (!fs.existsSync(this.comprobantesPath)) {
      return { secuencia: 0, secuencias: emptySec(), secuenciasIniciales: emptySec(), items: [] };
    }
    try {
      const raw = fs.readFileSync(this.comprobantesPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const secBase =
        typeof parsed.secuencia === 'number' && !Number.isNaN(parsed.secuencia) && parsed.secuencia >= 0
          ? Math.floor(parsed.secuencia)
          : 0;
      const secuencias = this.normalizeSecuencias(parsed.secuencias, secBase);
      const secuenciasIniciales = this.normalizeSecuencias(parsed.secuenciasIniciales, 0);
      return {
        secuencia: secuencias['01'],
        secuencias,
        secuenciasIniciales,
        items: Array.isArray(parsed.items) ? parsed.items : []
      };
    } catch {
      return { secuencia: 0, secuencias: emptySec(), secuenciasIniciales: emptySec(), items: [] };
    }
  }

  private writeComprobantesStore(data: ComprobantesStoreData): void {
    fs.writeFileSync(this.comprobantesPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  // CONFIGURACIÓN
  getConfig(): ConfiguracionSistema {
    if (!fs.existsSync(this.configPath)) return {} as any;
    const raw = fs.readFileSync(this.configPath, 'utf-8');
    return JSON.parse(raw);
  }

  saveConfig(data: Partial<ConfiguracionSistema>): ConfiguracionSistema {
    const actual = this.getConfig();
    const updated: ConfiguracionSistema = {
      emisor: { ...actual.emisor, ...(data.emisor || {}) },
      sitio: { ...actual.sitio, ...(data.sitio || {}) },
      hacienda: { ...actual.hacienda, ...(data.hacienda || {}) },
      correo: { ...(actual.correo || {}), ...(data.correo || {}) } as ConfiguracionSistema['correo']
    };
    fs.writeFileSync(this.configPath, JSON.stringify(updated, null, 2), 'utf-8');
    return updated;
  }

  // PRODUCTOS
  getProductos(): Producto[] {
    if (!fs.existsSync(this.productosPath)) return [];
    const list: Producto[] = JSON.parse(fs.readFileSync(this.productosPath, 'utf-8'));
    return list.map(p => ({
      ...p,
      moneda: p.moneda === 'USD' ? 'USD' : 'CRC',
      unidadMedida: p.unidadMedida || 'Unid'
    }));
  }

  saveProducto(prod: Partial<Producto>): Producto {
    const list = this.getProductos();
    const normalizado: Partial<Producto> = {
      ...prod,
      moneda: prod.moneda === 'USD' ? 'USD' : 'CRC',
      unidadMedida: prod.unidadMedida || 'Unid'
    };
    let result: Producto;
    if (normalizado.id) {
      const index = list.findIndex(p => p.id === normalizado.id);
      if (index !== -1) {
        list[index] = { ...list[index], ...normalizado } as Producto;
        result = list[index];
      } else {
        result = { ...normalizado, id: Date.now().toString() } as Producto;
        list.push(result);
      }
    } else {
      result = { ...normalizado, id: Date.now().toString() } as Producto;
      list.push(result);
    }
    fs.writeFileSync(this.productosPath, JSON.stringify(list, null, 2), 'utf-8');
    return result;
  }

  deleteProducto(id: string): boolean {
    const list = this.getProductos();
    const filtered = list.filter(p => p.id !== id);
    if (filtered.length !== list.length) {
      fs.writeFileSync(this.productosPath, JSON.stringify(filtered, null, 2), 'utf-8');
      return true;
    }
    return false;
  }

  // CATEGORIAS
  getCategorias(): string[] {
    if (!fs.existsSync(this.categoriasPath)) return [];
    return JSON.parse(fs.readFileSync(this.categoriasPath, 'utf-8'));
  }

  saveCategorias(cats: string[]): string[] {
    const cleaned = [...new Set(cats.map(c => c.trim()).filter(Boolean))];
    fs.writeFileSync(this.categoriasPath, JSON.stringify(cleaned, null, 2), 'utf-8');
    return cleaned;
  }

  // CLIENTES
  getClientes(): Cliente[] {
    if (!fs.existsSync(this.clientesPath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.clientesPath, 'utf-8'));
      if (!Array.isArray(parsed)) return [];
      const tiposValidos = ['01', '02', '03', '04'];
      const condsValidas = ['01', '02', '03', '04'];
      return parsed.map((c: any) => ({
        ...c,
        tipoIdentificacion: tiposValidos.includes(c.tipoIdentificacion) ? c.tipoIdentificacion : '01',
        condicionVenta: condsValidas.includes(c.condicionVenta) ? c.condicionVenta : '01',
        plazoCredito: Number(c.plazoCredito) || 30,
        monedaPreferida: c.monedaPreferida === 'USD' ? 'USD' : (c.monedaPreferida === 'CRC' ? 'CRC' : undefined)
      }));
    } catch {
      return [];
    }
  }

  saveCliente(cli: Partial<Cliente>): Cliente {
    const nombre = (cli.nombre || '').trim();
    if (!nombre) {
      throw new Error('El nombre o razón social del cliente es obligatorio.');
    }
    const cedula = String(cli.cedula || '').replace(/[\s-]+/g, '');
    if (!cedula) {
      throw new Error('El número de cédula o identificación es obligatorio.');
    }

    const tiposValidos = ['01', '02', '03', '04'] as const;
    const condsValidas = ['01', '02', '03', '04'] as const;
    const tipoIdentificacion = tiposValidos.includes(cli.tipoIdentificacion as any)
      ? (cli.tipoIdentificacion as Cliente['tipoIdentificacion'])
      : '01';
    const condicionVenta = condsValidas.includes(cli.condicionVenta as any)
      ? (cli.condicionVenta as Cliente['condicionVenta'])
      : '01';
    const monedaPreferida: 'CRC' | 'USD' | undefined =
      cli.monedaPreferida === 'USD' ? 'USD' : (cli.monedaPreferida === 'CRC' ? 'CRC' : undefined);

    const optText = (val?: string) => {
      const trimmed = (val || '').trim();
      return trimmed ? trimmed : undefined;
    };

    const datosNormalizados: Omit<Cliente, 'id' | 'creadoEn'> = {
      nombre,
      nombreComercial: optText(cli.nombreComercial),
      tipoIdentificacion,
      cedula,
      correo: optText(cli.correo),
      telefono: optText(cli.telefono),
      direccion: optText(cli.direccion),
      condicionVenta,
      plazoCredito: Number(cli.plazoCredito) || 30,
      monedaPreferida,
      notas: optText(cli.notas)
    };

    const list = this.getClientes();
    let result: Cliente;
    if (cli.id) {
      const index = list.findIndex(c => c.id === cli.id);
      if (index !== -1) {
        result = {
          ...datosNormalizados,
          id: list[index].id,
          creadoEn: list[index].creadoEn || new Date().toISOString()
        };
        list[index] = result;
      } else {
        result = {
          ...datosNormalizados,
          id: 'CLI-' + Date.now().toString(),
          creadoEn: new Date().toISOString()
        };
        list.push(result);
      }
    } else {
      result = {
        ...datosNormalizados,
        id: 'CLI-' + Date.now().toString(),
        creadoEn: new Date().toISOString()
      };
      list.push(result);
    }

    fs.writeFileSync(this.clientesPath, JSON.stringify(list, null, 2), 'utf-8');
    return result;
  }

  deleteCliente(id: string): boolean {
    const list = this.getClientes();
    const filtered = list.filter(c => c.id !== id);
    if (filtered.length !== list.length) {
      fs.writeFileSync(this.clientesPath, JSON.stringify(filtered, null, 2), 'utf-8');
      return true;
    }
    return false;
  }

  // COMPROBANTES & SECUENCIADOR
  getComprobantes(): ComprobanteGuardado[] {
    return this.readComprobantesStore().items;
  }

  getComprobanteByClave(clave: string): ComprobanteGuardado | undefined {
    return this.readComprobantesStore().items.find(c => c.clave === clave);
  }

  getSecuenciaActual(tipoDocumento: '01' | '02' | '03' | '04' = '01'): number {
    return this.readComprobantesStore().secuencias[tipoDocumento];
  }

  getSecuencias(): { ultimos: SecuenciasPorTipo; proximos: SecuenciasPorTipo } {
    const { secuencias } = this.readComprobantesStore();
    return {
      ultimos: { ...secuencias },
      proximos: {
        '01': secuencias['01'] + 1,
        '02': secuencias['02'] + 1,
        '03': secuencias['03'] + 1,
        '04': secuencias['04'] + 1
      }
    };
  }

  setProximosConsecutivos(proximos: Partial<Record<'01' | '02' | '03' | '04', number>>): {
    ultimos: SecuenciasPorTipo;
    proximos: SecuenciasPorTipo;
  } {
    const store = this.readComprobantesStore();
    const tipos: Array<'01' | '02' | '03' | '04'> = ['01', '02', '03', '04'];

    for (const k of tipos) {
      if (proximos[k] !== undefined) {
        const val = Number(proximos[k]);
        if (!Number.isInteger(val) || val < 1 || val > 9999999999) {
          throw new Error(`El próximo consecutivo para tipo ${k} debe ser un entero entre 1 y 9999999999.`);
        }
        store.secuencias[k] = val - 1;
        store.secuenciasIniciales[k] = val - 1;
      }
    }

    store.secuencia = store.secuencias['01'];
    this.writeComprobantesStore(store);
    return this.getSecuencias();
  }

  getNextSecuencia(tipoDocumento: string = '01'): number {
    const store = this.readComprobantesStore();
    const key: '01' | '02' | '03' | '04' =
      tipoDocumento === '02' || tipoDocumento === '03' || tipoDocumento === '04' ? tipoDocumento : '01';
    store.secuencias[key] = (store.secuencias[key] || 0) + 1;
    store.secuencia = store.secuencias['01'];
    this.writeComprobantesStore(store);
    return store.secuencias[key];
  }

  saveComprobante(registro: ComprobanteGuardado): void {
    const store = this.readComprobantesStore();
    store.items.unshift(registro);
    this.writeComprobantesStore(store);
  }

  updateComprobanteCorreo(
    clave: string,
    info: {
      correoEnviado?: boolean;
      correoEnviadoEn?: string;
      correoDestinatario?: string;
      correoError?: string;
    }
  ): ComprobanteGuardado | undefined {
    const store = this.readComprobantesStore();
    const index = store.items.findIndex(c => c.clave === clave);
    if (index === -1) return undefined;
    store.items[index] = {
      ...store.items[index],
      ...info
    };
    this.writeComprobantesStore(store);
    return store.items[index];
  }

  deleteComprobante(clave: string): { deleted: boolean; reason?: string } {
    const store = this.readComprobantesStore();
    const item = store.items.find(c => c.clave === clave);
    if (!item) {
      return { deleted: false, reason: 'Comprobante no encontrado.' };
    }
    if (item.estadoHacienda !== 'firmado_local') {
      return {
        deleted: false,
        reason: 'Solo se pueden eliminar comprobantes de prueba local (no enviados a Hacienda).'
      };
    }
    store.items = store.items.filter(c => c.clave !== clave);
    this.writeComprobantesStore(store);
    return { deleted: true };
  }

  clearPruebasLocales(resetSecuencia?: number, restaurarBase: boolean = true): { removed: number; secuencia: number; secuencias: SecuenciasPorTipo } {
    const store = this.readComprobantesStore();
    const cantidadAnterior = store.items.length;
    store.items = store.items.filter(c => c.estadoHacienda !== 'firmado_local');
    const removed = cantidadAnterior - store.items.length;

    if (typeof resetSecuencia === 'number' && !Number.isNaN(resetSecuencia) && resetSecuencia >= 0) {
      const n = Math.floor(resetSecuencia);
      store.secuencias['01'] = n;
      store.secuencia = n;
    } else if (restaurarBase) {
      store.secuencias = { ...store.secuenciasIniciales };
      store.secuencia = store.secuencias['01'];
    }

    this.writeComprobantesStore(store);
    return { removed, secuencia: store.secuencia, secuencias: store.secuencias };
  }

  // CONTROL DE GASTOS (FACTURAS RECIBIDAS)
  private readGastosStore(): GastosStoreData {
    if (!fs.existsSync(this.gastosPath)) {
      return { items: [] };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.gastosPath, 'utf-8'));
      return {
        ultimaSincronizacion: parsed.ultimaSincronizacion,
        ultimoResumen: parsed.ultimoResumen,
        ultimoError: parsed.ultimoError,
        items: Array.isArray(parsed.items) ? parsed.items : []
      };
    } catch {
      return { items: [] };
    }
  }

  private writeGastosStore(data: GastosStoreData): void {
    fs.writeFileSync(this.gastosPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private ensureGastosArchivosDir(): void {
    if (!fs.existsSync(this.gastosArchivosDir)) {
      fs.mkdirSync(this.gastosArchivosDir, { recursive: true });
    }
  }

  getGastosStore(): GastosStoreData {
    const store = this.readGastosStore();
    store.items.sort((a, b) => new Date(b.fechaEmision).getTime() - new Date(a.fechaEmision).getTime());
    return store;
  }

  getGastos(): GastoRecibido[] {
    return this.getGastosStore().items;
  }

  getGastoByClave(clave: string): GastoRecibido | undefined {
    return this.readGastosStore().items.find(g => g.clave === clave);
  }

  saveGasto(
    gasto: GastoRecibido,
    xmlContent?: string,
    pdfBuffer?: Buffer
  ): { saved: boolean; duplicado: boolean; item: GastoRecibido } {
    this.ensureGastosArchivosDir();
    const safeClave = String(gasto.clave || '').replace(/[^A-Za-z0-9_-]/g, '');
    if (!safeClave) {
      throw new Error('Clave inválida para guardar el gasto.');
    }

    const store = this.readGastosStore();
    const existente = store.items.find(g => g.clave === gasto.clave);
    if (existente) {
      let changed = false;
      if (!existente.tienePdf && pdfBuffer && pdfBuffer.length > 0) {
        fs.writeFileSync(path.join(this.gastosArchivosDir, `${safeClave}.pdf`), pdfBuffer);
        existente.tienePdf = true;
        changed = true;
      }
      if (!existente.tieneXml && xmlContent) {
        fs.writeFileSync(path.join(this.gastosArchivosDir, `${safeClave}.xml`), xmlContent, 'utf-8');
        existente.tieneXml = true;
        changed = true;
      }
      if (changed) {
        this.writeGastosStore(store);
      }
      return { saved: false, duplicado: true, item: existente };
    }

    let tieneXml = false;
    let tienePdf = false;
    if (xmlContent) {
      fs.writeFileSync(path.join(this.gastosArchivosDir, `${safeClave}.xml`), xmlContent, 'utf-8');
      tieneXml = true;
    }
    if (pdfBuffer && pdfBuffer.length > 0) {
      fs.writeFileSync(path.join(this.gastosArchivosDir, `${safeClave}.pdf`), pdfBuffer);
      tienePdf = true;
    }

    const item: GastoRecibido = {
      ...gasto,
      id: gasto.clave,
      tieneXml,
      tienePdf
    };

    store.items.push(item);
    store.items.sort((a, b) => new Date(b.fechaEmision).getTime() - new Date(a.fechaEmision).getTime());
    this.writeGastosStore(store);
    return { saved: true, duplicado: false, item };
  }

  updateGasto(
    clave: string,
    patch: Partial<Pick<GastoRecibido, 'categoriaGasto' | 'estadoConfirmacion' | 'notas'>>
  ): GastoRecibido | undefined {
    const store = this.readGastosStore();
    const index = store.items.findIndex(g => g.clave === clave);
    if (index === -1) return undefined;

    const current = store.items[index];
    const estadosValidos = ['pendiente', 'aceptado', 'aceptado_parcial', 'rechazado'];
    store.items[index] = {
      ...current,
      categoriaGasto: patch.categoriaGasto !== undefined ? String(patch.categoriaGasto).trim() || current.categoriaGasto : current.categoriaGasto,
      estadoConfirmacion:
        patch.estadoConfirmacion && estadosValidos.includes(patch.estadoConfirmacion)
          ? patch.estadoConfirmacion
          : current.estadoConfirmacion,
      notas: patch.notas !== undefined ? (String(patch.notas).trim() || undefined) : current.notas
    };
    this.writeGastosStore(store);
    return store.items[index];
  }

  deleteGasto(clave: string): boolean {
    const store = this.readGastosStore();
    const filtered = store.items.filter(g => g.clave !== clave);
    if (filtered.length === store.items.length) return false;

    store.items = filtered;
    this.writeGastosStore(store);

    if (/^[A-Za-z0-9_-]+$/.test(clave)) {
      for (const ext of ['xml', 'pdf']) {
        const fp = path.join(this.gastosArchivosDir, `${clave}.${ext}`);
        if (fs.existsSync(fp)) {
          try {
            fs.unlinkSync(fp);
          } catch {}
        }
      }
    }
    return true;
  }

  getGastoArchivoPath(clave: string, ext: 'xml' | 'pdf'): string | null {
    if (!/^[A-Za-z0-9_-]+$/.test(clave)) return null;
    const fp = path.join(this.gastosArchivosDir, `${clave}.${ext}`);
    return fs.existsSync(fp) ? fp : null;
  }

  saveEstadoSyncGastos(estado: EstadoSyncGastos): void {
    const store = this.readGastosStore();
    store.ultimaSincronizacion = estado.ultimaSincronizacion;
    store.ultimoResumen = estado.ultimoResumen;
    store.ultimoError = estado.ultimoError;
    this.writeGastosStore(store);
  }
}

export const dataStore = new DataStore();
