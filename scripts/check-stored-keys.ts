import { pgDataStore } from '../src/services/pg-data-store.js';
import { getGatewaysConfig } from '../src/services/billing-service.js';
import { pool } from '../src/db/pool.js';

async function main() {
  const stored: any = await pgDataStore.getPlatformSetting('payment_gateways');
  const gateways = await getGatewaysConfig();

  console.log('--- EN PLATFORM_SETTINGS (BD facturacion_test) ---');
  console.log('pasarelaActiva:', stored?.pasarelaActiva);
  console.log('hasSecretKey :', Boolean(stored?.onvopay?.secretKey), 'length:', stored?.onvopay?.secretKey?.length || 0);
  console.log('hasPublicKey :', Boolean(stored?.onvopay?.publicKey), 'length:', stored?.onvopay?.publicKey?.length || 0);
  console.log('hasWebhookSec:', Boolean(stored?.onvopay?.webhookSecret), 'length:', stored?.onvopay?.webhookSecret?.length || 0);

  console.log('\n--- EN GETGATEWAYSCONFIG() (COMBINADO) ---');
  console.log('pasarelaActiva:', gateways.pasarelaActiva);
  console.log('hasSecretKey :', Boolean(gateways.onvopay.secretKey), 'length:', gateways.onvopay.secretKey?.length || 0);
  console.log('hasPublicKey :', Boolean(gateways.onvopay.publicKey), 'length:', gateways.onvopay.publicKey?.length || 0);
  console.log('hasWebhookSec:', Boolean(gateways.onvopay.webhookSecret), 'length:', gateways.onvopay.webhookSecret?.length || 0);

  console.log('\n--- EN PROCESS.ENV ---');
  console.log('ENV_SECRET   :', Boolean(process.env.ONVO_SECRET_KEY), 'length:', process.env.ONVO_SECRET_KEY?.length || 0);
  console.log('ENV_PUBLIC   :', Boolean(process.env.ONVO_PUBLIC_KEY), 'length:', process.env.ONVO_PUBLIC_KEY?.length || 0);
  console.log('ENV_WEBHOOK  :', Boolean(process.env.ONVO_WEBHOOK_SECRET), 'length:', process.env.ONVO_WEBHOOK_SECRET?.length || 0);

  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
