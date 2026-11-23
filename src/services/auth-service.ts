import * as crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { pool, withTransaction } from '../db/pool.js';
import { hashPassword, verifyPassword } from './crypto-service.js';

export type UserRole = 'superadmin' | 'admin' | 'operador';

export interface AuthContext {
  userId: string;
  tenantId: string;
  email: string;
  nombre: string;
  role: UserRole;
  tenantNombre: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export const AUTH_COOKIE_NAME = 'fact_session';

function getJwtSecret(): string {
  return process.env.JWT_SECRET || 'facturacion-dev-jwt-secret-change-me';
}

export function signAuthToken(ctx: AuthContext): string {
  return jwt.sign(
    {
      sub: ctx.userId,
      tenantId: ctx.tenantId,
      email: ctx.email,
      nombre: ctx.nombre,
      role: ctx.role
    },
    getJwtSecret(),
    { expiresIn: '7d' }
  );
}

export function setAuthCookie(res: Response, token: string): void {
  const isSecure =
    process.env.NODE_ENV === 'production' ||
    Boolean(process.env.APP_URL?.startsWith('https://')) ||
    Boolean(process.env.PUBLIC_APP_URL?.startsWith('https://'));
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/'
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
}

export function extractAuthToken(req: Request): string | null {
  const fromCookie = req.cookies?.[AUTH_COOKIE_NAME];
  if (fromCookie && typeof fromCookie === 'string') return fromCookie;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

export async function resolveAuthFromToken(token: string): Promise<AuthContext | null> {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
    const userId = decoded?.sub;
    if (!userId || typeof userId !== 'string') return null;

    const res = await pool.query(
      `SELECT u.id, u.tenant_id, u.email, u.nombre, u.role, u.activo AS user_activo,
              t.nombre AS tenant_nombre, t.activo AS tenant_activo
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1`,
      [userId]
    );
    if (!res.rowCount) return null;
    const row = res.rows[0];
    if (!row.user_activo || !row.tenant_activo) return null;

    return {
      userId: row.id,
      tenantId: row.tenant_id,
      email: row.email,
      nombre: row.nombre,
      role: row.role as UserRole,
      tenantNombre: row.tenant_nombre
    };
  } catch {
    return null;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractAuthToken(req);
  if (!token) {
    res.status(401).json({ success: false, error: 'Debe iniciar sesión para acceder.' });
    return;
  }
  const auth = await resolveAuthFromToken(token);
  if (!auth) {
    clearAuthCookie(res);
    res.status(401).json({ success: false, error: 'Sesión expirada o inválida.' });
    return;
  }
  req.auth = auth;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth || (req.auth.role !== 'admin' && req.auth.role !== 'superadmin')) {
    res.status(403).json({ success: false, error: 'Requiere permisos de administrador.' });
    return;
  }
  next();
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth || req.auth.role !== 'superadmin') {
    res.status(403).json({ success: false, error: 'Acceso exclusivo para el administrador de la plataforma SaaS.' });
    return;
  }
  next();
}

function crearSlug(nombre: string): string {
  const base = nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'empresa';
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

export async function registrarTenantYAdmin(input: {
  nombreEmpresa: string;
  cedula?: string;
  nombreUsuario: string;
  email: string;
  password: string;
}): Promise<{ token: string; auth: AuthContext }> {
  const nombreEmpresa = (input.nombreEmpresa || '').trim();
  const nombreUsuario = (input.nombreUsuario || '').trim();
  const email = (input.email || '').trim().toLowerCase();
  const password = input.password || '';
  const cedula = String(input.cedula || '').replace(/[\s-]+/g, '');

  if (!nombreEmpresa) throw new Error('El nombre de la empresa o comercio es obligatorio.');
  if (!nombreUsuario) throw new Error('Su nombre completo es obligatorio.');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Ingrese un correo electrónico válido.');
  if (password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');

  const existing = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
  if (existing.rowCount && existing.rowCount > 0) {
    throw new Error('Ya existe una cuenta registrada con ese correo electrónico.');
  }

  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const subscriptionId = crypto.randomUUID();
  const slug = crearSlug(nombreEmpresa);
  const passwordHash = hashPassword(password);

  await withTransaction(async (client) => {
    await client.query(
      'INSERT INTO tenants (id, nombre, slug, cedula, activo) VALUES ($1, $2, $3, $4, TRUE)',
      [tenantId, nombreEmpresa, slug, cedula || null]
    );

    await client.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, nombre, role, activo)
       VALUES ($1, $2, $3, $4, $5, 'admin', TRUE)`,
      [userId, tenantId, email, passwordHash, nombreUsuario]
    );

    const emisorJson = {
      nombre: nombreEmpresa,
      cedula,
      tipoIdentificacion: cedula.length === 10 ? '02' : '01',
      nombreComercial: nombreEmpresa,
      actividadEconomica: '',
      sucursal: '001',
      terminal: '00001',
      correo: email,
      telefono: '',
      direccion: ''
    };
    const sitioJson = {
      nombreSistema: nombreEmpresa,
      subtitulo: 'Costa Rica • DGT v4.4',
      moneda: 'CRC',
      simboloMoneda: 'CRC',
      logoBase64: '',
      colorPrimario: '#16a34a',
      mensajePieTicket: '¡Gracias por su preferencia!',
      estiloFactura: 'corporativo',
      tipoCambioDefault: 510
    };
    const haciendaJson = {
      entorno: 'staging',
      usuario: '',
      enviarAHacienda: false
    };
    const correoJson = {
      proveedor: 'hostinger',
      host: 'smtp.hostinger.com',
      puerto: 465,
      seguro: true,
      usuario: '',
      nombreRemitente: `${nombreEmpresa} Facturación`,
      copiaOculta: '',
      asuntoTemplate: '{tipoDocumento} #{consecutivo} - {emisor}',
      mensajeTemplate:
        'Estimado(a) {cliente},\n\nAdjunto encontrará su {tipoDocumento} #{consecutivo} emitida por {emisor}, junto con el archivo XML oficial firmado según la normativa de la DGT de Costa Rica.\n\n¡Muchas gracias por su preferencia!',
      envioAutomatico: false,
      imapHost: 'imap.hostinger.com',
      imapPuerto: 993,
      imapSeguro: true,
      imapCarpeta: 'INBOX',
      imapAutoSync: false,
      imapIntervaloMin: 15,
      imapDiasAtras: 90
    };

    await client.query(
      `INSERT INTO tenant_configs (tenant_id, emisor_json, sitio_json, hacienda_json, correo_json)
       VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb)`,
      [tenantId, JSON.stringify(emisorJson), JSON.stringify(sitioJson), JSON.stringify(haciendaJson), JSON.stringify(correoJson)]
    );

    for (const cat of ['General', 'Servicios', 'Productos']) {
      await client.query('INSERT INTO categorias (tenant_id, nombre) VALUES ($1, $2)', [tenantId, cat]);
    }

    for (const tipo of ['01', '02', '03', '04']) {
      await client.query(
        'INSERT INTO secuencias_consecutivos (tenant_id, tipo_documento, ultimo_numero, numero_inicial) VALUES ($1, $2, 0, 0)',
        [tenantId, tipo]
      );
    }

    const trialEnd = new Date(Date.now() + 14 * 86400_000);
    await client.query(
      `INSERT INTO subscriptions (id, tenant_id, plan_code, status, billing_cycle, current_period_start, current_period_end, next_billing_date, provider)
       VALUES ($1, $2, 'trial', 'trialing', 'monthly', NOW(), $3, $3, 'trial')`,
      [subscriptionId, tenantId, trialEnd]
    );
  });

  const auth: AuthContext = {
    userId,
    tenantId,
    email,
    nombre: nombreUsuario,
    role: 'admin',
    tenantNombre: nombreEmpresa
  };
  return { token: signAuthToken(auth), auth };
}

export async function autenticarUsuario(emailInput: string, password: string): Promise<{ token: string; auth: AuthContext }> {
  const email = (emailInput || '').trim().toLowerCase();
  if (!email || !password) {
    throw new Error('Ingrese su correo electrónico y contraseña.');
  }

  const res = await pool.query(
    `SELECT u.id, u.tenant_id, u.email, u.password_hash, u.nombre, u.role, u.activo AS user_activo,
            t.nombre AS tenant_nombre, t.activo AS tenant_activo
     FROM users u
     JOIN tenants t ON t.id = u.tenant_id
     WHERE LOWER(u.email) = $1`,
    [email]
  );

  if (!res.rowCount) {
    throw new Error('Credenciales inválidas.');
  }
  const row = res.rows[0];
  if (!verifyPassword(password, row.password_hash)) {
    throw new Error('Credenciales inválidas.');
  }
  if (!row.user_activo) {
    throw new Error('Este usuario está desactivado. Contacte al administrador de su empresa.');
  }
  if (!row.tenant_activo) {
    throw new Error('La cuenta de esta empresa se encuentra deshabilitada.');
  }

  const auth: AuthContext = {
    userId: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    nombre: row.nombre,
    role: row.role as UserRole,
    tenantNombre: row.tenant_nombre
  };
  return { token: signAuthToken(auth), auth };
}

export async function cambiarContrasena(userId: string, actual: string, nueva: string): Promise<void> {
  if (!actual || !nueva || nueva.length < 6) {
    throw new Error('La nueva contraseña debe tener al menos 6 caracteres.');
  }
  const res = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!res.rowCount) throw new Error('Usuario no encontrado.');
  if (!verifyPassword(actual, res.rows[0].password_hash)) {
    throw new Error('La contraseña actual no coincide.');
  }
  await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, hashPassword(nueva)]);
}

// GESTIÓN DE USUARIOS POR TENANT
export async function listarUsuariosTenant(tenantId: string) {
  const res = await pool.query(
    `SELECT id, email, nombre, role, activo, created_at
     FROM users
     WHERE tenant_id = $1
     ORDER BY created_at ASC`,
    [tenantId]
  );
  return res.rows;
}

export async function crearUsuarioTenant(
  tenantId: string,
  input: { nombre: string; email: string; password: string; role?: string }
) {
  const nombre = (input.nombre || '').trim();
  const email = (input.email || '').trim().toLowerCase();
  const password = input.password || '';
  const role: 'admin' | 'operador' = input.role === 'admin' ? 'admin' : 'operador';

  if (!nombre) throw new Error('El nombre del usuario es obligatorio.');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Ingrese un correo electrónico válido.');
  if (password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');

  const subRes = await pool.query(
    `SELECT p.limite_usuarios, p.nombre AS plan_nombre
     FROM subscriptions s
     JOIN plans p ON p.code = s.plan_code
     WHERE s.tenant_id = $1`,
    [tenantId]
  );
  const limiteUsuarios = subRes.rowCount ? Number(subRes.rows[0].limite_usuarios) : 1;
  const countRes = await pool.query('SELECT COUNT(*)::int AS total FROM users WHERE tenant_id = $1', [tenantId]);
  const actuales = Number(countRes.rows[0]?.total || 0);

  if (limiteUsuarios !== -1 && actuales >= limiteUsuarios) {
    const planNom = subRes.rows[0]?.plan_nombre || 'actual';
    throw new Error(`Límite de ${limiteUsuarios} usuario(s) alcanzado para el ${planNom}. Mejore su plan para agregar más usuarios.`);
  }

  const dup = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
  if (dup.rowCount && dup.rowCount > 0) {
    throw new Error('Ese correo electrónico ya está registrado en el sistema.');
  }

  const id = crypto.randomUUID();
  const res = await pool.query(
    `INSERT INTO users (id, tenant_id, email, password_hash, nombre, role, activo)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE)
     RETURNING id, email, nombre, role, activo, created_at`,
    [id, tenantId, email, hashPassword(password), nombre, role]
  );
  return res.rows[0];
}

export async function actualizarUsuarioTenant(
  tenantId: string,
  userId: string,
  patch: { nombre?: string; role?: string; activo?: boolean; password?: string },
  actorUserId: string
) {
  const existing = await pool.query('SELECT * FROM users WHERE id = $1 AND tenant_id = $2', [userId, tenantId]);
  if (!existing.rowCount) throw new Error('Usuario no encontrado.');
  const u = existing.rows[0];

  if (u.role === 'superadmin' && patch.role && patch.role !== 'superadmin') {
    throw new Error('No se puede degradar al SuperAdmin principal.');
  }
  if (userId === actorUserId && patch.activo === false) {
    throw new Error('No puede desactivar su propia cuenta mientras está en sesión.');
  }

  const nombre = patch.nombre !== undefined ? patch.nombre.trim() || u.nombre : u.nombre;
  const role =
    u.role === 'superadmin'
      ? 'superadmin'
      : patch.role === 'admin' || patch.role === 'operador'
        ? patch.role
        : u.role;
  const activo = patch.activo !== undefined ? Boolean(patch.activo) : u.activo;
  const passwordHash =
    patch.password && patch.password.length >= 6 ? hashPassword(patch.password) : u.password_hash;

  const res = await pool.query(
    `UPDATE users
     SET nombre = $3, role = $4, activo = $5, password_hash = $6
     WHERE id = $1 AND tenant_id = $2
     RETURNING id, email, nombre, role, activo, created_at`,
    [userId, tenantId, nombre, role, activo, passwordHash]
  );
  return res.rows[0];
}

export async function eliminarUsuarioTenant(tenantId: string, userId: string, actorUserId: string): Promise<boolean> {
  if (userId === actorUserId) {
    throw new Error('No puede eliminar su propio usuario en sesión.');
  }
  const existing = await pool.query('SELECT role FROM users WHERE id = $1 AND tenant_id = $2', [userId, tenantId]);
  if (!existing.rowCount) return false;
  if (existing.rows[0].role === 'superadmin') {
    throw new Error('No se puede eliminar la cuenta SuperAdmin.');
  }
  const res = await pool.query('DELETE FROM users WHERE id = $1 AND tenant_id = $2', [userId, tenantId]);
  return (res.rowCount || 0) > 0;
}
