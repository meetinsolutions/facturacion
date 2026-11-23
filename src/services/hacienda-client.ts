import axios, { AxiosInstance } from 'axios';

export interface HaciendaConfig {
  clientId: string; // 'rut-stag' para pruebas, 'rut' para producción
  username: string; // Usuario generado en ATV (ej: cpf-01-XXXX-XXXX@stag.comprobanteselectronicos.go.cr)
  password: string; // Clave generada en ATV
  entorno: 'staging' | 'produccion';
}

export interface RecepcionPayload {
  clave: string;
  fecha: string;
  emisor: {
    tipoIdentificacion: string;
    numeroIdentificacion: string;
  };
  receptor?: {
    tipoIdentificacion: string;
    numeroIdentificacion: string;
  };
  comprobanteXml: string; // XML firmado codificado en Base64
}

export interface ConsultaRespuesta {
  clave: string;
  fecha: string;
  indEstado: 'recibido' | 'procesando' | 'aceptado' | 'rechazado';
  respuestaXml?: string; // XML de confirmación de Hacienda en Base64
}

export class HaciendaClient {
  private config: HaciendaConfig;
  private idpUrl: string;
  private apiUrl: string;
  private accessToken?: string;
  private tokenExpiresAt?: number;

  constructor(config: HaciendaConfig) {
    this.config = config;

    if (config.entorno === 'produccion') {
      if (process.env.NODE_ENV !== 'production' || process.env.ALLOW_HACIENDA_PROD !== 'true') {
        throw new Error(
          '[SALVAGUARDA ANTI-PRODUCCIÓN] Bloqueo de seguridad: Se intentó configurar Hacienda en modo "produccion" ' +
          'en un entorno de prueba/QA o sin autorización explícita (ALLOW_HACIENDA_PROD=true). Operación cancelada.'
        );
      }
      this.idpUrl = 'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/token';
      this.apiUrl = 'https://api.comprobanteselectronicos.go.cr/recepcion/v1';
    } else {
      // Staging / Pruebas oficiales DGT
      this.idpUrl = 'https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token';
      this.apiUrl = 'https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1';
    }
  }

  /**
   * Obtiene o renueva el token OAuth2 con el servidor de identidad de Hacienda
   */
  async obtenerToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && this.tokenExpiresAt && now < this.tokenExpiresAt - 30000) {
      return this.accessToken;
    }

    const defaultClientId = this.config.entorno === 'produccion' ? 'api-prod' : 'api-stag';
    const clientId = (this.config.clientId && this.config.clientId !== 'rut' && this.config.clientId !== 'rut-stag')
      ? this.config.clientId
      : defaultClientId;

    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('client_id', clientId);
    params.append('username', this.config.username);
    params.append('password', this.config.password);

    try {
      const response = await axios.post(this.idpUrl, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000
      });

      this.accessToken = response.data.access_token;
      // Expires_in suele ser 300s (5 minutos)
      this.tokenExpiresAt = now + (response.data.expires_in * 1000);
      return this.accessToken!;
    } catch (error: any) {
      const errMsg = error.response?.data?.error_description || error.message;
      throw new Error(`Error autenticando con IdP Hacienda: ${errMsg}`);
    }
  }

  /**
   * Envía el comprobante firmado a la API de Hacienda (/recepcion)
   * Hacienda responde HTTP 202 Accepted de forma inmediata.
   */
  async enviarComprobante(payload: RecepcionPayload): Promise<{ status: number; location?: string }> {
    if (this.apiUrl.includes('/recepcion/v1') && (process.env.NODE_ENV !== 'production' || process.env.ALLOW_HACIENDA_PROD !== 'true')) {
      throw new Error('[SALVAGUARDA ANTI-PRODUCCIÓN] Transmisión abortada: Se detectó llamada a endpoint de producción fuera de entorno productivo.');
    }

    const token = await this.obtenerToken();

    try {
      const response = await axios.post(`${this.apiUrl}/recepcion`, payload, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      return {
        status: response.status,
        location: response.headers['location']
      };
    } catch (error: any) {
      const errDetails = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      throw new Error(`Error enviando comprobante a Hacienda (${error.response?.status}): ${errDetails}`);
    }
  }

  /**
   * Consulta el estado de un comprobante enviado (/recepcion/{clave})
   */
  async consultarComprobante(clave: string): Promise<ConsultaRespuesta> {
    const token = await this.obtenerToken();

    try {
      const response = await axios.get(`${this.apiUrl}/recepcion/${clave}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        timeout: 10000
      });

      return {
        clave: response.data.clave,
        fecha: response.data.fecha,
        indEstado: response.data['ind-estado'],
        respuestaXml: response.data['respuesta-xml']
      };
    } catch (error: any) {
      const errDetails = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      throw new Error(`Error consultando comprobante ${clave}: ${errDetails}`);
    }
  }
}
