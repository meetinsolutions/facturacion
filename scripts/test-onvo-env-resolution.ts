/**
 * PRUEBA FOCALIZADA — RESOLUCIÓN DE CONFIGURACIÓN ONVO Y AISLAMIENTO DE SECRETOS
 * Valida la resolución de ONVO_WEBHOOK_SECRET vs ONVO_WEBHOOK_SECRET_LIVE
 * y la verificación normativa de esquemas XML DGT v4.3.
 */
import assert from 'assert';
import { getGatewaysConfig } from '../src/services/billing-service.js';
import { generarXMLFactura } from '../src/services/xml-builder.js';

async function runTests() {
  console.log('=== INICIO DE PRUEBAS FOCALIZADAS DE CONFIGURACIÓN Y NORMATIVA ===\n');

  // Guardar estado previo de variables de entorno
  const prevEnv = {
    ONVO_ENVIRONMENT: process.env.ONVO_ENVIRONMENT,
    ONVO_SECRET_KEY: process.env.ONVO_SECRET_KEY,
    ONVO_PUBLIC_KEY: process.env.ONVO_PUBLIC_KEY,
    ONVO_WEBHOOK_SECRET: process.env.ONVO_WEBHOOK_SECRET,
    ONVO_SECRET_KEY_LIVE: process.env.ONVO_SECRET_KEY_LIVE,
    ONVO_PUBLIC_KEY_LIVE: process.env.ONVO_PUBLIC_KEY_LIVE,
    ONVO_WEBHOOK_SECRET_LIVE: process.env.ONVO_WEBHOOK_SECRET_LIVE,
    ONVO_SECRET_KEY_SANDBOX: process.env.ONVO_SECRET_KEY_SANDBOX,
    ONVO_PUBLIC_KEY_SANDBOX: process.env.ONVO_PUBLIC_KEY_SANDBOX,
    ONVO_WEBHOOK_SECRET_SANDBOX: process.env.ONVO_WEBHOOK_SECRET_SANDBOX,
  };

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Entorno Sandbox predeterminado
    // -------------------------------------------------------------------------
    process.env.ONVO_ENVIRONMENT = 'sandbox';
    process.env.ONVO_SECRET_KEY = 'sk_test_fake_sandbox_key_123';
    process.env.ONVO_PUBLIC_KEY = 'pk_test_fake_sandbox_key_123';
    process.env.ONVO_WEBHOOK_SECRET = 'whsec_test_sandbox_secret_abc';
    delete process.env.ONVO_SECRET_KEY_LIVE;
    delete process.env.ONVO_PUBLIC_KEY_LIVE;
    delete process.env.ONVO_WEBHOOK_SECRET_LIVE;

    const cfgSandbox = await getGatewaysConfig();
    assert.strictEqual(cfgSandbox.onvopay.secretKey, 'sk_test_fake_sandbox_key_123', 'SecretKey debe ser el de sandbox');
    assert.strictEqual(cfgSandbox.onvopay.webhookSecret, 'whsec_test_sandbox_secret_abc', 'WebhookSecret debe ser el de sandbox');
    console.log('✅ TEST 1 APROBADO: Sandbox resuelve correctamente claves y webhookSecret.');

    // -------------------------------------------------------------------------
    // TEST 2: Modo LIVE configurado pero SIN ONVO_WEBHOOK_SECRET_LIVE
    // La clave secreta de webhook DEBE resolverse a cadena vacía para bloquear cobros
    // -------------------------------------------------------------------------
    process.env.ONVO_ENVIRONMENT = 'live';
    process.env.ONVO_SECRET_KEY_LIVE = 'sk_live_fake_live_key_999';
    process.env.ONVO_PUBLIC_KEY_LIVE = 'pk_live_fake_live_key_999';
    delete process.env.ONVO_WEBHOOK_SECRET_LIVE; // Sin webhook secret LIVE
    // ONVO_WEBHOOK_SECRET aún tiene el de sandbox:
    process.env.ONVO_WEBHOOK_SECRET = 'whsec_test_sandbox_secret_abc';

    const cfgLiveSinSecret = await getGatewaysConfig();
    assert.strictEqual(cfgLiveSinSecret.onvopay.secretKey, 'sk_live_fake_live_key_999', 'SecretKey debe ser el de LIVE');
    assert.strictEqual(cfgLiveSinSecret.onvopay.webhookSecret, '', 'En LIVE sin ONVO_WEBHOOK_SECRET_LIVE el webhookSecret DEBE ser vacío');
    console.log('✅ TEST 2 APROBADO: Ausencia de ONVO_WEBHOOK_SECRET_LIVE en modo LIVE deja webhookSecret vacío (bloqueo preventivo de pagos).');

    // -------------------------------------------------------------------------
    // TEST 3: Modo LIVE configurado CON ONVO_WEBHOOK_SECRET_LIVE
    // -------------------------------------------------------------------------
    process.env.ONVO_WEBHOOK_SECRET_LIVE = 'whsec_live_official_secret_xyz';
    const cfgLiveConSecret = await getGatewaysConfig();
    assert.strictEqual(cfgLiveConSecret.onvopay.webhookSecret, 'whsec_live_official_secret_xyz', 'Debe tomar el webhookSecret LIVE');
    console.log('✅ TEST 3 APROBADO: Con ONVO_WEBHOOK_SECRET_LIVE provisto, se resuelve el secreto de producción.');

    // -------------------------------------------------------------------------
    // TEST 4: Verificación normativa de esquemas XML (DGT v4.3)
    // -------------------------------------------------------------------------
    const testDoc: any = {
      sucursal: 1,
      terminal: 1,
      puntoVenta: 1,
      fechaEmision: new Date(),
      emisor: {
        nombre: 'EMPRESA PRUEBA DGT SA',
        identificacion: { tipo: '02', numero: '3101999888' },
        actividadEconomica: '722003',
        sucursal: 1,
        terminal: 1,
        ubicacion: { provincia: '1', canton: '01', distrito: '01', otrasSenas: 'San Jose' },
        telefono: { codigoPais: '506', numTelefono: '22223333' },
        correo: 'factura@empresa.cr'
      },
      receptor: {
        nombre: 'CLIENTE PRUEBA SA',
        identificacion: { tipo: '02', numero: '3101777666' },
        correo: 'cliente@prueba.cr'
      },
      condicionVenta: '01',
      mediosPago: ['01'],
      lineas: [
        {
          numeroLinea: 1,
          codigo: 'SRV-01',
          codigoCabys: '8314100000000',
          detalle: 'Servicio Profesional',
          cantidad: 1,
          unidadMedida: 'Sp',
          precioUnitario: 10000,
          montoTotal: 10000,
          subtotal: 10000,
          impuestos: [
            {
              codigo: '01',
              codigoTarifa: '08',
              tarifa: 13,
              monto: 1300
            }
          ],
          montoTotalLinea: 11300
        }
      ],
      resumen: {
        codigoMoneda: 'CRC',
        tipoCambio: 1,
        totalServiciosGravados: 10000,
        totalServiciosExentos: 0,
        totalServiciosExonerados: 0,
        totalMercanciasGravadas: 0,
        totalMercanciasExentas: 0,
        totalMercanciasExoneradas: 0,
        totalGravado: 10000,
        totalExento: 0,
        totalExonerado: 0,
        totalVenta: 10000,
        totalDescuentos: 0,
        totalVentaNeta: 10000,
        totalImpuesto: 1300,
        totalComprobante: 11300
      }
    };

    // Probar generación de Factura (01)
    const resFactura = generarXMLFactura({ ...testDoc, tipoDocumento: '01' }, 1);
    assert(resFactura.xml.includes('https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.3/facturaElectronica'), 'Factura debe usar namespace oficial v4.3');
    assert(!resFactura.xml.includes('v4.4'), 'No debe referenciar v4.4 inexistente');

    // Probar generación de Tiquete (04)
    const resTiquete = generarXMLFactura({ ...testDoc, tipoDocumento: '04' }, 2);
    assert(resTiquete.xml.includes('https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.3/tiqueteElectronico'), 'Tiquete debe usar namespace oficial v4.3');

    // Probar Nota de Crédito (03)
    const resNC = generarXMLFactura({
      ...testDoc,
      tipoDocumento: '03',
      informacionReferencia: [
        {
          tipoDoc: '01',
          numero: '50623112600310199988800100001010000000001199999999',
          fechaEmision: new Date(),
          codigo: '01',
          razon: 'Anulacion total de factura'
        }
      ]
    }, 3);
    assert(resNC.xml.includes('https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.3/notaCreditoElectronica'), 'Nota de Crédito debe usar namespace oficial v4.3');

    console.log('✅ TEST 4 APROBADO: Generador XML utiliza namespaces y esquemas oficiales DGT v4.3.');

    console.log('\n======================================================');
    console.log('🎉 TODAS LAS PRUEBAS FOCALIZADAS FUERON SUPERADAS AL 100%');
    console.log('======================================================\n');
  } finally {
    // Restaurar entorno
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

runTests().catch(err => {
  console.error('❌ ERROR EN PRUEBA FOCALIZADA:', err);
  process.exit(1);
});
