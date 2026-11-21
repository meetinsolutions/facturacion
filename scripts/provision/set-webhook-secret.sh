#!/usr/bin/env bash
# ==============================================================================
# set-webhook-secret.sh
# Configura exclusivamente la clave de firma de webhooks en facturacion-test
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

if [[ -n "${1:-}" ]]; then
    WEBHOOK_SECRET="$1"
else
    echo "======================================================================"
    echo "    CONFIGURAR CLAVE DE FIRMA DE WEBHOOKS (ONVO SANDBOX)             "
    echo "======================================================================"
    read -r -s -p "Pegue la clave de webhooks (whsec_...): " WEBHOOK_SECRET
    echo ""
fi

if [[ -z "${WEBHOOK_SECRET}" ]]; then
    echo "ERROR: La clave de webhook no puede estar vacía." >&2
    exit 1
fi

# Actualizar en .env
sed -i "s|^ONVO_WEBHOOK_SECRET=.*|ONVO_WEBHOOK_SECRET=${WEBHOOK_SECRET}|" "${ENV_FILE}"
chown facturacion_test:facturacion_test "${ENV_FILE}"
chmod 600 "${ENV_FILE}"

# Sincronizar en base de datos facturacion_test
echo "==> Sincronizando secreto en base de datos facturacion_test..."
su -s /bin/bash facturacion_test -c "cd /opt/facturacion-test && npx tsx -e '
  import { saveGatewaysConfig, getGatewaysConfig } from \"./src/services/billing-service.js\";
  import { pool } from \"./src/db/pool.js\";
  async function run() {
    const cur = await getGatewaysConfig();
    await saveGatewaysConfig({
      pasarelaActiva: \"onvopay\",
      onvopay: {
        ...cur.onvopay,
        webhookSecret: \"${WEBHOOK_SECRET}\"
      }
    });
    await pool.end();
  }
  run();
'"

echo "==> Reiniciando facturacion-test.service..."
systemctl restart facturacion-test.service
sleep 1

MASKED="${WEBHOOK_SECRET:0:8}...${WEBHOOK_SECRET: -4}"
echo "======================================================================"
echo "✓ Clave de webhooks configurada con éxito: ${MASKED}"
echo "✓ Servicio facturacion-test.service activo."
echo "======================================================================"
