import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Caja, CuentaBancaria, Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { bloquear } from '../../compras/comun';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { paginacion } from '../../comun/paginado';
import { AsientosService, RenglonAsiento } from '../../contabilidad/asientos/asientos.service';
import { PlanCuentasService } from '../../contabilidad/plan-cuentas/plan-cuentas.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { NumeracionService } from '../../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { AlcanceSucursalService } from '../sucursales/alcance.service';
import { DatosMovimientoBancario, DatosTransferenciaInterna } from './dto';
import { aPesos, D, registrarMovimiento, SALDO_INSUFICIENTE, saldoCaja } from './tesoreria-comun';

type Extremo = { tipo: 'BANCO'; cuenta: CuentaBancaria } | { tipo: 'CAJA'; caja: Caja };
const moneda = (e: Extremo) => (e.tipo === 'BANCO' ? e.cuenta.monedaCodigo : e.caja.monedaCodigo);
const contable = (e: Extremo) => (e.tipo === 'BANCO' ? e.cuenta.cuentaContableId : e.caja.cuentaContableId);
const ref = (e: Extremo) => (e.tipo === 'BANCO' ? { cuentaBancariaId: e.cuenta.id } : { cajaId: e.caja.id });

@Injectable()
export class BancosService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly alcance: AlcanceSucursalService,
    private readonly asientos: AsientosService,
    private readonly numeracion: NumeracionService,
    private readonly cuentas: ConfigComprasService,
    private readonly plan: PlanCuentasService,
    private readonly auditoria: AuditoriaService,
    private readonly cls: ClsService,
  ) {}

  private usuario() {
    return this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId;
  }

  /** Los usuarios de sucursal no operan cuentas bancarias. */
  private async cuentaBancaria(tx: TxEmpresa, id: string) {
    const c = this.alcance.sucursalUsuario() ? null : await tx.cuentaBancaria.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Cuenta bancaria no encontrada');
    if (!c.activa) throw new BadRequestException('La cuenta bancaria está inactiva');
    return c;
  }

  async listarMovimientos(q: { pagina?: string; porPagina?: string; cuentaBancariaId?: string }) {
    if (this.alcance.sucursalUsuario()) return { items: [], total: 0 };
    const db = this.tenant.db;
    const where: Prisma.MovimientoBancarioWhereInput = { cuentaBancariaId: q.cuentaBancariaId || undefined };
    const [items, total] = await Promise.all([
      db.movimientoBancario.findMany({ where, orderBy: [{ fecha: 'desc' }, { numero: 'desc' }], ...paginacion(q) }),
      db.movimientoBancario.count({ where }),
    ]);
    return { items, total };
  }

  movimiento(d: DatosMovimientoBancario) {
    return this.tenant.transaccion((tx) => this.movimientoEnTx(tx, d));
  }

  /** Movimiento bancario con su asiento dentro de una transacción existente (lo usa también la conciliación). */
  async movimientoEnTx(tx: TxEmpresa, d: DatosMovimientoBancario) {
    const empresaId = this.tenant.empresaId;
    const cuenta = await this.cuentaBancaria(tx, d.cuentaBancariaId);
    await this.plan.verificarImputable(tx, d.cuentaContableId, 'cuentaContableId');
    const importe = new D(d.importe).toDecimalPlaces(2);
    const numero = await this.numeracion.siguiente(tx, 'MBA', 0);
    const mov = await tx.movimientoBancario.create({
      data: { empresaId, numero, fecha: d.fecha, cuentaBancariaId: cuenta.id, tipo: d.tipo, cuentaContableId: d.cuentaContableId, concepto: d.concepto, importe, creadoPor: this.usuario() },
    });
    await registrarMovimiento(tx, empresaId, {
      fecha: d.fecha, tipo: d.tipo === 'GASTO' ? 'EGRESO' : 'INGRESO', cuentaBancariaId: cuenta.id, monedaCodigo: cuenta.monedaCodigo, importe,
      origenTipo: 'MOVIMIENTO_BANCARIO', origenId: mov.id,
    });
    const pesos = (await aPesos(tx, cuenta.monedaCodigo, importe, d.fecha)).toFixed(2);
    const banco = cuenta.cuentaContableId;
    const asiento = await this.asientos.generar(tx, {
      fecha: d.fecha, descripcion: `${d.tipo === 'GASTO' ? 'Gasto' : 'Ingreso'} bancario ${numero} - ${d.concepto}`, origenTipo: 'MOVIMIENTO_BANCARIO', origenId: mov.id,
      renglones: d.tipo === 'GASTO'
        ? [{ cuentaContableId: d.cuentaContableId, debe: pesos }, { cuentaContableId: banco, haber: pesos }]
        : [{ cuentaContableId: banco, debe: pesos }, { cuentaContableId: d.cuentaContableId, haber: pesos }],
    });
    await this.auditoria.registrar(tx, { entidad: 'MovimientoBancario', entidadId: mov.id, accion: 'CREAR', datos: { numero, tipo: d.tipo, importe: importe.toString() } });
    return tx.movimientoBancario.update({ where: { id: mov.id }, data: { asientoId: asiento.id } });
  }

  async listarTransferencias(q: { pagina?: string; porPagina?: string }) {
    const db = this.tenant.db;
    const cajas = await this.alcance.cajasVisibles(db);
    const where: Prisma.TransferenciaInternaWhereInput = cajas ? { OR: [{ origenCajaId: { in: cajas } }, { destinoCajaId: { in: cajas } }] } : {};
    const [items, total] = await Promise.all([
      db.transferenciaInterna.findMany({ where, orderBy: [{ fecha: 'desc' }, { numero: 'desc' }], ...paginacion(q) }),
      db.transferenciaInterna.count({ where }),
    ]);
    return { items, total };
  }

  private async extremo(tx: TxEmpresa, e: { cuentaBancariaId?: string | null; cajaId?: string | null }): Promise<Extremo> {
    if (e.cuentaBancariaId) return { tipo: 'BANCO', cuenta: await this.cuentaBancaria(tx, e.cuentaBancariaId) };
    const caja = await this.alcance.verificarCaja(tx, e.cajaId!);
    if (!caja.activa) throw new BadRequestException('La caja está inactiva');
    return { tipo: 'CAJA', caja };
  }

  transferencia(d: DatosTransferenciaInterna) {
    return this.tenant.transaccion(async (tx) => {
      const empresaId = this.tenant.empresaId;
      const origen = await this.extremo(tx, d.origen);
      const destino = await this.extremo(tx, d.destino);
      const mismo = (origen.tipo === 'BANCO' && destino.tipo === 'BANCO' && origen.cuenta.id === destino.cuenta.id)
        || (origen.tipo === 'CAJA' && destino.tipo === 'CAJA' && origen.caja.id === destino.caja.id);
      if (mismo) throw new BadRequestException('El origen y el destino deben ser distintos');
      const importeOrigen = new D(d.importeOrigen).toDecimalPlaces(2);
      const importeDestino = new D(d.importeDestino).toDecimalPlaces(2);
      const mOrigen = moneda(origen);
      const mDestino = moneda(destino);
      if (mOrigen === mDestino && !importeOrigen.eq(importeDestino))
        throw new BadRequestException({ statusCode: 400, message: 'En una transferencia en la misma moneda los importes deben ser iguales', campos: { importeDestino: 'Debe ser igual al importe de origen' } });
      await bloquear(tx, 'Caja', empresaId, [origen, destino].filter((e) => e.tipo === 'CAJA').map((e) => (e as { caja: Caja }).caja.id));
      if (origen.tipo === 'CAJA' && importeOrigen.gt(await saldoCaja(tx, origen.caja.id))) throw new BadRequestException(SALDO_INSUFICIENTE);

      const numero = await this.numeracion.siguiente(tx, 'TIN', 0);
      // Cotización implícita (pesos por unidad de la moneda extranjera) cuando las monedas difieren
      const cotizacion = mOrigen === mDestino ? null
        : (mOrigen === 'ARS' ? importeOrigen.div(importeDestino) : importeDestino.div(importeOrigen)).toDecimalPlaces(6);
      const t = await tx.transferenciaInterna.create({
        data: {
          empresaId, numero, fecha: d.fecha,
          origenCuentaBancariaId: origen.tipo === 'BANCO' ? origen.cuenta.id : null, origenCajaId: origen.tipo === 'CAJA' ? origen.caja.id : null,
          destinoCuentaBancariaId: destino.tipo === 'BANCO' ? destino.cuenta.id : null, destinoCajaId: destino.tipo === 'CAJA' ? destino.caja.id : null,
          monedaOrigen: mOrigen, monedaDestino: mDestino, importeOrigen, importeDestino, cotizacion, concepto: d.concepto ?? null, creadoPor: this.usuario(),
        },
      });
      await registrarMovimiento(tx, empresaId, { fecha: d.fecha, tipo: 'EGRESO', ...ref(origen), monedaCodigo: mOrigen, importe: importeOrigen, origenTipo: 'TRANSFERENCIA_INTERNA', origenId: t.id });
      await registrarMovimiento(tx, empresaId, { fecha: d.fecha, tipo: 'INGRESO', ...ref(destino), monedaCodigo: mDestino, importe: importeDestino, origenTipo: 'TRANSFERENCIA_INTERNA', origenId: t.id });

      const pesosOrigen = await aPesos(tx, mOrigen, importeOrigen, d.fecha);
      const pesosDestino = await aPesos(tx, mDestino, importeDestino, d.fecha);
      const renglones: RenglonAsiento[] = [
        { cuentaContableId: contable(destino), debe: pesosDestino.toFixed(2) },
        { cuentaContableId: contable(origen), haber: pesosOrigen.toFixed(2) },
      ];
      const dif = pesosOrigen.minus(pesosDestino);
      if (dif.gt(0)) renglones.push({ cuentaContableId: await this.cuentas.cuenta(tx, 'DIFERENCIA_CAMBIO_NEGATIVA'), debe: dif.toFixed(2) });
      if (dif.lt(0)) renglones.push({ cuentaContableId: await this.cuentas.cuenta(tx, 'DIFERENCIA_CAMBIO_POSITIVA'), haber: dif.neg().toFixed(2) });
      const asiento = await this.asientos.generar(tx, {
        fecha: d.fecha, descripcion: `Transferencia interna ${numero}${d.concepto ? ` - ${d.concepto}` : ''}`, origenTipo: 'TRANSFERENCIA_INTERNA', origenId: t.id, renglones,
      });
      await this.auditoria.registrar(tx, { entidad: 'TransferenciaInterna', entidadId: t.id, accion: 'CREAR', datos: { numero } });
      return tx.transferenciaInterna.update({ where: { id: t.id }, data: { asientoId: asiento.id } });
    });
  }
}
