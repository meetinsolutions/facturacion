import axios from 'axios';

export interface CabysItem {
  codigo: string;
  descripcion: string;
  impuesto: number;
  categorias?: string[];
}

export interface CabysValidationResult {
  formatoValido: boolean;
  existeEnCatalogo?: boolean;
  item?: CabysItem;
  advertencia?: string;
  error?: string;
}

// Caché en memoria para evitar llamadas redundantes a la API oficial
const cabysCache = new Map<string, CabysItem | null>();

/**
 * Valida la estructura sintáctica de un código CAByS según la normativa DGT.
 * REGLA DGT: Debe ser una cadena de exactamente 13 caracteres numéricos.
 * 
 * NOTA CRÍTICA: La validez de formato (13 dígitos) NO garantiza que el código
 * exista en el catálogo oficial del BCCR ni que esté activo para facturación.
 */
export function validarFormatoCabys(codigo: string): { valido: boolean; error?: string } {
  if (!codigo || typeof codigo !== 'string') {
    return { valido: false, error: 'El código CAByS es obligatorio y debe ser una cadena.' };
  }
  const limpio = codigo.trim();
  if (!/^\d{13}$/.test(limpio)) {
    return {
      valido: false,
      error: `El código CAByS "${codigo}" es inválido. Debe contener exactamente 13 dígitos numéricos.`
    };
  }
  return { valido: true };
}

/**
 * Consulta y valida la existencia de un código CAByS contra la API oficial del Ministerio de Hacienda / BCCR.
 * Endpoint oficial: https://api.hacienda.go.cr/fe/cabys?codigo={codigo}
 */
export async function validarCabysEnCatalogoOficial(codigo: string, timeoutMs = 4000): Promise<CabysValidationResult> {
  const formato = validarFormatoCabys(codigo);
  if (!formato.valido) {
    return {
      formatoValido: false,
      existeEnCatalogo: false,
      error: formato.error
    };
  }

  const cod = codigo.trim();

  // Verificar caché en memoria
  if (cabysCache.has(cod)) {
    const cached = cabysCache.get(cod);
    if (cached) {
      return {
        formatoValido: true,
        existeEnCatalogo: true,
        item: cached
      };
    } else {
      return {
        formatoValido: true,
        existeEnCatalogo: false,
        error: `El código CAByS ${cod} tiene 13 dígitos pero NO existe en el catálogo oficial DGT/BCCR.`
      };
    }
  }

  try {
    const resp = await axios.get<any[]>(`https://api.hacienda.go.cr/fe/cabys?codigo=${cod}`, {
      timeout: timeoutMs,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'MeetinFact/1.0 (Costa Rica Compliance Engine)'
      }
    });

    if (Array.isArray(resp.data) && resp.data.length > 0) {
      const match = resp.data.find(c => c.codigo === cod) || resp.data[0];
      const item: CabysItem = {
        codigo: match.codigo,
        descripcion: match.descripcion,
        impuesto: typeof match.impuesto === 'number' ? match.impuesto : 13,
        categorias: match.categorias
      };
      cabysCache.set(cod, item);
      return {
        formatoValido: true,
        existeEnCatalogo: true,
        item
      };
    } else {
      cabysCache.set(cod, null);
      return {
        formatoValido: true,
        existeEnCatalogo: false,
        advertencia: 'Código sintácticamente válido (13 dígitos) pero inexistente en el catálogo oficial.',
        error: `El código CAByS ${cod} no fue encontrado en el catálogo oficial de Hacienda/BCCR.`
      };
    }
  } catch (err: any) {
    // Si la API pública no está disponible o da timeout, no bloquear la emisión si el formato es correcto,
    // pero registrar la advertencia para trazabilidad y auditoría.
    return {
      formatoValido: true,
      existeEnCatalogo: undefined,
      advertencia: `No fue posible conectar con el catálogo oficial CAByS (${err.message}). Se validó únicamente estructura sintáctica.`
    };
  }
}

/**
 * Busca productos o servicios en el catálogo oficial CAByS por descripción o código parcial.
 */
export async function buscarCabysOficial(termino: string, timeoutMs = 4000): Promise<CabysItem[]> {
  if (!termino || termino.trim().length < 2) {
    return [];
  }

  try {
    const resp = await axios.get<{ cabys?: any[] }>(`https://api.hacienda.go.cr/fe/cabys?q=${encodeURIComponent(termino.trim())}`, {
      timeout: timeoutMs,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'MeetinFact/1.0 (Costa Rica Compliance Engine)'
      }
    });

    if (resp.data && Array.isArray(resp.data.cabys)) {
      return resp.data.cabys.map(c => ({
        codigo: c.codigo,
        descripcion: c.descripcion,
        impuesto: typeof c.impuesto === 'number' ? c.impuesto : 13,
        categorias: c.categorias
      }));
    }
    return [];
  } catch {
    return [];
  }
}
