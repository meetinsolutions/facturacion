import nodemailer from 'nodemailer';
import { ComprobanteGuardado, ConfiguracionSistema } from './data-store.js';
import { formatoFechaLegibleCR } from '../utils/cr-date.js';

export type ConfigCorreo = NonNullable<ConfiguracionSistema['correo']>;

const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function validarConfigCorreo(cfg?: Partial<ConfigCorreo>): ConfigCorreo {
  const host = (cfg?.host || '').trim();
  const usuario = (cfg?.usuario || '').trim();
  const password = cfg?.password || '';
  const puerto = Number(cfg?.puerto) || 465;

  if (!host) {
    throw new Error('Debe configurar el servidor SMTP (Host) en Configuración del Sitio → Correo / SMTP.');
  }
  if (!usuario) {
    throw new Error('Debe configurar el usuario / correo remitente SMTP en Configuración del Sitio → Correo / SMTP.');
  }
  if (!password) {
    throw new Error('Debe configurar la contraseña del correo SMTP en Configuración del Sitio → Correo / SMTP.');
  }

  return {
    proveedor: cfg?.proveedor || 'hostinger',
    host,
    puerto,
    seguro: cfg?.seguro !== undefined ? Boolean(cfg.seguro) : puerto === 465,
    usuario,
    password,
    nombreRemitente: (cfg?.nombreRemitente || 'Facturación Electrónica').trim(),
    copiaOculta: (cfg?.copiaOculta || '').trim() || undefined,
    asuntoTemplate: cfg?.asuntoTemplate,
    mensajeTemplate: cfg?.mensajeTemplate,
    envioAutomatico: Boolean(cfg?.envioAutomatico)
  };
}

function crearTransporter(cfg: ConfigCorreo) {
  return nodemailer.createTransport({
    host: cfg.host.trim(),
    port: Number(cfg.puerto) || 465,
    secure: Boolean(cfg.seguro),
    auth: {
      user: cfg.usuario.trim(),
      pass: cfg.password
    },
    tls: {
      minVersion: 'TLSv1.2'
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000
  });
}

function aplicarVariables(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => (vars[key] !== undefined ? vars[key] : `{${key}}`));
}

export async function probarConexionCorreo(
  cfg: Partial<ConfigCorreo>,
  destinatarioPrueba?: string
): Promise<{ mensaje: string; messageId?: string }> {
  const validado = validarConfigCorreo(cfg);
  const transporter = crearTransporter(validado);

  await transporter.verify();

  const destino = (destinatarioPrueba || '').trim();
  if (destino) {
    if (!EMAIL_REGEX.test(destino)) {
      throw new Error('El correo de destino para la prueba no tiene un formato válido.');
    }
    const info = await transporter.sendMail({
      from: `"${validado.nombreRemitente}" <${validado.usuario}>`,
      to: destino,
      subject: 'Prueba de conexión SMTP - MeetinLabs Facturación',
      text: `Conexión SMTP verificada exitosamente.\nRemitente: ${validado.usuario}\nServidor: ${validado.host}:${validado.puerto}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px;">
          <h2 style="color:#065f46;margin:0 0 12px;">Conexión SMTP Verificada</h2>
          <p style="color:#334155;font-size:14px;line-height:1.6;">
            El sistema de facturación pudo autenticarse y enviar correctamente a través de su servidor SMTP.
          </p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-size:13px;color:#0f172a;">
            <div><strong>Remitente:</strong> ${escapeHtml(validado.usuario)}</div>
            <div><strong>Servidor:</strong> ${escapeHtml(validado.host)}:${validado.puerto} (${validado.seguro ? 'SSL/TLS' : 'STARTTLS'})</div>
          </div>
        </div>
      `
    });
    return {
      mensaje: `Conexión verificada y correo de prueba enviado exitosamente a ${destino}.`,
      messageId: info.messageId
    };
  }

  return {
    mensaje: `Autenticación SMTP exitosa con ${validado.host}:${validado.puerto} (${validado.usuario}).`
  };
}

export async function enviarComprobantePorCorreo(params: {
  config: ConfiguracionSistema;
  comprobante: ComprobanteGuardado;
  destinatario: string;
  pdfBuffer: Buffer;
}): Promise<{ messageId: string; destinatario: string }> {
  const destLimpio = (params.destinatario || '').trim();
  if (!EMAIL_REGEX.test(destLimpio)) {
    throw new Error('El correo electrónico del destinatario no es válido.');
  }

  const cfg = validarConfigCorreo(params.config.correo);
  const { comprobante, pdfBuffer, config } = params;

  const docMap: Record<string, { label: string; prefijo: string }> = {
    '01': { label: 'Factura Electrónica', prefijo: 'Factura' },
    '02': { label: 'Nota de Débito Electrónica', prefijo: 'NotaDebito' },
    '03': { label: 'Nota de Crédito Electrónica', prefijo: 'NotaCredito' },
    '04': { label: 'Tiquete Electrónico', prefijo: 'Tiquete' }
  };
  const docInfo = docMap[comprobante.tipoDocumento] || { label: 'Comprobante Electrónico', prefijo: 'Comprobante' };

  const moneda = comprobante.moneda || 'CRC';
  const sim = moneda === 'USD' ? '$' : moneda === 'EUR' ? '€' : '¢';
  const totalFormateado = `${sim} ${Number(comprobante.total || 0).toLocaleString('es-CR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

  const fechaTexto = formatoFechaLegibleCR(comprobante.fecha);

  const emisorNombre = config.emisor?.nombreComercial || config.emisor?.nombre || 'Emisor';
  const clienteNombre = comprobante.cliente || 'Cliente';

  const vars: Record<string, string> = {
    cliente: clienteNombre,
    emisor: emisorNombre,
    tipoDocumento: docInfo.label,
    consecutivo: comprobante.consecutivo,
    clave: comprobante.clave,
    total: totalFormateado,
    fecha: fechaTexto
  };

  const asuntoDefault = '{tipoDocumento} #{consecutivo} - {emisor}';
  const mensajeDefault =
    'Estimado(a) {cliente},\n\nAdjunto encontrará su {tipoDocumento} #{consecutivo} emitida por {emisor}, junto con el archivo XML oficial firmado según la normativa de la DGT de Costa Rica.\n\n¡Muchas gracias por su preferencia!';

  const asunto = aplicarVariables((cfg.asuntoTemplate || asuntoDefault).trim(), vars);
  const mensajePlano = aplicarVariables((cfg.mensajeTemplate || mensajeDefault).trim(), vars);
  const mensajeHtml = escapeHtml(mensajePlano).replace(/\r?\n/g, '<br>');

  const htmlBody = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;background:#f1f5f9;padding:24px;">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 6px 20px rgba(15,23,42,0.06);">
        <div style="background:#0f172a;color:#ffffff;padding:24px 28px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#38bdf8;font-weight:700;">${escapeHtml(docInfo.label)}</div>
          <h1 style="margin:6px 0 0;font-size:20px;font-weight:800;">${escapeHtml(emisorNombre)}</h1>
        </div>
        <div style="padding:26px 28px;color:#334155;font-size:14px;line-height:1.65;">
          <p style="margin:0 0 20px;">${mensajeHtml}</p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;font-size:13px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="padding:4px 0;color:#64748b;">Cliente:</td>
                <td style="padding:4px 0;text-align:right;font-weight:700;color:#0f172a;">${escapeHtml(clienteNombre)}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#64748b;">Consecutivo:</td>
                <td style="padding:4px 0;text-align:right;font-family:monospace;font-weight:700;color:#0f172a;">${escapeHtml(comprobante.consecutivo)}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#64748b;">Fecha de emisión:</td>
                <td style="padding:4px 0;text-align:right;color:#0f172a;">${escapeHtml(fechaTexto)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0 0;color:#0f172a;font-weight:700;border-top:1px solid #e2e8f0;">Total Comprobante:</td>
                <td style="padding:8px 0 0;text-align:right;font-size:16px;font-weight:800;color:#059669;border-top:1px solid #e2e8f0;">${escapeHtml(totalFormateado)}</td>
              </tr>
            </table>
            <div style="margin-top:12px;padding-top:10px;border-top:1px dashed #cbd5e1;">
              <div style="font-size:10px;text-transform:uppercase;color:#64748b;font-weight:700;">Clave Numérica (50 dígitos)</div>
              <div style="font-family:monospace;font-size:11px;color:#334155;word-break:break-all;margin-top:3px;">${escapeHtml(comprobante.clave)}</div>
            </div>
          </div>
          <p style="margin:18px 0 0;font-size:12px;color:#64748b;">
            Se adjuntan dos archivos: la representación gráfica en <strong>PDF</strong> y el comprobante electrónico firmado en <strong>XML</strong>.
          </p>
        </div>
        <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 28px;text-align:center;font-size:11px;color:#94a3b8;">
          Comprobante Electrónico • Costa Rica DGT v4.3
        </div>
      </div>
    </div>
  `;

  const transporter = crearTransporter(cfg);
  const info = await transporter.sendMail({
    from: `"${cfg.nombreRemitente}" <${cfg.usuario}>`,
    to: destLimpio,
    bcc: cfg.copiaOculta || undefined,
    replyTo: config.emisor?.correo || cfg.usuario,
    subject: asunto,
    text: `${mensajePlano}\n\nConsecutivo: ${comprobante.consecutivo}\nClave: ${comprobante.clave}\nTotal: ${totalFormateado}`,
    html: htmlBody,
    attachments: [
      {
        filename: `${docInfo.prefijo}_${comprobante.consecutivo}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      },
      {
        filename: `${docInfo.prefijo}_${comprobante.consecutivo}.xml`,
        content: Buffer.from(comprobante.xmlFirmado || '', 'utf-8'),
        contentType: 'application/xml'
      }
    ]
  });

  return {
    messageId: info.messageId,
    destinatario: destLimpio
  };
}

export async function enviarNotificacionSuscripcionActivada(
  cfg: ConfigCorreo,
  destinatario: string,
  datos: {
    empresaNombre: string;
    planNombre: string;
    ciclo: 'monthly' | 'yearly';
    montoCrcFormateado: string;
    fechaVencimientoTexto: string;
    medioPago: string;
    referencia?: string;
  }
) {
  const destLimpio = (destinatario || '').trim();
  if (!EMAIL_REGEX.test(destLimpio)) {
    throw new Error(`Dirección de correo destinatario inválida: "${destinatario}"`);
  }

  const asunto = `Confirmación de Suscripción MeetinFact — ${datos.planNombre}`;
  const htmlBody = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.5;color:#1e293b;padding:24px 12px;background:#f1f5f9;">
      <div style="max-width:540px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);">
        <div style="background:linear-gradient(135deg,#059669,#0d9488);padding:24px;text-align:center;">
          <h1 style="color:#ffffff;font-size:20px;font-weight:900;margin:0;">MeetinFact</h1>
          <p style="color:#ccfbf1;font-size:12px;margin:4px 0 0;font-weight:600;">Suscripción Comercial Activada</p>
        </div>
        <div style="padding:24px;">
          <h2 style="font-size:16px;color:#0f172a;margin:0 0 12px;">¡Su suscripción ha sido confirmada con éxito!</h2>
          <p style="font-size:13px;color:#475569;margin:0 0 18px;">
            Estimado(a) <strong>${escapeHtml(datos.empresaNombre)}</strong>, le confirmamos la activación de su plan comercial en MeetinFact.
          </p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;font-size:12px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="padding:4px 0;color:#64748b;">Plan contratado:</td>
                <td style="padding:4px 0;text-align:right;font-weight:700;color:#0f172a;">${escapeHtml(datos.planNombre)}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#64748b;">Ciclo de cobro:</td>
                <td style="padding:4px 0;text-align:right;font-weight:700;color:#0f172a;">${datos.ciclo === 'yearly' ? 'Anual' : 'Mensual'}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#64748b;">Monto abonado:</td>
                <td style="padding:4px 0;text-align:right;font-weight:900;font-size:15px;color:#059669;">${escapeHtml(datos.montoCrcFormateado)}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#64748b;">Medio de pago:</td>
                <td style="padding:4px 0;text-align:right;color:#0f172a;">${escapeHtml(datos.medioPago)} ${datos.referencia ? `(${escapeHtml(datos.referencia)})` : ''}</td>
              </tr>
              <tr>
                <td style="padding:8px 0 0;color:#0f172a;font-weight:700;border-top:1px solid #e2e8f0;">Vigente hasta:</td>
                <td style="padding:8px 0 0;text-align:right;font-weight:700;color:#0f172a;border-top:1px solid #e2e8f0;">${escapeHtml(datos.fechaVencimientoTexto)}</td>
              </tr>
            </table>
          </div>
          <p style="margin:20px 0 0;font-size:12px;color:#64748b;text-align:center;">
            Gracias por confiar en MeetinFact para su facturación electrónica en Costa Rica.
          </p>
        </div>
      </div>
    </div>
  `;

  const transporter = crearTransporter(cfg);
  return await transporter.sendMail({
    from: `"${cfg.nombreRemitente}" <${cfg.usuario}>`,
    to: destLimpio,
    subject: asunto,
    html: htmlBody
  });
}
