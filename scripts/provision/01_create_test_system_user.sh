#!/usr/bin/env bash
# ==============================================================================
# 01_create_test_system_user.sh
# Creación del usuario Linux de pruebas y directorio aislado
# ==============================================================================
set -euo pipefail

TEST_USER="facturacion_test"
TEST_DIR="/opt/facturacion-test"

echo "==> [Paso 1/2] Verificando usuario Linux '${TEST_USER}'..."
if id "${TEST_USER}" &>/dev/null; then
    echo "El usuario ${TEST_USER} ya existe. Omitiendo creación."
else
    useradd -r -s /usr/sbin/nologin -d "${TEST_DIR}" -c "Usuario aislado para entorno de pruebas MeetinFact ONVO" "${TEST_USER}"
    echo "Usuario ${TEST_USER} creado exitosamente."
fi

echo "==> [Paso 2/2] Creando estructura de directorios en '${TEST_DIR}'..."
mkdir -p "${TEST_DIR}"
chown -R "${TEST_USER}:${TEST_USER}" "${TEST_DIR}"
chmod 750 "${TEST_DIR}"

echo "Configuración base de usuario y directorio completada."
