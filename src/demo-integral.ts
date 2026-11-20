import { MotorFacturacion } from './index.js';
import { ComprobanteElectronico } from './types/factura.types.js';
import * as path from 'path';

async function main() {
  console.log('=== DEMO INTEGRAL: FLUJO COMPLETO DEL MOTOR DE FACTURACIÓN ===\n');

  const motor = new MotorFacturacion();

  // 1. Configurar certificado criptográfico
  const certPath = path.join(process.cwd(), 'certs', 'test-cert.p12');
  motor.configurarCertificado(certPath, '1234');
  console.log('✔ Certificado criptográfico cargado exitosamente.');

  // 2. Factura de prueba lista para emitir
  const factura: ComprobanteElectronico = {
    fechaEmision: new Date(),
    tipoDocumento: '04', // Tiquete Electrónico POS
    condicionVenta: '01', // Contado
    mediosPago: ['01'],   // Efectivo
    emisor: {
      nombre: 'PUNTO DE VENTA DEMO S.A.',
      identificacion: {
        tipo: '02',
        numero: '3101999888'
      },
      actividadEconomica: '561001', // Restaurante / Cafetería
      sucursal: 1,
      terminal: 1,
      ubicacion: {
        provincia: '1',
        canton: '01',
        distrito: '01',
        senas: 'Frente al parque central'
      },
      correo: 'info@tiendademo.cr',
      entorno: 'staging'
    },
    lineas: [
      {
        numeroLinea: 1,
        codigoCabys: '2399901000100',
        codigoInterno: 'CAFE-01',
        cantidad: 2,
        unidadMedida: 'Unid',
        detalle: 'Café Cappuccino Grande',
        precioUnitario: 2200,
        montoTotal: 4400,
        subTotal: 4400,
        codigoImpuesto: '01',
        codigoTarifaIVA: '08',
        tarifaIVA: 13,
        montoIVA: 572,
        montoTotalLinea: 4972
      }
    ],
    resumen: {
      codigoMoneda: 'CRC',
      totalServiciosGravados: 0,
      totalServiciosExentos: 0,
      totalMercanciasGravadas: 4400,
      totalMercanciasExentas: 0,
      totalGravado: 4400,
      totalExento: 0,
      totalVenta: 4400,
      totalDescuentos: 0,
      totalVentaNeta: 4400,
      totalImpuesto: 572,
      totalComprobante: 4972
    }
  };

  // 3. Emitir Comprobante (Sin envío a Hacienda aún, modo simulación/local)
  console.log('\nEmitiendo comprobante con motor integrado...');
  const resultado = await motor.emitirFactura(factura, 105, false);

  console.log(`\n✔ Clave Numérica generada: ${resultado.clave}`);
  console.log(`✔ Consecutivo: ${resultado.consecutivo}`);
  console.log(`✔ Tamaño del XML firmado: ${Buffer.byteLength(resultado.xmlFirmado, 'utf8')} bytes`);
  console.log(`✔ Contiene bloque XAdES <ds:Signature>: ${resultado.xmlFirmado.includes('<ds:Signature')}`);
  console.log('\nFlujo completado con éxito!');
}

main().catch(console.error);
