import { saveGatewaysConfig, getGatewaysConfig } from '../src/services/billing-service.js';

async function main() {
  const current = await getGatewaysConfig();
  const updated = await saveGatewaysConfig({
    pasarelaActiva: 'onvopay',
    onvopay: {
      publicKey: current.onvopay?.publicKey || '',
      secretKey: current.onvopay?.secretKey || '',
      webhookSecret: 'whsec_ztvvr7dAmqtfOp3Xc55XPJK_dnzgfMLGqIRintlIMaY'
    }
  });
  console.log('Onvo Gateway Config updated successfully:');
  console.log(JSON.stringify(updated, null, 2));
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
