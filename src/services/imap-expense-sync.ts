import { ImapFlow, MessageStructureObject } from 'imapflow';
import { simpleParser, Attachment } from 'mailparser';
import { ConfiguracionSistema } from './data-store.js';
import { pgDataStore } from './pg-data-store.js';
import { parsearFacturaXMLCostaRica } from './xml-expense-parser.js';

type ConfigCorreo = NonNullable<ConfiguracionSistema['correo']>;

export interface SyncGastosResultado {
  enCurso?: boolean;
  revisados: number;
  candidatosConAdjuntos: number;
  importados: number;
  duplicados: number;
  omitidosPropios: number;
  omitidosOtroReceptor: number;
  errores: number;
  ultimaSincronizacion: string;
}

const syncEnCursoTenants = new Set<string>();

export function normalizarCedula(val?: string): string {
  return String(val || '').replace(/\D/g, '').replace(/^0+/, '');
}

function validarConfigImap(cfg?: Partial<ConfigCorreo>) {
  const host = (cfg?.imapHost || 'imap.hostinger.com').trim();
  const puerto = Number(cfg?.imapPuerto) || 993;
  const seguro = cfg?.imapSeguro !== undefined ? Boolean(cfg.imapSeguro) : true;
  const carpeta = (cfg?.imapCarpeta || 'INBOX').trim() || 'INBOX';
  const usuario = (cfg?.usuario || '').trim();
  const password = cfg?.password || '';

  if (!host) {
    throw new Error('Debe configurar el servidor entrante IMAP (Host) en Configuración → Correo / SMTP.');
  }
  if (!usuario) {
    throw new Error('Debe configurar el usuario / correo en Configuración → Correo / SMTP.');
  }
  if (!password) {
    throw new Error('Debe configurar la contraseña del correo en Configuración → Correo / SMTP.');
  }

  return { host, puerto, seguro, carpeta, usuario, password };
}

function crearClienteImap(valid: ReturnType<typeof validarConfigImap>): ImapFlow {
  const client = new ImapFlow({
    host: valid.host,
    port: valid.puerto,
    secure: valid.seguro,
    auth: {
      user: valid.usuario,
      pass: valid.password
    },
    logger: false,
    tls: {
      minVersion: 'TLSv1.2'
    }
  });
  client.on('error', () => {});
  return client;
}

function tienePosibleXml(node?: MessageStructureObject): boolean {
  if (!node) return false;
  const tipo = String(node.type || '').toLowerCase();
  const dispName = String(node.dispositionParameters?.filename || '').toLowerCase();
  const paramName = String(node.parameters?.name || '').toLowerCase();

  if (tipo.includes('xml') || dispName.endsWith('.xml') || paramName.endsWith('.xml')) {
    return true;
  }

  if (Array.isArray(node.childNodes)) {
    return node.childNodes.some(child => tienePosibleXml(child));
  }
  return false;
}

function esAdjuntoXml(att: Attachment): boolean {
  const name = String(att.filename || '').toLowerCase();
  const ct = String(att.contentType || '').toLowerCase();
  return name.endsWith('.xml') || ct.includes('xml');
}

function esAdjuntoPdf(att: Attachment): boolean {
  const name = String(att.filename || '').toLowerCase();
  const ct = String(att.contentType || '').toLowerCase();
  return name.endsWith('.pdf') || ct.includes('pdf');
}

function buscarPdfAsociado(
  pdfAtts: Attachment[],
  clave: string,
  consecutivo: string,
  unicoComprobanteEnCorreo: boolean
): Attachment | undefined {
  if (pdfAtts.length === 0) return undefined;
  const byClaveOrCons = pdfAtts.find(p => {
    const fn = String(p.filename || '');
    return fn.includes(clave) || (consecutivo && fn.includes(consecutivo));
  });
  if (byClaveOrCons) return byClaveOrCons;
  if (unicoComprobanteEnCorreo && pdfAtts.length === 1) return pdfAtts[0];
  return undefined;
}

async function cerrarImapSeguro(client: ImapFlow): Promise<void> {
  try {
    await client.logout();
  } catch {
    try {
      client.close();
    } catch {}
  }
}

export async function probarConexionIMAP(cfg?: Partial<ConfigCorreo>): Promise<{
  mensaje: string;
  host: string;
  puerto: number;
  carpeta: string;
  totalMensajes: number;
}> {
  const valid = validarConfigImap(cfg);
  const client = crearClienteImap(valid);

  await client.connect();
  let totalMensajes = 0;
  try {
    const lock = await client.getMailboxLock(valid.carpeta);
    try {
      totalMensajes = client.mailbox && typeof client.mailbox === 'object' ? client.mailbox.exists || 0 : 0;
    } finally {
      lock.release();
    }
  } finally {
    await cerrarImapSeguro(client);
  }

  return {
    mensaje: `Conexión IMAP exitosa con ${valid.host}:${valid.puerto} (${valid.carpeta}: ${totalMensajes} mensajes).`,
    host: valid.host,
    puerto: valid.puerto,
    carpeta: valid.carpeta,
    totalMensajes
  };
}

export async function sincronizarGastosDesdeCorreo(
  tenantId: string,
  config: ConfiguracionSistema,
  opciones?: { diasAtras?: number; limiteMensajes?: number }
): Promise<SyncGastosResultado> {
  const ahoraIso = new Date().toISOString();
  if (syncEnCursoTenants.has(tenantId)) {
    return {
      enCurso: true,
      revisados: 0,
      candidatosConAdjuntos: 0,
      importados: 0,
      duplicados: 0,
      omitidosPropios: 0,
      omitidosOtroReceptor: 0,
      errores: 0,
      ultimaSincronizacion: ahoraIso
    };
  }

  syncEnCursoTenants.add(tenantId);
  let valid: ReturnType<typeof validarConfigImap>;
  try {
    valid = validarConfigImap(config.correo);
  } catch (err) {
    syncEnCursoTenants.delete(tenantId);
    throw err;
  }

  const client = crearClienteImap(valid);
  const diasAtras = Math.max(1, Number(opciones?.diasAtras ?? config.correo?.imapDiasAtras) || 90);
  const limiteMensajes = Math.max(1, Number(opciones?.limiteMensajes) || 150);
  const tipoCambioDefault = Number(config.sitio?.tipoCambioDefault) || 510;
  const cedulaPropia = normalizarCedula(config.emisor?.cedula);

  let revisados = 0;
  let candidatosConAdjuntos = 0;
  let importados = 0;
  let duplicados = 0;
  let omitidosPropios = 0;
  let omitidosOtroReceptor = 0;
  let errores = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock(valid.carpeta);
    try {
      const since = new Date(Date.now() - diasAtras * 86400_000);
      const searchRes = await client.search({ since }, { uid: true });
      const allUids = Array.isArray(searchRes) ? [...searchRes].sort((a, b) => b - a).slice(0, limiteMensajes) : [];
      revisados = allUids.length;

      const candidateUids: number[] = [];
      if (allUids.length > 0) {
        for await (const msg of client.fetch(allUids, { uid: true, bodyStructure: true }, { uid: true })) {
          if (tienePosibleXml(msg.bodyStructure)) {
            candidateUids.push(msg.uid);
          }
        }
      }

      candidatosConAdjuntos = candidateUids.length;

      if (candidateUids.length > 0) {
        for await (const msg of client.fetch(candidateUids, { uid: true, source: true, envelope: true, internalDate: true }, { uid: true })) {
          if (!msg.source) continue;
          try {
            const mail = await simpleParser(msg.source);
            const attachments = Array.isArray(mail.attachments) ? mail.attachments : [];
            const xmlAtts = attachments.filter(esAdjuntoXml);
            const pdfAtts = attachments.filter(esAdjuntoPdf);

            const correoMeta = {
              uid: msg.uid,
              asunto: mail.subject || msg.envelope?.subject || undefined,
              remitente: mail.from?.text || msg.envelope?.from?.[0]?.address || undefined,
              fecha: mail.date ? mail.date.toISOString() : (msg.internalDate ? new Date(msg.internalDate).toISOString() : undefined)
            };

            const parsedComprobantes = xmlAtts
              .map(att => {
                const xmlText = att.content.toString('utf-8');
                const parsed = parsearFacturaXMLCostaRica(xmlText, {
                  tipoCambioDefault,
                  origen: 'correo_imap',
                  correoMeta
                });
                return { xmlText, parsed };
              })
              .filter(item => item.parsed.tipo === 'comprobante' && item.parsed.gasto);

            const unicoComprobante = parsedComprobantes.length === 1;

            for (const item of parsedComprobantes) {
              const gasto = item.parsed.gasto!;
              const cedulaEmisor = normalizarCedula(gasto.emisorCedula);
              if (cedulaPropia && cedulaEmisor && cedulaEmisor === cedulaPropia) {
                omitidosPropios += 1;
                continue;
              }

              const cedulaReceptor = normalizarCedula(gasto.receptorCedula);
              if (cedulaPropia && cedulaReceptor && cedulaReceptor !== cedulaPropia) {
                omitidosOtroReceptor += 1;
                continue;
              }

              const pdfAtt = buscarPdfAsociado(pdfAtts, gasto.clave, gasto.consecutivo, unicoComprobante);
              const savedRes = await pgDataStore.saveGasto(tenantId, gasto, item.xmlText, pdfAtt?.content);
              if (savedRes.duplicado) duplicados += 1;
              else if (savedRes.saved) importados += 1;
            }
          } catch (mailParseErr) {
            console.error('[IMAP Parse Message Error]', msg.uid, mailParseErr);
            errores += 1;
          }
        }
      }
    } finally {
      lock.release();
    }

    const ultimaSincronizacion = new Date().toISOString();
    const resumen: SyncGastosResultado = {
      revisados,
      candidatosConAdjuntos,
      importados,
      duplicados,
      omitidosPropios,
      omitidosOtroReceptor,
      errores,
      ultimaSincronizacion
    };

    await pgDataStore.saveEstadoSyncGastos(tenantId, {
      ultimaSincronizacion,
      ultimoResumen: {
        revisados,
        candidatosConAdjuntos,
        importados,
        duplicados,
        omitidosPropios,
        omitidosOtroReceptor,
        errores
      },
      ultimoError: undefined
    });

    return resumen;
  } catch (err: any) {
    await pgDataStore.saveEstadoSyncGastos(tenantId, {
      ultimaSincronizacion: new Date().toISOString(),
      ultimoError: err?.message || 'Error sincronizando correos IMAP'
    }).catch(() => undefined);
    throw err;
  } finally {
    await cerrarImapSeguro(client);
    syncEnCursoTenants.delete(tenantId);
  }
}
