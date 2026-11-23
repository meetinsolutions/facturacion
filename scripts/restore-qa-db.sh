#!/usr/bin/env bash
# ==============================================================================
# MEETINFACT QA — RESTAURACIÓN SEGURA DE BASE DE DATOS CIFRADA
# Descifra y restaura un respaldo en una base de datos de prueba aislada.
# Por seguridad, prohíbe restaurar sobre facturacion_saas (producción).
# ==============================================================================
set -euo pipefail

CONF_FILE="/etc/meetinfact-qa/backup.conf"
if [ -f "$CONF_FILE" ]; then
  # shellcheck source=/dev/null
  source "$CONF_FILE"
fi

BACKUP_DIR="${BACKUP_DIR:-/var/backups/meetinfact-qa}"
KEY_FILE="${KEY_FILE:-/etc/meetinfact-qa/backup.key}"
DB_CONTAINER="${DB_CONTAINER:-facturacion_postgres}"
DB_USER="${DB_USER:-facturacion_admin}"

ENC_FILE="${1:-}"
TARGET_DB="${2:-facturacion_dr_drill}"

if [ -z "$ENC_FILE" ]; then
  # Si no se provee archivo, tomar el más reciente
  ENC_FILE=$(find "$BACKUP_DIR" -name "facturacion_test_*.dump.enc" -type f | sort -r | head -n 1 || true)
  if [ -z "$ENC_FILE" ]; then
    echo "❌ Error: No se encontró ningún respaldo cifrado en $BACKUP_DIR"
    exit 1
  fi
  echo "ℹ️ Usando el respaldo cifrado más reciente: $ENC_FILE"
fi

# BLOQUEO DE SEGURIDAD ESTRICTO: PROHIBIDO RESTAURAR EN PRODUCCIÓN
if [ "$TARGET_DB" = "facturacion_saas" ] || [ "$TARGET_DB" = "postgres" ]; then
  echo "🚫 ACCIÓN DENEGADA: Prohibido restaurar sobre la base de datos de producción ($TARGET_DB)."
  exit 1
fi

if [ ! -f "$ENC_FILE" ]; then
  echo "❌ Error: El archivo de respaldo no existe: $ENC_FILE"
  exit 1
fi

if [ ! -f "$KEY_FILE" ]; then
  echo "❌ Error: La llave de descifrado no existe: $KEY_FILE"
  exit 1
fi

TEMP_DUMP="/tmp/restore_temp_$$.dump"
echo "🔓 Descifrando respaldo..."
openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 \
  -pass "file:$KEY_FILE" -in "$ENC_FILE" -out "$TEMP_DUMP"

echo "📋 Verificando catálogo del volcado descifrado..."
docker cp "$TEMP_DUMP" "$DB_CONTAINER:$TEMP_DUMP"
rm -f "$TEMP_DUMP"

docker exec "$DB_CONTAINER" pg_restore --list "$TEMP_DUMP" > /dev/null

echo "🗄️ Preparando base de datos destino: $TARGET_DB..."
PG_PASS="8pVkVpWpj4NrxmGIwZGbHd8"
docker exec -e PGPASSWORD="$PG_PASS" "$DB_CONTAINER" psql -U "$DB_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS $TARGET_DB;"
docker exec -e PGPASSWORD="$PG_PASS" "$DB_CONTAINER" psql -U "$DB_USER" -d postgres \
  -c "CREATE DATABASE $TARGET_DB OWNER $DB_USER;"

echo "⚡ Restaurando esquema y datos con pg_restore..."
docker exec -e PGPASSWORD="$PG_PASS" "$DB_CONTAINER" pg_restore \
  -U "$DB_USER" -d "$TARGET_DB" "$TEMP_DUMP"

docker exec -e PGPASSWORD="$PG_PASS" "$DB_CONTAINER" psql -U "$DB_USER" -d "$TARGET_DB" \
  -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO facturacion_test_runner; GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO facturacion_test_runner;"

docker exec "$DB_CONTAINER" rm -f "$TEMP_DUMP"

echo "✅ Restauración finalizada con éxito en la base de datos $TARGET_DB."
exit 0
