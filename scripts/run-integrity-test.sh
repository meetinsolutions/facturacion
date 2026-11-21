#!/bin/bash
set -e
cd /opt/facturacion

export DATABASE_URL="$(node --env-file=.env -e '
  const u = new URL(process.env.DATABASE_URL);
  u.pathname = "/facturacion_test";
  process.stdout.write(u.toString());
')"

echo "=== EJECUTANDO SUITE 1: INTEGRIDAD ETAPA A (8 PRUEBAS) ==="
npx tsx scripts/test-billing-integrity.ts

echo ""
echo "=== EJECUTANDO SUITE 2: SEGURIDAD Y ANTI-SANDBOX B3-INC1 (10 PRUEBAS) ==="
npx tsx scripts/test-b3-increment1.ts

echo ""
echo "=== EJECUTANDO SUITE 3: AUDITORÍA Y CHECKOUT ONVO B3-INC2 (23 PRUEBAS) ==="
npx tsx scripts/test-b3-increment2.ts
