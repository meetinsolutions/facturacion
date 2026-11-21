import { saveGatewaysConfig, getGatewaysConfig } from '../src/services/billing-service.js';
import { pool } from '../src/db/pool.js';

async function main() {
  const secret = process.env.ONVO_SECRET_KEY;
  const publicK = process.env.ONVO_PUBLIC_KEY;
  const webhook = process.env.ONVO_WEBHOOK_SECRET;

  if (!secret || !publicK) {
    console.error('ERROR: ONVO_SECRET_KEY o ONVO_PUBLIC_KEY ausentes en entorno.');
    process.exit(1);
  }

  const cur = await getGatewaysConfig();
  await saveGatewaysConfig({
    pasarelaActiva: 'onvopay',
    onvopay: {
      publicKey: publicK,
      secretKey: secret,
      webhookSecret: webhook || cur.onvopay.webhookSecret
    }
  });
  console.log('✓ Sincronización en PostgreSQL (platform_settings) completada con éxito.');
  await pool.end();
}

main().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
