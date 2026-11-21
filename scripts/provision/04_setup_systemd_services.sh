#!/usr/bin/env bash
# ==============================================================================
# 04_setup_systemd_services.sh
# Instalación de las unidades systemd para el entorno de pruebas y reconciliador
# ==============================================================================
set -euo pipefail

echo "==> [Paso 1/3] Creando unidad facturacion-test.service..."
cat << 'EOF' > /etc/systemd/system/facturacion-test.service
[Unit]
Description=MeetinFact SaaS - Entorno de Pruebas Aislado ONVO
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
User=facturacion_test
Group=facturacion_test
WorkingDirectory=/opt/facturacion-test
EnvironmentFile=/opt/facturacion-test/.env
ExecStart=/usr/bin/node /opt/facturacion-test/node_modules/.bin/tsx src/server.ts
Restart=always
RestartSec=5

# Restricciones estrictas de recursos (CGroups)
MemoryMax=512M
MemoryHigh=400M
CPUQuota=50%
TasksMax=100
LimitNOFILE=4096

# Sandboxing y seguridad del sistema de archivos
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/facturacion-test
PrivateTmp=true
NoNewPrivileges=true

StandardOutput=journal
StandardError=journal
SyslogIdentifier=facturacion-test

[Install]
WantedBy=multi-user.target
EOF

echo "==> [Paso 2/3] Creando unidad facturacion-test-reconcile.service..."
cat << 'EOF' > /etc/systemd/system/facturacion-test-reconcile.service
[Unit]
Description=MeetinFact - Worker de Conciliacion Periodica ONVO
After=network.target docker.service

[Service]
Type=oneshot
User=facturacion_test
Group=facturacion_test
WorkingDirectory=/opt/facturacion-test
EnvironmentFile=/opt/facturacion-test/.env
ExecStart=/usr/bin/node /opt/facturacion-test/node_modules/.bin/tsx scripts/workers/reconcile-onvo.ts

# Sandboxing
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/facturacion-test
PrivateTmp=true
NoNewPrivileges=true

StandardOutput=journal
StandardError=journal
SyslogIdentifier=facturacion-test-reconcile
EOF

echo "==> [Paso 3/3] Creando temporizador facturacion-test-reconcile.timer..."
cat << 'EOF' > /etc/systemd/system/facturacion-test-reconcile.timer
[Unit]
Description=Ejecutar Reconciliador ONVO cada 15 minutos en entorno de pruebas
RefuseManualStart=no
RefuseManualStop=no

[Timer]
OnBootSec=5min
OnUnitActiveSec=15min
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
echo "Unidades systemd creadas y recargadas. (Permanecen detenidas y deshabilitadas)."
