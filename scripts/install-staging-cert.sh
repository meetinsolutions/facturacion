#!/usr/bin/env bash
set -euo pipefail

TRANSFER_DIR="/root/.staging_transfer"
TARGET_FILE="/opt/facturacion-test/certs/emisor_staging.p12"
SERVICE_USER="facturacion_test"

echo "=== INSTALADOR SEGURO DE CERTIFICADO HACIENDA STAGING ==="

# Buscar archivo .p12 en el directorio de transferencia temporal
SOURCE_P12=$(find "${TRANSFER_DIR}" -maxdepth 1 -name "*.p12" -type f | head -n 1)

if [[ -z "${SOURCE_P12}" ]]; then
  echo "❌ Error: No se encontró ningún archivo .p12 en ${TRANSFER_DIR}."
  echo "Por favor transfiera su certificado a ${TRANSFER_DIR} antes de ejecutar este script."
  exit 1
fi

echo "-> Archivo detectado: $(basename "${SOURCE_P12}")"
echo "-> Moviendo a ubicación definitiva ${TARGET_FILE}..."
mv "${SOURCE_P12}" "${TARGET_FILE}"

echo "-> Asignando propiedad a ${SERVICE_USER}:${SERVICE_USER}..."
chown "${SERVICE_USER}:${SERVICE_USER}" "${TARGET_FILE}"

echo "-> Restringiendo permisos a 600 (-rw-------)..."
chmod 600 "${TARGET_FILE}"

# Limpieza estricta del directorio temporal
rm -f "${TRANSFER_DIR}"/* 2>/dev/null || true

echo "✅ Certificado instalado con éxito y copia temporal eliminada."
ls -l "${TARGET_FILE}"
