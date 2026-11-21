#!/usr/bin/env bash
# ==============================================================================
# set-api-keys.sh
# Configura interactivamente ONVO_SECRET_KEY y ONVO_PUBLIC_KEY en facturacion-test
# Preserva el ONVO_WEBHOOK_SECRET ya configurado.
# ==============================================================================
set -euo pipefail

ENV_FILE="/opt/facturacion-test/.env"

if [[ $EUID -ne 0 ]]; then
   echo "ERROR: Debe ejecutarse como root o con sudo." >&2
   exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
    echo "ERROR: ${ENV_FILE} no encontrado." >&2
    exit 1
fi

echo "======================================================================"
echo "    CONFIGURACIÓN DE CLAVES API DE ONVO SANDBOX (SECRET & PUBLIC)    "
echo "======================================================================"
echo "Obtenga estas claves desde: https://dashboard.onvopay.com"
echo "Sección: Desarrolladores > Claves API (Modo Sandbox activo)"
echo "======================================================================"
echo ""

# 1. Solicitar Secret Key
read -r -s -p "Pegue la nueva ONVO_SECRET_KEY (sk_test_...): " SECRET_KEY
echo ""

if [[ -z "${SECRET_KEY}" ]]; then
    echo "ERROR: La Secret Key no puede estar vacía." >&2
    exit 1
fi

# Validaciones de seguridad
if [[ "${SECRET_KEY}" =~ (sk_live_|onvo_live_) ]]; then
    echo "ERROR CRÍTICO: Ha introducido una clave de PRODUCCIÓN. Operación abortada." >&2
    exit 1
fi

if [[ "${SECRET_KEY}" =~ ^(pk_test_|pk_sandbox_) ]]; then
    echo "ERROR: Ha introducido una Public Key en lugar de una Secret Key." >&2
    exit 1
fi

# 2. Solicitar Public Key
read -r -s -p "Pegue la nueva ONVO_PUBLIC_KEY (pk_test_...): " PUBLIC_KEY
echo ""

if [[ -z "${PUBLIC_KEY}" ]]; then
    echo "ERROR: La Public Key no puede estar vacía." >&2
    exit 1
fi

if [[ "${PUBLIC_KEY}" =~ (pk_live_|onvo_live_) ]]; then
    echo "ERROR CRÍTICO: Ha introducido una clave pública de PRODUCCIÓN." >&2
    exit 1
fi

if [[ "${SECRET_KEY}" == "${PUBLIC_KEY}" ]]; then
    echo "ERROR: La Secret Key y la Public Key no pueden ser idénticas." >&2
    exit 1
fi

# 3. Actualizar .env preservando el webhook secret existente
sed -i "s|^ONVO_SECRET_KEY=.*|ONVO_SECRET_KEY=${SECRET_KEY}|" "${ENV_FILE}"
sed -i "s|^ONVO_PUBLIC_KEY=.*|ONVO_PUBLIC_KEY=${PUBLIC_KEY}|" "${ENV_FILE}"

chown facturacion_test:facturacion_test "${ENV_FILE}"
chmod 600 "${ENV_FILE}"

# 4. Sincronizar en PostgreSQL platform_settings
echo "==> Sincronizando claves en base de datos facturacion_test..."
su -s /bin/bash facturacion_test -c "cd /opt/facturacion-test && npx tsx scripts/sync-gateways-from-env.ts"

# 5. Reiniciar servicio
systemctl restart facturacion-test.service
sleep 1

MASKED_SEC="${SECRET_KEY:0:8}...${SECRET_KEY: -4}"
MASKED_PUB="${PUBLIC_KEY:0:8}...${PUBLIC_KEY: -4}"

echo "======================================================================"
echo "✓ Secret Key configurada : ${MASKED_SEC}"
echo "✓ Public Key configurada : ${MASKED_PUB}"
echo "✓ Webhook Secret actual  : PRESERVADO INTACTO"
echo "✓ Servicio facturacion-test reiniciado."
echo "======================================================================"
echo ""
echo "==> Ejecutando prueba de autenticación de solo lectura contra ONVO Sandbox..."
su -s /bin/bash facturacion_test -c "cd /opt/facturacion-test && npx tsx scripts/test-onvo-connection.ts"
