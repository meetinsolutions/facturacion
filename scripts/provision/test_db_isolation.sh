#!/usr/bin/env bash
set -euo pipefail

source /opt/facturacion-test/.pg_credentials
export PGPASSWORD="${POSTGRES_TEST_RUNNER_PASS}"

echo "=== TEST POSITIVO: Conectando a facturacion_test ==="
psql -h 127.0.0.1 -p 5433 -U facturacion_test_runner -d facturacion_test -c "SELECT current_user, current_database();"

echo "=== TEST NEGATIVO: Conectando a facturacion_saas ==="
if psql -h 127.0.0.1 -p 5433 -U facturacion_test_runner -d facturacion_saas -c "SELECT 1;" 2>&1; then
    echo "ERROR CRITICO: Pudo conectar a facturacion_saas" >&2
    exit 1
else
    echo "EXITO CONFIRMADO: Acceso a facturacion_saas denegado (Permission denied)."
fi
