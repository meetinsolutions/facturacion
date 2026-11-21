/**
 * Script de validación de integración en vivo con ONVO Pay Sandbox
 * Ejecuta:
 * 1. Comprobación de credenciales en entorno test
 * 2. Creación de Checkout Session dinámica en ONVO Sandbox
 * 3. Verificación de persistencia en payment_transactions (estado pending)
 * 4. Instrucciones para completar el pago con tarjeta oficial de prueba
 */
import { pool } from '../src/db/pool.js';
import { getGatewaysConfig, iniciarCheckoutRecurrente } from '../src/services/billing-service.js';

async function main() {
  console.log('======================================================================');
  console.log('    TEST DE INTEGRACIÓN EN VIVO: ONVO PAY CHECKOUT DINÁMICO (SANDBOX) ');
  console.log('======================================================================\n');

  // 1. Validar claves
  const gateways = await getGatewaysConfig();
  if (!gateways.onvopay.secretKey) {
    console.error('❌ ERROR: ONVO_SECRET_KEY no está configurada en .env.');
    console.error('Ejecute primero: sudo /opt/facturacion-test/scripts/configure-onvo-sandbox.sh');
    process.exit(1);
  }

  const maskedKey = `${gateways.onvopay.secretKey.substring(0, 8)}...${gateways.onvopay.secretKey.slice(-4)}`;
  console.log(`✓ Clave de Sandbox detectada: ${maskedKey}`);

  // 2. Obtener un tenant de prueba en facturacion_test
  const tenantRes = await pool.query(
    "SELECT id, nombre FROM tenants WHERE slug LIKE '%meetinlabs%' OR slug LIKE '%test%' LIMIT 1"
  );

  if (!tenantRes.rowCount) {
    console.error('❌ ERROR: No se encontró ningún tenant de prueba en facturacion_test.');
    process.exit(1);
  }

  const tenant = tenantRes.rows[0];
  console.log(`✓ Tenant objetivo de prueba: ${tenant.nombre} (${tenant.id})`);

  // 3. Crear sesión de Checkout
  console.log('--> Creando sesión de checkout dinámica en la API de ONVO Pay Sandbox...');
  try {
    const result = await iniciarCheckoutRecurrente(
      tenant.id,
      'pro',
      'monthly',
      'onvopay'
    );

    console.log('\n======================================================================');
    console.log('    SESIÓN DE CHECKOUT CREADA EXITOSAMENTE EN ONVO SANDBOX           ');
    console.log('======================================================================');
    console.log(`✓ ID de Sesión (ONVO)   : ${result.sessionId}`);
    console.log(`✓ URL de Checkout       : ${result.checkoutUrl}`);
    console.log(`✓ Transacción Interna ID: ${result.transactionId}`);
    console.log('======================================================================\n');

    // 4. Verificar en base de datos facturacion_test
    const txCheck = await pool.query(
      'SELECT id, tenant_id, plan_code, amount_usd, currency, status, checkout_session_id, created_at FROM payment_transactions WHERE id = $1',
      [result.transactionId]
    );

    const tx = txCheck.rows[0];
    console.log('✓ Estado en Base de Datos (facturacion_test):');
    console.log(`  - Status             : ${tx.status} (debe ser pending)`);
    console.log(`  - Checkout Session ID: ${tx.checkout_session_id}`);
    console.log(`  - Monto / Moneda     : $${tx.amount_usd} ${tx.currency}`);
    console.log(`  - Plan Solicitado    : ${tx.plan_code}`);

    console.log('\n--> INSTRUCCIONES PARA COMPLETAR LA PRUEBA:');
    console.log(`1. Abra la URL en su navegador: ${result.checkoutUrl}`);
    console.log('2. Utilice los datos oficiales de prueba:');
    console.log('   - Tarjeta: 4242 4242 4242 4242 (Visa Aprobada)');
    console.log('   - Exp    : Cualquier fecha futura (ej. 12/28)');
    console.log('   - CVC    : 123');
    console.log('3. Complete el pago en la pasarela.');
    console.log('4. ONVO emitirá el webhook firmado hacia:');
    console.log('   https://test-facturacion.meetinlabs.com/api/billing/webhook/onvopay');
    console.log('5. Verifique la acreditación en:');
    console.log(`   SELECT status, current_period_end FROM subscriptions WHERE tenant_id = '${tenant.id}';`);
    console.log('======================================================================');
  } catch (err: any) {
    console.error('❌ Error al interactuar con ONVO API:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
