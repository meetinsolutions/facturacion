#!/usr/bin/env bash
# ==============================================================================
# configure-onvo-sandbox.sh
# Configuración interactiva y segura de credenciales Sandbox de ONVO Pay
# No imprime claves completas ni las almacena en historiales o informes
# ==============================================================================
set -euo pipefail

ENV_FILE="/opt/facturacion-test/.env"

if [[ $EUID -ne 0 ]]; then
   echo "ERROR: Este script debe ejecutarse como root o con sudo." >&2
   exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
    echo "ERROR: ${ENV_FILE} no encontrado." >&2
    exit 1
fi

echo "======================================================================"
echo "    CONFIGURACIÓN SEGURA DE ONVO PAY SANDBOX (ENTORNO DE PRUEBAS)    "
echo "======================================================================"

if [[ -n "${ONVO_INPUT_SECRET_KEY:-}" && -n "${ONVO_INPUT_PUBLIC_KEY:-}" && -n "${ONVO_INPUT_WEBHOOK_SECRET:-}" ]]; then
    echo "Modo no-interactivo detectado vía variables de entorno seguras."
    SECRET_KEY="${ONVO_INPUT_SECRET_KEY}"
    PUBLIC_KEY="${ONVO_INPUT_PUBLIC_KEY}"
    WEBHOOK_SECRET="${ONVO_INPUT_WEBHOOK_SECRET}"
else
    echo "Obtenga estas claves desde: https://dashboard.onvopay.com"
    echo "Asegúrese de activar el switch 'Modo Sandbox' / 'Modo Pruebas'."
    echo "Las claves de prueba deben comenzar con: 'sk_test_' o 'onvo_test_'"
    echo "======================================================================"
    echo ""

    # 1. Solicitar Secret Key
    read -r -s -p "Ingrese la nueva ONVO_SECRET_KEY (Sandbox): " SECRET_KEY
    echo ""
    # 2. Solicitar Public Key
    read -r -s -p "Ingrese la nueva ONVO_PUBLIC_KEY (Sandbox): " PUBLIC_KEY
    echo ""
    # 3. Solicitar Webhook Secret
    read -r -s -p "Ingrese ONVO_WEBHOOK_SECRET (whsec_...): " WEBHOOK_SECRET
    echo ""
fi

if [[ -z "${SECRET_KEY}" ]]; then
    echo "ERROR: La clave secreta no puede estar vacía." >&2
    exit 1
fi

# Control estricto contra claves de producción
if [[ "${SECRET_KEY}" =~ (sk_live_|onvo_live_) || "${PUBLIC_KEY}" =~ (pk_live_|onvo_live_) ]]; then
    echo "======================================================================" >&2
    echo "ERROR CRÍTICO DE SEGURIDAD: Ha introducido una clave de PRODUCCIÓN." >&2
    echo "El entorno de pruebas prohíbe taxativamente claves con prefijo 'live'." >&2
    echo "Operación abortada de inmediato." >&2
    echo "======================================================================" >&2
    exit 1
fi

# Validación cruzada entre Secret y Public Key
if [[ "${SECRET_KEY}" == "${PUBLIC_KEY}" ]]; then
    echo "ERROR: La Secret Key y la Public Key no pueden ser idénticas." >&2
    exit 1
fi

if [[ "${SECRET_KEY}" =~ ^(pk_test_|pk_sandbox_) ]]; then
    echo "ERROR: Ha ingresado una Public Key en el campo de Secret Key." >&2
    exit 1
fi

if [[ "${PUBLIC_KEY}" =~ ^(sk_test_|sk_sandbox_) ]]; then
    echo "ERROR: Ha ingresado una Secret Key en el campo de Public Key." >&2
    exit 1
fi

if [[ ! "${SECRET_KEY}" =~ ^(sk_test_|onvo_test_|sk_sandbox_) ]]; then
    echo "ADVERTENCIA: La clave secreta no contiene prefijo habitual de sandbox ('sk_test_', 'onvo_test_')."
fi

if [[ -z "${WEBHOOK_SECRET}" ]]; then
    echo "ERROR: El secreto de webhook no puede estar vacío." >&2
    exit 1
fi

# 4. Actualizar .env de forma atómica y segura
echo "==> Actualizando ${ENV_FILE} de forma segura..."

MASKED_SECRET="${SECRET_KEY:0:8}...${SECRET_KEY: -4}"
MASKED_PUBLIC="${PUBLIC_KEY:0:8}...${PUBLIC_KEY: -4}"
MASKED_WEBHOOK="${WEBHOOK_SECRET:0:8}...${WEBHOOK_SECRET: -4}"

sed -i "s|^ONVO_SECRET_KEY=.*|ONVO_SECRET_KEY=${SECRET_KEY}|" "${ENV_FILE}"
sed -i "s|^ONVO_PUBLIC_KEY=.*|ONVO_PUBLIC_KEY=${PUBLIC_KEY}|" "${ENV_FILE}"
sed -i "s|^ONVO_WEBHOOK_SECRET=.*|ONVO_WEBHOOK_SECRET=${WEBHOOK_SECRET}|" "${ENV_FILE}"

# Permisos restrictivos
chown facturacion_test:facturacion_test "${ENV_FILE}"
chmod 600 "${ENV_FILE}"

# 5. Sincronizar en base de datos facturacion_test (platform_settings)
echo "==> Sincronizando configuración en base de datos facturacion_test..."
su -s /bin/bash facturacion_test -c "cd /opt/facturacion-test && npx tsx -e '
  import { saveGatewaysConfig } from \"./src/services/billing-service.js\";
  import { pool } from \"./src/db/pool.js\";
  async function run() {
    await saveGatewaysConfig({
      pasarelaActiva: \"onvopay\",
      onvopay: {
        publicKey: \"${PUBLIC_KEY}\",
        secretKey: \"${SECRET_KEY}\",
        webhookSecret: \"${WEBHOOK_SECRET}\"
      }
    });
    await pool.end();
  }
  run();
'"

echo "==> Reiniciando facturacion-test.service..."
systemctl restart facturacion-test.service
sleep 2

if systemctl is-active --quiet facturacion-test.service; then
    echo "======================================================================"
    echo "    CONFIGURACIÓN APLICADA EXITOSAMENTE                              "
    echo "======================================================================"
    echo "Secret Key configurada    : ${MASKED_SECRET}"
    echo "Public Key configurada    : ${MASKED_PUBLIC}"
    echo "Webhook Secret configurado: ${MASKED_WEBHOOK}"
    echo "Servicio facturacion-test : ACTIVO"
    echo "======================================================================"
    echo ""
    echo "==> Ejecutando prueba de conectividad no-destructiva contra ONVO Sandbox..."
    su -s /bin/bash facturacion_test -c "cd /opt/facturacion-test && npx tsx scripts/test-onvo-connection.ts"
else
    echo "ERROR: El servicio facturacion-test.service falló al reiniciar." >&2
    journalctl -u facturacion-test.service -n 20 --no-pager >&2
    exit 1
fi
