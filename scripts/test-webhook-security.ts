import crypto from 'crypto';

const SECRET = 'whsec_ztvvr7dAmqtfOp3Xc55XPJK_dnzgfMLGqIRintlIMaY';
const PAYLOAD = JSON.stringify({ type: 'payment_intent.succeeded', id: 'pi_test_123', status: 'succeeded' });
const NOW_SECONDS = Math.floor(Date.now() / 1000);

async function testSuite() {
  console.log('--- INICIANDO PRUEBAS DE SEGURIDAD DE WEBHOOK ONVO ---');

  // Test 1: Solicitud sin firma
  {
    const res = await fetch('http://localhost:3050/api/billing/webhook/onvopay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: PAYLOAD
    });
    console.log('1. Sin firma -> Status:', res.status, res.status === 401 ? '✅ RECHAZADO (401)' : '❌ FALLÓ');
  }

  // Test 2: User-Agent spoofing (intento de evasión)
  {
    const res = await fetch('http://localhost:3050/api/billing/webhook/onvopay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ONVO-Webhooks/1.0'
      },
      body: PAYLOAD
    });
    console.log('2. Spoofed User-Agent -> Status:', res.status, res.status === 401 ? '✅ RECHAZADO (401)' : '❌ FALLÓ');
  }

  // Test 3: Secreto en URL query param (?secret=...)
  {
    const res = await fetch(`http://localhost:3050/api/billing/webhook/onvopay?secret=${SECRET}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: PAYLOAD
    });
    console.log('3. Secreto en URL query -> Status:', res.status, res.status === 401 ? '✅ RECHAZADO (401)' : '❌ FALLÓ');
  }

  // Test 4: Timestamp expirado (ataque de repetición / replay > 300s)
  {
    const oldTimestamp = NOW_SECONDS - 500;
    const toSign = `${oldTimestamp}.${PAYLOAD}`;
    const key = Buffer.from(SECRET, 'utf-8');
    const sig = crypto.createHmac('sha256', key).update(toSign).digest('hex');

    const res = await fetch('http://localhost:3050/api/billing/webhook/onvopay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Onvo-Signature': `t=${oldTimestamp},v1=${sig}`
      },
      body: PAYLOAD
    });
    console.log('4. Timestamp expirado (500s) -> Status:', res.status, res.status === 401 ? '✅ RECHAZADO (401)' : '❌ FALLÓ');
  }

  // Test 5: Formato oficial nativo ONVO (X-Onvo-Signature: t=...,v1=...)
  {
    const toSign = `${NOW_SECONDS}.${PAYLOAD}`;
    const key = Buffer.from(SECRET, 'utf-8');
    const sigHex = crypto.createHmac('sha256', key).update(toSign).digest('hex');

    const res = await fetch('http://localhost:3050/api/billing/webhook/onvopay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Onvo-Signature': `t=${NOW_SECONDS},v1=${sigHex}`
      },
      body: PAYLOAD
    });
    const json = await res.json();
    console.log('5. Formato Oficial ONVO Nativo (Hex) -> Status:', res.status, res.status === 200 && json.success ? '✅ ACEPTADO (200)' : '❌ FALLÓ');
  }

  // Test 6: Formato Svix (svix-id, svix-timestamp, svix-signature)
  {
    const msgId = 'msg_test_' + Date.now();
    const svixTimestamp = String(NOW_SECONDS);
    const toSign = `${msgId}.${svixTimestamp}.${PAYLOAD}`;
    const key = Buffer.from(SECRET.slice(6), 'base64');
    const sigB64 = crypto.createHmac('sha256', key).update(toSign).digest('base64');

    const res = await fetch('http://localhost:3050/api/billing/webhook/onvopay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'svix-id': msgId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': `v1,${sigB64}`
      },
      body: PAYLOAD
    });
    const json = await res.json();
    console.log('6. Formato Svix Headers (Base64) -> Status:', res.status, res.status === 200 && json.success ? '✅ ACEPTADO (200)' : '❌ FALLÓ');
  }

  console.log('--- FIN DE LA SUITE DE SEGURIDAD ---');
}

testSuite().catch(console.error);
