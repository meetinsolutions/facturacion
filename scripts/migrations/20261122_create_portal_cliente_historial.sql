-- ==============================================================================
-- MEETINFACT — PORTAL DE COMPROBANTES: INCREMENTO 2
-- Migración: Tabla de OTPs de verificación y sesiones temporales para clientes
-- Entorno objetivo: facturacion_test (NO ejecutar en producción sin autorización)
-- ==============================================================================

-- 1. Tabla de códigos OTP de acceso
CREATE TABLE IF NOT EXISTS portal_clientes_otp (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  cedula_receptor TEXT,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE portal_clientes_otp 
  ADD COLUMN IF NOT EXISTS cedula_receptor TEXT;

CREATE INDEX IF NOT EXISTS idx_portal_otp_email_active 
  ON portal_clientes_otp (email, expires_at) 
  WHERE used = FALSE;

CREATE INDEX IF NOT EXISTS idx_portal_otp_email_created
  ON portal_clientes_otp (email, created_at);

-- 2. Tabla de sesiones temporales seguras de clientes
CREATE TABLE IF NOT EXISTS portal_clientes_sesiones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  cedula_receptor TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  revocado BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_acceso_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE portal_clientes_sesiones 
  ADD COLUMN IF NOT EXISTS cedula_receptor TEXT;

CREATE INDEX IF NOT EXISTS idx_portal_sesiones_token_hash 
  ON portal_clientes_sesiones (token_hash) 
  WHERE revocado = FALSE;

CREATE INDEX IF NOT EXISTS idx_portal_sesiones_email 
  ON portal_clientes_sesiones (email);

-- 3. Ampliación de auditoría para correlacionar sesiones de clientes
ALTER TABLE auditoria_descargas_comprobantes 
  ADD COLUMN IF NOT EXISTS portal_sesion_id UUID REFERENCES portal_clientes_sesiones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS correo_solicitante TEXT,
  ALTER COLUMN tipo_accion TYPE VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_auditoria_descargas_portal_sesion
  ON auditoria_descargas_comprobantes (portal_sesion_id)
  WHERE portal_sesion_id IS NOT NULL;
