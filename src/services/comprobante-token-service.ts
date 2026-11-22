/**
 * MEETINFACT — PORTAL DE COMPROBANTES (INCREMENTO 1)
 * Servicio de Tokens de Acceso Seguro (256 bits), Validación Criptográfica y Auditoría
 */
import crypto from 'crypto';
import { pool } from '../db/pool.js';

export interface ComprobanteAccesoValido {
  tokenId: string;
  tenantId: string;
  clave: string;
  consecutivo: string;
  tipoDocumento: string;
  fecha: Date;
  moneda: string;
  total: number;
  cliente: string;
  estadoHacienda: string;
  xmlFirmado: string;
  docOriginalJson: any;
  emisorJson: any;
  expiraEn: Date;
}

const TOKEN_REGEX = /^[A-Za-z0-9_-]{40,64}$/;

/**
 * Calcula el hash criptográfico SHA-256 del token para almacenamiento y búsqueda segura.
 * El raw token NUNCA se persiste en texto plano.
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Genera un token aleatorio con 256 bits de entropía real (base64url opaco).
 * Almacena exclusivamente el hash SHA-256 en la base de datos.
 */
export async function generarTokenAcceso(
  tenantId: string,
  clave: string,
  opciones: number | { diasVigencia?: number; diasValidez?: number } = 90
): Promise<{ rawToken: string; expiraEn: Date; tokenHash: string }> {
  let diasVigencia = 90;
  if (typeof opciones === 'number') {
    diasVigencia = opciones;
  } else if (opciones && typeof opciones === 'object') {
    diasVigencia = opciones.diasVigencia ?? opciones.diasValidez ?? 90;
  }

  // 1. Validar que el comprobante existe para este tenant específico
  const compCheck = await pool.query(
    'SELECT clave FROM comprobantes WHERE tenant_id = $1 AND clave = $2',
    [tenantId, clave]
  );
  if (!compCheck.rowCount) {
    throw new Error('Comprobante no encontrado para el tenant especificado.');
  }

  // 2. Generar 256 bits de entropía (32 bytes aleatorios criptográficos)
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);

  const expiraEn = new Date(Date.now() + diasVigencia * 24 * 3600 * 1000);

  // 3. Persistir exclusivamente el hash y la vigencia
  await pool.query(
    `INSERT INTO comprobantes_tokens_acceso (tenant_id, clave, token_hash, expira_en)
     VALUES ($1, $2, $3, $4)`,
    [tenantId, clave, tokenHash, expiraEn]
  );

  return { rawToken, expiraEn, tokenHash };
}

/**
 * Valida un token público recibido en la URL.
 * Retorna la información del comprobante si el token es válido, activo y no expirado.
 * Retorna null ante cualquier inconsistencia, evitando enumeración.
 */
export async function validarTokenAcceso(
  rawToken: string
): Promise<ComprobanteAccesoValido | null> {
  if (!rawToken || typeof rawToken !== 'string' || !TOKEN_REGEX.test(rawToken)) {
    return null;
  }

  const tokenHash = hashToken(rawToken);

  const res = await pool.query(
    `SELECT 
       t.id AS token_id,
       t.tenant_id,
       t.clave,
       t.expira_en,
       t.revocado,
       t.accesos_contador,
       c.consecutivo,
       c.tipo_documento,
       c.fecha,
       c.moneda,
       c.total,
       c.cliente,
       c.estado_hacienda,
       c.xml_firmado,
       c.doc_original_json,
       tc.emisor_json
     FROM comprobantes_tokens_acceso t
     JOIN comprobantes c ON c.tenant_id = t.tenant_id AND c.clave = t.clave
     LEFT JOIN tenant_configs tc ON tc.tenant_id = t.tenant_id
     WHERE t.token_hash = $1`,
    [tokenHash]
  );

  if (!res.rowCount) {
    return null;
  }

  const row = res.rows[0];

  // Verificar revocación y expiración
  if (row.revocado) {
    return null;
  }

  const now = new Date();
  if (now > new Date(row.expira_en)) {
    return null;
  }

  // Actualizar contador y último acceso de forma asíncrona sin bloquear la respuesta
  pool.query(
    `UPDATE comprobantes_tokens_acceso
     SET accesos_contador = accesos_contador + 1, ultimo_acceso = NOW()
     WHERE id = $1`,
    [row.token_id]
  ).catch(err => {
    console.warn('[PORTAL TOKENS] Error actualizando métricas de acceso:', err.message);
  });

  return {
    tokenId: row.token_id,
    tenantId: row.tenant_id,
    clave: row.clave,
    consecutivo: row.consecutivo,
    tipoDocumento: row.tipo_documento,
    fecha: row.fecha,
    moneda: row.moneda,
    total: Number(row.total),
    cliente: row.cliente,
    estadoHacienda: row.estado_hacienda,
    xmlFirmado: row.xml_firmado,
    docOriginalJson: row.doc_original_json,
    emisorJson: row.emisor_json || {},
    expiraEn: row.expira_en
  };
}

/**
 * Revoca todos los tokens activos asociados a un comprobante específico de un tenant.
 */
export async function revocarTokensComprobante(
  tenantId: string,
  clave: string
): Promise<number> {
  const res = await pool.query(
    `UPDATE comprobantes_tokens_acceso
     SET revocado = TRUE, revocado_en = NOW()
     WHERE tenant_id = $1 AND clave = $2 AND revocado = FALSE`,
    [tenantId, clave]
  );
  return res.rowCount || 0;
}

/**
 * Rota un token: revoca los anteriores y genera uno nuevo con 256 bits de entropía.
 */
export async function rotarTokenAcceso(
  tenantId: string,
  clave: string,
  diasVigencia = 90
): Promise<{ rawToken: string; expiraEn: Date }> {
  await revocarTokensComprobante(tenantId, clave);
  return await generarTokenAcceso(tenantId, clave, diasVigencia);
}

/**
 * Registra un evento en la bitácora de auditoría de descargas y accesos.
 */
export async function registrarAuditoriaAcceso(params: {
  tenantId: string;
  clave: string;
  tipoAccion: 'view_html' | 'download_xml' | 'download_pdf';
  ipOrigen?: string;
  userAgent?: string;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO auditoria_descargas_comprobantes (tenant_id, clave, tipo_accion, ip_origen, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        params.tenantId,
        params.clave,
        params.tipoAccion,
        params.ipOrigen || null,
        params.userAgent ? params.userAgent.substring(0, 512) : null
      ]
    );
  } catch (err: any) {
    console.warn('[AUDITORIA PORTAL] Error registrando auditoría:', err.message);
  }
}

/**
 * Purgado seguro de tokens expirados antiguos y registros de auditoría que superan la política de retención.
 */
export async function purgarDatosAntiguos(params?: {
  diasRetencionTokens?: number;
  diasRetencionAuditoria?: number;
}): Promise<{ tokensEliminados: number; auditoriaEliminada: number }> {
  const diasTokens = params?.diasRetencionTokens ?? 180;
  const diasAuditoria = params?.diasRetencionAuditoria ?? 365;

  const resTokens = await pool.query(
    `DELETE FROM comprobantes_tokens_acceso
     WHERE (expira_en < NOW() - make_interval(days => $1))
        OR (revocado = TRUE AND revocado_en < NOW() - INTERVAL '30 days')`,
    [diasTokens]
  );

  const resAuditoria = await pool.query(
    `DELETE FROM auditoria_descargas_comprobantes
     WHERE fecha < NOW() - make_interval(days => $1)`,
    [diasAuditoria]
  );

  return {
    tokensEliminados: resTokens.rowCount || 0,
    auditoriaEliminada: resAuditoria.rowCount || 0
  };
}
