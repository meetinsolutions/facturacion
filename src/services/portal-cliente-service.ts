/**
 * MEETINFACT — PORTAL DE COMPROBANTES: INCREMENTO 2
 * Servicio de autenticación OTP, sesiones temporales seguras y consulta de historial para clientes
 */
import crypto from 'crypto';
import { Pool } from 'pg';
import { pool } from '../db/pool.js';
import { ComprobanteGuardado } from './data-store.js';
import { formatoFechaLegibleCR, getRangoUtcDiaCR } from '../utils/cr-date.js';

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const OTP_EXPIRACION_MINUTOS = 10;
const OTP_MAX_INTENTOS = 3;
const OTP_COOLDOWN_SEGUNDOS = 60;
const OTP_MAX_SOLICITUDES_VENTANA = 3;
const VENTANA_RATE_LIMIT_MINUTOS = 15;
const SESION_EXPIRACION_HORAS = 2;

// Almacén en memoria exclusivo para pruebas automatizadas en QA
// NUNCA expone códigos a logs ni al cliente HTTP
const _qaOtpTestingStore = new Map<string, string>();

export function getUltimoOtpParaPruebasQA(email: string): string | undefined {
  return _qaOtpTestingStore.get(email.trim().toLowerCase());
}

export function limpiarAlmacenPruebasQA(): void {
  _qaOtpTestingStore.clear();
}

export interface ComprobanteClienteItem {
  tenantId: string;
  emisorNombre: string;
  emisorCedula: string;
  clave: string;
  consecutivo: string;
  tipoDocumento: string;
  fecha: Date;
  fechaLegible: string;
  moneda: string;
  total: number;
  cliente: string;
  estadoHacienda: string;
}

export interface FiltrosHistorialCliente {
  fechaDesde?: string;
  fechaHasta?: string;
  estado?: string;
  tipoDocumento?: string;
  tenantId?: string;
  limite?: number;
  offset?: number;
}

export interface ResultadoHistorialCliente {
  comprobantes: ComprobanteClienteItem[];
  total: number;
  pagina: number;
  totalPaginas: number;
}

/**
 * Solicita el envío de un código OTP para acceder al portal de clientes.
 * Aplica anti-enumeración estricta: siempre responde con éxito sin revelar si el correo existe.
 */
export async function solicitarOtpCliente(
  emailRaw: string,
  clientIp: string = '127.0.0.1',
  poolOverride?: Pool
): Promise<{ ok: boolean; mensaje: string; cooldown?: number }> {
  const db = poolOverride || pool;
  const email = (emailRaw || '').trim().toLowerCase();

  if (!email || !EMAIL_REGEX.test(email)) {
    return {
      ok: false,
      mensaje: 'Por favor, ingrese una dirección de correo electrónico válida.'
    };
  }

  // 1. Control de frecuencia (Rate Limiting y Cooldown)
  const rateCheck = await db.query(
    `SELECT created_at 
     FROM portal_clientes_otp 
     WHERE email = $1 AND created_at > NOW() - ($2 || ' minutes')::interval 
     ORDER BY created_at DESC`,
    [email, VENTANA_RATE_LIMIT_MINUTOS]
  );

  if (rateCheck.rowCount && rateCheck.rowCount >= OTP_MAX_SOLICITUDES_VENTANA) {
    return {
      ok: false,
      mensaje: 'Ha alcanzado el límite de solicitudes. Por seguridad, intente nuevamente más tarde.'
    };
  }

  if (rateCheck.rowCount && rateCheck.rowCount > 0) {
    const ultimoEnvio = new Date(rateCheck.rows[0].created_at).getTime();
    const ahora = Date.now();
    const diffSegundos = Math.floor((ahora - ultimoEnvio) / 1000);
    if (diffSegundos < OTP_COOLDOWN_SEGUNDOS) {
      const restante = OTP_COOLDOWN_SEGUNDOS - diffSegundos;
      return {
        ok: false,
        mensaje: `Por favor espere ${restante} segundos antes de solicitar otro código.`,
        cooldown: restante
      };
    }
  }

  // 2. Verificación de existencia de comprobantes asociados al receptor
  const compCheck = await db.query(
    `SELECT 1 FROM comprobantes 
     WHERE (
       LOWER(TRIM(correo_cliente)) = $1 
       OR LOWER(TRIM(correo_destinatario)) = $1 
       OR LOWER(TRIM(doc_original_json->'receptor'->>'correo')) = $1
     ) LIMIT 1`,
    [email]
  );

  // Mensaje uniforme para prevenir enumeración de correos
  const mensajeRespuestaUniforme =
    'Si la dirección de correo cuenta con comprobantes asociados, recibirá un código de verificación en breve.';

  if (!compCheck.rowCount || compCheck.rowCount === 0) {
    // No revelar que el correo no existe en la base de datos
    return { ok: true, mensaje: mensajeRespuestaUniforme };
  }

  // 3. Generación criptográfica del OTP (6 dígitos numéricos)
  const otpNumber = crypto.randomInt(100000, 1000000);
  const otpCode = otpNumber.toString();
  const otpHash = crypto.createHash('sha256').update(otpCode).digest('hex');
  const expiresAt = new Date(Date.now() + OTP_EXPIRACION_MINUTOS * 60 * 1000);

  // 4. Invalidar códigos previos no utilizados para este correo
  await db.query(
    `UPDATE portal_clientes_otp SET used = TRUE WHERE email = $1 AND used = FALSE`,
    [email]
  );

  // 5. Persistir el hash del OTP (NUNCA el código en texto plano)
  await db.query(
    `INSERT INTO portal_clientes_otp (email, otp_hash, expires_at, max_attempts, ip_address)
     VALUES ($1, $2, $3, $4, $5)`,
    [email, otpHash, expiresAt, OTP_MAX_INTENTOS, clientIp]
  );

  // 6. Registro exclusivo para pruebas en QA
  _qaOtpTestingStore.set(email, otpCode);

  return { ok: true, mensaje: mensajeRespuestaUniforme };
}

/**
 * Verifica el código OTP provisto por el usuario y genera una sesión temporal segura.
 */
export async function verificarOtpCliente(
  emailRaw: string,
  otpRaw: string,
  clientInfo: { ip?: string; userAgent?: string } = {},
  poolOverride?: Pool
): Promise<{ ok: boolean; sessionToken?: string; expiraEn?: Date; error?: string; intentosRestantes?: number }> {
  const db = poolOverride || pool;
  const email = (emailRaw || '').trim().toLowerCase();
  const otp = (otpRaw || '').trim();

  if (!email || !otp || !/^\d{6}$/.test(otp)) {
    return { ok: false, error: 'Código de verificación inválido. Debe contener 6 dígitos.' };
  }

  // 1. Buscar OTP vigente no utilizado
  const res = await db.query(
    `SELECT id, otp_hash, expires_at, attempts, max_attempts 
     FROM portal_clientes_otp 
     WHERE email = $1 AND used = FALSE AND expires_at > NOW() 
     ORDER BY created_at DESC LIMIT 1`,
    [email]
  );

  if (!res.rowCount || res.rowCount === 0) {
    return { ok: false, error: 'Código inválido o expirado. Por favor solicite uno nuevo.' };
  }

  const record = res.rows[0];

  if (record.attempts >= record.max_attempts) {
    await db.query(`UPDATE portal_clientes_otp SET used = TRUE WHERE id = $1`, [record.id]);
    return { ok: false, error: 'Ha superado el número máximo de intentos. Solicite un nuevo código.' };
  }

  // 2. Comparación de hash en tiempo constante (protección contra timing attacks)
  const inputHash = crypto.createHash('sha256').update(otp).digest('hex');
  const storedBuf = Buffer.from(record.otp_hash, 'hex');
  const inputBuf = Buffer.from(inputHash, 'hex');

  const matches = storedBuf.length === inputBuf.length && crypto.timingSafeEqual(storedBuf, inputBuf);

  if (!matches) {
    const nuevosIntentos = record.attempts + 1;
    const esUltimo = nuevosIntentos >= record.max_attempts;

    await db.query(
      `UPDATE portal_clientes_otp 
       SET attempts = $1, used = $2 
       WHERE id = $3`,
      [nuevosIntentos, esUltimo, record.id]
    );

    const restantes = Math.max(0, record.max_attempts - nuevosIntentos);
    return {
      ok: false,
      error: esUltimo
        ? 'Código incorrecto. Ha alcanzado el límite de intentos permitidos. Solicite un nuevo código.'
        : `Código de verificación incorrecto. Le quedan ${restantes} intento(s).`,
      intentosRestantes: restantes
    };
  }

  // 3. OTP correcto: Quemar el código de inmediato (single-use estricto)
  await db.query(`UPDATE portal_clientes_otp SET used = TRUE WHERE id = $1`, [record.id]);
  _qaOtpTestingStore.delete(email);

  // 4. Crear sesión criptográfica con 256 bits de entropía
  const rawSessionToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawSessionToken).digest('hex');
  const expiraEn = new Date(Date.now() + SESION_EXPIRACION_HORAS * 3600 * 1000);

  await db.query(
    `INSERT INTO portal_clientes_sesiones (email, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [email, tokenHash, expiraEn, clientInfo.ip || null, clientInfo.userAgent || null]
  );

  return {
    ok: true,
    sessionToken: rawSessionToken,
    expiraEn
  };
}

/**
 * Valida un token de sesión de cliente mediante SHA-256 en tiempo seguro.
 */
export async function validarSesionCliente(
  rawToken: string,
  poolOverride?: Pool
): Promise<{ valid: boolean; session?: { id: string; email: string; expiraEn: Date }; error?: string }> {
  const db = poolOverride || pool;
  if (!rawToken || typeof rawToken !== 'string') {
    return { valid: false, error: 'Token de sesión no provisto.' };
  }

  const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');

  const res = await db.query(
    `SELECT id, email, expires_at, revocado 
     FROM portal_clientes_sesiones 
     WHERE token_hash = $1`,
    [tokenHash]
  );

  if (!res.rowCount || res.rowCount === 0) {
    return { valid: false, error: 'Sesión no válida o no encontrada.' };
  }

  const s = res.rows[0];

  if (s.revocado) {
    return { valid: false, error: 'La sesión ha sido revocada.' };
  }

  const ahora = new Date();
  if (new Date(s.expires_at) <= ahora) {
    return { valid: false, error: 'La sesión ha expirado. Ingrese nuevamente.' };
  }

  // Actualizar último acceso de forma asíncrona
  db.query(`UPDATE portal_clientes_sesiones SET ultimo_acceso_en = NOW() WHERE id = $1`, [s.id]).catch(() => {});

  return {
    valid: true,
    session: {
      id: s.id,
      email: s.email,
      expiraEn: new Date(s.expires_at)
    }
  };
}

/**
 * Cierra la sesión activa revocando su token en la base de datos.
 */
export async function revocarSesionCliente(rawToken: string, poolOverride?: Pool): Promise<boolean> {
  const db = poolOverride || pool;
  if (!rawToken) return false;

  const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
  const res = await db.query(
    `UPDATE portal_clientes_sesiones SET revocado = TRUE WHERE token_hash = $1`,
    [tokenHash]
  );
  return (res.rowCount || 0) > 0;
}

/**
 * Consulta el historial de comprobantes para el receptor autenticado.
 * Aplica aislamiento estricto: solo muestra comprobantes donde el receptor coincide con el email verificado.
 */
export async function listarComprobantesCliente(
  email: string,
  filtros: FiltrosHistorialCliente = {},
  poolOverride?: Pool
): Promise<ResultadoHistorialCliente> {
  const db = poolOverride || pool;
  const em = (email || '').trim().toLowerCase();

  const condiciones: string[] = [
    `(
      LOWER(TRIM(c.correo_cliente)) = $1 
      OR LOWER(TRIM(c.correo_destinatario)) = $1 
      OR LOWER(TRIM(c.doc_original_json->'receptor'->>'correo')) = $1
    )`
  ];
  const params: any[] = [em];
  let pIdx = 2;

  if (filtros.fechaDesde) {
    try {
      const { inicioUtc } = getRangoUtcDiaCR(filtros.fechaDesde);
      condiciones.push(`c.fecha >= $${pIdx}`);
      params.push(inicioUtc);
      pIdx++;
    } catch {}
  }

  if (filtros.fechaHasta) {
    try {
      const { finUtc } = getRangoUtcDiaCR(filtros.fechaHasta);
      condiciones.push(`c.fecha < $${pIdx}`);
      params.push(finUtc);
      pIdx++;
    } catch {}
  }

  if (filtros.tipoDocumento) {
    condiciones.push(`c.tipo_documento = $${pIdx}`);
    params.push(filtros.tipoDocumento.trim());
    pIdx++;
  }

  if (filtros.estado) {
    condiciones.push(`LOWER(TRIM(c.estado_hacienda)) = LOWER(TRIM($${pIdx}))`);
    params.push(filtros.estado.trim());
    pIdx++;
  }

  if (filtros.tenantId) {
    condiciones.push(`c.tenant_id = $${pIdx}`);
    params.push(filtros.tenantId.trim());
    pIdx++;
  }

  const whereClause = condiciones.join(' AND ');

  // Contar total
  const countRes = await db.query(
    `SELECT COUNT(*)::int AS total FROM comprobantes c WHERE ${whereClause}`,
    params
  );
  const total = Number(countRes.rows[0]?.total || 0);

  const limite = Math.min(Math.max(Number(filtros.limite) || 20, 1), 100);
  const offset = Math.max(Number(filtros.offset) || 0, 0);

  const queryParams = [...params, limite, offset];
  const listRes = await db.query(
    `SELECT 
       c.tenant_id,
       COALESCE(t.nombre, 'Emisor MeetinFact') AS emisor_nombre,
       COALESCE(t.cedula, '') AS emisor_cedula,
       c.clave,
       c.consecutivo,
       c.tipo_documento,
       c.fecha,
       c.moneda,
       c.total,
       c.cliente,
       c.estado_hacienda
     FROM comprobantes c
     LEFT JOIN tenants t ON t.id = c.tenant_id
     WHERE ${whereClause}
     ORDER BY c.fecha DESC
     LIMIT $${pIdx} OFFSET $${pIdx + 1}`,
    queryParams
  );

  const items: ComprobanteClienteItem[] = listRes.rows.map((row: any) => ({
    tenantId: row.tenant_id,
    emisorNombre: row.emisor_nombre,
    emisorCedula: row.emisor_cedula,
    clave: row.clave,
    consecutivo: row.consecutivo,
    tipoDocumento: row.tipo_documento,
    fecha: new Date(row.fecha),
    fechaLegible: formatoFechaLegibleCR(new Date(row.fecha)),
    moneda: row.moneda || 'CRC',
    total: Number(row.total || 0),
    cliente: row.cliente || '',
    estadoHacienda: row.estado_hacienda || 'procesando'
  }));

  const pagina = Math.floor(offset / limite) + 1;
  const totalPaginas = Math.ceil(total / limite) || 1;

  return {
    comprobantes: items,
    total,
    pagina,
    totalPaginas
  };
}

/**
 * Obtiene un comprobante específico verificando rigurosamente que pertenezca al cliente autenticado.
 */
export async function obtenerComprobanteClienteAutorizado(
  email: string,
  clave: string,
  poolOverride?: Pool
): Promise<{
  comprobante: ComprobanteGuardado & { tenantId: string; docOriginalJson?: any };
  emisorNombre: string;
} | null> {
  const db = poolOverride || pool;
  const em = (email || '').trim().toLowerCase();
  const cl = (clave || '').trim();

  const res = await db.query(
    `SELECT c.*, COALESCE(t.nombre, 'Emisor MeetinFact') AS emisor_nombre
     FROM comprobantes c
     LEFT JOIN tenants t ON t.id = c.tenant_id
     WHERE c.clave = $1
       AND (
         LOWER(TRIM(c.correo_cliente)) = $2 
         OR LOWER(TRIM(c.correo_destinatario)) = $2 
         OR LOWER(TRIM(c.doc_original_json->'receptor'->>'correo')) = $2
       )
     LIMIT 1`,
    [cl, em]
  );

  if (!res.rowCount || res.rowCount === 0) {
    return null;
  }

  const row = res.rows[0];
  const comp: ComprobanteGuardado & { tenantId: string; docOriginalJson?: any } = {
    clave: row.clave,
    consecutivo: row.consecutivo,
    tipoDocumento: row.tipo_documento,
    fecha: new Date(row.fecha),
    moneda: row.moneda,
    total: Number(row.total),
    cliente: row.cliente,
    estadoHacienda: row.estado_hacienda,
    estilo: row.estilo,
    notas: row.notas,
    correoCliente: row.correo_cliente,
    correoEnviado: row.correo_enviado,
    correoEnviadoEn: row.correo_enviado_en ? new Date(row.correo_enviado_en).toISOString() : undefined,
    correoDestinatario: row.correo_destinatario,
    correoError: row.correo_error,
    xmlFirmado: row.xml_firmado,
    docOriginal: row.doc_original_json,
    docOriginalJson: row.doc_original_json,
    tenantId: row.tenant_id
  };

  return {
    comprobante: comp,
    emisorNombre: row.emisor_nombre
  };
}

/**
 * Registra un evento de auditoría para visualizaciones o descargas desde el portal autenticado de clientes.
 */
export async function registrarAuditoriaCliente(
  tenantId: string,
  clave: string,
  sesionId: string | null,
  correo: string,
  tipoAccion: 'portal_historial_consulta' | 'portal_visualizacion' | 'portal_descarga_xml' | 'portal_descarga_pdf',
  ip?: string,
  userAgent?: string,
  poolOverride?: Pool
): Promise<void> {
  const db = poolOverride || pool;
  try {
    await db.query(
      `INSERT INTO auditoria_descargas_comprobantes 
         (tenant_id, clave, portal_sesion_id, correo_solicitante, tipo_accion, ip_origen, user_agent, fecha)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [tenantId, clave, sesionId, correo, tipoAccion, ip || null, userAgent || null]
    );
  } catch (err) {
    // Registro de auditoría no bloquea la respuesta al cliente
    console.error('[AUDITORIA] Error al registrar evento en portal de clientes:', (err as Error).message);
  }
}
