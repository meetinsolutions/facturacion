import { probarConexionIMAP, sincronizarGastosDesdeCorreo } from '../src/services/imap-expense-sync.js';
import { pgDataStore } from '../src/services/pg-data-store.js';

async function main() {
  const tenantId = '61c44529-9803-4863-b49e-02670560ef18';
  const config = await pgDataStore.getConfig(tenantId);
  console.log('Ejecutando sincronización inicial de gastos para MeetinLabs...');
  const syncRes = await sincronizarGastosDesdeCorreo(tenantId, config, { diasAtras: 90 });
  console.log('Resultado de sincronización:', JSON.stringify(syncRes, null, 2));
  process.exit(0);
}

main().catch(console.error);
