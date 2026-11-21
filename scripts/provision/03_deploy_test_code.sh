#!/usr/bin/env bash
# ==============================================================================
# 03_deploy_test_code.sh
# Despliegue del código fuente en /opt/facturacion-test e instalación de dependencias
# ==============================================================================
set -euo pipefail

SOURCE_DIR="/opt/facturacion"
TARGET_DIR="/opt/facturacion-test"
TEST_USER="facturacion_test"

echo "==> [Paso 1/4] Sincronizando árbol de código hacia ${TARGET_DIR}..."
rsync -av --delete \
    --exclude='.git' \
    --exclude='.env' \
    --exclude='node_modules' \
    --exclude='*.log' \
    "${SOURCE_DIR}/" "${TARGET_DIR}/"

echo "==> [Paso 2/4] Instalando dependencias de producción en ${TARGET_DIR}..."
cd "${TARGET_DIR}"
npm ci --omit=dev

echo "==> [Paso 3/4] Generando archivo de configuración .env aislado..."
CREDS_FILE="${TARGET_DIR}/.pg_credentials"
if [[ -f "${CREDS_FILE}" ]]; then
    source "${CREDS_FILE}"
else
    echo "ERROR: Archivo ${CREDS_FILE} no encontrado. Ejecute primero 02_setup_postgres_test_runner.sh." >&2
    exit 1
fi

JWT_SECRET_TEST=$(openssl rand -hex 32)

cat <<EOF > "${TARGET_DIR}/.env"
# Configuración del Entorno de Pruebas Aislado ONVO
NODE_ENV=test
PORT=3055
HOST=127.0.0.1
APP_URL=https://test-facturacion.meetinlabs.com

# Base de datos aislada conectando con el rol sin privilegios en producción
DATABASE_URL=postgresql://facturacion_test_runner:${POSTGRES_TEST_RUNNER_PASS}@127.0.0.1:5433/facturacion_test

# Seguridad de Sesión
JWT_SECRET=${JWT_SECRET_TEST}

# Credenciales de Prueba ONVO Pay (Sandbox de ONVO)
# Configurar antes de iniciar pruebas reales
ONVO_SECRET_KEY=${ONVO_TEST_SECRET_KEY:-}
ONVO_PUBLIC_KEY=${ONVO_TEST_PUBLIC_KEY:-}
ONVO_WEBHOOK_SECRET=${ONVO_TEST_WEBHOOK_SECRET:-}

# Integraciones externas deshabilitadas en pruebas
ALLOW_SANDBOX_CHECKOUT=false
STRIPE_SECRET_KEY=
TILOPAY_API_KEY=
TILOPAY_API_USER=
EOF

# Eliminar archivo temporal de credenciales una vez volcado al .env
rm -f "${CREDS_FILE}"

echo "==> [Paso 4/4] Estableciendo propiedad y permisos restrictivos..."
chown -R "${TEST_USER}:${TEST_USER}" "${TARGET_DIR}"
chmod 600 "${TARGET_DIR}/.env"

echo "Despliegue de código y configuración completado."
