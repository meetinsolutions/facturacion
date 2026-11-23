#!/usr/bin/env bash
# ==============================================================================
# MEETINFACT QA — DISPATCHER DE ALERTAS OPERATIVAS
# Envía notificaciones a canales webhook (Slack, Discord, Telegram, etc.)
# ==============================================================================
set -euo pipefail

CONF_FILE="/etc/meetinfact-qa/alerts.conf"
if [ -f "$CONF_FILE" ]; then
  # shellcheck source=/dev/null
  source "$CONF_FILE"
fi

TIPO="${1:-ALERTA_GENERICA}"
MENSAJE="${2:-Se ha detectado una condición anómala en MeetinFact QA}"
NIVEL="${3:-CRITICO}"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S UTC')

ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
ALERT_EMAIL="${ALERT_EMAIL:-}"

log_alert() {
  local log_file="/var/log/meetinfact-qa-alerts.log"
  echo "[$TIMESTAMP] [$NIVEL] [$TIPO] $MENSAJE" >> "$log_file" 2>/dev/null || true
  echo "[$TIMESTAMP] [$NIVEL] [$TIPO] $MENSAJE"
}

log_alert

if [ -z "$ALERT_WEBHOOK_URL" ]; then
  echo "ℹ️ [ALERTA PENDIENTE] Sin ALERT_WEBHOOK_URL configurado en /etc/meetinfact-qa/alerts.conf."
  echo "   Bloqueo: Requiere que el propietario configure la URL del webhook de notificaciones (Slack/Discord/PagerDuty)."
  exit 0
fi

# Despacho HTTP JSON por webhook
PAYLOAD=$(cat <<EOF
{
  "service": "MeetinFact QA",
  "environment": "test",
  "level": "$NIVEL",
  "type": "$TIPO",
  "message": "$MENSAJE",
  "timestamp": "$TIMESTAMP"
}
EOF
)

if curl -s -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$ALERT_WEBHOOK_URL" --max-time 10 > /dev/null 2>&1; then
  echo "📢 Alerta despachada correctamente al webhook."
else
  echo "⚠️ Fallo al conectar con el webhook de alertas."
fi
