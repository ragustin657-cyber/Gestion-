import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TipoTitularSocio } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { EstadosService } from '../../contabilidad/estados/estados.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { liquidarBienesPersonales } from './calculo';

const D = Prisma.Decimal;
const dia = (d: Date) => d.toISOString().slice(0, 10);
export const BP_PRESENTADA = 'La liquidación de Bienes Personales del año está presentada';
export interface DatosSocio { nombre: string; tipoDocumento: string; documento: string; tipoTitular: TipoTitularSocio; porcentaje: number; activo?: boolean }

@Injectable()
export class BienesPersonalesService {
  constructor(private readonly tenant: TenantPrisma, private readonly auditoria: AuditoriaService, private readonly cls: ClsService, private readonly estados: EstadosService) {}

  private usuario() {
    return this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId;
  }

  // --- Socios ---

  socios() {
    return this.tenant.db.socio.findMany({ orderBy: [{ activo: 'desc' }, { nombre: 'asc' }] });
  }

  guardarSocio(id: string | null, d: DatosSocio) {
    return this.tenant.transaccion(async (tx) => {
      if (id && !(await tx.socio.findUnique({ where: { id } }))) throw new NotFoundException('Socio no encontrado');
      const s = id ? await tx.socio.update({ where: { id }, data: d }) : await tx.socio.create({ data: { ...d, empresaId: this.tenant.empresaId } });
      await this.auditoria.registrar(tx, { entidad: 'Socio', entidadId: s.id, accion: id ? 'MODIFICAR' : 'CREAR', datos: d });
      return s;
    });
  }

  // --- Liquidación ---

  private anio(anio?: number | string) {
    const a = Number(anio);
    if (!anio || !Number.isInteger(a)) throw new BadRequestException('Indique el año');
    return a;
  }

  /** Ejercicio cuyo cierre cae en el año (el último si hay más de uno). */
  private async ejercicio(tx: TxEmpresa, anio: number) {
    const ej = await tx.ejercicio.findFirst({ where: { hasta: { gte: new Date(Date.UTC(anio, 0, 1)), lte: new Date(Date.UTC(anio, 11, 31)) } }, orderBy: { hasta: 'desc' } });
    if (!ej) throw new BadRequestException(`No hay un ejercicio que cierre en ${anio}`);
    return ej;
  }

  /** Fila del año (se crea con las participaciones copiadas del registro la primera vez). */
  private async fila(tx: TxEmpresa, anio: number) {
    const f = await tx.bienesPersonalesAcciones.findUnique({ where: { empresaId_anio: { empresaId: this.tenant.empresaId, anio } } });
    if (f) return f;
    const nueva = await tx.bienesPersonalesAcciones.create({ data: { empresaId: this.tenant.empresaId, anio } });
    await this.copiar(tx, anio);
    return nueva;
  }

  private async copiar(tx: TxEmpresa, anio: number) {
    await tx.bienesPersonalesParticipacion.deleteMany({ where: { anio } });
    const socios = await tx.socio.findMany({ where: { activo: true } });
    if (socios.length) await tx.bienesPersonalesParticipacion.createMany({ data: socios.map((s) => ({ empresaId: this.tenant.empresaId, anio, socioId: s.id, tipoTitular: s.tipoTitular, porcentaje: s.porcentaje })) });
  }

  /** Bloqueo como la DJ de Ganancias (E46): FOR UPDATE sobre la fila del año y error si está presentada. */
  private async editable(tx: TxEmpresa, anio: number) {
    await this.fila(tx, anio);
    const [f] = await tx.$queryRaw<{ estado: string }[]>`SELECT "estado" FROM "BienesPersonalesAcciones" WHERE "empresaId" = ${this.tenant.empresaId}::uuid AND "anio" = ${anio} FOR UPDATE`;
    if (f?.estado === 'PRESENTADA') throw new BadRequestException(BP_PRESENTADA);
  }

  private async calcular(tx: TxEmpresa, anio: number) {
    const ej = await this.ejercicio(tx, anio);
    const fila = await this.fila(tx, anio);
    const situacion = await this.estados.situacion({ fecha: dia(ej.hasta) });
    const config = await tx.configImpuestos.findFirst();
    const parts = await tx.bienesPersonalesParticipacion.findMany({ where: { anio } });
    const socios = new Map((await tx.socio.findMany({ where: { id: { in: parts.map((p) => p.socioId) } } })).map((s) => [s.id, s]));
    const r = liquidarBienesPersonales({
      patrimonio: new D(situacion.patrimonioNeto.total), ajuste: new D(fila.ajustePatrimonio), alicuota: new D(config?.alicuotaBienesPersonalesAcciones ?? '0.5'),
      participaciones: parts.map((p) => ({ socioId: p.socioId, nombre: socios.get(p.socioId)?.nombre ?? '', documento: socios.get(p.socioId)?.documento ?? '', tipoTitular: p.tipoTitular, porcentaje: new D(p.porcentaje) }))
        .sort((a, b) => b.porcentaje.cmp(a.porcentaje) || a.nombre.localeCompare(b.nombre)),
    });
    // Revisión E47: el año se copió del registro y el registro cambió después (venta, fallecimiento, mudanza): avisar
    const activos = await tx.socio.findMany({ where: { activo: true } });
    const clave = (xs: { socioId: string; tipoTitular: string; porcentaje: Prisma.Decimal }[]) => xs.map((x) => `${x.socioId}|${x.tipoTitular}|${new D(x.porcentaje).toFixed(4)}`).sort().join(';');
    if (fila.estado === 'BORRADOR' && clave(parts) !== clave(activos.map((s) => ({ socioId: s.id, tipoTitular: s.tipoTitular, porcentaje: s.porcentaje }))))
      r.avisos.push('Las participaciones del año difieren del registro de socios: revíselas o vuelva a copiar del registro');
    const t = (x: Prisma.Decimal) => x.toFixed(2);
    return {
      ejercicio: { numero: ej.numero, desde: dia(ej.desde), hasta: dia(ej.hasta), estado: ej.estado },
      liquidacion: {
        patrimonio: t(r.patrimonio), ajuste: t(r.ajuste), base: t(r.base), alicuota: r.alicuota.toString(),
        filas: r.filas.map((f) => ({ socioId: f.socioId, nombre: f.nombre, documento: f.documento, tipoTitular: f.tipoTitular, porcentaje: f.porcentaje.toFixed(4), paga: f.paga, vpp: t(f.vpp), impuesto: t(f.impuesto) })),
        sumaParticipaciones: r.sumaParticipaciones.toFixed(4), total: t(r.total), completo: r.completo, avisos: r.avisos,
      },
    };
  }

  async consultar(q: { anio?: string }) {
    const anio = this.anio(q.anio);
    return this.tenant.transaccion(async (tx) => {
      const fila = await this.fila(tx, anio);
      const presentaciones = await tx.bienesPersonalesPresentacion.findMany({ where: { anio }, orderBy: { numero: 'asc' } });
      const vigente = presentaciones.filter((p) => !p.anuladaEn).at(-1);
      // Presentada: la foto, no un recálculo
      const datos = fila.estado === 'PRESENTADA' && vigente ? (vigente.datos as unknown as Awaited<ReturnType<BienesPersonalesService['calcular']>>) : await this.calcular(tx, anio);
      return {
        anio, ...datos, estado: fila.estado, ajuste: { importe: new D(fila.ajustePatrimonio).toFixed(2), concepto: fila.conceptoAjuste },
        presentaciones: presentaciones.map((p) => ({ numero: p.numero, presentadaEn: p.presentadaEn, presentadaPor: p.presentadaPor, anuladaEn: p.anuladaEn, motivoAnulacion: p.motivoAnulacion })),
      };
    });
  }

  guardarAjuste(d: { anio: number; importe: number; concepto?: string | null }) {
    return this.tenant.transaccion(async (tx) => {
      await this.editable(tx, d.anio);
      const r = await tx.bienesPersonalesAcciones.update({ where: { empresaId_anio: { empresaId: this.tenant.empresaId, anio: d.anio } }, data: { ajustePatrimonio: d.importe, conceptoAjuste: d.concepto || null } });
      await this.auditoria.registrar(tx, { entidad: 'BienesPersonalesAcciones', entidadId: r.id, accion: 'MODIFICAR', datos: d });
      return r;
    });
  }

  guardarParticipaciones(d: { anio: number; participaciones: { socioId: string; tipoTitular: TipoTitularSocio; porcentaje: number }[] }) {
    return this.tenant.transaccion(async (tx) => {
      await this.editable(tx, d.anio);
      const ids = d.participaciones.map((p) => p.socioId);
      if ((await tx.socio.count({ where: { id: { in: ids } } })) !== new Set(ids).size) throw new NotFoundException('Socio no encontrado');
      await tx.bienesPersonalesParticipacion.deleteMany({ where: { anio: d.anio } });
      if (d.participaciones.length) await tx.bienesPersonalesParticipacion.createMany({ data: d.participaciones.map((p) => ({ ...p, empresaId: this.tenant.empresaId, anio: d.anio })) });
      await this.auditoria.registrar(tx, { entidad: 'BienesPersonalesParticipacion', entidadId: this.tenant.empresaId, accion: 'MODIFICAR', datos: d });
      return { ok: true };
    });
  }

  copiarSocios(anio: number) {
    return this.tenant.transaccion(async (tx) => {
      await this.editable(tx, anio);
      await this.copiar(tx, anio);
      await this.auditoria.registrar(tx, { entidad: 'BienesPersonalesParticipacion', entidadId: this.tenant.empresaId, accion: 'MODIFICAR', datos: { anio, copia: true } });
      return { ok: true };
    });
  }

  presentar(anio: number) {
    return this.tenant.transaccion(async (tx) => {
      await this.editable(tx, anio);
      const ej = await this.ejercicio(tx, anio);
      if (ej.estado !== 'CERRADO') throw new BadRequestException('Cierre el ejercicio antes de presentar la liquidación');
      const datos = await this.calcular(tx, anio);
      if (!datos.liquidacion.completo) throw new BadRequestException(datos.liquidacion.avisos[0]);
      const numero = await tx.bienesPersonalesPresentacion.count({ where: { anio } });
      const p = await tx.bienesPersonalesPresentacion.create({ data: { empresaId: this.tenant.empresaId, anio, numero, datos: datos as unknown as Prisma.InputJsonValue, presentadaPor: this.usuario() } });
      await tx.bienesPersonalesAcciones.update({ where: { empresaId_anio: { empresaId: this.tenant.empresaId, anio } }, data: { estado: 'PRESENTADA' } });
      await this.auditoria.registrar(tx, { entidad: 'BienesPersonalesPresentacion', entidadId: p.id, accion: 'APROBAR', datos: { numero } });
      return { numero };
    });
  }

  anular(anio: number, motivo: string) {
    return this.tenant.transaccion(async (tx) => {
      const fila = await this.fila(tx, anio);
      const [f] = await tx.$queryRaw<{ estado: string }[]>`SELECT "estado" FROM "BienesPersonalesAcciones" WHERE "id" = ${fila.id}::uuid FOR UPDATE`;
      if (f?.estado !== 'PRESENTADA') throw new BadRequestException('La liquidación no está presentada');
      const vigente = await tx.bienesPersonalesPresentacion.findFirst({ where: { anio, anuladaEn: null }, orderBy: { numero: 'desc' } });
      if (vigente) await tx.bienesPersonalesPresentacion.update({ where: { id: vigente.id }, data: { anuladaEn: new Date(), anuladaPor: this.usuario(), motivoAnulacion: motivo } });
      await tx.bienesPersonalesAcciones.update({ where: { id: fila.id }, data: { estado: 'BORRADOR' } });
      await this.auditoria.registrar(tx, { entidad: 'BienesPersonalesPresentacion', entidadId: vigente?.id ?? fila.id, accion: 'ANULAR', datos: { motivo } });
      return { ok: true };
    });
  }
}
