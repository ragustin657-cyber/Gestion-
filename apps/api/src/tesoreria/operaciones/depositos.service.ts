import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { bloquear } from '../../compras/comun';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { paginacion } from '../../comun/paginado';
import { AsientosService, RenglonAsiento } from '../../contabilidad/asientos/asientos.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { NumeracionService } from '../../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { AlcanceSucursalService } from '../sucursales/alcance.service';
import { CarteraService, noDisponible } from './cartera.service';
import { DatosDeposito } from './dto';
import { anularMovimientos, aPesos, D, hoy, MONEDA_DISTINTA, registrarMovimiento, SALDO_INSUFICIENTE, saldoCaja } from './tesoreria-comun';

const INCLUIR = { items: { orderBy: { tipo: 'asc' } } } satisfies Prisma.DepositoBancarioInclude;

@Injectable()
export class DepositosService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly alcance: AlcanceSucursalService,
    private readonly cartera: CarteraService,
    private readonly asientos: AsientosService,
    private readonly numeracion: NumeracionService,
    private readonly cuentas: ConfigComprasService,
    private readonly auditoria: AuditoriaService,
    private readonly cls: ClsService,
  ) {}

  private async filtro(tx: TxEmpresa): Promise<Prisma.DepositoBancarioWhereInput> {
    const cajas = await this.alcance.cajasVisibles(tx);
    return cajas ? { cajaId: { in: cajas } } : {};
  }

  async listar(q: { pagina?: string; porPagina?: string }) {
    const db = this.tenant.db;
    const where = await this.filtro(db);
    const [items, total] = await Promise.all([
      db.depositoBancario.findMany({ where, include: INCLUIR, orderBy: [{ fecha: 'desc' }, { numero: 'desc' }], ...paginacion(q) }),
      db.depositoBancario.count({ where }),
    ]);
    return { items, total };
  }

  async obtener(id: string, tx: TxEmpresa = this.tenant.db) {
    const d = await tx.depositoBancario.findFirst({ where: { id, ...(await this.filtro(tx)) }, include: INCLUIR });
    if (!d) throw new NotFoundException('Depósito no encontrado');
    return d;
  }

  crear(d: DatosDeposito) {
    return this.tenant.transaccion(async (tx) => {
      const empresaId = this.tenant.empresaId;
      const caja = await this.alcance.verificarCaja(tx, d.cajaId);
      const cuenta = await tx.cuentaBancaria.findUnique({ where: { id: d.cuentaBancariaId } });
      if (!cuenta) throw new NotFoundException('Cuenta bancaria no encontrada');
      if (!cuenta.activa) throw new BadRequestException('La cuenta bancaria está inactiva');
      if (!d.cheques.length && !d.efectivo) throw new BadRequestException('Indique los valores a depositar');
      if (new Set(d.cheques).size !== d.cheques.length) throw new BadRequestException('Hay cheques repetidos');

      await bloquear(tx, 'Caja', empresaId, [caja.id]);
      await bloquear(tx, 'ChequeTercero', empresaId, d.cheques);
      const cheques = await tx.chequeTercero.findMany({ where: { id: { in: d.cheques } } });
      if (cheques.length !== d.cheques.length) throw new NotFoundException('Cheque no encontrado');
      if (caja.monedaCodigo !== cuenta.monedaCodigo || cheques.some((c) => c.monedaCodigo !== cuenta.monedaCodigo)) throw new BadRequestException(MONEDA_DISTINTA);
      for (const c of cheques) if (c.estado !== 'EN_CARTERA' || c.cajaId !== caja.id) throw noDisponible(c.numero);
      const efectivo = d.efectivo ? new D(d.efectivo.importe).toDecimalPlaces(2) : null;
      if (efectivo && efectivo.gt(await saldoCaja(tx, caja.id))) throw new BadRequestException(SALDO_INSUFICIENTE);

      const numero = await this.numeracion.siguiente(tx, 'DEP', 0);
      const usuario = this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId;
      const dep = await tx.depositoBancario.create({
        data: { empresaId, numero, fecha: d.fecha, cajaId: caja.id, cuentaBancariaId: cuenta.id, boleta: d.boleta ?? null, creadoPor: usuario },
      });
      const mov = { tipo: 'DEPOSITO', id: dep.id, fecha: d.fecha };
      const renglones: RenglonAsiento[] = [];
      let total = new D(0);
      let totalPesos = new D(0);
      let diferencia = new D(0);
      const valores = await this.cuentas.cuenta(tx, 'VALORES_A_DEPOSITAR');
      for (const c of cheques) {
        await this.cartera.cambiarEstado(tx, c.id, 'DEPOSITADO', { cajaId: null, cuentaBancariaId: cuenta.id, fechaDeposito: d.fecha }, mov, ['EN_CARTERA']);
        await tx.depositoBancarioItem.create({ data: { empresaId, depositoId: dep.id, tipo: 'CHEQUE', chequeId: c.id, monedaCodigo: c.monedaCodigo, importe: c.importe } });
        const pesos = await aPesos(tx, c.monedaCodigo, c.importe, d.fecha);
        // Valores a depositar se cancela por lo registrado al ingresar; la diferencia es de cambio
        renglones.push({ cuentaContableId: valores, haber: c.importePesos.toFixed(2), detalle: `Cheque ${c.numero} ${c.banco}` });
        diferencia = diferencia.plus(pesos.minus(c.importePesos));
        total = total.plus(c.importe);
        totalPesos = totalPesos.plus(pesos);
      }
      if (efectivo) {
        await tx.depositoBancarioItem.create({ data: { empresaId, depositoId: dep.id, tipo: 'EFECTIVO', monedaCodigo: caja.monedaCodigo, importe: efectivo } });
        await registrarMovimiento(tx, empresaId, { fecha: d.fecha, tipo: 'EGRESO', cajaId: caja.id, monedaCodigo: caja.monedaCodigo, importe: efectivo, origenTipo: 'DEPOSITO', origenId: dep.id });
        const pesos = await aPesos(tx, caja.monedaCodigo, efectivo, d.fecha);
        renglones.push({ cuentaContableId: caja.cuentaContableId, haber: pesos.toFixed(2) });
        total = total.plus(efectivo);
        totalPesos = totalPesos.plus(pesos);
      }
      await registrarMovimiento(tx, empresaId, { fecha: d.fecha, tipo: 'INGRESO', cuentaBancariaId: cuenta.id, monedaCodigo: cuenta.monedaCodigo, importe: total, origenTipo: 'DEPOSITO', origenId: dep.id });
      renglones.unshift({ cuentaContableId: cuenta.cuentaContableId, debe: totalPesos.toFixed(2) });
      if (diferencia.gt(0)) renglones.push({ cuentaContableId: await this.cuentas.cuenta(tx, 'DIFERENCIA_CAMBIO_POSITIVA'), haber: diferencia.toFixed(2) });
      if (diferencia.lt(0)) renglones.push({ cuentaContableId: await this.cuentas.cuenta(tx, 'DIFERENCIA_CAMBIO_NEGATIVA'), debe: diferencia.neg().toFixed(2) });
      const asiento = await this.asientos.generar(tx, {
        fecha: d.fecha, descripcion: `Depósito ${numero} en cuenta ${cuenta.numero}${d.boleta ? ` - boleta ${d.boleta}` : ''}`, origenTipo: 'DEPOSITO', origenId: dep.id, renglones,
      });
      await tx.depositoBancario.update({ where: { id: dep.id }, data: { asientoId: asiento.id } });
      await this.auditoria.registrar(tx, { entidad: 'DepositoBancario', entidadId: dep.id, accion: 'CREAR', datos: { numero, total: total.toString() } });
      return this.obtener(dep.id, tx);
    });
  }

  anular(id: string, motivo: string) {
    return this.tenant.transaccion(async (tx) => {
      const empresaId = this.tenant.empresaId;
      const dep = await this.obtener(id, tx);
      await bloquear(tx, 'Caja', empresaId, [dep.cajaId]);
      const chequeIds = dep.items.map((i) => i.chequeId!).filter(Boolean);
      await bloquear(tx, 'ChequeTercero', empresaId, chequeIds);
      const actual = await tx.depositoBancario.findUniqueOrThrow({ where: { id } });
      if (actual.estado === 'ANULADO') throw new BadRequestException('El depósito ya está anulado');
      const cheques = await tx.chequeTercero.findMany({ where: { id: { in: chequeIds } } });
      if (cheques.some((c) => c.estado !== 'DEPOSITADO')) throw new BadRequestException('El depósito tiene cheques acreditados o rechazados');
      const fecha = hoy() < dep.fecha ? dep.fecha : hoy();
      const mov = { tipo: 'ANULACION_DEPOSITO', id, fecha };
      for (const c of cheques)
        await this.cartera.cambiarEstado(tx, c.id, 'EN_CARTERA', { cajaId: dep.cajaId, cuentaBancariaId: null, fechaDeposito: null }, mov, ['DEPOSITADO']);
      await anularMovimientos(tx, 'DEPOSITO', id);
      const contra = await this.asientos.contraasiento(tx, dep.asientoId!, fecha, `Anulación del depósito ${dep.numero} - ${motivo}`);
      await tx.depositoBancario.update({ where: { id }, data: { estado: 'ANULADO', motivoAnulacion: motivo, asientoAnulacionId: contra.id } });
      await this.auditoria.registrar(tx, { entidad: 'DepositoBancario', entidadId: id, accion: 'ANULAR', datos: { motivo } });
      return this.obtener(id, tx);
    });
  }
}
