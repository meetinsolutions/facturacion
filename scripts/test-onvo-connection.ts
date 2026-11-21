/**
 * Test de conectividad y autenticación contra ONVO Pay Sandbox
 * Realiza una consulta GET de sólo lectura para validar la autenticación de la Secret Key.
 */
import { getGatewaysConfig } from '../src/services/billing-service.js';

async function main() {
  console.log('======================================================================');
  console.log('    TEST DE CONECTIVIDAD Y AUTENTICACIÓN: ONVO PAY SANDBOX           ');
  console.log('======================================================================\n');

  const gateways = await getGatewaysConfig();
  const secretKey = gateways.onvopay.secretKey || process.env.ONVO_SECRET_KEY;

  if (!secretKey) {
    console.error('❌ ERROR: ONVO_SECRET_KEY no se encuentra configurada.');
    process.exit(1);
  }

  // Verificación de prefijo seguro de Sandbox
  if (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('onvo_test_')) {
    console.warn('⚠️ ADVERTENCIA: La clave no contiene prefijo estándar de sandbox.');
  } else {
    console.log('✓ Prefijo de entorno Sandbox verificado.');
  }

  const masked = `${secretKey.substring(0, 8)}...${secretKey.slice(-4)}`;
  console.log(`✓ Clave Secreta en uso: ${masked}`);

  // Probar endpoints oficiales de lectura
  const endpoints = [
    'https://api.onvopay.com/v1/payment-intents?limit=1',
    'https://api.onvopay.com/v1/customers?limit=1'
  ];

  let authenticated = false;

  for (const ep of endpoints) {
    const url = new URL(ep);
    console.log(`--> Probando GET ${url.pathname} ...`);
    try {
      const res = await fetch(ep, {
        headers: {
          Authorization: `Bearer ${secretKey}`
        }
      });

      console.log(`    Respuesta HTTP: ${res.status} ${res.statusText}`);

      if (res.ok) {
        authenticated = true;
        console.log(`\n✅ AUTENTICACIÓN EXITOSA (HTTP ${res.status} OK):`);
        console.log(`   La clave secreta es válida y está autorizada en ONVO Pay Sandbox.`);
        console.log(`   Endpoint validado: ${url.pathname}`);
        console.log('======================================================================');
        break;
      } else if (res.status === 401) {
        console.error(`\n❌ ERROR 401 UNAUTHORIZED: Clave secreta inválida o rechazada.`);
        process.exit(1);
      } else if (res.status === 403) {
        console.error(`\n❌ ERROR 403 FORBIDDEN: Acceso denegado (¿se introdujo una Public Key?).`);
        process.exit(1);
      } else if (res.status === 429) {
        console.error(`\n❌ ERROR 429 TOO MANY REQUESTS: Rate limit excedido.`);
        process.exit(1);
      } else {
        const text = await res.text();
        console.log(`    Detalle (HTTP ${res.status}): ${text.slice(0, 150)}`);
      }
    } catch (err: any) {
      console.error(`    Error de red en ${url.pathname}:`, err.message);
    }
  }

  if (authenticated) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
