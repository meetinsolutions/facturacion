#!/usr/bin/env bash
# ==============================================================================
# 02_setup_postgres_test_runner.sh
# Ejecutor seguro de aprovisionamiento de usuario PostgreSQL
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="${SCRIPT_DIR}/02_setup_postgres_test_runner.sql"

# Si no se provee la contraseña como variable de entorno, se genera una aleatoria criptográficamente segura
if [[ -z "${TEST_RUNNER_PASS:-}" ]]; then
    TEST_RUNNER_PASS=$(openssl rand -hex 24)
    echo "Contraseña generada automáticamente para facturacion_test_runner."
fi

echo "==> Aplicando aislamiento de permisos en PostgreSQL..."
docker exec -i facturacion_postgres psql -U facturacion_admin -d postgres \
    -v test_runner_pass="${TEST_RUNNER_PASS}" \
    -f - < "${SQL_FILE}"

echo "==> Guardando credencial en archivo temporal de aprovisionamiento con permisos 600..."
CREDS_FILE="/opt/facturacion-test/.pg_credentials"
mkdir -p /opt/facturacion-test
echo "POSTGRES_TEST_RUNNER_PASS=${TEST_RUNNER_PASS}" > "${CREDS_FILE}"
chmod 600 "${CREDS_FILE}"
chown facturacion_test:facturacion_test "${CREDS_FILE}" 2>/dev/null || true

echo "Configuración de PostgreSQL completada."
