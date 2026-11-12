import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BienUso, MotivoBajaBienUso, Prisma, RubroBienUso } from '@prisma/client';
import { AsientosService, RenglonAsiento } from '../contabilidad/asientos/asientos.service';
import { ConfigComprasService } from '../compras/config/config-compras.service';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { AmortizacionService } from './amortizacion.service';
import { BienesService } from './bienes.service';
import { mesDe, sumarMeses } from './calculo';

const D = Prisma.Decimal;
const mmaaaa = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

@Injectable()
export class BajasService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly asientos: AsientosService,
    private readonly cuentas: ConfigComprasService,
    private readonly amortizacion: AmortizacionService,
    private readonly bienes: BienesService,
  ) {}

  /** Reglas de baja (spec §5): activo, fecha ≥ alta, amortizado hasta el mes anterior y sin amortizaciones posteriores. */
  async validarBaja(tx: TxEmpresa, bienId: string, fecha: Date): Promise<BienUso & { rubro: RubroBienUso }> {
    const b = await tx.bienUso.findUnique({ where: { id: bienId }, include: { rubro: true } });
    if (!b) throw new NotFoundException('Bien de uso inexistente');
    if (b.estado === 'BAJA') throw new BadRequestException('El bien ya está dado de baja');
    if (fecha < b.fechaAlta) throw new BadRequestException('La fecha de baja no puede ser anterior al alta');
    const mes = mesDe(fecha);
    if (await tx.amortizacionBien.count({ where: { bienId, mes: { gte: mes }, proceso: { estado: 'VIGENTE' } } })) throw new BadRequestException('El bien tiene amortizaciones posteriores a la baja');
    const anterior = sumarMeses(mes, -1);
    if (!(await this.amortizacion.pendienteHasta(tx, bienId, anterior)).isZero()) throw new BadRequestException(`Genere primero la amortización de ${mmaaaa(anterior)}`);
    return b;
  }

  /** Asiento de baja: amortización acumulada al debe, residual a la cuenta indicada, valor de origen al haber; fecha de origen = alta. */
  async registrarBaja(tx: TxEmpresa, b: BienUso & { rubro: RubroBienUso }, fecha: Date, motivo: MotivoBajaBienUso, cuentaResidualId: string, comprobanteVentaRenglonId: string | null = null) {
    const acumulada = await this.bienes.amortizadoVigente(tx, b.id);
    const residual = new D(b.valorOrigen).minus(acumulada);
    const fechaOrigen = new Date(`${mesDe(b.fechaAlta)}-01T00:00:00Z`);
    const renglones: RenglonAsiento[] = [
      { cuentaContableId: b.rubro.cuentaAmortizacionId, debe: acumulada.toFixed(2), fechaOrigen },
      { cuentaContableId: cuentaResidualId, debe: residual.toFixed(2), fechaOrigen },
      { cuentaContableId: b.rubro.cuentaOrigenId, haber: new D(b.valorOrigen).toFixed(2), fechaOrigen },
    ];
    const asiento = await this.asientos.generar(tx, { fecha, descripcion: `Baja del bien de uso N° ${b.numero} - ${b.descripcion}`, origenTipo: 'BIEN_USO_BAJA', origenId: b.id, renglones });
    return tx.bienUso.update({ where: { id: b.id }, data: { estado: 'BAJA', fechaBaja: fecha, motivoBaja: motivo, asientoBajaId: asiento.id, comprobanteVentaRenglonId } });
  }

  baja(id: string, d: { fecha: Date; motivo: 'DESUSO' | 'SINIESTRO' | 'ROBO' }) {
    return this.tenant.transaccion(async (tx) => {
      const b = await this.validarBaja(tx, id, d.fecha);
      await this.registrarBaja(tx, b, d.fecha, d.motivo, await this.cuentas.cuenta(tx, 'BAJAS_BIENES_USO'));
      return this.bienes.obtener(id, tx);
    });
  }

  anularBaja(id: string) {
    return this.tenant.transaccion(async (tx) => {
      const b = await tx.bienUso.findUnique({ where: { id } });
      if (!b) throw new NotFoundException('Bien de uso inexistente');
      if (b.estado !== 'BAJA' || !b.asientoBajaId) throw new BadRequestException('El bien no está dado de baja');
      if (b.motivoBaja === 'VENTA') throw new BadRequestException('La baja por venta no se anula: el bien se vendió con un comprobante autorizado');
      await this.asientos.contraasiento(tx, b.asientoBajaId, b.fechaBaja!, `Anulación de la baja del bien de uso N° ${b.numero}`);
      await tx.bienUso.update({ where: { id }, data: { estado: 'ACTIVO', fechaBaja: null, motivoBaja: null, asientoBajaId: null } });
      return this.bienes.obtener(id, tx);
    });
  }

  /** Validaciones de los renglones de venta de bienes (al guardar y antes de pedir el CAE). */
  async validarVenta(tx: TxEmpresa, c: { id?: string; tipo: string; fecha: Date }, renglones: { bienUsoId?: string | null; articuloId?: string | null; cantidad: number | Prisma.Decimal }[]) {
    const ids = renglones.map((r) => r.bienUsoId).filter((x): x is string => !!x);
    if (!ids.length) return;
    if (c.tipo === 'NOTA_CREDITO') throw new BadRequestException('Una nota de crédito no puede vender un bien de uso');
    if (new Set(ids).size !== ids.length) throw new BadRequestException('El mismo bien de uso está en dos renglones');
    for (const r of renglones.filter((x) => x.bienUsoId))
      if (r.articuloId || !new D(r.cantidad).eq(1)) throw new BadRequestException('El renglón de un bien de uso va sin artículo y con cantidad 1');
    for (const id of ids) {
      const b = await this.validarBaja(tx, id, c.fecha);
      const otro = await tx.comprobanteVentaRenglon.findFirst({ where: { bienUsoId: id, comprobante: { estado: { in: ['PENDIENTE_CAE', 'AUTORIZADO'] }, ...(c.id ? { id: { not: c.id } } : {}) } } });
      if (otro) throw new BadRequestException(`El bien N° ${b.numero} ya está en otro comprobante`);
    }
  }

  /** Al autorizar la venta: baja con motivo VENTA y residual contra el resultado por venta. */
  async alAutorizarVenta(tx: TxEmpresa, fecha: Date, renglones: { id: string; bienUsoId: string | null }[]) {
    const conBien = renglones.filter((r) => r.bienUsoId);
    if (!conBien.length) return;
    const cuenta = await this.cuentas.cuenta(tx, 'RESULTADO_VENTA_BIENES_USO');
    for (const r of conBien) {
      const b = await tx.bienUso.findUniqueOrThrow({ where: { id: r.bienUsoId! }, include: { rubro: true } });
      await this.registrarBaja(tx, b, fecha, 'VENTA', cuenta, r.id);
    }
  }
}
