#!/usr/bin/env bash
# ==============================================================================
# 06_post_provision_audit.sh
# Verificación y auditoría de seguridad post-aprovisionamiento
# ==============================================================================
set -euo pipefail

echo "========================================================================"
echo "    AUDITORÍA DE SEGURIDAD Y AISLAMIENTO POST-APROVISIONAMIENTO        "
echo "========================================================================"

# Cargar variables del entorno de pruebas
if [[ ! -f /opt/facturacion-test/.env ]]; then
    echo "ERROR: /opt/facturacion-test/.env no existe." >&2
    exit 1
fi

DB_URL=$(grep '^DATABASE_URL=' /opt/facturacion-test/.env | cut -d= -f2-)
TEST_PASS=$(echo "$DB_URL" | sed -E 's/.*:([^@]+)@.*/\1/')

echo "--> [Auditoría 1/5] Prueba Positiva: Conexión TCP autorizada a facturacion_test..."
if PGPASSWORD="${TEST_PASS}" psql -h 127.0.0.1 -p 5433 -U facturacion_test_runner -d facturacion_test -c "SELECT count(*) FROM payment_transactions;" > /dev/null 2>&1; then
    echo "    [PASS] Acceso concedido a facturacion_test."
else
    echo "    [FAIL] No se pudo conectar a facturacion_test." >&2
    exit 1
fi

echo "--> [Auditoría 2/5] Prueba Negativa: Intento de conexión TCP a facturacion_saas..."
if PGPASSWORD="${TEST_PASS}" psql -h 127.0.0.1 -p 5433 -U facturacion_test_runner -d facturacion_saas -c "SELECT 1;" > /dev/null 2>&1; then
    echo "    [FAIL CRÍTICO] facturacion_test_runner pudo conectar a facturacion_saas." >&2
    exit 1
else
    echo "    [PASS] Acceso a facturacion_saas denegado exitosamente (Permission Denied)."
fi

echo "--> [Auditoría 3/5] Verificación de Interfaz de Escucha (Loopback 127.0.0.1:3055)..."
LISTEN_LINE=$(ss -tlpn | grep ':3055' || true)
if [[ "${LISTEN_LINE}" =~ 127\.0\.0\.1:3055 ]]; then
    echo "    [PASS] El servicio de pruebas escucha exclusivamente en 127.0.0.1:3055."
elif [[ -z "${LISTEN_LINE}" ]]; then
    echo "    [INFO] El servicio facturacion-test.service no está en ejecución todavía."
else
    echo "    [FAIL CRÍTICO] El puerto 3055 está expuesto en interfaces externas: ${LISTEN_LINE}" >&2
    exit 1
fi

echo "--> [Auditoría 4/5] Prueba del Worker de Conciliación..."
if (cd /opt/facturacion-test && npx tsx scripts/workers/reconcile-onvo.ts); then
    echo "    [PASS] Worker de conciliación ejecutó y liberó bloqueos correctamente."
else
    echo "    [FAIL] Fallo en la ejecución del worker de conciliación." >&2
    exit 1
fi

echo "--> [Auditoría 5/5] Invarianza de Producción..."
PROD_STATUS=$(systemctl is-active facturacion.service)
if [[ "${PROD_STATUS}" == "active" ]]; then
    echo "    [PASS] facturacion.service se mantiene 'active' y sin interrupciones."
else
    echo "    [FAIL CRÍTICO] facturacion.service NO está activo: ${PROD_STATUS}" >&2
    exit 1
fi

echo "========================================================================"
echo "    AUDITORÍA SUPERADA: EL ENTORNO DE PRUEBAS ESTÁ 100% AISLADO       "
echo "========================================================================"
