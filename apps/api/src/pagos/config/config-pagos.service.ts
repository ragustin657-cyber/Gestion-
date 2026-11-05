import { BadRequestException, Injectable } from '@nestjs/common';
import { EscalaGanancias, JurisdiccionIibb, Prisma, RegimenGanancias, SinPadron } from '@prisma/client';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { conUnicidad } from '../../comun/errores';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';

const D = Prisma.Decimal;
export const vistaRegimen = (r: RegimenGanancias) => ({ ...r, verificar: !r.editadoEn });

export interface TramoEscala { desde: number; hasta: number | null; fijo: number; porcentaje: number }
export interface DatosRegimen {
  codigo: string; descripcion: string; minimoNoSujeto: number; alicuotaInscripto: number; alicuotaNoInscripto: number;
  usaEscala?: boolean; minimoRetencion: number; activo?: boolean;
}
export interface DatosJurisdiccion { jurisdiccion: string; alicuotaDefecto: number; minimoRetencion: number; usaPadron: boolean; sinPadron: SinPadron }

@Injectable()
export class ConfigPagosService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly auditoria: AuditoriaService,
  ) {}

  async parametros(tx: TxEmpresa = this.tenant.db): Promise<{ montoAprobacionOp: Prisma.Decimal }> {
    const e = await tx.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    return { montoAprobacionOp: e.montoAprobacionOp };
  }

  modificar(d: { montoAprobacionOp?: number }) {
    return this.tenant.transaccion(async (tx) => {
      await tx.empresa.update({ where: { id: this.tenant.empresaId }, data: d });
      await this.auditoria.registrar(tx, { entidad: 'ConfigPagos', entidadId: this.tenant.empresaId, accion: 'MODIFICAR', datos: d });
      return this.parametros(tx);
    });
  }

  regimen(tx: TxEmpresa, codigo: string): Promise<RegimenGanancias | null> {
    return tx.regimenGanancias.findUnique({ where: { empresaId_codigo: { empresaId: this.tenant.empresaId, codigo } } });
  }

  escala(tx: TxEmpresa = this.tenant.db): Promise<EscalaGanancias[]> {
    return tx.escalaGanancias.findMany({ orderBy: { desde: 'asc' } });
  }

  /** Jurisdicciones donde la empresa es agente de retención de IIBB. */
  async jurisdicciones(tx: TxEmpresa): Promise<JurisdiccionIibb[]> {
    const e = await tx.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    return tx.jurisdiccionIibb.findMany({ where: { jurisdiccion: { in: e.jurisdiccionesIibb } }, orderBy: { jurisdiccion: 'asc' } });
  }

  async regimenes() {
    return (await this.tenant.db.regimenGanancias.findMany({ orderBy: { codigo: 'asc' } })).map(vistaRegimen);
  }

  crearRegimen(d: DatosRegimen) {
    return conUnicidad('Ya existe un régimen con ese código', () =>
      this.tenant.transaccion(async (tx) => {
        const r = await tx.regimenGanancias.create({ data: { ...d, empresaId: this.tenant.empresaId, editadoEn: new Date() } });
        await this.auditoria.registrar(tx, { entidad: 'RegimenGanancias', entidadId: r.id, accion: 'CREAR', datos: d });
        return vistaRegimen(r);
      }),
    );
  }

  modificarRegimen(id: string, d: Partial<DatosRegimen>) {
    return conUnicidad('Ya existe un régimen con ese código', () =>
      this.tenant.transaccion(async (tx) => {
        const r = await tx.regimenGanancias.update({ where: { id }, data: { ...d, editadoEn: new Date() } });
        await this.auditoria.registrar(tx, { entidad: 'RegimenGanancias', entidadId: id, accion: 'MODIFICAR', datos: d });
        return vistaRegimen(r);
      }),
    );
  }

  reemplazarEscala(tramos: TramoEscala[]) {
    const ordenados = [...tramos].sort((a, b) => a.desde - b.desde);
    const valida = ordenados.length > 0 && ordenados[0].desde === 0 && ordenados.every((t, i) => {
      const sig = ordenados[i + 1];
      if (!sig) return t.hasta === null || t.hasta > t.desde;
      return t.hasta !== null && t.hasta > t.desde && new D(t.hasta).eq(sig.desde);
    });
    if (!valida) throw new BadRequestException('La escala debe tener tramos contiguos y crecientes');
    return this.tenant.transaccion(async (tx) => {
      await tx.escalaGanancias.deleteMany({});
      await tx.escalaGanancias.createMany({ data: ordenados.map((t) => ({ ...t, empresaId: this.tenant.empresaId })) });
      await this.auditoria.registrar(tx, { entidad: 'EscalaGanancias', entidadId: this.tenant.empresaId, accion: 'MODIFICAR', datos: ordenados });
      return this.escala(tx);
    });
  }

  todasLasJurisdicciones() {
    return this.tenant.db.jurisdiccionIibb.findMany({ orderBy: { jurisdiccion: 'asc' } });
  }

  reemplazarJurisdicciones(lista: DatosJurisdiccion[]) {
    return this.tenant.transaccion(async (tx) => {
      for (const j of lista)
        await tx.jurisdiccionIibb.upsert({
          where: { empresaId_jurisdiccion: { empresaId: this.tenant.empresaId, jurisdiccion: j.jurisdiccion } },
          create: { ...j, empresaId: this.tenant.empresaId },
          update: j,
        });
      await this.auditoria.registrar(tx, { entidad: 'JurisdiccionIibb', entidadId: this.tenant.empresaId, accion: 'MODIFICAR', datos: lista });
      return tx.jurisdiccionIibb.findMany({ orderBy: { jurisdiccion: 'asc' } });
    });
  }
}
