import { pool } from '../src/db/pool.js';
import { solicitarOtpCliente, verificarOtpCliente, listarComprobantesCliente, getUltimoOtpParaPruebasQA } from '../src/services/portal-cliente-service.js';

async function main() {
  const email = 'juan.perez.1795455319181@cliente.cr';
  console.log(`[TEST-OTP] 1. Solicitando OTP para ${email}...`);
  
  const reqRes = await solicitarOtpCliente(email, '127.0.0.1');
  console.log('[TEST-OTP] Resultado solicitar:', reqRes);

  const otp = getUltimoOtpParaPruebasQA(email);
  console.log(`[TEST-OTP] Código OTP recuperado de QA store: ${otp}`);
  
  if (!otp) {
    throw new Error('No se recuperó el OTP en QA store');
  }

  console.log('[TEST-OTP] 2. Verificando OTP...');
  const verifRes = await verificarOtpCliente(email, otp, { ip: '127.0.0.1', userAgent: 'test-agent' });
  console.log('[TEST-OTP] Resultado verificar:', verifRes);

  if (!verifRes.ok || !verifRes.sessionToken) {
    throw new Error('Fallo verificación de OTP');
  }

  console.log('[TEST-OTP] 3. Listando comprobantes para el receptor...');
  const listRes = await listarComprobantesCliente(email);
  console.log(`[TEST-OTP] Comprobantes encontrados: ${listRes.total}`);
  for (const c of listRes.comprobantes) {
    console.log(`  - Clave: ${c.clave} | Tipo: ${c.tipoDocumento} | Emisor: ${c.emisorNombre} | Total: ${c.total} ${c.moneda}`);
  }

  console.log('\n[TEST-OTP] Flujo completado con éxito.');
  await pool.end();
}

main().catch(err => {
  console.error('[TEST-OTP] Error:', err);
  process.exit(1);
});
