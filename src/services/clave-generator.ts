import { TipoDocumento, SituacionEnvio } from '../types/factura.types.js';
import { getFechaPartesCR } from '../utils/cr-date.js';

/**
 * Genera el número consecutivo de 20 dígitos según la normativa DGT:
 * - 3 dígitos: Casa Matriz / Sucursal (relleno con ceros a la izquierda)
 * - 5 dígitos: Punto de venta / Terminal (relleno con ceros a la izquierda)
 * - 2 dígitos: Tipo de comprobante (01=FE, 02=ND, 03=NC, 04=TE, 05=FEE, 06=FEC)
 * - 10 dígitos: Número secuencial del comprobante
 */
export function generarConsecutivo(
  sucursal: number,
  terminal: number,
  tipoDoc: TipoDocumento,
  secuencia: number
): string {
  const sucursalStr = sucursal.toString().padStart(3, '0');
  const terminalStr = terminal.toString().padStart(5, '0');
  const secuenciaStr = secuencia.toString().padStart(10, '0');

  const consecutivo = `${sucursalStr}${terminalStr}${tipoDoc}${secuenciaStr}`;
  if (consecutivo.length !== 20) {
    throw new Error(`El consecutivo debe tener exactamente 20 dígitos. Generado: ${consecutivo}`);
  }
  return consecutivo;
}

/**
 * Genera un código de seguridad numérico aleatorio de 8 dígitos
 */
export function generarCodigoSeguridad(): string {
  const random = Math.floor(10000000 + Math.random() * 90000000);
  return random.toString();
}

/**
 * Genera la clave numérica de 50 dígitos según la especificación de Hacienda Costa Rica:
 * - 3 dígitos: Código de país ("506")
 * - 2 dígitos: Día de emisión (DD)
 * - 2 dígitos: Mes de emisión (MM)
 * - 2 dígitos: Año de emisión (YY)
 * - 12 dígitos: Número de identificación del emisor (relleno con ceros a la izquierda)
 * - 20 dígitos: Número de consecutivo
 * - 1 dígito: Situación del comprobante (1=Normal, 2=Contingencia, 3=Sin internet)
 * - 8 dígitos: Código de seguridad
 */
export function generarClave(params: {
  fecha: Date;
  cedulaEmisor: string;
  consecutivo: string;
  situacion?: SituacionEnvio;
  codigoSeguridad?: string;
}): string {
  if (!(params.fecha instanceof Date) || Number.isNaN(params.fecha.getTime())) {
    throw new Error('La fecha proporcionada para la generación de la clave numérica es inválida.');
  }

  const codigoPais = '506';

  const partes = getFechaPartesCR(params.fecha);
  const dia = partes.dia;
  const mes = partes.mes;
  const anio = partes.anio;

  // Limpiar cédula y rellenar a 12 dígitos
  const cedulaLimpia = params.cedulaEmisor.replace(/\D/g, '').padStart(12, '0');

  if (params.consecutivo.length !== 20) {
    throw new Error('El consecutivo proporcionado debe tener exactamente 20 caracteres.');
  }

  const situacion = params.situacion || '1';
  const codigoSeguridad = (params.codigoSeguridad || generarCodigoSeguridad()).padStart(8, '0');

  const clave = `${codigoPais}${dia}${mes}${anio}${cedulaLimpia}${params.consecutivo}${situacion}${codigoSeguridad}`;

  if (clave.length !== 50) {
    throw new Error(`La clave numérica debe tener exactamente 50 dígitos. Generada: ${clave} (largo: ${clave.length})`);
  }

  return clave;
}
