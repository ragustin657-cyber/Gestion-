import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { NumeracionService } from '../../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { periodoAbierto } from '../periodos/control';
import type { TipoAsiento } from '@prisma/client';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export interface RenglonAsiento {
  cuentaContableId: string;
  centroCostoId?: string | null;
  debe?: string;
  haber?: string;
  detalle?: string;
}

export interface DatosAsiento {
  fecha: Date;
  descripcion: string;
  origenTipo: string;
  origenId: string;
  renglones: RenglonAsiento[];
  /** Por defecto AUTOMATICO. */
  tipo?: TipoAsiento;
}

const fmt = (d: Dec) => d.toFixed(2);

/** Motor de asientos: agrupa, valida cuentas y balanceo, y numera. */
@Injectable()
export class AsientosService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly numeracion: NumeracionService,
    private readonly auditoria: AuditoriaService,
    private readonly cls: ClsService,
  ) {}

  async generar(tx: TxEmpresa, a: DatosAsiento, anulaAId?: string): Promise<{ id: string; numero: number }> {
    // Agrupar por cuenta + centro de costo, neteando debe y haber
    const grupos = new Map<string, { cuentaContableId: string; centroCostoId: string | null; neto: Dec; detalle?: string }>();
    for (const r of a.renglones) {
      const k = `${r.cuentaContableId}|${r.centroCostoId ?? ''}`;
      const g = grupos.get(k) ?? { cuentaContableId: r.cuentaContableId, centroCostoId: r.centroCostoId ?? null, neto: new D(0), detalle: r.detalle };
      g.neto = g.neto.plus(new D(r.debe ?? 0)).minus(new D(r.haber ?? 0));
      grupos.set(k, g);
    }
    const renglones = [...grupos.values()]
      .filter((g) => !g.neto.toDecimalPlaces(2).isZero())
      .map((g) => ({
        cuentaContableId: g.cuentaContableId,
        centroCostoId: g.centroCostoId,
        debe: g.neto.gt(0) ? g.neto.toDecimalPlaces(2) : new D(0),
        haber: g.neto.lt(0) ? g.neto.neg().toDecimalPlaces(2) : new D(0),
        detalle: g.detalle ?? null,
      }));
    if (!renglones.length) throw new BadRequestException('El asiento no tiene importes');

    const cuentas = await tx.cuentaContable.findMany({ where: { id: { in: [...new Set(renglones.map((r) => r.cuentaContableId))] } } });
    for (const r of renglones) {
      const c = cuentas.find((x) => x.id === r.cuentaContableId);
      if (!c || !c.imputable || !c.activa)
        throw new BadRequestException(`La cuenta contable ${c ? `${c.codigo} ${c.nombre}` : r.cuentaContableId} no es imputable o está inactiva`);
    }

    const debe = renglones.reduce((s, r) => s.plus(r.debe), new D(0));
    const haber = renglones.reduce((s, r) => s.plus(r.haber), new D(0));
    if (!debe.eq(haber)) throw new BadRequestException(`El asiento no balancea (debe ${fmt(debe)}, haber ${fmt(haber)})`);

    // Control de fechas contables (bloquea el período hasta el fin de la transacción)
    const { ejercicio } = await periodoAbierto(tx, this.tenant.empresaId, a.fecha);
    const ctx = this.cls.get<ContextoRequest>(CLAVE_CONTEXTO);
    const numero = await this.numeracion.siguiente(tx, 'ASIENTO', 0);
    const asiento = await tx.asiento.create({
      data: {
        empresaId: this.tenant.empresaId, numero, fecha: a.fecha, descripcion: a.descripcion,
        origenTipo: a.origenTipo, origenId: a.origenId, anulaAId: anulaAId ?? null, creadoPor: ctx.usuarioId,
        tipo: a.tipo ?? 'AUTOMATICO', ejercicioId: ejercicio.id,
      },
    });
    await tx.asientoRenglon.createMany({
      data: renglones.map((r) => ({ ...r, empresaId: this.tenant.empresaId, asientoId: asiento.id })),
    });
    await this.auditoria.registrar(tx, { entidad: 'Asiento', entidadId: asiento.id, accion: 'CREAR', datos: { numero, origenTipo: a.origenTipo, origenId: a.origenId } });
    return { id: asiento.id, numero };
  }

  /** Asiento inverso del indicado (debe ↔ haber), vinculado por anulaAId. */
  async contraasiento(tx: TxEmpresa, asientoId: string, fecha: Date, descripcion: string): Promise<{ id: string; numero: number }> {
    const orig = await tx.asiento.findUnique({ where: { id: asientoId }, include: { renglones: true } });
    if (!orig) throw new BadRequestException('Asiento original inexistente');
    return this.generar(
      tx,
      {
        fecha, descripcion, origenTipo: orig.origenTipo, origenId: orig.origenId,
        renglones: orig.renglones.map((r) => ({
          cuentaContableId: r.cuentaContableId, centroCostoId: r.centroCostoId,
          debe: r.haber.toString(), haber: r.debe.toString(), detalle: r.detalle ?? undefined,
        })),
      },
      orig.id,
    );
  }
}
