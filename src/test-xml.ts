import { generarXMLFactura } from './services/xml-builder.js';
import { ComprobanteElectronico } from './types/factura.types.js';
import * as fs from 'fs';
import * as path from 'path';

console.log('=== PRUEBA DE CONSTRUCCIÓN DE XML OFICIAL v4.3 (DGT COSTA RICA) ===\n');

// 1. Crear comprobante de ejemplo realista
const facturaEjemplo: ComprobanteElectronico = {
  fechaEmision: new Date(),
  tipoDocumento: '01', // Factura Electrónica
  condicionVenta: '01', // Contado
  mediosPago: ['04'],   // 04 = Transferencia / SINPE
  emisor: {
    nombre: 'COMERCIALIZADORA EL ÉXITO S.A.',
    identificacion: {
      tipo: '02', // Cédula Jurídica
      numero: '3101555666'
    },
    nombreComercial: 'Supermercado El Éxito',
    actividadEconomica: '471100', // Comercio al por menor
    sucursal: 1,
    terminal: 1,
    ubicacion: {
      provincia: '1',  // San José
      canton: '01',    // San José Central
      distrito: '01',  // Carmen
      senas: 'Avenida Central, frente al parque'
    },
    telefono: {
      codigoPais: '506',
      numero: '22223333'
    },
    correo: 'facturacion@elexito.cr',
    entorno: 'staging'
  },
  receptor: {
    nombre: 'JUAN PÉREZ MORA',
    identificacion: {
      tipo: '01', // Cédula Física
      numero: '112340567'
    },
    ubicacion: {
      provincia: '1',
      canton: '01',
      distrito: '02',
      senas: 'Barrio Escalante, casa 24'
    },
    telefono: {
      codigoPais: '506',
      numero: '88889999'
    },
    correo: 'juan.perez@ejemplo.cr'
  },
  lineas: [
    {
      numeroLinea: 1,
      codigoCabys: '2399901000100', // Código CAByS de ejemplo
      codigoInterno: 'PROD-001',
      cantidad: 2,
      unidadMedida: 'Unid',
      detalle: 'Teclado inalámbrico profesional',
      precioUnitario: 15000,
      montoTotal: 30000,
      montoDescuento: 0,
      subTotal: 30000,
      codigoImpuesto: '01', // IVA
      codigoTarifaIVA: '08', // 13% General
      tarifaIVA: 13,
      montoIVA: 3900,
      montoTotalLinea: 33900
    },
    {
      numeroLinea: 2,
      codigoCabys: '8314101000100', // Servicios profesionales
      codigoInterno: 'SERV-CONFIG',
      cantidad: 1,
      unidadMedida: 'Sp',
      detalle: 'Servicio de configuración e instalación en sitio',
      precioUnitario: 10000,
      montoTotal: 10000,
      montoDescuento: 1000,
      naturalezaDescuento: 'Descuento cliente frecuente',
      subTotal: 9000,
      codigoImpuesto: '01',
      codigoTarifaIVA: '08',
      tarifaIVA: 13,
      montoIVA: 1170,
      montoTotalLinea: 10170
    }
  ],
  resumen: {
    codigoMoneda: 'CRC',
    totalServiciosGravados: 9000,
    totalServiciosExentos: 0,
    totalMercanciasGravadas: 30000,
    totalMercanciasExentas: 0,
    totalGravado: 39000,
    totalExento: 0,
    totalVenta: 40000,
    totalDescuentos: 1000,
    totalVentaNeta: 39000,
    totalImpuesto: 5070,
    totalComprobante: 44070
  }
};

const secuenciaFactura = 1;
const { xml, clave, consecutivo } = generarXMLFactura(facturaEjemplo, secuenciaFactura);

console.log(`Clave Asignada: ${clave}`);
console.log(`Consecutivo Asignado: ${consecutivo}\n`);
console.log('--- VISTA PREVIA DEL XML GENERADO (Primeras 35 líneas) ---');
console.log(xml.split('\n').slice(0, 35).join('\n'));
console.log('...\n');

// Guardar archivo para inspección
const outDir = path.join(process.cwd(), 'output');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}
const outFilePath = path.join(outDir, `${clave}.xml`);
fs.writeFileSync(outFilePath, xml, 'utf-8');
console.log(`XML completo guardado exitosamente en:\n${outFilePath}`);
