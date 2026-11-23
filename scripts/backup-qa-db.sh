#!/usr/bin/env bash
# ==============================================================================
# MEETINFACT QA — RESPALDO AUTOMÁTICO CIFRADO DE BASE DE DATOS
# Exclusivo para facturacion_test (Entorno QA Aislado)
# Formato: PostgreSQL Custom (-Fc) cifrado con AES-256-CBC (PBKDF2)
# ==============================================================================
set -euo pipefail

CONF_FILE="/etc/meetinfact-qa/backup.conf"
if [ -f "$CONF_FILE" ]; then
  # shellcheck source=/dev/null
  source "$CONF_FILE"
fi

BACKUP_DIR="${BACKUP_DIR:-/var/backups/meetinfact-qa}"
KEY_FILE="${KEY_FILE:-/etc/meetinfact-qa/backup.key}"
DB_NAME="${DB_NAME:-facturacion_test}"
DB_CONTAINER="${DB_CONTAINER:-facturacion_postgres}"
DB_USER="${DB_USER:-facturacion_admin}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
S3_BACKUP_ENABLED="${S3_BACKUP_ENABLED:-false}"
LOG_FILE="${LOG_FILE:-/var/log/meetinfact-qa-backup.log}"

log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
  echo "$msg"
  echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
}

alert_failure() {
  local error_msg="$1"
  log "❌ ERROR EN RESPALDO: $error_msg"
  if [ -x "/opt/facturacion-test/scripts/send-alert.sh" ]; then
    /opt/facturacion-test/scripts/send-alert.sh "FALLO_RESPALDO" "$error_msg" || true
  fi
}

# 1. Asegurar directorios y clave de cifrado
mkdir -p "$BACKUP_DIR"
chmod 0700 "$BACKUP_DIR"

if [ ! -f "$KEY_FILE" ]; then
  mkdir -p "$(dirname "$KEY_FILE")"
  chmod 0700 "$(dirname "$KEY_FILE")"
  openssl rand -hex 32 > "$KEY_FILE"
  chmod 0600 "$KEY_FILE"
  log "🔑 Nueva llave criptográfica AES-256 generada en $KEY_FILE"
fi

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
TEMP_DUMP="/tmp/${DB_NAME}_${TIMESTAMP}.dump"
ENC_DUMP="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.dump.enc"

log "🚀 Iniciando respaldo de $DB_NAME..."

# 2. Ejecutar pg_dump en formato custom comprimido (-Fc)
PG_PASS="8pVkVpWpj4NrxmGIwZGbHd8"
if ! docker exec -e PGPASSWORD="$PG_PASS" "$DB_CONTAINER" \
    pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc -f "$TEMP_DUMP"; then
  alert_failure "Fallo al ejecutar pg_dump para $DB_NAME"
  rm -f "$TEMP_DUMP"
  exit 1
fi

# 3. Validar integridad del dump antes del cifrado (pg_restore --list)
if ! docker exec "$DB_CONTAINER" pg_restore --list "$TEMP_DUMP" > /dev/null 2>&1; then
  alert_failure "Verificación de catálogo (TOC) falló en el archivo $TEMP_DUMP"
  docker exec "$DB_CONTAINER" rm -f "$TEMP_DUMP"
  exit 1
fi

# Copiar el dump del contenedor al host temporalmente para cifrado
docker cp "$DB_CONTAINER:$TEMP_DUMP" "$TEMP_DUMP"
docker exec "$DB_CONTAINER" rm -f "$TEMP_DUMP"

DUMP_SIZE=$(stat -c %s "$TEMP_DUMP" 2>/dev/null || stat -f %z "$TEMP_DUMP")
log "📦 Volcado verificado con éxito ($(( DUMP_SIZE / 1024 )) KB)."

# 4. Cifrado simétrico AES-256-CBC con PBKDF2 (100.000 iteraciones)
log "🔒 Cifrando archivo con AES-256-CBC..."
if ! openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 \
    -pass "file:$KEY_FILE" -in "$TEMP_DUMP" -out "$ENC_DUMP"; then
  alert_failure "Fallo durante el cifrado openssl del respaldo"
  rm -f "$TEMP_DUMP" "$ENC_DUMP"
  exit 1
fi

chmod 0600 "$ENC_DUMP"
# Eliminar copia en texto plano
shred -u "$TEMP_DUMP" 2>/dev/null || rm -f "$TEMP_DUMP"

ENC_SIZE=$(stat -c %s "$ENC_DUMP" 2>/dev/null || stat -f %z "$ENC_DUMP")
log "✅ Respaldo cifrado guardado en $ENC_DUMP ($(( ENC_SIZE / 1024 )) KB)."

# 5. Política de retención: rotación de archivos antiguos (> RETENTION_DAYS)
log "🧹 Aplicando política de retención ($RETENTION_DAYS días)..."
DELETED_COUNT=0
while IFS= read -r old_file; do
  if [ -n "$old_file" ]; then
    rm -f "$old_file"
    log "   -> Eliminado respaldo expirado: $(basename "$old_file")"
    DELETED_COUNT=$((DELETED_COUNT + 1))
  fi
done < <(find "$BACKUP_DIR" -name "${DB_NAME}_*.dump.enc" -type f -mtime +"$RETENTION_DAYS" 2>/dev/null || true)
log "   -> Total respaldos rotados: $DELETED_COUNT"

# 6. Sincronización externa (Cloudflare R2 / AWS S3)
if [ "$S3_BACKUP_ENABLED" = "true" ]; then
  log "☁️ Sincronizando respaldo cifrado a almacenamiento externo S3/R2..."
  if [ -x "/opt/facturacion-test/scripts/sync-s3.sh" ]; then
    /opt/facturacion-test/scripts/sync-s3.sh "$ENC_DUMP" || alert_failure "Fallo en la sincronización S3 externa"
  else
    log "⚠️ Script de sincronización S3 no encontrado o no ejecutable."
  fi
else
  log "ℹ️ [S3 EXTERNO] Copia externa deshabilitada (S3_BACKUP_ENABLED=false)."
  log "   Bloqueo: Requiere bucket y credenciales S3/R2 autorizados por el propietario."
fi

log "🎉 Respaldo completado satisfactoriamente."
exit 0
