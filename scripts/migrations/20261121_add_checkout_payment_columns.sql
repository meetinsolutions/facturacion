-- scripts/migrations/20261121_add_checkout_payment_columns.sql
-- MeetinFact SaaS - Etapa B3 Incremento 2
-- Almacenamiento inequívoco de referencias de checkout y pagos confirmados

ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS checkout_session_id TEXT;
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS payment_intent_id TEXT;

-- Índice único parcial para evitar duplicación de sesiones de checkout
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transactions_checkout_session 
  ON payment_transactions (checkout_session_id) 
  WHERE checkout_session_id IS NOT NULL;

-- Índice único parcial para garantizar idempotencia: un mismo pago/intent no puede asociarse a dos transacciones
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transactions_payment_intent 
  ON payment_transactions (payment_intent_id) 
  WHERE payment_intent_id IS NOT NULL;
