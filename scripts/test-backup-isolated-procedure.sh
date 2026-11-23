#!/usr/bin/env bash
set -euo pipefail

echo "=== TEST PROCEDIMIENTO DE RESPALDO Y RESTAURACIÓN AISLADA (QA) ==="

# 1. Definir variables exactas sin comodines
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DB_SOURCE="facturacion_test"
DB_CONTAINER="facturacion_postgres"
DB_USER="facturacion_admin"
PG_PASS="8pVkVpWpj4NrxmGIwZGbHd8"

CONTAINER_TMP="/tmp/${DB_SOURCE}_${TIMESTAMP}.dump"
HOST_BACKUP_DIR="/var/backups/meetinfact-qa"
HOST_DUMP="${HOST_BACKUP_DIR}/${DB_SOURCE}_test_${TIMESTAMP}.dump"

mkdir -p "$HOST_BACKUP_DIR"
chmod 0700 "$HOST_BACKUP_DIR"

# 2. Verificación de espacio en disco en host (mínimo 1 GB en /var)
AVAIL_KB=$(df -k "$HOST_BACKUP_DIR" | awk 'NR==2 {print $4}')
echo "[*] Espacio disponible en host: $(( AVAIL_KB / 1024 )) MB"
if [ "$AVAIL_KB" -lt 1048576 ]; then
  echo "ERROR: Espacio insuficiente en disco (< 1GB libre)."
  exit 1
fi

# 3. Verificación de identidad previa de base de datos
ID_CHECK=$(docker exec -e PGPASSWORD="$PG_PASS" "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_SOURCE" -t -A -c "SELECT current_database() || '|' || current_user;")
echo "[*] Verificación de identidad de origen: $ID_CHECK"
if [ "$ID_CHECK" != "${DB_SOURCE}|${DB_USER}" ]; then
  echo "ERROR: Falló verificación de identidad de BD ($ID_CHECK)."
  exit 1
fi

# 4. Volcado custom comprimido
echo "[*] Ejecutando pg_dump en contenedor..."
docker exec -e PGPASSWORD="$PG_PASS" "$DB_CONTAINER" \
  pg_dump -U "$DB_USER" -d "$DB_SOURCE" -Fc -f "$CONTAINER_TMP"
DUMP_EXIT=$?
if [ $DUMP_EXIT -ne 0 ]; then
  echo "ERROR: pg_dump falló con código $DUMP_EXIT"
  docker exec "$DB_CONTAINER" rm -f "$CONTAINER_TMP"
  exit 1
fi

# 5. Copia al host con ruta exacta
echo "[*] Copiando volcado al host con ruta exacta..."
docker cp "${DB_CONTAINER}:${CONTAINER_TMP}" "$HOST_DUMP"
CP_EXIT=$?
if [ $CP_EXIT -ne 0 ]; then
  echo "ERROR: docker cp falló con código $CP_EXIT"
  exit 1
fi
docker exec "$DB_CONTAINER" rm -f "$CONTAINER_TMP"
chmod 0600 "$HOST_DUMP"

DUMP_SIZE=$(stat -c %s "$HOST_DUMP")
echo "[*] Volcado en host verificado ($(( DUMP_SIZE / 1024 )) KB, permisos 0600)."

# 6. Verificación de catálogo (TOC) mediante streaming a pg_restore
echo "[*] Verificando catálogo (TOC) de integridad interna..."
cat "$HOST_DUMP" | docker exec -i "$DB_CONTAINER" pg_restore --list > /dev/null
echo "[*] Catálogo verificado con éxito."

# 7. Prueba de restaurabilidad en base aislada con identificador único
SCRATCH_ID="scratch_${RANDOM}_$(date +%s)"
echo "[*] Creando base de datos temporal única: $SCRATCH_ID..."
# COMANDOS SEPARADOS PARA CREATE Y DROP
docker exec -e PGPASSWORD="$PG_PASS" "$DB_CONTAINER" psql -U "$DB_USER" -d postgres \
  -c "CREATE DATABASE \"$SCRATCH_ID\" OWNER \"$DB_USER\";"

echo "[*] Restaurando esquema y datos en $SCRATCH_ID..."
cat "$HOST_DUMP" | docker exec -i -e PGPASSWORD="$PG_PASS" "$DB_CONTAINER" \
  pg_restore -U "$DB_USER" -d "$SCRATCH_ID" > /dev/null 2>&1 || true

# Validar que existan tablas en la base restaurada
TABLE_COUNT=$(docker exec -e PGPASSWORD="$PG_PASS" "$DB_CONTAINER" psql -U "$DB_USER" -d "$SCRATCH_ID" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")
echo "[*] Tablas restauradas en $SCRATCH_ID: $TABLE_COUNT"

if [ "$TABLE_COUNT" -lt 5 ]; then
  echo "ERROR: La restauración no contiene las tablas esperadas."
  # NO eliminar el dump para análisis forense
  echo "AVISO: El archivo $HOST_DUMP se conserva para auditoría."
  exit 1
fi

# 8. Verificación estricta de propiedad antes de eliminar
echo "[*] Verificando propiedad de $SCRATCH_ID antes del DROP..."
OWNER_CHECK=$(docker exec -e PGPASSWORD="$PG_PASS" "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -t -A -c "SELECT pg_catalog.pg_get_userbyid(datdba) FROM pg_database WHERE datname = '$SCRATCH_ID';")
if [ "$OWNER_CHECK" != "$DB_USER" ]; then
  echo "ERROR: El propietario de la base temporal ($OWNER_CHECK) no coincide con $DB_USER. Abortando eliminación."
  exit 1
fi

echo "[*] Eliminando base de datos temporal $SCRATCH_ID en comando separado..."
docker exec -e PGPASSWORD="$PG_PASS" "$DB_CONTAINER" psql -U "$DB_USER" -d postgres \
  -c "DROP DATABASE \"$SCRATCH_ID\";"

echo "[*] Confirmando que $SCRATCH_ID fue eliminada..."
EXISTS_CHECK=$(docker exec -e PGPASSWORD="$PG_PASS" "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -t -A -c "SELECT count(*) FROM pg_database WHERE datname = '$SCRATCH_ID';")
if [ "$EXISTS_CHECK" != "0" ]; then
  echo "ERROR: La base temporal no fue eliminada."
  exit 1
fi

# Limpieza controlada del dump de prueba
rm -f "$HOST_DUMP"

echo "🎉 PROCEDIMIENTO DE RESPALDO Y RESTAURACIÓN AISLADA VALIDADO EXITOSAMENTE."
