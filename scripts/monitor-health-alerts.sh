#!/usr/bin/env bash
# ==============================================================================
# MEETINFACT QA — MONITOR DE SALUD Y DETECCIÓN DE INCIDENTES
# Monitorea: 1) Caída de servicio, 2) PostgreSQL, 3) Respaldo, 4) Espacio en disco
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALERT_SCRIPT="${SCRIPT_DIR}/send-alert.sh"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/meetinfact-qa}"
DISK_THRESHOLD="${DISK_THRESHOLD:-85}"

echo "🔍 [MONITOR QA] Ejecutando ronda de chequeos de infraestructura..."

# 1. Chequeo de caída de servicio systemd
if ! systemctl is-active --quiet facturacion-test.service; then
  echo "❌ [FALLO] El servicio facturacion-test.service NO está activo."
  "$ALERT_SCRIPT" "SERVICIO_CAIDO" "El servicio facturacion-test.service se encuentra detenido o en estado fallido." "CRITICO"
else
  echo "✅ Servicio facturacion-test.service activo."
fi

# 2. Chequeo de PostgreSQL (Port 5433)
if ! docker exec -e PGPASSWORD=8pVkVpWpj4NrxmGIwZGbHd8 facturacion_postgres psql -U facturacion_admin -d facturacion_test -c "SELECT 1;" > /dev/null 2>&1; then
  echo "❌ [FALLO] PostgreSQL (facturacion_test en puerto 5433) no responde consultas."
  "$ALERT_SCRIPT" "POSTGRES_CAIDO" "PostgreSQL en facturacion_postgres (facturacion_test) no responde consultas SQL." "CRITICO"
else
  echo "✅ PostgreSQL facturacion_postgres respondiendo correctamente."
fi

# 3. Chequeo de espacio en disco (partición raíz /)
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
if [ "$DISK_USAGE" -ge "$DISK_THRESHOLD" ]; then
  echo "⚠️ [FALLO] Uso de disco crítico: ${DISK_USAGE}% (Umbral: ${DISK_THRESHOLD}%)."
  "$ALERT_SCRIPT" "DISCO_LLENO" "Alerta de capacidad: la partición raíz ha alcanzado el ${DISK_USAGE}% de ocupación." "ALTO"
else
  echo "✅ Espacio en disco saludable: ${DISK_USAGE}% en uso (Umbral: ${DISK_THRESHOLD}%)."
fi

# 4. Chequeo de respaldo programado (verificar si existe respaldo en las últimas 26 horas)
LATEST_BACKUP=$(find "$BACKUP_DIR" -name "facturacion_test_*.dump.enc" -type f -mmin -1560 2>/dev/null | head -n 1 || true)
if [ -z "$LATEST_BACKUP" ]; then
  TOTAL_BACKUPS=$(find "$BACKUP_DIR" -name "facturacion_test_*.dump.enc" -type f 2>/dev/null | wc -l || true)
  if [ "$TOTAL_BACKUPS" -eq 0 ]; then
    echo "⚠️ [ALERTA] No se ha generado ningún respaldo cifrado en $BACKUP_DIR aún."
    "$ALERT_SCRIPT" "RESPALDO_AUSENTE" "No existe ningún respaldo en $BACKUP_DIR." "MEDIO"
  else
    echo "⚠️ [ALERTA] El último respaldo cifrado tiene más de 26 horas de antigüedad."
    "$ALERT_SCRIPT" "RESPALDO_DESACTUALIZADO" "No se detecta un respaldo reciente generado en las últimas 26 horas en $BACKUP_DIR." "ALTO"
  fi
else
  echo "✅ Respaldo reciente detectado: $(basename "$LATEST_BACKUP")."
fi

echo "🏁 [MONITOR QA] Ronda de chequeos finalizada exitosamente."
exit 0
