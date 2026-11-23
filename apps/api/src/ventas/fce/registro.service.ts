import { hoyEn, ZONA_ARGENTINA } from '@gestion/shared';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { fechaAR } from '../../compras/comun';
import { EstadoFceRegistro, FceRegistro, RolFce } from '@prisma/client';
import { ConfigArcaService } from '../../arca/config-arca.service';
import { ErrorConexionArca, ErrorServicioArca } from '../../arca/cliente-arca';
import { FceArca } from '../../arca/cliente-fce';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';

const DIAS_CONSULTA = 90;
const UNA_HORA = 3600000;
const dia = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const yyyymmdd = (s: string) => s.replace(/-/g, '');
/** Código ARCA de FCE → tipo y letra del comprobante (201 FACTURA A … 213 NOTA_CREDITO C). */
export function tipoDeFce(cbteTipo: number): { tipo: 'FACTURA' | 'NOTA_DEBITO' | 'NOTA_CREDITO'; letra: 'A' | 'B' | 'C' } {
  const base = cbteTipo - 200;
  const letra = base <= 3 ? 'A' : base <= 8 ? 'B' : 'C';
  const resto = (base - (letra === 'A' ? 1 : letra === 'B' ? 6 : 11)) as 0 | 1 | 2;
  return { tipo: (['FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO'] as const)[resto], letra };
}
/** Mensaje del error de ARCA para el usuario: `No se pudo consultar ARCA: <detalle>`. */
export const mensajeArca = (e: Error) => `No se pudo consultar ARCA: ${e.message.replace(/^No se pudo conectar con ARCA: /, '').replace(/^ARCA rechazó la operación: /, '')}`;

/** Registro de facturas de crédito MiPyME (spec E50 §5 y §6). */
@Injectable()
export class FceRegistroService {
  constructor(private readonly tenant: TenantPrisma, private readonly arca: ConfigArcaService, private readonly auditoria: AuditoriaService) {}

  /** Trae del registro de ARCA las FCE del rol de los últimos 90 días y actualiza estados y emparejamientos. */
  async actualizar(rol: RolFce): Promise<{ actualizadas: number }> {
    const cliente = await this.arca.clienteFce();
    const ambiente = await this.arca.ambiente();
    const hoy = hoyEn(ZONA_ARGENTINA);
    const desde = new Date(`${hoy}T00:00:00Z`);
    desde.setUTCDate(desde.getUTCDate() - DIAS_CONSULTA);
    let lista: FceArca[];
    try {
      lista = await cliente.consultarComprobantes(rol, yyyymmdd(iso(desde)!), yyyymmdd(hoy));
    } catch (e) {
      if (e instanceof ErrorConexionArca || e instanceof ErrorServicioArca) throw new BadRequestException(mensajeArca(e));
      throw e;
    }
    const db = this.tenant.db;
    const ahora = new Date();
    for (const f of lista) {
      const cuitContraparte = (rol === 'EMISOR' ? f.cuitReceptor : f.cuitEmisor).replace(/\D/g, '');
      const datos = {
        fecha: dia(f.fecha)!, importe: f.importe, moneda: f.moneda, fechaVencimientoPago: dia(f.fechaVencimientoPago), estado: f.estado as EstadoFceRegistro,
        fechaRecepcion: dia(f.fechaRecepcion), fechaLimite: dia(f.fechaLimite), motivosRechazo: f.motivosRechazo, consultadoEn: ahora,
        ...(await this.emparejar(rol, ambiente, f)),
      };
      await db.fceRegistro.upsert({
        where: { empresaId_ambiente_rol_cuitContraparte_cbteTipo_puntoVenta_numero: { empresaId: this.tenant.empresaId, ambiente, rol, cuitContraparte, cbteTipo: f.cbteTipo, puntoVenta: f.ptoVta, numero: f.numero } },
        create: { empresaId: this.tenant.empresaId, ambiente, rol, cuitContraparte, cbteTipo: f.cbteTipo, puntoVenta: f.ptoVta, numero: f.numero, ...datos },
        update: datos,
      });
    }
    // Las que ya no vienen (fuera de los 90 días) quedan como estaban; las consultadas marcan la hora
    await db.fceRegistro.updateMany({ where: { ambiente, rol }, data: { consultadoEn: ahora } });
    return { actualizadas: lista.length };
  }

  /** Venta propia (emisor) o compra cargada (receptor) del mismo comprobante. */
  protected async emparejar(rol: RolFce, ambiente: FceRegistro['ambiente'], f: FceArca): Promise<{ comprobanteVentaId?: string | null; comprobanteCompraId?: string | null }> {
    const { tipo, letra } = tipoDeFce(f.cbteTipo);
    if (rol === 'EMISOR') {
      const v = await this.tenant.db.comprobanteVenta.findFirst({ where: { ambiente, puntoVenta: f.ptoVta, tipo, letra, fce: true, numero: f.numero } });
      return { comprobanteVentaId: v?.id ?? null };
    }
    return { comprobanteCompraId: await this.compraDe(f, tipo, letra) };
  }

  /** La compra cargada del mismo proveedor y comprobante: primero la marcada FCE; la común emparejada queda marcada (E50 §6). */
  protected async compraDe(f: FceArca, tipo: string, letra: string): Promise<string | null> {
    const db = this.tenant.db;
    const where = { estado: 'CONFIRMADO' as const, tercero: { cuit: f.cuitEmisor.replace(/\D/g, '') }, tipo: tipo as 'FACTURA', letra, puntoVenta: f.ptoVta, numero: f.numero };
    const marcada = await db.comprobanteCompra.findFirst({ where: { ...where, fce: true } });
    if (marcada) return marcada.id;
    const comun = await db.comprobanteCompra.findFirst({ where: { ...where, fce: false } });
    if (!comun) return null;
    // Revisión E50: si ya hay una compra FCE con ese número (p. ej. anulada) no se marca la común (chocaría con la unicidad)
    const { estado: _estado, ...sinEstado } = where;
    if (await db.comprobanteCompra.findFirst({ where: { ...sinEstado, fce: true } })) return comun.id;
    await this.tenant.transaccion(async (tx) => {
      await tx.comprobanteCompra.update({ where: { id: comun.id }, data: { fce: true } });
      await this.auditoria.registrar(tx, { entidad: 'ComprobanteCompra', entidadId: comun.id, accion: 'MODIFICAR', datos: { fce: true, motivo: 'Emparejada con una factura de crédito MiPyME recibida' } });
    });
    return comun.id;
  }

  /** Aceptar o rechazar una FCE recibida (E50 §6): pendiente, dentro del plazo; llama a ARCA y guarda el estado. */
  async responder(id: string, r: { acepta: true } | { acepta: false; motivos: string[]; texto: string }) {
    const db = this.tenant.db;
    const f = await db.fceRegistro.findFirst({ where: { id, rol: 'RECEPTOR' } });
    if (!f) throw new NotFoundException('Factura de crédito inexistente');
    if (f.estado !== 'PENDIENTE') throw new BadRequestException('La factura de crédito no está pendiente');
    if (f.fechaLimite && f.fechaLimite.getTime() < new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`).getTime())
      throw new BadRequestException(`El plazo para aceptar o rechazar venció el ${fechaAR(f.fechaLimite)}`);
    const clave = { cuitEmisor: f.cuitContraparte, cbteTipo: f.cbteTipo, ptoVta: f.puntoVenta, numero: f.numero };
    const cliente = await this.arca.clienteFce();
    let motivos: string[] = [];
    try {
      if (r.acepta) await cliente.aceptar({ ...clave, importe: f.importe.toFixed(2) });
      else {
        await cliente.rechazar(clave, r.motivos, r.texto);
        const lista = await cliente.motivosRechazo();
        motivos = r.motivos.map((m) => lista.find((x) => x.codigo === m)?.descripcion ?? m);
      }
    } catch (e) {
      if (e instanceof ErrorConexionArca || e instanceof ErrorServicioArca) throw new BadRequestException(mensajeArca(e));
      throw e;
    }
    const actualizado = await this.tenant.transaccion(async (tx) => {
      const u = await tx.fceRegistro.update({
        where: { id }, data: r.acepta ? { estado: 'ACEPTADA' } : { estado: 'RECHAZADA', motivosRechazo: motivos, textoRechazo: r.texto },
      });
      await this.auditoria.registrar(tx, { entidad: 'FceRegistro', entidadId: id, accion: r.acepta ? 'APROBAR' : 'ANULAR', datos: r.acepta ? { aceptada: true } : { motivos: r.motivos, texto: r.texto } });
      return u;
    });
    const aviso = !f.comprobanteCompraId
      ? (r.acepta ? 'La compra no está cargada' : null)
      : (r.acepta ? null : 'La compra está cargada: anúlela o registre la nota de crédito del proveedor');
    return { id, estado: actualizado.estado, aviso };
  }

  async motivos() {
    try {
      return await (await this.arca.clienteFce()).motivosRechazo();
    } catch (e) {
      if (e instanceof ErrorConexionArca || e instanceof ErrorServicioArca) throw new BadRequestException(mensajeArca(e));
      throw e;
    }
  }

  /** Listado del rol (actualiza antes si nunca se consultó o la última consulta tiene más de una hora). */
  async listar(rol: RolFce, estado?: string) {
    const db = this.tenant.db;
    const ambiente = await this.arca.ambiente();
    const ultima = await db.fceRegistro.aggregate({ where: { ambiente, rol }, _max: { consultadoEn: true } });
    let aviso: string | null = null;
    if (!ultima._max.consultadoEn || Date.now() - ultima._max.consultadoEn.getTime() > UNA_HORA) {
      try {
        await this.actualizar(rol);
      } catch (e) {
        if (!(e instanceof BadRequestException)) throw e;
        aviso = (e.getResponse() as { message: string }).message;
      }
    }
    const filas = await db.fceRegistro.findMany({
      where: { ambiente, rol, ...(estado ? { estado: estado as EstadoFceRegistro } : {}) }, orderBy: [{ fecha: 'desc' }, { numero: 'desc' }],
    });
    const ventas = await db.comprobanteVenta.findMany({ where: { id: { in: filas.map((f) => f.comprobanteVentaId).filter((x): x is string => !!x) } }, include: { tercero: true } });
    const notas = rol === 'EMISOR' ? await db.comprobanteVenta.findMany({ where: { comprobanteAsociadoId: { in: ventas.map((v) => v.id) }, fce: true }, orderBy: { fecha: 'asc' } }) : [];
    const terceros = await db.tercero.findMany({ where: { cuit: { in: [...new Set(filas.map((f) => f.cuitContraparte))] } } });
    const hoy = new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`).getTime();
    return {
      aviso,
      filas: filas.map((f) => ({
        id: f.id, cuitContraparte: f.cuitContraparte, cbteTipo: f.cbteTipo, puntoVenta: f.puntoVenta, numero: f.numero, fecha: iso(f.fecha), importe: f.importe.toFixed(2), moneda: f.moneda,
        fechaVencimientoPago: iso(f.fechaVencimientoPago), estado: f.estado, fechaRecepcion: iso(f.fechaRecepcion), fechaLimite: iso(f.fechaLimite),
        diasRestantes: f.fechaLimite && f.estado === 'PENDIENTE' ? Math.round((f.fechaLimite.getTime() - hoy) / 86400000) : null,
        motivosRechazo: f.motivosRechazo, textoRechazo: f.textoRechazo, comprobanteVentaId: f.comprobanteVentaId, comprobanteCompraId: f.comprobanteCompraId,
        compraCargada: !!f.comprobanteCompraId,
        cliente: ventas.find((v) => v.id === f.comprobanteVentaId)?.tercero.razonSocial ?? terceros.find((t) => t.cuit === f.cuitContraparte)?.razonSocial ?? null,
        notas: notas.filter((n) => n.comprobanteAsociadoId === f.comprobanteVentaId).map((n) => ({ id: n.id, tipo: n.tipo, numero: n.numero, total: n.total.toFixed(2), anulacion: n.anulacionFce })),
      })),
    };
  }

  /** Error si se quiere anular (nota con anulación) una FCE aceptada según el último estado guardado (E50 §4.2). */
  async verificarAnulable(tx: TxEmpresa, ventaId: string) {
    const r = await tx.fceRegistro.findFirst({ where: { rol: 'EMISOR', comprobanteVentaId: ventaId, estado: { in: ['ACEPTADA', 'ACEPTADA_TACITA'] } } });
    if (r) throw new BadRequestException('La factura de crédito está aceptada: no se puede anular');
  }
}
