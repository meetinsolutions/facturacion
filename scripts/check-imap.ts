import { pgDataStore } from '../src/services/pg-data-store.js';
import { getEstadoSuscripcion } from '../src/services/billing-service.js';

async function main() {
  const c = await pgDataStore.getConfig('61c44529-9803-4863-b49e-02670560ef18');
  console.log('Gastos IMAP:', JSON.stringify(c.gastos, null, 2));
  console.log('Emisor Cedula:', c.emisor?.cedula);
  const sub = await getEstadoSuscripcion('61c44529-9803-4863-b49e-02670560ef18');
  console.log('Suscripcion:', JSON.stringify(sub, null, 2));
  process.exit(0);
}

main().catch(console.error);
