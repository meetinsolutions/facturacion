/**
 * MEETINFACT — UTILITARIO CENTRALIZADO DE TIEMPO Y ZONA HORARIA
 * Zona de negocio oficial: America/Costa_Rica (UTC−06:00)
 */

export const TIMEZONE_CR = 'America/Costa_Rica';

export interface FechaPartesCR {
  dia: string;           // '01' - '31'
  mes: string;           // '01' - '12'
  anio: string;          // '26' (2 dígitos para clave tributaria)
  anioCompleto: string;  // '2026' (4 dígitos)
  hora: string;          // '00' - '23' (hourCycle h23)
  minuto: string;        // '00' - '59'
  segundo: string;       // '00' - '59'
}

/**
 * Obtiene los componentes de fecha y hora en la zona oficial de Costa Rica
 * mediante Intl.DateTimeFormat y formatToParts(), recuperando valores por su propiedad `type`.
 */
export function getFechaPartesCR(date: Date = new Date()): FechaPartesCR {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE_CR,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

  const parts = formatter.formatToParts(d);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      partMap[p.type] = p.value;
    }
  }

  const anioCompleto = partMap['year'] || '1970';
  const anio = anioCompleto.slice(-2);
  const mes = (partMap['month'] || '01').padStart(2, '0');
  const dia = (partMap['day'] || '01').padStart(2, '0');
  const hora = (partMap['hour'] || '00').padStart(2, '0');
  const minuto = (partMap['minute'] || '00').padStart(2, '0');
  const segundo = (partMap['second'] || '00').padStart(2, '0');

  return {
    dia,
    mes,
    anio,
    anioCompleto,
    hora,
    minuto,
    segundo
  };
}

/**
 * Formatea una fecha a formato estándar ISO 8601 con desplazamiento oficial de Costa Rica (-06:00).
 * Requerido por la estructura XML v4.3 del Ministerio de Hacienda.
 * Ejemplo: 2026-11-21T18:14:53-06:00
 */
export function formatoFechaIsoCR(date: Date = new Date()): string {
  const p = getFechaPartesCR(date);
  return `${p.anioCompleto}-${p.mes}-${p.dia}T${p.hora}:${p.minuto}:${p.segundo}-06:00`;
}

/**
 * Formatea una fecha u hora para su presentación en HTML, PDF o correos electrónicos
 * siempre en la zona horaria de Costa Rica.
 */
export function formatoFechaLegibleCR(
  date: Date | string | null | undefined,
  options?: {
    incluirHora?: boolean;
    formatoLargo?: boolean;
    formatoCorto?: boolean;
    soloFecha?: boolean;
  }
): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';

  const incluirHora = options?.soloFecha ? false : (options?.incluirHora !== false);
  const formatoLargo = Boolean(options?.formatoLargo);
  const formatoCorto = Boolean(options?.formatoCorto);

  if (formatoCorto) {
    return new Intl.DateTimeFormat('es-CR', {
      timeZone: TIMEZONE_CR,
      dateStyle: 'short',
      timeStyle: incluirHora ? 'short' : undefined
    }).format(d);
  }

  return new Intl.DateTimeFormat('es-CR', {
    timeZone: TIMEZONE_CR,
    dateStyle: formatoLargo ? 'long' : 'medium',
    timeStyle: incluirHora ? 'short' : undefined
  }).format(d);
}

/**
 * Determina el período fiscal mensual 'YYYY-MM' correspondiente a un instante en Costa Rica.
 */
export function getMesFiscalCR(date: Date | string = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const p = getFechaPartesCR(d);
  return `${p.anioCompleto}-${p.mes}`;
}

/**
 * Convierte un mes fiscal 'YYYY-MM' en un rango cerrado-abierto [inicioUtc, finUtc)
 * que delimita exactamente dicho mes en la hora oficial de Costa Rica (UTC-06:00).
 * 
 * Ejemplo: '2026-11'
 * - Inicio en CR: 2026-11-01 00:00:00 CR  =>  2026-11-01 06:00:00 UTC
 * - Fin en CR:    2026-12-01 00:00:00 CR  =>  2026-12-01 06:00:00 UTC
 */
export function getRangoUtcMesFiscalCR(mesFiscal: string): { inicioUtc: Date; finUtc: Date } {
  const regex = /^(\d{4})-(\d{2})$/;
  const match = mesFiscal.match(regex);
  if (!match) {
    throw new Error(`Formato de mes fiscal inválido: "${mesFiscal}". Debe ser YYYY-MM.`);
  }

  const anio = parseInt(match[1], 10);
  const mes = parseInt(match[2], 10);

  if (mes < 1 || mes > 12) {
    throw new Error(`Mes fiscal fuera de rango (1-12): "${mesFiscal}".`);
  }

  const inicioIso = `${match[1]}-${match[2]}-01T06:00:00.000Z`;
  const inicioUtc = new Date(inicioIso);

  // Calcular el primer día del mes siguiente
  let sigAnio = anio;
  let sigMes = mes + 1;
  if (sigMes > 12) {
    sigMes = 1;
    sigAnio += 1;
  }
  const sigMesStr = String(sigMes).padStart(2, '0');
  const finIso = `${sigAnio}-${sigMesStr}-01T06:00:00.000Z`;
  const finUtc = new Date(finIso);

  return { inicioUtc, finUtc };
}

/**
 * Convierte una fecha específica 'YYYY-MM-DD' en un rango cerrado-abierto [inicioUtc, finUtc)
 * correspondiente al día completo en Costa Rica.
 */
export function getRangoUtcDiaCR(fechaStr: string): { inicioUtc: Date; finUtc: Date } {
  const regex = /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = fechaStr.match(regex);
  if (!match) {
    throw new Error(`Formato de fecha inválido: "${fechaStr}". Debe ser YYYY-MM-DD.`);
  }

  const anio = parseInt(match[1], 10);
  const mes = parseInt(match[2], 10);
  const dia = parseInt(match[3], 10);

  const inicioUtc = new Date(`${match[1]}-${match[2]}-${match[3]}T06:00:00.000Z`);

  // Calcular día siguiente sumando 24 horas exactas en UTC
  const finUtc = new Date(inicioUtc.getTime() + 24 * 3600 * 1000);

  return { inicioUtc, finUtc };
}
