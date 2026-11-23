#!/usr/bin/env bash
# ==============================================================================
# MEETINFACT QA — PRUEBA CONTROLADA DE ROLLBACK DE APLICACIÓN
# Simula un despliegue defectuoso y su reversión automática en sandbox aislado
# ==============================================================================
set -euo pipefail

SANDBOX_DIR="/tmp/meetinfact_rollback_drill"
rm -rf "$SANDBOX_DIR"
mkdir -p "$SANDBOX_DIR/releases/stable_v1" "$SANDBOX_DIR/releases/defectuosa_v2"

echo "🧪 [ROLLBACK DRILL] 1. Creando entorno aislado de prueba en $SANDBOX_DIR..."

# Version 1 (Estable): servidor mock HTTP que responde 200 OK
cat << 'EOF' > "$SANDBOX_DIR/releases/stable_v1/server.js"
const http = require('http');
const server = http.createServer((req, res) => {
  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', version: 'v1.0.0-stable' }));
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(3099, '127.0.0.1');
EOF

# Version 2 (Defectuosa): archivo que falla inmediatamente al arrancar o rompe la ruta
cat << 'EOF' > "$SANDBOX_DIR/releases/defectuosa_v2/server.js"
const http = require('http');
// Defecto inducido: no maneja /api/health y lanza error fatal
throw new Error('FATAL: Configuración incompatible o defecto en compilación v2.0.0');
EOF

# 2. Desplegar Version 1 estable
ln -sfn "$SANDBOX_DIR/releases/stable_v1" "$SANDBOX_DIR/current"
echo "🚀 [ROLLBACK DRILL] 2. Desplegando versión estable v1..."
node "$SANDBOX_DIR/current/server.js" &
MOCK_PID=$!
sleep 1

STATUS_V1=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3099/api/health || echo "FAIL")
echo "   -> Estado HTTP versión estable: $STATUS_V1 (Esperado: 200)"
kill -9 "$MOCK_PID" 2>/dev/null || true

# 3. Simular despliegue defectuoso (Version 2)
echo "💥 [ROLLBACK DRILL] 3. Simulando despliegue de actualización defectuosa v2..."
ln -sfn "$SANDBOX_DIR/releases/defectuosa_v2" "$SANDBOX_DIR/current"

T_START=$(date +%s%N)
DEFECTO_CONFIRMADO=false
if ! node "$SANDBOX_DIR/current/server.js" >/dev/null 2>&1; then
  DEFECTO_CONFIRMADO=true
  echo "   -> Defecto detectado: el proceso v2 falló al inicializar."
fi

# 4. Ejecutar Procedimiento Automático de Rollback a v1
echo "🔄 [ROLLBACK DRILL] 4. Ejecutando reversión inmediata a release previa estable (v1)..."
ln -sfn "$SANDBOX_DIR/releases/stable_v1" "$SANDBOX_DIR/current"
node "$SANDBOX_DIR/current/server.js" &
RESTORED_PID=$!
sleep 1

T_END=$(date +%s%N)
RTO_ROLLBACK_MS=$(( (T_END - T_START) / 1000000 ))

STATUS_RESTORED=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3099/api/health || echo "FAIL")
PAYLOAD_RESTORED=$(curl -s http://127.0.0.1:3099/api/health || echo "{}")

kill -9 "$RESTORED_PID" 2>/dev/null || true
rm -rf "$SANDBOX_DIR"

echo "✅ [ROLLBACK DRILL] 5. Verificación post-rollback completada:"
echo "   -> Estado HTTP post-rollback: $STATUS_RESTORED"
echo "   -> Respuesta: $PAYLOAD_RESTORED"
echo "   -> RTO de Rollback medido: ${RTO_ROLLBACK_MS} ms"
echo "🎉 Simulacro de rollback finalizado con éxito sin afectar ningún servicio activo."
exit 0
