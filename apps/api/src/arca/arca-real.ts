import { ClienteArca, ComprobanteArca, DatosCae, ErrorConexionArca, ResultadoCae } from './cliente-arca';
import { ClaveFce, ClienteFce, FceArca, ObligacionFce } from './cliente-fce';
import { armarTra, firmarTra, leerLoginResponse, xmlLoginCms } from './wsaa';
import { leerComprobantesFce, leerMotivos, leerObligacion, leerSinDatos, xmlAceptar, xmlConsultarComprobantes, xmlMotivos, xmlObligacion, xmlRechazar } from './wsfecred';
import { AuthWsfe, leerConsultar, leerDummy, leerSolicitarCae, leerUltimoAutorizado, NS_WSFE, xmlConsultar, xmlDummy, xmlSolicitarCae, xmlUltimoAutorizado } from './wsfe';

export const ENDPOINTS = {
  // wsfecred (E50): URLs del manual del registro de FCE, a verificar
  HOMOLOGACION: { wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms', wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx', wsfecred: 'https://fwshomo.afip.gov.ar/wsfecred/FECredService' },
  PRODUCCION: { wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms', wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx', wsfecred: 'https://serviciosjava.afip.gob.ar/wsfecred/FECredService' },
} as const;

export interface Token { token: string; sign: string; vence: Date }
export interface AlmacenTokens {
  leer(): Promise<Token | null>;
  guardar(t: Token): Promise<void>;
  borrar(): Promise<void>;
}

export interface OpcionesArcaReal {
  ambiente: keyof typeof ENDPOINTS;
  cuit: string;
  crt: string;
  key: string;
  tokens: AlmacenTokens;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const MARGEN_TOKEN_MS = 10 * 60000;

/** Cliente de ARCA por SOAP: login WSAA con el certificado de la empresa (token guardado) y operaciones WSFEv1. */
export class ArcaReal implements ClienteArca {
  constructor(protected readonly o: OpcionesArcaReal) {}

  protected async post(url: string, accion: string, cuerpo: string): Promise<string> {
    const f = this.o.fetch ?? fetch;
    try {
      const r = await f(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: accion },
        body: cuerpo,
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 30000),
      });
      return await r.text();
    } catch (e) {
      throw new ErrorConexionArca(`No se pudo conectar con ARCA: ${(e as Error).message}`);
    }
  }

  /** Servicio de WSAA del ticket (E50: `wsfecred` para el registro de FCE). */
  protected servicio = 'wsfe';

  protected async auth(): Promise<AuthWsfe> {
    const guardado = await this.o.tokens.leer();
    if (guardado && guardado.vence.getTime() - Date.now() > MARGEN_TOKEN_MS) return { token: guardado.token, sign: guardado.sign, cuit: this.o.cuit };
    const cms = firmarTra(armarTra(this.servicio, new Date()), this.o.crt, this.o.key);
    let t: Token;
    try {
      t = leerLoginResponse(await this.post(ENDPOINTS[this.o.ambiente].wsaa, '', xmlLoginCms(cms)));
    } catch (e) {
      // Se renueva antes de que venza; si ARCA todavía no entrega uno nuevo, el guardado sigue sirviendo hasta su vencimiento
      if (e instanceof ErrorConexionArca && e.yaAutenticado && guardado && guardado.vence.getTime() > Date.now())
        return { token: guardado.token, sign: guardado.sign, cuit: this.o.cuit };
      throw e;
    }
    await this.o.tokens.guardar(t);
    return { token: t.token, sign: t.sign, cuit: this.o.cuit };
  }

  /** Ejecuta una operación del WSFE; si ARCA rechaza el token, lo descarta, hace login de nuevo y reintenta una vez. */
  private async wsfe<T>(op: string, xml: (a: AuthWsfe) => string, leer: (x: string) => T): Promise<T> {
    for (let intento = 0; ; intento++) {
      const a = await this.auth();
      try {
        return leer(await this.post(ENDPOINTS[this.o.ambiente].wsfe, `${NS_WSFE}${op}`, xml(a)));
      } catch (e) {
        if (e instanceof ErrorConexionArca && e.tokenInvalido && intento === 0) {
          await this.o.tokens.borrar();
          continue;
        }
        throw e;
      }
    }
  }

  ultimoAutorizado(ptoVta: number, cbteTipo: number): Promise<number> {
    return this.wsfe('FECompUltimoAutorizado', (a) => xmlUltimoAutorizado(a, ptoVta, cbteTipo), leerUltimoAutorizado);
  }

  consultar(ptoVta: number, cbteTipo: number, numero: number): Promise<ComprobanteArca | null> {
    return this.wsfe('FECompConsultar', (a) => xmlConsultar(a, ptoVta, cbteTipo, numero), leerConsultar);
  }

  solicitarCae(d: DatosCae): Promise<ResultadoCae> {
    return this.wsfe('FECAESolicitar', (a) => xmlSolicitarCae(a, d), leerSolicitarCae);
  }

  async probar(): Promise<{ ok: boolean; detalle: string }> {
    const dummy = leerDummy(await this.post(ENDPOINTS[this.o.ambiente].wsfe, `${NS_WSFE}FEDummy`, xmlDummy()));
    if (!dummy.ok) return dummy;
    await this.auth();
    return { ok: true, detalle: `${dummy.detalle}. Acceso con el certificado: OK` };
  }
}

/** Registro de facturas de crédito MiPyME (`wsfecred`, E50): mismo certificado, su propio ticket de WSAA. */
export class ArcaRealFce extends ArcaReal implements ClienteFce {
  protected servicio = 'wsfecred';

  private async fce<T>(op: string, xml: (a: AuthWsfe) => string, leer: (x: string) => T): Promise<T> {
    for (let intento = 0; ; intento++) {
      const a = await this.auth();
      try {
        return leer(await this.post(ENDPOINTS[this.o.ambiente].wsfecred, '', xml(a)));
      } catch (e) {
        if (e instanceof ErrorConexionArca && e.tokenInvalido && intento === 0) {
          await this.o.tokens.borrar();
          continue;
        }
        throw e;
      }
    }
  }

  consultarObligacion(cuit: string, fecha: string): Promise<ObligacionFce> {
    return this.fce('consultarMontoObligadoRecepcion', (a) => xmlObligacion(a, cuit, fecha), leerObligacion);
  }

  consultarComprobantes(rol: 'EMISOR' | 'RECEPTOR', desde: string, hasta: string): Promise<FceArca[]> {
    return this.fce('consultarComprobantes', (a) => xmlConsultarComprobantes(a, rol, desde, hasta), leerComprobantesFce);
  }

  aceptar(f: ClaveFce & { importe: string }): Promise<void> {
    return this.fce('aceptarFECred', (a) => xmlAceptar(a, f), leerSinDatos('aceptarFECred'));
  }

  rechazar(f: ClaveFce, motivos: string[], texto: string): Promise<void> {
    return this.fce('rechazarFECred', (a) => xmlRechazar(a, f, motivos, texto), leerSinDatos('rechazarFECred'));
  }

  motivosRechazo(): Promise<{ codigo: string; descripcion: string }[]> {
    return this.fce('consultarTiposMotivosRechazo', (a) => xmlMotivos(a), leerMotivos);
  }
}
