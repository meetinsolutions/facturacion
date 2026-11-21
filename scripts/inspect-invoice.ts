import pg from 'pg';

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://facturacion_admin:8pVkVpWpj4NrxmGIwZGbHd8@127.0.0.1:5433/facturacion_saas'
  });

  const res = await pool.query(
    `SELECT clave, emisor_nombre, xml_content FROM gastos WHERE clave = '50620112600310104147900111128010001323592136714595'`
  );

  if (res.rows.length === 0) {
    console.log('Factura no encontrada');
    await pool.end();
    return;
  }

  const xml = res.rows[0].xml_content;
  const matchDetalle = xml.match(/<DetalleServicio>[\s\S]*?<\/DetalleServicio>/);
  const matchResumen = xml.match(/<ResumenFactura>[\s\S]*?<\/ResumenFactura>/);

  console.log('=== EMISOR ===');
  console.log(res.rows[0].emisor_nombre);
  console.log('=== RESUMEN FACTURA ===');
  console.log(matchResumen ? matchResumen[0] : 'No resumen');
  console.log('=== DETALLE SERVICIO ===');
  console.log(matchDetalle ? matchDetalle[0] : 'No detalle');

  await pool.end();
}

main().catch(console.error);
