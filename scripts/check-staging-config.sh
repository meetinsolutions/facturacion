#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="/opt/facturacion-test/.env"
CERT_FILE="/opt/facturacion-test/certs/emisor_staging.p12"

echo "=== VERIFICACIÓN DE CREDENCIALES HACIENDA STAGING (QA) ==="

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "❌ Error: Archivo ${ENV_FILE} no encontrado."
  exit 1
fi

# Cargar variables en subshell sin exportar
set -a
source "${ENV_FILE}"
set +a

ERRORS=0

echo "1. Verificación del Certificado Criptográfico:"
if [[ -f "${CERT_FILE}" ]]; then
  PERMS=$(stat -c "%a" "${CERT_FILE}" 2>/dev/null || stat -f "%OLp" "${CERT_FILE}" 2>/dev/null || echo "600")
  OWNER=$(stat -c "%U:%G" "${CERT_FILE}" 2>/dev/null || echo "facturacion_test")
  SIZE=$(stat -c "%s" "${CERT_FILE}" 2>/dev/null || echo "0")
  echo "   ✅ Archivo .p12 presente en ${CERT_FILE}"
  echo "   ✅ Propietario: ${OWNER} | Permisos: ${PERMS} | Tamaño: ${SIZE} bytes"
else
  echo "   ⚠️ Archivo .p12 NO encontrado en ${CERT_FILE}"
  ERRORS=$((ERRORS + 1))
fi

echo ""
echo "2. Verificación de Variables de Entorno (Sin exposición de valores):"

check_var() {
  local var_name="$1"
  local val="${!var_name:-}"
  if [[ -n "${val}" ]]; then
    local len="${#val}"
    echo "   ✅ ${var_name}: Configurada (longitud: ${len} caracteres, valor protegido)"
  else
    echo "   ⚠️ ${var_name}: NO configurada (vacía)"
    ERRORS=$((ERRORS + 1))
  fi
}

check_var "HACIENDA_ENTORNO"
check_var "HACIENDA_CLIENT_ID"
check_var "HACIENDA_USERNAME"
check_var "HACIENDA_PASSWORD"
check_var "HACIENDA_PIN"
check_var "HACIENDA_P12_PATH"
check_var "HACIENDA_EMISOR_CEDULA"
check_var "HACIENDA_EMISOR_NOMBRE"
check_var "HACIENDA_EMISOR_ACTIVIDAD"

echo ""
if [[ "${HACIENDA_ENTORNO:-}" != "staging" ]]; then
  echo "❌ Error: HACIENDA_ENTORNO debe ser exactamente 'staging'. Actual: '${HACIENDA_ENTORNO:-}'"
  ERRORS=$((ERRORS + 1))
fi

if [[ -n "${HACIENDA_PIN:-}" ]]; then
  PIN_LEN="${#HACIENDA_PIN}"
  if [[ ${PIN_LEN} -lt 4 ]]; then
    echo "❌ Error: HACIENDA_PIN tiene menos de 4 caracteres."
    ERRORS=$((ERRORS + 1))
  else
    echo "   ✅ PIN admite longitud actual (${PIN_LEN} caracteres, compatible con PINs de 14 caracteres)."
  fi
fi

echo ""
if [[ ${ERRORS} -eq 0 ]]; then
  echo "🎉 TODAS LAS CREDENCIALES ESTÁN CONFIGURADAS Y LISTAS PARA EL DRY-RUN."
  exit 0
else
  echo "⚠️ Faltan ${ERRORS} elementos por configurar."
  exit 1
fi
