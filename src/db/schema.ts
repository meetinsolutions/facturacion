import { pool } from './pool.js';

export async function initDatabaseSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id UUID PRIMARY KEY,
      nombre TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      cedula TEXT,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nombre TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

    CREATE TABLE IF NOT EXISTS tenant_configs (
      tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      emisor_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      sitio_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      hacienda_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      hacienda_password_enc TEXT,
      hacienda_pin_enc TEXT,
      correo_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      correo_password_enc TEXT,
      cert_p12_enc TEXT,
      cert_filename TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS productos (
      id TEXT NOT NULL,
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      codigo_interno TEXT NOT NULL,
      codigo_cabys TEXT NOT NULL,
      detalle TEXT NOT NULL,
      precio_unitario NUMERIC(18,5) NOT NULL,
      moneda TEXT NOT NULL DEFAULT 'CRC',
      unidad_medida TEXT NOT NULL DEFAULT 'Unid',
      tarifa_iva NUMERIC(6,2) NOT NULL DEFAULT 13,
      codigo_tarifa_iva TEXT NOT NULL DEFAULT '08',
      categoria TEXT NOT NULL DEFAULT 'General',
      stock INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (tenant_id, id)
    );

    CREATE TABLE IF NOT EXISTS categorias (
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      nombre TEXT NOT NULL,
      PRIMARY KEY (tenant_id, nombre)
    );

    CREATE TABLE IF NOT EXISTS clientes (
      id TEXT NOT NULL,
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      nombre TEXT NOT NULL,
      nombre_comercial TEXT,
      tipo_identificacion TEXT NOT NULL DEFAULT '01',
      cedula TEXT NOT NULL,
      correo TEXT,
      telefono TEXT,
      direccion TEXT,
      condicion_venta TEXT NOT NULL DEFAULT '01',
      plazo_credito INTEGER NOT NULL DEFAULT 30,
      moneda_preferida TEXT,
      notas TEXT,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_id, id)
    );

    CREATE TABLE IF NOT EXISTS secuencias_consecutivos (
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      tipo_documento TEXT NOT NULL,
      ultimo_numero BIGINT NOT NULL DEFAULT 0,
      numero_inicial BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (tenant_id, tipo_documento)
    );

    CREATE TABLE IF NOT EXISTS comprobantes (
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      clave TEXT NOT NULL,
      consecutivo TEXT NOT NULL,
      tipo_documento TEXT NOT NULL,
      fecha TIMESTAMPTZ NOT NULL,
      moneda TEXT NOT NULL,
      total NUMERIC(18,5) NOT NULL,
      cliente TEXT NOT NULL,
      estado_hacienda TEXT NOT NULL,
      estilo TEXT,
      notas TEXT,
      correo_cliente TEXT,
      correo_enviado BOOLEAN NOT NULL DEFAULT FALSE,
      correo_enviado_en TIMESTAMPTZ,
      correo_destinatario TEXT,
      correo_error TEXT,
      xml_firmado TEXT NOT NULL,
      doc_original_json JSONB NOT NULL,
      PRIMARY KEY (tenant_id, clave)
    );
    CREATE INDEX IF NOT EXISTS idx_comprobantes_tenant_fecha ON comprobantes(tenant_id, fecha DESC);

    CREATE TABLE IF NOT EXISTS gastos (
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      clave TEXT NOT NULL,
      consecutivo TEXT NOT NULL,
      tipo_documento TEXT NOT NULL,
      tipo_documento_nombre TEXT NOT NULL,
      fecha_emision TIMESTAMPTZ NOT NULL,
      emisor_nombre TEXT NOT NULL,
      emisor_nombre_comercial TEXT,
      emisor_cedula TEXT NOT NULL,
      emisor_tipo_id TEXT,
      emisor_correo TEXT,
      receptor_nombre TEXT,
      receptor_cedula TEXT,
      moneda TEXT NOT NULL DEFAULT 'CRC',
      tipo_cambio NUMERIC(18,5) NOT NULL DEFAULT 1,
      subtotal_gravado NUMERIC(18,5) NOT NULL DEFAULT 0,
      subtotal_exento NUMERIC(18,5) NOT NULL DEFAULT 0,
      total_descuentos NUMERIC(18,5) NOT NULL DEFAULT 0,
      total_venta_neta NUMERIC(18,5) NOT NULL DEFAULT 0,
      total_impuesto NUMERIC(18,5) NOT NULL DEFAULT 0,
      total_comprobante NUMERIC(18,5) NOT NULL DEFAULT 0,
      total_crc NUMERIC(18,5) NOT NULL DEFAULT 0,
      impuesto_crc NUMERIC(18,5) NOT NULL DEFAULT 0,
      desglose_iva_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      lineas_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      categoria_gasto TEXT NOT NULL DEFAULT 'General / Sin Clasificar',
      estado_confirmacion TEXT NOT NULL DEFAULT 'pendiente',
      notas TEXT,
      origen TEXT NOT NULL DEFAULT 'carga_manual',
      correo_uid BIGINT,
      correo_asunto TEXT,
      correo_remitente TEXT,
      correo_fecha TIMESTAMPTZ,
      tiene_xml BOOLEAN NOT NULL DEFAULT FALSE,
      tiene_pdf BOOLEAN NOT NULL DEFAULT FALSE,
      xml_content TEXT,
      pdf_content BYTEA,
      importado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_id, clave)
    );
    CREATE INDEX IF NOT EXISTS idx_gastos_tenant_fecha ON gastos(tenant_id, fecha_emision DESC);

    CREATE TABLE IF NOT EXISTS gastos_sync_estado (
      tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      ultima_sincronizacion TIMESTAMPTZ,
      ultimo_resumen_json JSONB,
      ultimo_error TEXT
    );

    CREATE TABLE IF NOT EXISTS plans (
      code TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      descripcion TEXT NOT NULL,
      precio_mensual_crc NUMERIC(12,2) NOT NULL DEFAULT 0,
      precio_anual_crc NUMERIC(12,2) NOT NULL DEFAULT 0,
      precio_mensual_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
      precio_anual_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
      moneda TEXT NOT NULL DEFAULT 'CRC',
      limite_comprobantes_mes INTEGER NOT NULL,
      limite_usuarios INTEGER NOT NULL,
      permite_imap_gastos BOOLEAN NOT NULL DEFAULT FALSE,
      permite_envio_correo BOOLEAN NOT NULL DEFAULT TRUE,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      orden INTEGER NOT NULL DEFAULT 0
    );

    ALTER TABLE plans ADD COLUMN IF NOT EXISTS precio_mensual_crc NUMERIC(12,2) DEFAULT 0;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS precio_anual_crc NUMERIC(12,2) DEFAULT 0;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS moneda TEXT DEFAULT 'CRC';

    CREATE TABLE IF NOT EXISTS subscriptions (
      id UUID PRIMARY KEY,
      tenant_id UUID UNIQUE NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      plan_code TEXT NOT NULL REFERENCES plans(code),
      status TEXT NOT NULL DEFAULT 'trialing',
      billing_cycle TEXT NOT NULL DEFAULT 'monthly',
      current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      current_period_end TIMESTAMPTZ NOT NULL,
      next_billing_date TIMESTAMPTZ,
      provider TEXT NOT NULL DEFAULT 'trial',
      provider_customer_id TEXT,
      provider_subscription_id TEXT,
      cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payment_transactions (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
      plan_code TEXT NOT NULL REFERENCES plans(code),
      billing_cycle TEXT NOT NULL DEFAULT 'monthly',
      amount_usd NUMERIC(10,2) NOT NULL,
      amount_crc NUMERIC(12,2),
      currency TEXT NOT NULL DEFAULT 'CRC',
      provider TEXT NOT NULL,
      provider_reference TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      comprobante_notas TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      paid_at TIMESTAMPTZ
    );
    ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS amount_crc NUMERIC(12,2);
    ALTER TABLE payment_transactions ALTER COLUMN currency SET DEFAULT 'CRC';
    CREATE INDEX IF NOT EXISTS idx_payment_transactions_tenant ON payment_transactions(tenant_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY,
      value_enc TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const planesDefault = [
    {
      code: 'trial',
      nombre: 'Prueba Gratis 14 Días',
      descripcion: 'Prueba completa con envío PDF+XML y Control de Gastos IMAP (hasta 5 comprobantes).',
      mensualCrc: 0,
      anualCrc: 0,
      mensualUsd: 0,
      anualUsd: 0,
      limiteComp: 5,
      limiteUsers: 1,
      imap: true,
      correo: true,
      orden: 1
    },
    {
      code: 'emprendedor',
      nombre: 'Plan Emprendedor',
      descripcion: 'Hasta 100 comprobantes mensuales, catálogo de productos/clientes y envío PDF+XML.',
      mensualCrc: 6900,
      anualCrc: 69000,
      mensualUsd: 15,
      anualUsd: 150,
      limiteComp: 100,
      limiteUsers: 2,
      imap: false,
      correo: true,
      orden: 2
    },
    {
      code: 'pro',
      nombre: 'Plan Profesional',
      descripcion: 'Comprobantes ilimitados, múltiples usuarios y Control de Gastos IMAP automático.',
      mensualCrc: 12900,
      anualCrc: 129000,
      mensualUsd: 25,
      anualUsd: 250,
      limiteComp: -1,
      limiteUsers: 5,
      imap: true,
      correo: true,
      orden: 3
    },
    {
      code: 'empresarial',
      nombre: 'Plan Empresarial',
      descripcion: 'Comprobantes ilimitados, hasta 20 usuarios y todas las automatizaciones fiscales.',
      mensualCrc: 34900,
      anualCrc: 349000,
      mensualUsd: 75,
      anualUsd: 750,
      limiteComp: -1,
      limiteUsers: 20,
      imap: true,
      correo: true,
      orden: 4
    }
  ];

  for (const p of planesDefault) {
    await pool.query(
      `INSERT INTO plans (code, nombre, descripcion, precio_mensual_crc, precio_anual_crc, precio_mensual_usd, precio_anual_usd, moneda, limite_comprobantes_mes, limite_usuarios, permite_imap_gastos, permite_envio_correo, activo, orden)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'CRC',$8,$9,$10,$11,TRUE,$12)
       ON CONFLICT (code) DO UPDATE
       SET precio_mensual_crc = EXCLUDED.precio_mensual_crc,
           precio_anual_crc = EXCLUDED.precio_anual_crc,
           moneda = 'CRC'`,
      [p.code, p.nombre, p.descripcion, p.mensualCrc, p.anualCrc, p.mensualUsd, p.anualUsd, p.limiteComp, p.limiteUsers, p.imap, p.correo, p.orden]
    );
  }
}
