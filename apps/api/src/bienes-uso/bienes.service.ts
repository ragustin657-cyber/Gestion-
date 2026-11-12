import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { hoyEn, ZONA_ARGENTINA } from '@gestion/shared';
import { BienUso, Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { CLAVE_CONTEXTO, ContextoRequest } from '../contexto/contexto';
import { AsientosService } from '../contabilidad/asientos/asientos.service';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { acumuladaEsperada, mesDe } from './calculo';
import { DatosBien, DatosBienRenglon, EdicionBien } from './dto';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const dia = (f: Date | null) => (f ? f.toISOString().slice(0, 10) : null);
const hoy = () => new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`);

/** Bien con importes en texto y fechas 'AAAA-MM-DD'. */
export function bienSalida(b: BienUso) {
  return {
    ...b, valorOrigen: b.valorOrigen.toFixed(2), valorResidual: b.valorResidual.toFixed(2), amortizacionInicial: b.amortizacionInicial.toFixed(2),
    fechaAlta: dia(b.fechaAlta), fechaAmortizacionInicial: dia(b.fechaAmortizacionInicial), fechaBaja: dia(b.fechaBaja),
  };
}

@Injectable()
export class BienesService {
  constructor(private readonly tenant: TenantPrisma, private readonly asientos: AsientosService, private readonly cls: ClsService) {}

  private usuario() {
    return this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId;
  }

  /** Amortización contabilizada vigente del bien, incluida la de la carga inicial. */
  async amortizadoVigente(tx: TxEmpresa, bienId: string): Promise<Dec> {
    const b = await tx.bienUso.findUniqueOrThrow({ where: { id: bienId } });
    const s = await tx.amortizacionBien.aggregate({ where: { bienId, proceso: { estado: 'VIGENTE' } }, _sum: { importe: true } });
    return new D(s._sum.importe ?? 0).plus(b.amortizacionInicial);
  }

  private async tieneAmortizaciones(tx: TxEmpresa, bienId: string) {
    return (await tx.amortizacionBien.count({ where: { bienId, proceso: { estado: 'VIGENTE' } } })) > 0;
  }

  private validarValores(valorOrigen: Dec, valorResidual: Dec) {
    if (valorResidual.gte(valorOrigen)) throw new BadRequestException('El valor residual debe ser menor que el valor de origen');
  }

  private async siguienteNumero(tx: TxEmpresa) {
    const u = await tx.bienUso.aggregate({ _max: { numero: true } });
    return (u._max.numero ?? 0) + 1;
  }

  /** Verifica los datos de bien de un renglón de factura (antes de crear la factura). */
  validarRenglon(bien: DatosBienRenglon, valorOrigen: Dec) {
    this.validarValores(valorOrigen, new D(bien.valorResidual ?? 0));
  }

  /** Bienes de una factura de proveedor: uno por renglón a la cuenta de un rubro (sin asiento propio). */
  async crearDesdeFactura(tx: TxEmpresa, fechaContable: Date, renglones: { id: string; rubroId: string; vidaRubro: number; valorPesos: Dec; bien: DatosBienRenglon }[]) {
    for (const r of renglones) {
      this.validarValores(r.valorPesos, new D(r.bien.valorResidual ?? 0));
      await tx.bienUso.create({
        data: {
          empresaId: this.tenant.empresaId, numero: await this.siguienteNumero(tx), descripcion: r.bien.descripcion, rubroId: r.rubroId, fechaAlta: fechaContable,
          valorOrigen: r.valorPesos, vidaUtilMeses: r.bien.vidaUtilMeses ?? r.vidaRubro, valorResidual: r.bien.valorResidual ?? 0, origen: 'FACTURA',
          comprobanteCompraRenglonId: r.id, creadoPor: this.usuario(),
        },
      });
    }
  }

  /** Al anular una factura de proveedor: rechaza si sus bienes ya tienen amortizaciones o baja; si no, los elimina. */
  async alAnularFactura(tx: TxEmpresa, renglonIds: string[]) {
    const bienes = await tx.bienUso.findMany({ where: { comprobanteCompraRenglonId: { in: renglonIds } }, orderBy: { numero: 'asc' } });
    for (const b of bienes)
      if (b.estado === 'BAJA' || (await this.tieneAmortizaciones(tx, b.id)))
        throw new BadRequestException(`El bien N° ${b.numero} ya tiene amortizaciones o baja: anúlelas primero`);
    if (bienes.length) await tx.bienUso.deleteMany({ where: { id: { in: bienes.map((b) => b.id) } } });
  }

  async listar(f: { rubroId?: string; estado?: string; q?: string }) {
    const db = this.tenant.db;
    const bienes = await db.bienUso.findMany({
      where: { ...(f.rubroId ? { rubroId: f.rubroId } : {}), ...(f.estado === 'ACTIVO' || f.estado === 'BAJA' ? { estado: f.estado } : {}), ...(f.q ? { descripcion: { contains: f.q, mode: 'insensitive' } } : {}) },
      include: { rubro: { select: { nombre: true } } }, orderBy: { numero: 'asc' },
    });
    const m = mesDe(hoy());
    return bienes.map((b) => {
      const acumulada = acumuladaEsperada(b, m);
      return { ...bienSalida(b), rubro: b.rubro.nombre, acumulada: acumulada.toFixed(2), residual: new D(b.valorOrigen).minus(acumulada).toFixed(2) };
    });
  }

  async obtener(id: string, tx: TxEmpresa = this.tenant.db) {
    const b = await tx.bienUso.findUnique({ where: { id }, include: { rubro: true, amortizaciones: { where: { proceso: { estado: 'VIGENTE' } }, include: { proceso: { select: { asientoId: true } } }, orderBy: { mes: 'asc' } } } });
    if (!b) throw new NotFoundException('Bien de uso inexistente');
    const { amortizaciones, rubro, ...resto } = b;
    const contabilizada = amortizaciones.reduce((s, a) => s.plus(a.importe), new D(b.amortizacionInicial));
    return {
      ...bienSalida(resto as BienUso), rubro: { id: rubro.id, nombre: rubro.nombre },
      amortizaciones: amortizaciones.map((a) => ({ mes: a.mes, importe: a.importe.toFixed(2), asientoId: a.proceso.asientoId })),
      amortizacionContabilizada: contabilizada.toFixed(2), residualContable: new D(b.valorOrigen).minus(contabilizada).toFixed(2),
    };
  }

  crear(d: DatosBien) {
    return this.tenant.transaccion(async (tx) => {
      const rubro = await tx.rubroBienUso.findUnique({ where: { id: d.rubroId } });
      if (!rubro || !rubro.activo) throw new BadRequestException('Rubro inexistente o inactivo');
      const valorOrigen = new D(d.valorOrigen), valorResidual = new D(d.valorResidual ?? 0);
      this.validarValores(valorOrigen, valorResidual);
      const datos = {
        empresaId: this.tenant.empresaId, numero: await this.siguienteNumero(tx), descripcion: d.descripcion, rubroId: rubro.id, fechaAlta: d.fechaAlta,
        valorOrigen, vidaUtilMeses: d.vidaUtilMeses ?? rubro.vidaUtilMeses, valorResidual, origen: d.origen, creadoPor: this.usuario(),
      };
      if (d.origen === 'INICIAL') {
        if (d.amortizacionInicial === undefined || !d.fechaAmortizacionInicial) throw new BadRequestException('Indique la amortización acumulada y su fecha');
        const f = d.fechaAmortizacionInicial;
        const finMes = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0));
        if (f.getTime() !== finMes.getTime()) throw new BadRequestException('La fecha de la amortización acumulada debe ser fin de mes');
        if (mesDe(f) < mesDe(d.fechaAlta)) throw new BadRequestException('La fecha de la amortización acumulada no puede ser anterior al alta');
        if (new D(d.amortizacionInicial).gt(valorOrigen.minus(valorResidual))) throw new BadRequestException('La amortización acumulada no puede superar el valor amortizable');
        const b = await tx.bienUso.create({ data: { ...datos, amortizacionInicial: d.amortizacionInicial, fechaAmortizacionInicial: f } });
        return this.obtener(b.id, tx);
      }
      if (!d.cuentaContrapartidaId) throw new BadRequestException('Indique la cuenta de contrapartida');
      const contra = await tx.cuentaContable.findUnique({ where: { id: d.cuentaContrapartidaId } });
      if (!contra || !contra.imputable) throw new BadRequestException('La cuenta de contrapartida debe ser imputable');
      if (contra.id === rubro.cuentaOrigenId) throw new BadRequestException('La contrapartida no puede ser la cuenta del rubro');
      const b = await tx.bienUso.create({ data: datos });
      const asiento = await this.asientos.generar(tx, {
        fecha: d.fechaAlta, descripcion: `Alta de bien de uso N° ${b.numero} - ${d.descripcion}`, origenTipo: 'BIEN_USO', origenId: b.id,
        renglones: [{ cuentaContableId: rubro.cuentaOrigenId, debe: valorOrigen.toFixed(2) }, { cuentaContableId: contra.id, haber: valorOrigen.toFixed(2) }],
      });
      await tx.bienUso.update({ where: { id: b.id }, data: { asientoAltaId: asiento.id } });
      return this.obtener(b.id, tx);
    });
  }

  modificar(id: string, d: EdicionBien) {
    return this.tenant.transaccion(async (tx) => {
      const b = await tx.bienUso.findUnique({ where: { id } });
      if (!b) throw new NotFoundException('Bien de uso inexistente');
      const { descripcion, ...valores } = d;
      const cambia = Object.keys(valores).length > 0;
      if (cambia) {
        if (b.estado === 'BAJA') throw new BadRequestException('El bien está dado de baja');
        if (await this.tieneAmortizaciones(tx, id)) throw new BadRequestException('El bien ya tiene amortizaciones: anúlelas para modificarlo');
        if (b.origen !== 'INICIAL' && (valores.fechaAlta || valores.valorOrigen !== undefined || valores.rubroId))
          throw new BadRequestException('La fecha, el valor y el rubro salen de la factura o del asiento de alta');
        this.validarValores(new D(valores.valorOrigen ?? b.valorOrigen), new D(valores.valorResidual ?? b.valorResidual));
      }
      await tx.bienUso.update({ where: { id }, data: { ...(descripcion ? { descripcion } : {}), ...valores } });
      return this.obtener(id, tx);
    });
  }

  eliminar(id: string) {
    return this.tenant.transaccion(async (tx) => {
      const b = await tx.bienUso.findUnique({ where: { id } });
      if (!b) throw new NotFoundException('Bien de uso inexistente');
      if (b.origen === 'FACTURA') throw new BadRequestException('Un bien dado de alta por factura se elimina anulando la factura');
      if (b.estado === 'BAJA' || (await this.tieneAmortizaciones(tx, id))) throw new BadRequestException('El bien ya tiene amortizaciones o baja: anúlelas primero');
      if (b.asientoAltaId) await this.asientos.contraasiento(tx, b.asientoAltaId, hoy(), `Eliminación del bien de uso N° ${b.numero}`);
      await tx.bienUso.delete({ where: { id } });
      return { ok: true };
    });
  }
}
