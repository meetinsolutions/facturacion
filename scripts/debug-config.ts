import { pgDataStore } from '../src/services/pg-data-store.js';

async function main() {
  const tenantId = '61c44529-9803-4863-b49e-02670560ef18';
  const c = await pgDataStore.getConfig(tenantId);
  console.log('correo:', {
    usuario: c.correo?.usuario,
    hasPassword: Boolean(c.correo?.password),
    imapHost: c.correo?.imapHost,
    imapPuerto: c.correo?.imapPuerto,
    imapAutoSync: c.correo?.imapAutoSync
  });
  process.exit(0);
}

main().catch(console.error);
