#!/usr/bin/env bash
# ==============================================================================
# MEETINFACT QA — SINCRONIZACIÓN EXTERNA A S3 / CLOUDFLARE R2
# Mecanismo configurable para transmisión fuera del VPS
# ==============================================================================
set -euo pipefail

CONF_FILE="/etc/meetinfact-qa/backup.conf"
if [ -f "$CONF_FILE" ]; then
  # shellcheck source=/dev/null
  source "$CONF_FILE"
fi

FILE_TO_UPLOAD="${1:-}"

if [ -z "$FILE_TO_UPLOAD" ] || [ ! -f "$FILE_TO_UPLOAD" ]; then
  echo "❌ Error: Debe especificar un archivo existente para subir a S3."
  exit 1
fi

S3_BACKUP_ENABLED="${S3_BACKUP_ENABLED:-false}"
S3_ENDPOINT="${S3_ENDPOINT:-}"
S3_BUCKET="${S3_BUCKET:-}"
S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-}"
S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-}"
S3_REGION="${S3_REGION:-auto}"

if [ "$S3_BACKUP_ENABLED" != "true" ]; then
  echo "ℹ️ Sincronización S3 desactivada (S3_BACKUP_ENABLED=false)."
  echo "   Bloqueo pendiente: Requiere autorización y credenciales del bucket Cloudflare R2 / AWS S3."
  exit 0
fi

if [ -z "$S3_BUCKET" ] || [ -z "$S3_ACCESS_KEY_ID" ] || [ -z "$S3_SECRET_ACCESS_KEY" ]; then
  echo "⚠️ S3_BACKUP_ENABLED=true pero faltan variables requeridas (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)."
  echo "   Bloqueo: Credenciales incompletas."
  exit 1
fi

FILENAME=$(basename "$FILE_TO_UPLOAD")
echo "☁️ Subiendo $FILENAME a s3://$S3_BUCKET/qa_backups/$FILENAME..."

# Soporte para aws-cli o rclone o minio client si están instalados
if command -v aws >/dev/null 2>&1; then
  AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
  aws s3 cp "$FILE_TO_UPLOAD" "s3://$S3_BUCKET/qa_backups/$FILENAME" \
    ${S3_ENDPOINT:+--endpoint-url "$S3_ENDPOINT"} \
    --region "$S3_REGION"
  echo "✅ Subida S3 completada con éxito vía aws-cli."
elif command -v rclone >/dev/null 2>&1; then
  rclone copyto "$FILE_TO_UPLOAD" ":s3,provider=Other,endpoint='$S3_ENDPOINT',access_key_id='$S3_ACCESS_KEY_ID',secret_access_key='$S3_SECRET_ACCESS_KEY':$S3_BUCKET/qa_backups/$FILENAME"
  echo "✅ Subida S3 completada con éxito vía rclone."
else
  echo "❌ Error: Se requiere aws-cli o rclone instalado en el sistema para ejecutar la sincronización S3."
  exit 1
fi
