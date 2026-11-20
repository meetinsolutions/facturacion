import * as fs from 'fs';
import { pool, withTransaction } from '../db/pool.js';
import {
  decryptBuffer,
  decryptSecret,
  encryptBuffer,
  encryptSecret
} from './crypto-service.js';
import {
  Cliente,
  ComprobanteGuardado,
  ConfiguracionSistema,
  EstadoSyncGastos,
  GastoRecibido,
  Producto,
  SecuenciasPorTipo
} from './data-store.js';

export type ConfigSistemaConCert = ConfiguracionSistema & { certificadoCargado?: boolean };

function defaultConfig(): ConfigSistemaConCert {
  return {
    emisor: {
      nombre: '',
      cedula: '',
      tipoIdentificacion: '01',
      nombreComercial: '',
      actividadEconomica: '',
      sucursal: '001',
      terminal: '00001',
      correo: '',
      telefono: '',
      direccion: ''
    },
    sitio: {
      nombreSistema: 'Facturación CR',
      subtitulo: 'Costa Rica • DGT v4.3',
      moneda: 'CRC',
      simboloMoneda: 'CRC',
      logoBase64: '',
      colorPrimario: '#16a34a',
      mensajePieTicket: '¡Gracias por su compra!',
      estiloFactura: 'corporativo',
      tipoCambioDefault: 510
    },
    hacienda: {
      entorno: 'staging',
      usuario: '',
      password: '',
      pin: '',
      enviarAHacienda: false
    },
    correo: {
      proveedor: 'hostinger',
      host: 'smtp.hostinger.com',
      puerto: 465,
      seguro: true,
      usuario: '',
      password: '',
      nombreRemitente: 'Facturación Electrónica',
      copiaOculta: '',
      asuntoTemplate: '{tipoDocumento} #{consecutivo} - {emisor}',
      mensajeTemplate:
        'Estimado(a) {cliente},\n\nAdjunto encontrará su {tipoDocumento} #{consecutivo} emitida por {emisor}, junto con el archivo XML oficial firmado según la normativa de la DGT de Costa Rica.\n\n¡Muchas gracias por su preferencia!',
      envioAutomatico: false,
      imapHost: 'imap.hostinger.com',
      imapPuerto: 993,
      imapSeguro: true,
      imapCarpeta: 'INBOX',
      imapAutoSync: false,
      imapIntervaloMin: 15,
      imapDiasAtras: 90
    },
    certificadoCargado: false
  };
}

function mapProductoRow(row: any): Producto {
  return {
    id: row.id,
    codigoInterno: row.codigo_interno,
    codigoCabys: row.codigo_cabys,
    detalle: row.detalle,
    precioUnitario: Number(row.precio_unitario),
    moneda: row.moneda === 'USD' ? 'USD' : 'CRC',
    unidadMedida: row.unidad_medida || 'Unid',
    tarifaIVA: Number(row.tarifa_iva),
    codigoTarifaIVA: row.codigo_tarifa_iva || '08',
    categoria: row.categoria || 'General',
    stock: Number(row.stock) || 0
  };
}

function mapClienteRow(row: any): Cliente {
  const tipos = ['01', '02', '03', '04'];
  const conds = ['01', '02', '03', '04'];
  return {
    id: row.id,
    nombre: row.nombre,
    nombreComercial: row.nombre_comercial || undefined,
    tipoIdentificacion: tipos.includes(row.tipo_identificacion) ? row.tipo_identificacion : '01',
    cedula: row.cedula,
    correo: row.correo || undefined,
    telefono: row.telefono || undefined,
    direccion: row.direccion || undefined,
    condicionVenta: conds.includes(row.condicion_venta) ? row.condicion_venta : '01',
    plazoCredito: Number(row.plazo_credito) || 30,
    monedaPreferida: row.moneda_preferida === 'USD' ? 'USD' : row.moneda_preferida === 'CRC' ? 'CRC' : undefined,
    notas: row.notas || undefined,
    creadoEn: row.creado_en ? new Date(row.creado_en).toISOString() : undefined
  };
}

function mapComprobanteRow(row: any): ComprobanteGuardado {
  return {
    clave: row.clave,
    consecutivo: row.consecutivo,
    tipoDocumento: row.tipo_documento,
    fecha: row.fecha ? new Date(row.fecha).toISOString() : new Date().toISOString(),
    moneda: row.moneda,
    total: Number(row.total),
    cliente: row.cliente,
    estadoHacienda: row.estado_hacienda,
    estilo: row.estilo || undefined,
    notas: row.notas || undefined,
    correoCliente: row.correo_cliente || undefined,
    correoEnviado: Boolean(row.correo_enviado),
    correoEnviadoEn: row.correo_enviado_en ? new Date(row.correo_enviado_en).toISOString() : undefined,
    correoDestinatario: row.correo_destinatario || undefined,
    correoError: row.correo_error || undefined,
    xmlFirmado: row.xml_firmado,
    docOriginal: row.doc_original_json
  };
}

function mapGastoRow(row: any): GastoRecibido {
  return {
    id: row.clave,
    clave: row.clave,
    consecutivo: row.consecutivo,
    tipoDocumento: row.tipo_documento,
    tipoDocumentoNombre: row.tipo_documento_nombre,
    fechaEmision: row.fecha_emision ? new Date(row.fecha_emision).toISOString() : new Date().toISOString(),
    emisorNombre: row.emisor_nombre,
    emisorNombreComercial: row.emisor_nombre_comercial || undefined,
    emisorCedula: row.emisor_cedula,
    emisorTipoId: row.emisor_tipo_id || undefined,
    emisorCorreo: row.emisor_correo || undefined,
    receptorNombre: row.receptor_nombre || undefined,
    receptorCedula: row.receptor_cedula || undefined,
    moneda: row.moneda === 'USD' ? 'USD' : row.moneda === 'EUR' ? 'EUR' : 'CRC',
    tipoCambio: Number(row.tipo_cambio) || 1,
    subtotalGravado: Number(row.subtotal_gravado) || 0,
    subtotalExento: Number(row.subtotal_exento) || 0,
    totalDescuentos: Number(row.total_descuentos) || 0,
    totalVentaNeta: Number(row.total_venta_neta) || 0,
    totalImpuesto: Number(row.total_impuesto) || 0,
    totalComprobante: Number(row.total_comprobante) || 0,
    totalCRC: Number(row.total_crc) || 0,
    impuestoCRC: Number(row.impuesto_crc) || 0,
    desgloseIVA: row.desglose_iva_json || {},
    lineas: Array.isArray(row.lineas_json) ? row.lineas_json : [],
    categoriaGasto: row.categoria_gasto || 'General / Sin Clasificar',
    estadoConfirmacion: row.estado_confirmacion || 'pendiente',
    notas: row.notas || undefined,
    origen: row.origen === 'correo_imap' ? 'correo_imap' : 'carga_manual',
    correoUid: row.correo_uid !== null && row.correo_uid !== undefined ? Number(row.correo_uid) : undefined,
    correoAsunto: row.correo_asunto || undefined,
    correoRemitente: row.correo_remitente || undefined,
    correoFecha: row.correo_fecha ? new Date(row.correo_fecha).toISOString() : undefined,
    tieneXml: Boolean(row.tiene_xml),
    tienePdf: Boolean(row.tiene_pdf),
    importadoEn: row.importado_en ? new Date(row.importado_en).toISOString() : new Date().toISOString()
  };
}

export class PgDataStore {
  // CONFIGURACIÓN POR TENANT
  async getConfig(tenantId: string): Promise<ConfigSistemaConCert> {
    const def = defaultConfig();
    const res = await pool.query('SELECT * FROM tenant_configs WHERE tenant_id = $1', [tenantId]);
    if (res.rowCount === 0) return def;

    const row = res.rows[0];
    const haciendaJson = { ...def.hacienda, ...(row.hacienda_json || {}) };
    const correoJson = { ...def.correo, ...(row.correo_json || {}) };

    const haciendaPass = decryptSecret(row.hacienda_password_enc) || haciendaJson.password || '';
    const haciendaPin = decryptSecret(row.hacienda_pin_enc) || haciendaJson.pin || '';
    const correoPass = decryptSecret(row.correo_password_enc) || correoJson.password || '';

    return {
      emisor: { ...def.emisor, ...(row.emisor_json || {}) },
      sitio: { ...def.sitio, ...(row.sitio_json || {}) },
      hacienda: {
        ...haciendaJson,
        password: haciendaPass,
        pin: haciendaPin
      },
      correo: {
        ...correoJson,
        password: correoPass
      },
      certificadoCargado: Boolean(row.cert_p12_enc)
    };
  }

  async saveConfig(tenantId: string, data: Partial<ConfiguracionSistema>): Promise<ConfigSistemaConCert> {
    const actual = await this.getConfig(tenantId);
    const updatedEmisor = { ...actual.emisor, ...(data.emisor || {}) };
    const updatedSitio = { ...actual.sitio, ...(data.sitio || {}) };
    const updatedHaciendaFull = { ...actual.hacienda, ...(data.hacienda || {}) };
    const updatedCorreoFull = { ...(actual.correo || {}), ...(data.correo || {}) } as NonNullable<
      ConfiguracionSistema['correo']
    >;

    const { password: hPass, pin: hPin, ...haciendaPublic } = updatedHaciendaFull;
    const { password: cPass, ...correoPublic } = updatedCorreoFull;

    await pool.query(
      `INSERT INTO tenant_configs (tenant_id, emisor_json, sitio_json, hacienda_json, hacienda_password_enc, hacienda_pin_enc, correo_json, correo_password_enc, updated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6, $7::jsonb, $8, NOW())
       ON CONFLICT (tenant_id) DO UPDATE SET
         emisor_json = EXCLUDED.emisor_json,
         sitio_json = EXCLUDED.sitio_json,
         hacienda_json = EXCLUDED.hacienda_json,
         hacienda_password_enc = EXCLUDED.hacienda_password_enc,
         hacienda_pin_enc = EXCLUDED.hacienda_pin_enc,
         correo_json = EXCLUDED.correo_json,
         correo_password_enc = EXCLUDED.correo_password_enc,
         updated_at = NOW()`,
      [
        tenantId,
        JSON.stringify(updatedEmisor),
        JSON.stringify(updatedSitio),
        JSON.stringify(haciendaPublic),
        encryptSecret(hPass),
        encryptSecret(hPin),
        JSON.stringify(correoPublic),
        encryptSecret(cPass)
      ]
    );

    if (data.emisor?.cedula || data.emisor?.nombreComercial || data.emisor?.nombre) {
      await pool.query(
        'UPDATE tenants SET cedula = COALESCE(NULLIF($2, \'\'), cedula), nombre = COALESCE(NULLIF($3, \'\'), nombre) WHERE id = $1',
        [tenantId, updatedEmisor.cedula || '', updatedEmisor.nombreComercial || updatedEmisor.nombre || '']
      );
    }

    return await this.getConfig(tenantId);
  }

  async saveCertificadoP12(tenantId: string, buffer: Buffer, pin: string, filename = 'certificado.p12'): Promise<void> {
    const certEnc = encryptBuffer(buffer);
    const pinEnc = encryptSecret(pin);
    await pool.query(
      `INSERT INTO tenant_configs (tenant_id, cert_p12_enc, cert_filename, hacienda_pin_enc, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (tenant_id) DO UPDATE SET
         cert_p12_enc = EXCLUDED.cert_p12_enc,
         cert_filename = EXCLUDED.cert_filename,
         hacienda_pin_enc = EXCLUDED.hacienda_pin_enc,
         updated_at = NOW()`,
      [tenantId, certEnc, filename, pinEnc]
    );
  }

  async getCertificadoP12(tenantId: string): Promise<{ buffer: Buffer; pin: string; filename?: string } | null> {
    const res = await pool.query(
      'SELECT cert_p12_enc, cert_filename, hacienda_pin_enc, hacienda_json FROM tenant_configs WHERE tenant_id = $1',
      [tenantId]
    );
    if (res.rowCount === 0 || !res.rows[0].cert_p12_enc) return null;
    const row = res.rows[0];
    const buffer = decryptBuffer(row.cert_p12_enc);
    if (!buffer) return null;
    const pin = decryptSecret(row.hacienda_pin_enc) || row.hacienda_json?.pin || '';
    return { buffer, pin, filename: row.cert_filename || 'certificado.p12' };
  }

  // PRODUCTOS
  async getProductos(tenantId: string): Promise<Producto[]> {
    const res = await pool.query('SELECT * FROM productos WHERE tenant_id = $1 ORDER BY detalle ASC', [tenantId]);
    return res.rows.map(mapProductoRow);
  }

  async saveProducto(tenantId: string, prod: Partial<Producto>): Promise<Producto> {
    const id = prod.id && String(prod.id).trim() ? String(prod.id).trim() : Date.now().toString();
    const tarifaIVA = prod.tarifaIVA !== undefined ? Number(prod.tarifaIVA) : 13;
    const codigoTarifaMap: Record<number, string> = { 0: '01', 1: '02', 2: '03', 4: '04', 8: '07', 13: '08' };
    const codigoTarifaIVA = prod.codigoTarifaIVA || codigoTarifaMap[tarifaIVA] || '08';

    const res = await pool.query(
      `INSERT INTO productos (id, tenant_id, codigo_interno, codigo_cabys, detalle, precio_unitario, moneda, unidad_medida, tarifa_iva, codigo_tarifa_iva, categoria, stock)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (tenant_id, id) DO UPDATE SET
         codigo_interno = EXCLUDED.codigo_interno,
         codigo_cabys = EXCLUDED.codigo_cabys,
         detalle = EXCLUDED.detalle,
         precio_unitario = EXCLUDED.precio_unitario,
         moneda = EXCLUDED.moneda,
         unidad_medida = EXCLUDED.unidad_medida,
         tarifa_iva = EXCLUDED.tarifa_iva,
         codigo_tarifa_iva = EXCLUDED.codigo_tarifa_iva,
         categoria = EXCLUDED.categoria,
         stock = EXCLUDED.stock
       RETURNING *`,
      [
        id,
        tenantId,
        String(prod.codigoInterno || 'PROD-001').trim(),
        String(prod.codigoCabys || '2399901000100').trim(),
        String(prod.detalle || 'Producto / Servicio').trim(),
        Number(prod.precioUnitario) || 0,
        prod.moneda === 'USD' ? 'USD' : 'CRC',
        String(prod.unidadMedida || 'Unid').trim() || 'Unid',
        tarifaIVA,
        codigoTarifaIVA,
        String(prod.categoria || 'General').trim() || 'General',
        Number(prod.stock) || 0
      ]
    );
    return mapProductoRow(res.rows[0]);
  }

  async deleteProducto(tenantId: string, id: string): Promise<boolean> {
    const res = await pool.query('DELETE FROM productos WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return (res.rowCount || 0) > 0;
  }

  // CATEGORIAS
  async getCategorias(tenantId: string): Promise<string[]> {
    const res = await pool.query('SELECT nombre FROM categorias WHERE tenant_id = $1 ORDER BY nombre ASC', [tenantId]);
    return res.rows.map(r => r.nombre);
  }

  async saveCategorias(tenantId: string, cats: string[]): Promise<string[]> {
    const cleaned = [...new Set((Array.isArray(cats) ? cats : []).map(c => String(c).trim()).filter(Boolean))];
    await withTransaction(async (client) => {
      await client.query('DELETE FROM categorias WHERE tenant_id = $1', [tenantId]);
      for (const nombre of cleaned) {
        await client.query('INSERT INTO categorias (tenant_id, nombre) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
          tenantId,
          nombre
        ]);
      }
    });
    return await this.getCategorias(tenantId);
  }

  // CLIENTES
  async getClientes(tenantId: string): Promise<Cliente[]> {
    const res = await pool.query('SELECT * FROM clientes WHERE tenant_id = $1 ORDER BY nombre ASC', [tenantId]);
    return res.rows.map(mapClienteRow);
  }

  async saveCliente(tenantId: string, cli: Partial<Cliente>): Promise<Cliente> {
    const nombre = (cli.nombre || '').trim();
    if (!nombre) {
      throw new Error('El nombre o razón social del cliente es obligatorio.');
    }
    const cedula = String(cli.cedula || '').replace(/[\s-]+/g, '');
    if (!cedula) {
      throw new Error('El número de cédula o identificación es obligatorio.');
    }

    const tiposValidos = ['01', '02', '03', '04'];
    const condsValidas = ['01', '02', '03', '04'];
    const tipoIdentificacion = tiposValidos.includes(String(cli.tipoIdentificacion))
      ? String(cli.tipoIdentificacion)
      : '01';
    const condicionVenta = condsValidas.includes(String(cli.condicionVenta)) ? String(cli.condicionVenta) : '01';
    const monedaPreferida =
      cli.monedaPreferida === 'USD' ? 'USD' : cli.monedaPreferida === 'CRC' ? 'CRC' : null;

    const opt = (v?: string) => {
      const t = (v || '').trim();
      return t || null;
    };

    const id = cli.id && String(cli.id).trim() ? String(cli.id).trim() : `CLI-${Date.now()}`;
    const res = await pool.query(
      `INSERT INTO clientes (id, tenant_id, nombre, nombre_comercial, tipo_identificacion, cedula, correo, telefono, direccion, condicion_venta, plazo_credito, moneda_preferida, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (tenant_id, id) DO UPDATE SET
         nombre = EXCLUDED.nombre,
         nombre_comercial = EXCLUDED.nombre_comercial,
         tipo_identificacion = EXCLUDED.tipo_identificacion,
         cedula = EXCLUDED.cedula,
         correo = EXCLUDED.correo,
         telefono = EXCLUDED.telefono,
         direccion = EXCLUDED.direccion,
         condicion_venta = EXCLUDED.condicion_venta,
         plazo_credito = EXCLUDED.plazo_credito,
         moneda_preferida = EXCLUDED.moneda_preferida,
         notas = EXCLUDED.notas
       RETURNING *`,
      [
        id,
        tenantId,
        nombre,
        opt(cli.nombreComercial),
        tipoIdentificacion,
        cedula,
        opt(cli.correo),
        opt(cli.telefono),
        opt(cli.direccion),
        condicionVenta,
        Number(cli.plazoCredito) || 30,
        monedaPreferida,
        opt(cli.notas)
      ]
    );
    return mapClienteRow(res.rows[0]);
  }

  async deleteCliente(tenantId: string, id: string): Promise<boolean> {
    const res = await pool.query('DELETE FROM clientes WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return (res.rowCount || 0) > 0;
  }

  // CONSECUTIVOS & SECUENCIADOR
  async getSecuenciaActual(tenantId: string, tipoDocumento: '01' | '02' | '03' | '04' = '01'): Promise<number> {
    const res = await pool.query(
      'SELECT ultimo_numero FROM secuencias_consecutivos WHERE tenant_id = $1 AND tipo_documento = $2',
      [tenantId, tipoDocumento]
    );
    return res.rowCount ? Number(res.rows[0].ultimo_numero) : 0;
  }

  async getSecuencias(tenantId: string): Promise<{ ultimos: SecuenciasPorTipo; proximos: SecuenciasPorTipo }> {
    const res = await pool.query(
      'SELECT tipo_documento, ultimo_numero FROM secuencias_consecutivos WHERE tenant_id = $1',
      [tenantId]
    );
    const ultimos: SecuenciasPorTipo = { '01': 0, '02': 0, '03': 0, '04': 0 };
    for (const r of res.rows) {
      if (r.tipo_documento === '01' || r.tipo_documento === '02' || r.tipo_documento === '03' || r.tipo_documento === '04') {
        ultimos[r.tipo_documento as '01' | '02' | '03' | '04'] = Number(r.ultimo_numero) || 0;
      }
    }
    return {
      ultimos,
      proximos: {
        '01': ultimos['01'] + 1,
        '02': ultimos['02'] + 1,
        '03': ultimos['03'] + 1,
        '04': ultimos['04'] + 1
      }
    };
  }

  async setProximosConsecutivos(
    tenantId: string,
    proximos: Partial<Record<'01' | '02' | '03' | '04', number>>
  ): Promise<{ ultimos: SecuenciasPorTipo; proximos: SecuenciasPorTipo }> {
    const tipos: Array<'01' | '02' | '03' | '04'> = ['01', '02', '03', '04'];
    await withTransaction(async (client) => {
      for (const k of tipos) {
        if (proximos[k] !== undefined) {
          const val = Number(proximos[k]);
          if (!Number.isInteger(val) || val < 1 || val > 9999999999) {
            throw new Error(`El próximo consecutivo para tipo ${k} debe ser un entero entre 1 y 9999999999.`);
          }
          const base = val - 1;
          await client.query(
            `INSERT INTO secuencias_consecutivos (tenant_id, tipo_documento, ultimo_numero, numero_inicial)
             VALUES ($1, $2, $3, $3)
             ON CONFLICT (tenant_id, tipo_documento) DO UPDATE SET
               ultimo_numero = EXCLUDED.ultimo_numero,
               numero_inicial = EXCLUDED.numero_inicial`,
            [tenantId, k, base]
          );
        }
      }
    });
    return await this.getSecuencias(tenantId);
  }

  async getNextSecuencia(tenantId: string, tipoDocumento: string = '01'): Promise<number> {
    const key: '01' | '02' | '03' | '04' =
      tipoDocumento === '02' || tipoDocumento === '03' || tipoDocumento === '04' ? tipoDocumento : '01';
    const res = await pool.query(
      `INSERT INTO secuencias_consecutivos (tenant_id, tipo_documento, ultimo_numero, numero_inicial)
       VALUES ($1, $2, 1, 0)
       ON CONFLICT (tenant_id, tipo_documento) DO UPDATE SET
         ultimo_numero = secuencias_consecutivos.ultimo_numero + 1
       RETURNING ultimo_numero`,
      [tenantId, key]
    );
    return Number(res.rows[0].ultimo_numero);
  }

  // COMPROBANTES EMITIDOS
  async getComprobantes(tenantId: string): Promise<ComprobanteGuardado[]> {
    const res = await pool.query('SELECT * FROM comprobantes WHERE tenant_id = $1 ORDER BY fecha DESC', [tenantId]);
    return res.rows.map(mapComprobanteRow);
  }

  async getComprobanteByClave(tenantId: string, clave: string): Promise<ComprobanteGuardado | undefined> {
    const res = await pool.query('SELECT * FROM comprobantes WHERE tenant_id = $1 AND clave = $2', [tenantId, clave]);
    return res.rowCount ? mapComprobanteRow(res.rows[0]) : undefined;
  }

  async countComprobantesMesActual(tenantId: string): Promise<number> {
    const res = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM comprobantes
       WHERE tenant_id = $1 AND fecha >= date_trunc('month', NOW())`,
      [tenantId]
    );
    return Number(res.rows[0]?.total || 0);
  }

  async saveComprobante(tenantId: string, registro: ComprobanteGuardado): Promise<void> {
    await pool.query(
      `INSERT INTO comprobantes (
        tenant_id, clave, consecutivo, tipo_documento, fecha, moneda, total, cliente,
        estado_hacienda, estilo, notas, correo_cliente, correo_enviado, correo_enviado_en,
        correo_destinatario, correo_error, xml_firmado, doc_original_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)
      ON CONFLICT (tenant_id, clave) DO NOTHING`,
      [
        tenantId,
        registro.clave,
        registro.consecutivo,
        registro.tipoDocumento,
        new Date(registro.fecha),
        registro.moneda,
        Number(registro.total) || 0,
        registro.cliente,
        registro.estadoHacienda,
        registro.estilo || null,
        registro.notas || null,
        registro.correoCliente || null,
        Boolean(registro.correoEnviado),
        registro.correoEnviadoEn ? new Date(registro.correoEnviadoEn) : null,
        registro.correoDestinatario || null,
        registro.correoError || null,
        registro.xmlFirmado,
        JSON.stringify(registro.docOriginal || {})
      ]
    );
  }

  async updateComprobanteCorreo(
    tenantId: string,
    clave: string,
    info: {
      correoEnviado?: boolean;
      correoEnviadoEn?: string;
      correoDestinatario?: string;
      correoError?: string;
    }
  ): Promise<ComprobanteGuardado | undefined> {
    const actual = await this.getComprobanteByClave(tenantId, clave);
    if (!actual) return undefined;

    const merged = { ...actual, ...info };
    const res = await pool.query(
      `UPDATE comprobantes
       SET correo_enviado = $3,
           correo_enviado_en = $4,
           correo_destinatario = $5,
           correo_error = $6
       WHERE tenant_id = $1 AND clave = $2
       RETURNING *`,
      [
        tenantId,
        clave,
        Boolean(merged.correoEnviado),
        merged.correoEnviadoEn ? new Date(merged.correoEnviadoEn) : null,
        merged.correoDestinatario || null,
        info.correoError === undefined ? null : info.correoError
      ]
    );
    return res.rowCount ? mapComprobanteRow(res.rows[0]) : undefined;
  }

  async deleteComprobante(tenantId: string, clave: string): Promise<{ deleted: boolean; reason?: string }> {
    const item = await this.getComprobanteByClave(tenantId, clave);
    if (!item) {
      return { deleted: false, reason: 'Comprobante no encontrado.' };
    }
    if (item.estadoHacienda !== 'firmado_local') {
      return {
        deleted: false,
        reason: 'Solo se pueden eliminar comprobantes de prueba local (no enviados a Hacienda).'
      };
    }
    await pool.query('DELETE FROM comprobantes WHERE tenant_id = $1 AND clave = $2', [tenantId, clave]);
    return { deleted: true };
  }

  async clearPruebasLocales(
    tenantId: string,
    resetSecuencia?: number,
    restaurarBase: boolean = true
  ): Promise<{ removed: number; secuencia: number; secuencias: SecuenciasPorTipo }> {
    const removed = await withTransaction(async (client) => {
      const del = await client.query(
        "DELETE FROM comprobantes WHERE tenant_id = $1 AND estado_hacienda = 'firmado_local'",
        [tenantId]
      );
      if (typeof resetSecuencia === 'number' && !Number.isNaN(resetSecuencia) && resetSecuencia >= 0) {
        const n = Math.floor(resetSecuencia);
        await client.query(
          `INSERT INTO secuencias_consecutivos (tenant_id, tipo_documento, ultimo_numero, numero_inicial)
           VALUES ($1, '01', $2, $2)
           ON CONFLICT (tenant_id, tipo_documento) DO UPDATE SET ultimo_numero = EXCLUDED.ultimo_numero`,
          [tenantId, n]
        );
      } else if (restaurarBase) {
        await client.query(
          'UPDATE secuencias_consecutivos SET ultimo_numero = numero_inicial WHERE tenant_id = $1',
          [tenantId]
        );
      }
      return del.rowCount || 0;
    });

    const secData = await this.getSecuencias(tenantId);
    return { removed, secuencia: secData.ultimos['01'], secuencias: secData.ultimos };
  }

  // CONTROL DE GASTOS
  async getGastosStore(tenantId: string): Promise<EstadoSyncGastos & { items: GastoRecibido[] }> {
    const [estadoRes, itemsRes] = await Promise.all([
      pool.query('SELECT * FROM gastos_sync_estado WHERE tenant_id = $1', [tenantId]),
      pool.query(
        `SELECT tenant_id, clave, consecutivo, tipo_documento, tipo_documento_nombre, fecha_emision,
                emisor_nombre, emisor_nombre_comercial, emisor_cedula, emisor_tipo_id, emisor_correo,
                receptor_nombre, receptor_cedula, moneda, tipo_cambio, subtotal_gravado, subtotal_exento,
                total_descuentos, total_venta_neta, total_impuesto, total_comprobante, total_crc, impuesto_crc,
                desglose_iva_json, lineas_json, categoria_gasto, estado_confirmacion, notas, origen,
                correo_uid, correo_asunto, correo_remitente, correo_fecha, tiene_xml, tiene_pdf, importado_en
         FROM gastos WHERE tenant_id = $1 ORDER BY fecha_emision DESC`,
        [tenantId]
      )
    ]);

    const est = estadoRes.rowCount ? estadoRes.rows[0] : null;
    return {
      ultimaSincronizacion: est?.ultima_sincronizacion ? new Date(est.ultima_sincronizacion).toISOString() : undefined,
      ultimoResumen: est?.ultimo_resumen_json || undefined,
      ultimoError: est?.ultimo_error || undefined,
      items: itemsRes.rows.map(mapGastoRow)
    };
  }

  async getGastos(tenantId: string): Promise<GastoRecibido[]> {
    return (await this.getGastosStore(tenantId)).items;
  }

  async getGastoByClave(tenantId: string, clave: string): Promise<GastoRecibido | undefined> {
    const res = await pool.query(
      `SELECT tenant_id, clave, consecutivo, tipo_documento, tipo_documento_nombre, fecha_emision,
              emisor_nombre, emisor_nombre_comercial, emisor_cedula, emisor_tipo_id, emisor_correo,
              receptor_nombre, receptor_cedula, moneda, tipo_cambio, subtotal_gravado, subtotal_exento,
              total_descuentos, total_venta_neta, total_impuesto, total_comprobante, total_crc, impuesto_crc,
              desglose_iva_json, lineas_json, categoria_gasto, estado_confirmacion, notas, origen,
              correo_uid, correo_asunto, correo_remitente, correo_fecha, tiene_xml, tiene_pdf, importado_en
       FROM gastos WHERE tenant_id = $1 AND clave = $2`,
      [tenantId, clave]
    );
    return res.rowCount ? mapGastoRow(res.rows[0]) : undefined;
  }

  async saveGasto(
    tenantId: string,
    gasto: GastoRecibido,
    xmlContent?: string,
    pdfBuffer?: Buffer
  ): Promise<{ saved: boolean; duplicado: boolean; item: GastoRecibido }> {
    const existing = await pool.query(
      'SELECT clave, tiene_xml, tiene_pdf FROM gastos WHERE tenant_id = $1 AND clave = $2',
      [tenantId, gasto.clave]
    );

    if (existing.rowCount && existing.rowCount > 0) {
      const row = existing.rows[0];
      if ((!row.tiene_pdf && pdfBuffer && pdfBuffer.length > 0) || (!row.tiene_xml && xmlContent)) {
        await pool.query(
          `UPDATE gastos
           SET xml_content = COALESCE(xml_content, $3),
               tiene_xml = tiene_xml OR ($3 IS NOT NULL),
               pdf_content = COALESCE(pdf_content, $4),
               tiene_pdf = tiene_pdf OR ($4 IS NOT NULL)
           WHERE tenant_id = $1 AND clave = $2`,
          [tenantId, gasto.clave, xmlContent || null, pdfBuffer && pdfBuffer.length > 0 ? pdfBuffer : null]
        );
      }
      const full = (await this.getGastoByClave(tenantId, gasto.clave))!;
      return { saved: false, duplicado: true, item: full };
    }

    const tieneXml = Boolean(xmlContent);
    const tienePdf = Boolean(pdfBuffer && pdfBuffer.length > 0);
    await pool.query(
      `INSERT INTO gastos (
        tenant_id, clave, consecutivo, tipo_documento, tipo_documento_nombre, fecha_emision,
        emisor_nombre, emisor_nombre_comercial, emisor_cedula, emisor_tipo_id, emisor_correo,
        receptor_nombre, receptor_cedula, moneda, tipo_cambio, subtotal_gravado, subtotal_exento,
        total_descuentos, total_venta_neta, total_impuesto, total_comprobante, total_crc, impuesto_crc,
        desglose_iva_json, lineas_json, categoria_gasto, estado_confirmacion, notas, origen,
        correo_uid, correo_asunto, correo_remitente, correo_fecha, tiene_xml, tiene_pdf, xml_content, pdf_content
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
        $24::jsonb,$25::jsonb,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37
      )`,
      [
        tenantId,
        gasto.clave,
        gasto.consecutivo,
        gasto.tipoDocumento,
        gasto.tipoDocumentoNombre,
        new Date(gasto.fechaEmision),
        gasto.emisorNombre,
        gasto.emisorNombreComercial || null,
        gasto.emisorCedula || '',
        gasto.emisorTipoId || null,
        gasto.emisorCorreo || null,
        gasto.receptorNombre || null,
        gasto.receptorCedula || null,
        gasto.moneda,
        Number(gasto.tipoCambio) || 1,
        Number(gasto.subtotalGravado) || 0,
        Number(gasto.subtotalExento) || 0,
        Number(gasto.totalDescuentos) || 0,
        Number(gasto.totalVentaNeta) || 0,
        Number(gasto.totalImpuesto) || 0,
        Number(gasto.totalComprobante) || 0,
        Number(gasto.totalCRC) || 0,
        Number(gasto.impuestoCRC) || 0,
        JSON.stringify(gasto.desgloseIVA || {}),
        JSON.stringify(gasto.lineas || []),
        gasto.categoriaGasto || 'General / Sin Clasificar',
        gasto.estadoConfirmacion || 'pendiente',
        gasto.notas || null,
        gasto.origen || 'carga_manual',
        gasto.correoUid ?? null,
        gasto.correoAsunto || null,
        gasto.correoRemitente || null,
        gasto.correoFecha ? new Date(gasto.correoFecha) : null,
        tieneXml,
        tienePdf,
        xmlContent || null,
        tienePdf ? pdfBuffer! : null
      ]
    );

    const savedItem = (await this.getGastoByClave(tenantId, gasto.clave))!;
    return { saved: true, duplicado: false, item: savedItem };
  }

  async updateGasto(
    tenantId: string,
    clave: string,
    patch: Partial<Pick<GastoRecibido, 'categoriaGasto' | 'estadoConfirmacion' | 'notas'>>
  ): Promise<GastoRecibido | undefined> {
    const current = await this.getGastoByClave(tenantId, clave);
    if (!current) return undefined;

    const estadosValidos = ['pendiente', 'aceptado', 'aceptado_parcial', 'rechazado'];
    const categoria = patch.categoriaGasto !== undefined ? String(patch.categoriaGasto).trim() || current.categoriaGasto : current.categoriaGasto;
    const estado =
      patch.estadoConfirmacion && estadosValidos.includes(patch.estadoConfirmacion)
        ? patch.estadoConfirmacion
        : current.estadoConfirmacion;
    const notas = patch.notas !== undefined ? (String(patch.notas).trim() || null) : (current.notas || null);

    await pool.query(
      'UPDATE gastos SET categoria_gasto = $3, estado_confirmacion = $4, notas = $5 WHERE tenant_id = $1 AND clave = $2',
      [tenantId, clave, categoria, estado, notas]
    );
    return await this.getGastoByClave(tenantId, clave);
  }

  async deleteGasto(tenantId: string, clave: string): Promise<boolean> {
    const res = await pool.query('DELETE FROM gastos WHERE tenant_id = $1 AND clave = $2', [tenantId, clave]);
    return (res.rowCount || 0) > 0;
  }

  async getGastoArchivo(tenantId: string, clave: string, ext: 'xml' | 'pdf'): Promise<string | Buffer | null> {
    const col = ext === 'xml' ? 'xml_content' : 'pdf_content';
    const res = await pool.query(`SELECT ${col} AS data FROM gastos WHERE tenant_id = $1 AND clave = $2`, [
      tenantId,
      clave
    ]);
    if (!res.rowCount || !res.rows[0].data) return null;
    return res.rows[0].data;
  }

  async saveEstadoSyncGastos(tenantId: string, estado: EstadoSyncGastos): Promise<void> {
    await pool.query(
      `INSERT INTO gastos_sync_estado (tenant_id, ultima_sincronizacion, ultimo_resumen_json, ultimo_error)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (tenant_id) DO UPDATE SET
         ultima_sincronizacion = EXCLUDED.ultima_sincronizacion,
         ultimo_resumen_json = COALESCE(EXCLUDED.ultimo_resumen_json, gastos_sync_estado.ultimo_resumen_json),
         ultimo_error = EXCLUDED.ultimo_error`,
      [
        tenantId,
        estado.ultimaSincronizacion ? new Date(estado.ultimaSincronizacion) : new Date(),
        estado.ultimoResumen ? JSON.stringify(estado.ultimoResumen) : null,
        estado.ultimoError || null
      ]
    );
  }

  async listarTenantsConAutoSyncImap(): Promise<Array<{ tenantId: string; config: ConfigSistemaConCert }>> {
    const res = await pool.query(
      `SELECT t.id AS tenant_id
       FROM tenants t
       JOIN tenant_configs tc ON tc.tenant_id = t.id
       JOIN subscriptions s ON s.tenant_id = t.id
       JOIN plans p ON p.code = s.plan_code
       WHERE t.activo = TRUE
         AND s.status IN ('trialing', 'active', 'past_due')
         AND p.permite_imap_gastos = TRUE
         AND COALESCE((tc.correo_json->>'imapAutoSync')::boolean, FALSE) = TRUE
         AND COALESCE(tc.correo_password_enc, '') <> ''`
    );

    const out: Array<{ tenantId: string; config: ConfigSistemaConCert }> = [];
    for (const r of res.rows) {
      const cfg = await this.getConfig(r.tenant_id);
      if (cfg.correo?.usuario && cfg.correo?.password) {
        out.push({ tenantId: r.tenant_id, config: cfg });
      }
    }
    return out;
  }

  // AJUSTES GLOBALES DE PLATAFORMA (PASARELAS)
  async getPlatformSetting<T = any>(key: string): Promise<T | null> {
    const res = await pool.query('SELECT value_enc FROM platform_settings WHERE key = $1', [key]);
    if (!res.rowCount || !res.rows[0].value_enc) return null;
    try {
      const raw = decryptSecret(res.rows[0].value_enc);
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setPlatformSetting(key: string, value: unknown): Promise<void> {
    const enc = encryptSecret(JSON.stringify(value));
    await pool.query(
      `INSERT INTO platform_settings (key, value_enc, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value_enc = EXCLUDED.value_enc, updated_at = NOW()`,
      [key, enc]
    );
  }
}

export const pgDataStore = new PgDataStore();
