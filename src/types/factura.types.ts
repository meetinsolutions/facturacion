/**
 * Tipos de identificación según DGT Costa Rica:
 * 01 - Cédula Física (9 dígitos)
 * 02 - Cédula Jurídica (10 dígitos)
 * 03 - DIMEX (11 o 12 dígitos)
 * 04 - NITE (10 dígitos)
 */
export type TipoIdentificacion = '01' | '02' | '03' | '04';

/**
 * Tipos de Comprobante Electrónico:
 * 01 - Factura Electrónica (FE)
 * 02 - Nota de Débito (ND)
 * 03 - Nota de Crédito (NC)
 * 04 - Tiquete Electrónico (TE)
 * 05 - Factura Electrónica de Exportación (FEE)
 * 06 - Factura Electrónica de Compra (FEC)
 */
export type TipoDocumento = '01' | '02' | '03' | '04' | '05' | '06';

/**
 * Situación del comprobante:
 * 1 - Normal
 * 2 - Contingencia (sin sistema)
 * 3 - Sin internet
 */
export type SituacionEnvio = '1' | '2' | '3';

/**
 * Condición de la venta:
 * 01 - Contado
 * 02 - Crédito
 * 03 - Consignación
 * 04 - Apartado
 * 05 - Arrendamiento con opción de compra
 * 06 - Arrendamiento en función financiera
 * 99 - Otros
 */
export type CondicionVenta = '01' | '02' | '03' | '04' | '05' | '06' | '99';

/**
 * Métodos de Pago:
 * 01 - Efectivo
 * 02 - Tarjeta
 * 03 - Cheque
 * 04 - Transferencia / Depósito
 * 05 - Recaudado por terceros
 * 99 - Otros (SINPE Móvil, etc.)
 */
export type MedioPago = '01' | '02' | '03' | '04' | '05' | '99';

/**
 * Códigos de Impuesto IVA:
 * 01 - Tarifa 0% (Exento)
 * 02 - Tarifa reducida 1%
 * 03 - Tarifa reducida 2%
 * 04 - Tarifa reducida 4%
 * 07 - Tarifa reducida 8%
 * 08 - Tarifa general 13%
 */
export type TarifaIVA = '01' | '02' | '03' | '04' | '07' | '08';

export interface Ubicacion {
  provincia: string;   // 1 dígito (1-7)
  canton: string;      // 2 dígitos
  distrito: string;    // 2 dígitos
  barrio?: string;     // 2 dígitos
  senas: string;       // Dirección exacta
}

export interface Telefono {
  codigoPais: string;  // e.g. "506"
  numero: string;      // e.g. "88888888"
}

export interface EmisorConfig {
  nombre: string;
  identificacion: {
    tipo: TipoIdentificacion;
    numero: string;    // Sin guiones ni espacios
  };
  nombreComercial?: string;
  ubicacion: Ubicacion;
  telefono?: Telefono;
  correo: string;
  actividadEconomica: string; // Código de actividad DGT (6 dígitos)
  sucursal: number;           // Casa Matriz o Sucursal (3 dígitos, e.g. 1)
  terminal: number;           // Punto de venta / Caja (5 dígitos, e.g. 1)
  // Credenciales y Seguridad
  certificadoPath?: string;   // Ruta al archivo .p12
  certificadoPin?: string;    // PIN del certificado
  usuarioHacienda?: string;   // Usuario generado en ATV
  passwordHacienda?: string;  // Contraseña generada en ATV
  entorno: 'staging' | 'produccion';
}

export interface ReceptorCliente {
  nombre: string;
  identificacion?: {
    tipo: TipoIdentificacion;
    numero: string;
  };
  nombreComercial?: string;
  ubicacion?: Ubicacion;
  telefono?: Telefono;
  correo?: string;
}

export interface LineaDetalleVenta {
  numeroLinea: number;
  codigoCabys: string;         // Código CAByS obligatorio de 13 dígitos
  codigoInterno?: string;      // Código del producto / SKU
  cantidad: number;
  unidadMedida: string;        // e.g. "Unid", "Sp" (Servicios profesionales), "kg"
  detalle: string;             // Descripción del bien o servicio
  precioUnitario: number;
  montoTotal: number;          // cantidad * precioUnitario
  montoDescuento?: number;
  naturalezaDescuento?: string;
  subTotal: number;            // montoTotal - montoDescuento
  // Impuestos
  codigoImpuesto?: '01';       // 01 = IVA
  codigoTarifaIVA?: TarifaIVA;
  tarifaIVA?: number;          // e.g. 13, 8, 4, 2, 1, 0
  montoIVA?: number;
  // Exoneración (si aplica)
  exoneracion?: {
    tipoDocumento: string;     // 01 = Compras autorizadas, etc.
    numeroDocumento: string;
    nombreInstitucion: string;
    fechaEmision: string;
    porcentajeExoneracion: number;
    montoExoneracion: number;
  };
  montoTotalLinea: number;      // subTotal + montoIVA - exoneracion
}

export interface ResumenFactura {
  codigoMoneda: 'CRC' | 'USD' | 'EUR';
  tipoCambio?: number;         // Obligatorio si es USD u otra moneda
  totalServiciosGravados: number;
  totalServiciosExentos: number;
  totalMercanciasGravadas: number;
  totalMercanciasExentas: number;
  totalGravado: number;
  totalExento: number;
  totalVenta: number;
  totalDescuentos: number;
  totalVentaNeta: number;
  totalImpuesto: number;
  totalComprobante: number;
}

export interface ComprobanteElectronico {
  clave?: string;              // 50 dígitos
  consecutivo?: string;        // 20 dígitos
  fechaEmision: Date;
  tipoDocumento: TipoDocumento;
  condicionVenta: CondicionVenta;
  plazoCredito?: string;
  mediosPago: MedioPago[];
  emisor: EmisorConfig;
  receptor?: ReceptorCliente;
  lineas: LineaDetalleVenta[];
  resumen: ResumenFactura;
  // Referencias para Notas de Crédito / Débito
  informacionReferencia?: {
    tipoDoc: TipoDocumento;
    numero: string;            // Clave del comprobante de referencia
    fechaEmision: Date;
    codigo: '01' | '02' | '03' | '04' | '05' | '99'; // Anula, Corrige texto, Corrige monto, etc.
    razon: string;
  };
}
