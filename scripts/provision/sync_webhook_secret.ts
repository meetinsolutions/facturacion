import { saveGatewaysConfig, getGatewaysConfig } from '../src/services/billing-service.js';
import { pool } from '../src/db/pool.js';

async function main() {
  const secret = process.env.ONVO_WEBHOOK_SECRET;
  if (!secret) {
    console.error('No ONVO_WEBHOOK_SECRET in environment');
    process.exit(1);
  }
  const cur = await getGatewaysConfig();
  await saveGatewaysConfig({
    pasarelaActiva: 'onvopay',
    onvopay: {
      ...cur.onvopay,
      webhookSecret: secret
    }
  });
  console.log('Webhook secret synchronized in PostgreSQL platform_settings');
  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
