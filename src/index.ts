import { ComprobanteElectronico } from './types/factura.types.js';
import { generarXMLFactura, formatoFechaCR } from './services/xml-builder.js';
import { cargarCertificadoP12, firmarXMLFactura, CertificadoInfo } from './services/xml-signer.js';
import { HaciendaClient, RecepcionPayload, ConsultaRespuesta } from './services/hacienda-client.js';

export interface FacturaResultado {
  clave: string;
  consecutivo: string;
  xmlSinFirmar: string;
  xmlFirmado: string;
  envioHacienda?: {
    status: number;
    location?: string;
  };
}

export class MotorFacturacion {
  private certInfo?: CertificadoInfo;
  private haciendaClient?: HaciendaClient;

  /**
   * Configura las credenciales criptográficas del emisor
   */
  configurarCertificado(p12PathOrBuffer: string | Buffer, pin: string) {
    this.certInfo = cargarCertificadoP12(p12PathOrBuffer, pin);
  }

  /**
   * Configura el cliente de Hacienda ATV
   */
  configurarHacienda(username: string, password: string, entorno: 'staging' | 'produccion' = 'staging') {
    this.haciendaClient = new HaciendaClient({
      clientId: entorno === 'produccion' ? 'api-prod' : 'api-stag',
      username,
      password,
      entorno
    });
  }

  /**
   * Emite una factura completa: Genera Consecutivo -> Clave -> XML -> Firma XAdES -> Envío a Hacienda
   */
  async emitirFactura(doc: ComprobanteElectronico, secuencia: number, autoEnviar: boolean = false): Promise<FacturaResultado> {
    if (!this.certInfo) {
      throw new Error('Debe configurar el certificado criptográfico antes de emitir comprobantes.');
    }

    // 1. Generar XML y Clave
    const { xml, clave, consecutivo } = generarXMLFactura(doc, secuencia);

    // 2. Firmar XML con XAdES-BES
    const xmlFirmado = firmarXMLFactura(xml, this.certInfo);

    const resultado: FacturaResultado = {
      clave,
      consecutivo,
      xmlSinFirmar: xml,
      xmlFirmado
    };

    // 3. Envío opcional a Hacienda
    if (autoEnviar) {
      if (!this.haciendaClient) {
        throw new Error('HaciendaClient no configurado para autoEnviar.');
      }

      const payload: RecepcionPayload = {
        clave,
        fecha: formatoFechaCR(doc.fechaEmision),
        emisor: {
          tipoIdentificacion: doc.emisor.identificacion.tipo,
          numeroIdentificacion: doc.emisor.identificacion.numero.replace(/\D/g, '')
        },
        receptor: doc.receptor?.identificacion ? {
          tipoIdentificacion: doc.receptor.identificacion.tipo,
          numeroIdentificacion: doc.receptor.identificacion.numero.replace(/\D/g, '')
        } : undefined,
        comprobanteXml: Buffer.from(xmlFirmado, 'utf-8').toString('base64')
      };

      const respuestaEnvio = await this.haciendaClient.enviarComprobante(payload);
      resultado.envioHacienda = respuestaEnvio;
    }

    return resultado;
  }

  /**
   * Consulta el estado en Hacienda (recibido / procesando / aceptado / rechazado)
   */
  async consultarEstado(clave: string): Promise<ConsultaRespuesta> {
    if (!this.haciendaClient) {
      throw new Error('HaciendaClient no está configurado.');
    }
    return await this.haciendaClient.consultarComprobante(clave);
  }
}
