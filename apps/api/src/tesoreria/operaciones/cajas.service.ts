import { BadRequestException, Injectable } from '@nestjs/common';
import type { Caja, Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { bloquear } from '../../compras/comun';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { paginacion } from '../../comun/paginado';
import { AsientosService } from '../../contabilidad/asientos/asientos.service';
import { PlanCuentasService } from '../../contabilidad/plan-cuentas/plan-cuentas.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { NumeracionService } from '../../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { AlcanceSucursalService } from '../sucursales/alcance.service';
import { DatosArqueo, DatosMovimientoCaja } from './dto';
import { aPesos, D, Dec, registrarMovimiento, SALDO_INSUFICIENTE, saldoCaja } from './tesoreria-comun';

@Injectable()
export class CajasService {
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

  private async filtro(cajaId?: string): Promise<{ cajaId?: string | { in: string[] } }> {
    const cajas = await this.alcance.cajasVisibles(this.tenant.db);
    if (cajaId) return { cajaId: cajas && !cajas.includes(cajaId) ? { in: [] } : cajaId };
    return cajas ? { cajaId: { in: cajas } } : {};
  }

  async listarMovimientos(q: { pagina?: string; porPagina?: string; cajaId?: string }) {
    const db = this.tenant.db;
    const where: Prisma.MovimientoCajaWhereInput = await this.filtro(q.cajaId);
    const [items, total] = await Promise.all([
      db.movimientoCaja.findMany({ where, orderBy: [{ fecha: 'desc' }, { numero: 'desc' }], ...paginacion(q) }),
      db.movimientoCaja.count({ where }),
    ]);
    return { items, total };
  }

  async listarArqueos(q: { pagina?: string; porPagina?: string; cajaId?: string }) {
    const db = this.tenant.db;
    const where: Prisma.ArqueoWhereInput = await this.filtro(q.cajaId);
    const [items, total] = await Promise.all([
      db.arqueo.findMany({ where, orderBy: [{ fecha: 'desc' }, { numero: 'desc' }], ...paginacion(q) }),
      db.arqueo.count({ where }),
    ]);
    return { items, total };
  }

  /** Movimiento de caja con su asiento; la caja ya está bloqueada y el saldo validado. */
  private async registrar(tx: TxEmpresa, caja: Caja, d: { fecha: Date; tipo: 'INGRESO' | 'EGRESO'; cuentaContableId: string; concepto: string; importe: Dec; arqueoId?: string }) {
    const empresaId = this.tenant.empresaId;
    const numero = await this.numeracion.siguiente(tx, 'MCA', 0);
    const mov = await tx.movimientoCaja.create({
      data: { empresaId, numero, fecha: d.fecha, cajaId: caja.id, tipo: d.tipo, cuentaContableId: d.cuentaContableId, concepto: d.concepto, importe: d.importe, arqueoId: d.arqueoId ?? null, creadoPor: this.usuario() },
    });
    await registrarMovimiento(tx, empresaId, { fecha: d.fecha, tipo: d.tipo, cajaId: caja.id, monedaCodigo: caja.monedaCodigo, importe: d.importe, origenTipo: 'MOVIMIENTO_CAJA', origenId: mov.id });
    const pesos = (await aPesos(tx, caja.monedaCodigo, d.importe, d.fecha)).toFixed(2);
    const asiento = await this.asientos.generar(tx, {
      fecha: d.fecha, descripcion: `${d.tipo === 'INGRESO' ? 'Ingreso' : 'Egreso'} de caja ${numero} (${caja.nombre}) - ${d.concepto}`, origenTipo: 'MOVIMIENTO_CAJA', origenId: mov.id,
      renglones: d.tipo === 'INGRESO'
        ? [{ cuentaContableId: caja.cuentaContableId, debe: pesos }, { cuentaContableId: d.cuentaContableId, haber: pesos }]
        : [{ cuentaContableId: d.cuentaContableId, debe: pesos }, { cuentaContableId: caja.cuentaContableId, haber: pesos }],
    });
    return tx.movimientoCaja.update({ where: { id: mov.id }, data: { asientoId: asiento.id } });
  }

  movimiento(d: DatosMovimientoCaja) {
    return this.tenant.transaccion(async (tx) => {
      const caja = await this.alcance.verificarCaja(tx, d.cajaId);
      if (!caja.activa) throw new BadRequestException('La caja está inactiva');
      await this.plan.verificarImputable(tx, d.cuentaContableId, 'cuentaContableId');
      await bloquear(tx, 'Caja', this.tenant.empresaId, [caja.id]);
      const importe = new D(d.importe).toDecimalPlaces(2);
      if (d.tipo === 'EGRESO' && importe.gt(await saldoCaja(tx, caja.id))) throw new BadRequestException(SALDO_INSUFICIENTE);
      const mov = await this.registrar(tx, caja, { ...d, importe });
      await this.auditoria.registrar(tx, { entidad: 'MovimientoCaja', entidadId: mov.id, accion: 'CREAR', datos: { numero: mov.numero, tipo: d.tipo, importe: importe.toString() } });
      return mov;
    });
  }

  arqueo(d: DatosArqueo) {
    return this.tenant.transaccion(async (tx) => {
      const empresaId = this.tenant.empresaId;
      const caja = await this.alcance.verificarCaja(tx, d.cajaId);
      await bloquear(tx, 'Caja', empresaId, [caja.id]);
      const saldoSistema = await saldoCaja(tx, caja.id);
      const contado = new D(d.contado).toDecimalPlaces(2);
      const diferencia = contado.minus(saldoSistema);
      if (!diferencia.isZero() && !d.motivo)
        throw new BadRequestException({ statusCode: 400, message: 'Indique el motivo de la diferencia', campos: { motivo: 'Indique el motivo de la diferencia' } });
      const numero = await this.numeracion.siguiente(tx, 'ARQ', 0);
      const arqueo = await tx.arqueo.create({
        data: { empresaId, numero, cajaId: caja.id, fecha: d.fecha, saldoSistema, contado, diferencia, motivo: d.motivo ?? null, creadoPor: this.usuario() },
      });
      let asientoId: string | null = null;
      if (!diferencia.isZero()) {
        const mov = await this.registrar(tx, caja, {
          fecha: d.fecha, tipo: diferencia.gt(0) ? 'INGRESO' : 'EGRESO', cuentaContableId: await this.cuentas.cuenta(tx, 'DIFERENCIAS_DE_CAJA'),
          concepto: `Arqueo ${numero}: ${d.motivo}`, importe: diferencia.abs(), arqueoId: arqueo.id,
        });
        asientoId = mov.asientoId;
      }
      await this.auditoria.registrar(tx, { entidad: 'Arqueo', entidadId: arqueo.id, accion: 'CREAR', datos: { numero, diferencia: diferencia.toString() } });
      return tx.arqueo.update({ where: { id: arqueo.id }, data: { asientoId } });
    });
  }
}
