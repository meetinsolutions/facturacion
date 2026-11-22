-- ==============================================================================
-- MEETINFACT — PORTAL DE COMPROBANTES: INCREMENTO 1
-- Tablas de Tokens de Acceso Seguro (SHA-256) y Bitácora de Auditoría
-- ==============================================================================

-- 1. Tokens de Acceso Seguro (Solo almacena hash SHA-256 de 256 bits)
CREATE TABLE IF NOT EXISTS comprobantes_tokens_acceso (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  clave TEXT NOT NULL,
  token_hash VARCHAR(64) UNIQUE NOT NULL,
  expira_en TIMESTAMPTZ NOT NULL,
  revocado BOOLEAN NOT NULL DEFAULT FALSE,
  revocado_en TIMESTAMPTZ,
  accesos_contador INTEGER NOT NULL DEFAULT 0,
  ultimo_acceso TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_token_comprobante FOREIGN KEY (tenant_id, clave)
    REFERENCES comprobantes(tenant_id, clave) ON DELETE CASCADE
);

-- Índice parcial para búsqueda rápida de tokens activos por tenant y clave
CREATE INDEX IF NOT EXISTS idx_tokens_tenant_clave_activos 
  ON comprobantes_tokens_acceso (tenant_id, clave) 
  WHERE revocado = FALSE;

-- 2. Bitácora de Auditoría de Accesos y Descargas
CREATE TABLE IF NOT EXISTS auditoria_descargas_comprobantes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  clave TEXT NOT NULL,
  tipo_accion VARCHAR(20) NOT NULL, -- 'view_html', 'download_xml', 'download_pdf'
  ip_origen INET,
  user_agent VARCHAR(512),
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_auditoria_comprobante FOREIGN KEY (tenant_id, clave)
    REFERENCES comprobantes(tenant_id, clave) ON DELETE CASCADE
);

-- Índice para consultas de auditoría ordenadas cronológicamente
CREATE INDEX IF NOT EXISTS idx_auditoria_tenant_clave_fecha 
  ON auditoria_descargas_comprobantes (tenant_id, clave, fecha DESC);
