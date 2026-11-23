-- ======================================================================
-- MEETINFACT — MIGRACIÓN A MONEDA COMERCIAL EN COLONES (CRC)
-- Entorno: QA facturacion_test
-- ======================================================================

ALTER TABLE plans ADD COLUMN IF NOT EXISTS precio_mensual_crc NUMERIC(12,2) DEFAULT 0;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS precio_anual_crc NUMERIC(12,2) DEFAULT 0;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS moneda TEXT DEFAULT 'CRC';

ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS amount_crc NUMERIC(12,2);
ALTER TABLE payment_transactions ALTER COLUMN currency SET DEFAULT 'CRC';

-- Aplicar tabla de precios en colones costarricenses (CRC)
UPDATE plans SET
  precio_mensual_crc = 0.00,
  precio_anual_crc = 0.00,
  moneda = 'CRC'
WHERE code = 'trial';

UPDATE plans SET
  precio_mensual_crc = 6900.00,
  precio_anual_crc = 69000.00,
  moneda = 'CRC'
WHERE code = 'emprendedor';

UPDATE plans SET
  nombre = 'Plan Profesional',
  precio_mensual_crc = 12900.00,
  precio_anual_crc = 129000.00,
  moneda = 'CRC'
WHERE code = 'pro';

UPDATE plans SET
  precio_mensual_crc = 34900.00,
  precio_anual_crc = 349000.00,
  moneda = 'CRC'
WHERE code = 'empresarial';
