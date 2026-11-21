#!/usr/bin/env bash
# ==============================================================================
# 05_setup_nginx_and_tls.sh
# Verificación DNS, configuración de Nginx y emisión segura de TLS
# ==============================================================================
set -euo pipefail

DOMAIN="test-facturacion.meetinlabs.com"
EXPECTED_IP="216.225.205.159"
NGINX_CONF="/etc/nginx/sites-available/${DOMAIN}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"

echo "==> [Paso 1/4] Verificando resolución DNS para '${DOMAIN}'..."
RESOLVED_IP=$(dig +short "${DOMAIN}" @8.8.8.8 | tail -n1 || true)

if [[ "${RESOLVED_IP}" != "${EXPECTED_IP}" ]]; then
    echo "======================================================================" >&2
    echo "ERROR: El registro DNS para ${DOMAIN} no está configurado o no ha propagado." >&2
    echo "IP esperada : ${EXPECTED_IP}" >&2
    echo "IP resuelta : ${RESOLVED_IP:-NXDOMAIN}" >&2
    echo "" >&2
    echo "ACCIÓN REQUERIDA:" >&2
    echo "Crear un registro de tipo 'A' en el proveedor DNS:" >&2
    echo "  Nombre : test-facturacion" >&2
    echo "  Valor  : ${EXPECTED_IP}" >&2
    echo "  TTL    : 300 segundos" >&2
    echo "======================================================================" >&2
    exit 1
fi

echo "DNS verificado correctamente (${RESOLVED_IP})."

echo "==> [Paso 2/4] Generando archivo de autenticación básica para QA (/etc/nginx/.htpasswd_test)..."
if [[ ! -f /etc/nginx/.htpasswd_test ]]; then
    QA_PASS=$(openssl rand -hex 12)
    htpasswd -cb /etc/nginx/.htpasswd_test qa_meetinfact "${QA_PASS}"
    echo "Usuario QA creado: qa_meetinfact (Guardar credencial de forma segura)"
fi

echo "==> [Paso 3/4] Generando configuración de Nginx para ${DOMAIN}..."
cat << 'EOF' > "${NGINX_CONF}"
server {
    listen 80;
    server_name test-facturacion.meetinlabs.com;

    # Permitir validación de Certbot ACME
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name test-facturacion.meetinlabs.com;

    ssl_certificate /etc/letsencrypt/live/test-facturacion.meetinlabs.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/test-facturacion.meetinlabs.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    access_log /var/log/nginx/facturacion_test_access.log;
    error_log /var/log/nginx/facturacion_test_error.log;

    client_max_body_size 15M;

    # 1. Endpoint exacto del Webhook ONVO: Exento de Basic Auth, protegido por firma Svix/HMAC
    location = /api/billing/webhook/onvopay {
        auth_basic off;
        proxy_pass http://127.0.0.1:3055;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }

    # 2. Todo el resto de la interfaz y APIs: Protegido por Basic Auth para QA interno
    location / {
        auth_basic "MeetinFact QA Isolated Environment";
        auth_basic_user_file /etc/nginx/.htpasswd_test;

        proxy_pass http://127.0.0.1:3055;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
EOF

echo "==> [Paso 4/4] Verificando certificados SSL o emitiendo con Certbot..."
if [[ ! -f /etc/letsencrypt/live/${DOMAIN}/fullchain.pem ]]; then
    echo "Emitiendo certificado inicial con Certbot..."
    certbot certonly --webroot -w /var/www/html -d "${DOMAIN}" --non-interactive --agree-tos -m admin@meetinlabs.com
fi

ln -sf "${NGINX_CONF}" "${NGINX_ENABLED}"
nginx -t
systemctl reload nginx
echo "Configuración Nginx y TLS para ${DOMAIN} habilitada exitosamente."
