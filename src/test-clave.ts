import {
  generarConsecutivo,
  generarClave,
  generarCodigoSeguridad
} from './services/clave-generator.js';
import { TipoDocumento } from './types/factura.types.js';

console.log('=== PRUEBA DE GENERACIÓN DE CONSECUTIVO Y CLAVE DE 50 DÍGITOS (DGT COSTA RICA) ===\n');

// Datos de prueba para una Factura Electrónica (01)
const sucursal = 1;      // Casa matriz (001)
const terminal = 1;      // Caja 1 (00001)
const tipoDoc: TipoDocumento = '01'; // Factura Electrónica
const secuencia = 42;    // Factura #42

const consecutivo = generarConsecutivo(sucursal, terminal, tipoDoc, secuencia);
console.log(`Consecutivo (20 dígitos): ${consecutivo}`);
console.log(`- Longitud: ${consecutivo.length} caracteres`);

// Emisor de prueba: Cédula jurídica 3-101-123456
const cedulaEmisor = '3101123456';
const fechaEmision = new Date();

const clave = generarClave({
  fecha: fechaEmision,
  cedulaEmisor,
  consecutivo,
  situacion: '1' // 1 = Normal
});

console.log(`\nClave Numérica (50 dígitos): ${clave}`);
console.log(`- Longitud: ${clave.length} caracteres`);

// Desglose de la clave generada
console.log('\nDesglose de la Clave:');
console.log(`- País: ${clave.substring(0, 3)}`);
console.log(`- Fecha (DDMMAA): ${clave.substring(3, 9)}`);
console.log(`- Cédula Emisor: ${clave.substring(9, 21)}`);
console.log(`- Consecutivo: ${clave.substring(21, 41)}`);
console.log(`- Situación de Envío: ${clave.substring(41, 42)}`);
console.log(`- Código de Seguridad: ${clave.substring(42, 50)}`);
