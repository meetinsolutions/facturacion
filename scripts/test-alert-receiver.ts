/**
 * PRUEBA DE ALERTAS OPERATIVAS CON RECEPTOR SIMULADO (QA)
 * Inicia un receptor HTTP local en puerto 9876, ejecuta send-alert.sh
 * y valida el payload recibido (tipo, nivel, mensaje, servicio, timestamp).
 */
import http from 'http';
import { exec } from 'child_process';
import assert from 'assert';

async function testAlertDispatcher() {
  console.log('=== PRUEBA DE ALERTAS CON RECEPTOR SIMULADO (QA) ===\n');

  let alertReceived: any = null;

  // 1. Iniciar servidor receptor HTTP mock en puerto 9876
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          alertReceived = JSON.parse(body);
          console.log('📬 [RECEPTOR SIMULADO] Alerta recibida con éxito:');
          console.log(JSON.stringify(alertReceived, null, 2));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, status: 'received' }));
        } catch (e: any) {
          res.writeHead(400);
          res.end('Invalid JSON');
        }
      });
    } else {
      res.writeHead(405);
      res.end();
    }
  });

  await new Promise<void>(resolve => server.listen(9876, '127.0.0.1', () => resolve()));
  console.log('🚀 Receptor simulado escuchando en http://127.0.0.1:9876/alert-webhook');

  try {
    // 2. Invocar send-alert.sh configurando ALERT_WEBHOOK_URL al receptor simulado
    const cmd = `ALERT_WEBHOOK_URL="http://127.0.0.1:9876/alert-webhook" /opt/facturacion-test/scripts/send-alert.sh "FALLO_RESPALDO_SIMULADO" "Prueba de alerta operativa de respaldo fallido" "CRITICO"`;

    console.log('📢 Despachando alerta mediante send-alert.sh...');
    const execOutput = await new Promise<string>((resolve, reject) => {
      exec(cmd, (err, stdout, stderr) => {
        if (err) return reject(new Error(`Error ejecutando send-alert.sh: ${stderr || err.message}`));
        resolve(stdout);
      });
    });

    console.log('📄 Salida de send-alert.sh:\n' + execOutput);

    // 3. Validar el payload capturado por el receptor
    assert(alertReceived, 'El receptor simulado debió capturar el payload de la alerta');
    assert.strictEqual(alertReceived.service, 'MeetinFact QA');
    assert.strictEqual(alertReceived.environment, 'test');
    assert.strictEqual(alertReceived.type, 'FALLO_RESPALDO_SIMULADO');
    assert.strictEqual(alertReceived.level, 'CRITICO');
    assert(alertReceived.message.includes('Prueba de alerta operativa'));
    assert(alertReceived.timestamp, 'Debe incluir marca temporal');

    console.log('✅ Verificación matemática del payload exitosa.');
    console.log('\n🎉 PRUEBA DE ALERTAS OPERATIVAS SUPERADA AL 100%.');
  } finally {
    server.close();
  }
}

testAlertDispatcher().catch(err => {
  console.error('❌ ERROR EN PRUEBA DE ALERTAS:', err);
  process.exit(1);
});
