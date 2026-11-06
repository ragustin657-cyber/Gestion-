import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { bloquear, fechaAR } from '../../compras/comun';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { paginacion } from '../../comun/paginado';
import { AsientosService, RenglonAsiento } from '../../contabilidad/asientos/asientos.service';
import { PlanCuentasService } from '../../contabilidad/plan-cuentas/plan-cuentas.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { NumeracionService } from '../../numeracion/numeracion.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { AlcanceSucursalService } from '../sucursales/alcance.service';
import { CarteraService } from './cartera.service';
import { DatosIngreso } from './dto';
import { anularMovimientos, aPesos, D, Dec, hoy, registrarMovimiento, saldoCaja } from './tesoreria-comun';

const INCLUIR = { efectivo: true, cheques: { orderBy: { creadoEn: 'asc' } }, transferencias: true } satisfies Prisma.IngresoValoresInclude;
const YA_MOVIDOS = 'Hay valores de este ingreso que ya se movieron';
const DIAS_VENCIMIENTO = 30;

@Injectable()
export class IngresosService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly alcance: AlcanceSucursalService,
    private readonly cartera: CarteraService,
    private readonly asientos: AsientosService,
    private readonly numeracion: NumeracionService,
    private readonly cuentas: ConfigComprasService,
    private readonly plan: PlanCuentasService,
    private readonly auditoria: AuditoriaService,
    private readonly cls: ClsService,
  ) {}

  private filtro(): Prisma.IngresoValoresWhereInput {
    const s = this.alcance.sucursalUsuario();
    return s ? { sucursalId: s } : {};
  }

  async listar(q: { pagina?: string; porPagina?: string; estado?: string }) {
    const where: Prisma.IngresoValoresWhereInput = { ...this.filtro() };
    if (q.estado) {
      if (!['CONFIRMADO', 'ANULADO'].includes(q.estado)) throw new BadRequestException('Estado inválido');
      where.estado = q.estado as 'CONFIRMADO' | 'ANULADO';
    }
    const [items, total] = await Promise.all([
      this.tenant.db.ingresoValores.findMany({ where, include: INCLUIR, orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }], ...paginacion(q) }),
      this.tenant.db.ingresoValores.count({ where }),
    ]);
    return { items, total };
  }

  async obtener(id: string, tx: TxEmpresa = this.tenant.db) {
    const i = await tx.ingresoValores.findFirst({ where: { id, ...this.filtro() }, include: INCLUIR });
    if (!i) throw new NotFoundException('Ingreso no encontrado');
    return i;
  }

  crear(d: DatosIngreso) {
    return this.tenant.transaccion(async (tx) => {
      const empresaId = this.tenant.empresaId;
      const caja = await this.alcance.verificarCaja(tx, d.cajaId);
      if (!caja.activa) throw new BadRequestException('La caja está inactiva');
      if (!d.efectivo && !d.cheques.length && !d.transferencias.length) throw new BadRequestException('Ingrese al menos un valor');

      let terceroId: string | null = null;
      let cuentaHaber: string;
      if (d.origen === 'CLIENTE') {
        const t = d.terceroId ? await tx.tercero.findUnique({ where: { id: d.terceroId } }) : null;
        if (!t) throw new BadRequestException({ statusCode: 400, message: 'Indique el cliente', campos: { terceroId: 'Indique el cliente' } });
        if (!t.esCliente) throw new BadRequestException({ statusCode: 400, message: 'El tercero no es cliente', campos: { terceroId: 'El tercero no es cliente' } });
        terceroId = t.id;
        cuentaHaber = await this.cuentas.cuenta(tx, 'DEUDORES_POR_VENTAS');
      } else {
        if (!d.cuentaContableId)
          throw new BadRequestException({ statusCode: 400, message: 'Indique la cuenta contable', campos: { cuentaContableId: 'Campo obligatorio' } });
        await this.plan.verificarImputable(tx, d.cuentaContableId, 'cuentaContableId');
        cuentaHaber = d.cuentaContableId;
      }

      const cuentasBanco = new Map<string, { monedaCodigo: string; id: string }>();
      for (const t of d.transferencias) {
        const c = await tx.cuentaBancaria.findUnique({ where: { id: t.cuentaBancariaId } });
        if (!c) throw new NotFoundException('Cuenta bancaria no encontrada');
        cuentasBanco.set(c.id, c);
      }

      const sucursal = await tx.sucursal.findUniqueOrThrow({ where: { id: caja.sucursalId } });
      const usuario = this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId;
      // Talonario por id de sucursal: el código se puede cambiar sin romper la numeración
      const numero = await this.numeracion.siguiente(tx, `ING-${sucursal.id}`, 0);
      const ingreso = await tx.ingresoValores.create({
        data: {
          empresaId, sucursalId: sucursal.id, numero, fecha: d.fecha, cajaId: caja.id, origen: d.origen, terceroId,
          cuentaContableId: d.origen === 'OTRO' ? cuentaHaber : null, concepto: d.concepto, creadoPor: usuario,
        },
      });
      const origen = { tipo: 'INGRESO', id: ingreso.id, fecha: d.fecha };

      const renglones: RenglonAsiento[] = [];
      const porMoneda = new Map<string, { importe: Dec; pesos: Dec }>();
      const sumar = (moneda: string, importe: Dec, pesos: Dec) => {
        const m = porMoneda.get(moneda) ?? { importe: new D(0), pesos: new D(0) };
        porMoneda.set(moneda, { importe: m.importe.plus(importe), pesos: m.pesos.plus(pesos) });
      };

      if (d.efectivo) {
        const importe = new D(d.efectivo.importe).toDecimalPlaces(2);
        const pesos = await aPesos(tx, caja.monedaCodigo, importe, d.fecha);
        await tx.ingresoValoresEfectivo.create({ data: { empresaId, ingresoId: ingreso.id, monedaCodigo: caja.monedaCodigo, importe } });
        await registrarMovimiento(tx, empresaId, {
          fecha: d.fecha, tipo: 'INGRESO', cajaId: caja.id, monedaCodigo: caja.monedaCodigo, importe, origenTipo: 'INGRESO', origenId: ingreso.id,
        });
        renglones.push({ cuentaContableId: caja.cuentaContableId, debe: pesos.toFixed(2) });
        sumar(caja.monedaCodigo, importe, pesos);
      }

      const advertencias: string[] = [];
      const limite = hoy();
      limite.setUTCDate(limite.getUTCDate() - DIAS_VENCIMIENTO);
      const valores = await this.cuentas.cuenta(tx, 'VALORES_A_DEPOSITAR');
      for (const c of d.cheques) {
        const importe = new D(c.importe).toDecimalPlaces(2);
        const pesos = await aPesos(tx, caja.monedaCodigo, importe, d.fecha);
        const repetido = await tx.chequeTercero.findFirst({ where: { banco: c.banco, numero: c.numero, libradorCuit: c.libradorCuit, claveAnulacion: '' } });
        if (repetido) throw new ConflictException(`El cheque ${c.numero} del banco ${c.banco} ya fue registrado`);
        let cheque;
        try {
          cheque = await tx.chequeTercero.create({
            data: {
              empresaId, ingresoId: ingreso.id, tipo: c.tipo, banco: c.banco, numero: c.numero, libradorNombre: c.libradorNombre,
              libradorCuit: c.libradorCuit, fechaEmision: c.fechaEmision, fechaPago: c.fechaPago, monedaCodigo: caja.monedaCodigo, importe,
              estado: 'EN_CARTERA', cajaId: caja.id, terceroOrigenId: terceroId, importePesos: pesos, sucursalId: sucursal.id,
            },
          });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
            throw new ConflictException(`El cheque ${c.numero} del banco ${c.banco} ya fue registrado`);
          throw e;
        }
        await this.cartera.alta(tx, cheque, origen);
        if (c.fechaPago < limite) advertencias.push(`El cheque ${c.numero} está vencido para depositar`);
        renglones.push({ cuentaContableId: valores, debe: pesos.toFixed(2), detalle: `Cheque ${c.numero} ${c.banco}` });
        sumar(caja.monedaCodigo, importe, pesos);
      }

      if (d.transferencias.length) {
        const cuentaTransf = await this.cuentas.cuenta(tx, 'TRANSFERENCIAS_A_ACREDITAR');
        for (const t of d.transferencias) {
          const cb = cuentasBanco.get(t.cuentaBancariaId)!;
          const importe = new D(t.importe).toDecimalPlaces(2);
          const pesos = await aPesos(tx, cb.monedaCodigo, importe, d.fecha);
          await tx.transferenciaRecibida.create({
            data: { empresaId, ingresoId: ingreso.id, cuentaBancariaId: cb.id, fecha: t.fecha, referencia: t.referencia ?? null, monedaCodigo: cb.monedaCodigo, importe },
          });
          renglones.push({ cuentaContableId: cuentaTransf, debe: pesos.toFixed(2) });
          sumar(cb.monedaCodigo, importe, pesos);
        }
      }

      const totalPesos = [...porMoneda.values()].reduce((s, m) => s.plus(m.pesos), new D(0));
      renglones.push({ cuentaContableId: cuentaHaber, haber: totalPesos.toFixed(2) });
      if (terceroId)
        for (const [moneda, m] of porMoneda)
          await tx.movimientoCuentaCorriente.create({
            data: {
              empresaId, terceroId, origenTipo: 'COBRO', origenId: ingreso.id, fecha: d.fecha, fechaVencimiento: d.fecha, monedaCodigo: moneda,
              importe: m.importe.neg(), importePesos: m.pesos.neg(), saldo: m.importe.neg(), saldoPesos: m.pesos.neg(),
            },
          });

      const asiento = await this.asientos.generar(tx, {
        fecha: d.fecha, descripcion: `Ingreso de valores ${sucursal.codigo}-${String(numero).padStart(8, '0')} - ${d.concepto}`,
        origenTipo: 'INGRESO_VALORES', origenId: ingreso.id, renglones,
      });
      await tx.ingresoValores.update({ where: { id: ingreso.id }, data: { asientoId: asiento.id } });
      await this.auditoria.registrar(tx, { entidad: 'IngresoValores', entidadId: ingreso.id, accion: 'CREAR', datos: { numero, sucursal: sucursal.codigo } });
      return { ...(await this.obtener(ingreso.id, tx)), advertencias };
    });
  }

  anular(id: string, motivo: string) {
    return this.tenant.transaccion(async (tx) => {
      const empresaId = this.tenant.empresaId;
      const ing = await this.obtener(id, tx);
      if (ing.estado === 'ANULADO') throw new BadRequestException('El ingreso ya está anulado');
      const movsCc = await tx.movimientoCuentaCorriente.findMany({ where: { origenTipo: 'COBRO', origenId: id } });
      await bloquear(tx, 'MovimientoCuentaCorriente', empresaId, movsCc.map((m) => m.id));
      await bloquear(tx, 'Caja', empresaId, [ing.cajaId]);
      await bloquear(tx, 'ChequeTercero', empresaId, ing.cheques.map((c) => c.id));
      // El efectivo del ingreso tiene que seguir en la caja
      const efectivo = ing.efectivo.reduce((s, e) => s.plus(e.importe), new D(0));
      const sinEfectivo = efectivo.gt(0) && (await saldoCaja(tx, ing.cajaId)).lt(efectivo);
      const cheques = await tx.chequeTercero.findMany({ where: { ingresoId: id } });
      const transf = await tx.transferenciaRecibida.findMany({ where: { ingresoId: id } });
      const aplicaciones = await tx.aplicacionCuentaCorriente.count({ where: { movimientoId: { in: movsCc.map((m) => m.id) }, anulada: false } });
      if (cheques.some((c) => c.estado !== 'EN_CARTERA' || c.cajaId !== ing.cajaId) || transf.some((t) => t.estado !== 'PENDIENTE') || aplicaciones || sinEfectivo)
        throw new BadRequestException(YA_MOVIDOS);

      const fecha = hoy();
      const fechaAnulacion = fecha < ing.fecha ? ing.fecha : fecha;
      const contra = await this.asientos.contraasiento(tx, ing.asientoId!, fechaAnulacion, `Anulación del ingreso de valores ${ing.numero} - ${motivo}`);
      for (const c of cheques) await this.cartera.cambiarEstado(tx, c.id, 'ANULADO', { cajaId: null, claveAnulacion: c.id }, { tipo: 'ANULACION_INGRESO', id, fecha: fechaAnulacion });
      await tx.transferenciaRecibida.updateMany({ where: { ingresoId: id }, data: { estado: 'ANULADA' } });
      await anularMovimientos(tx, 'INGRESO', id);
      await tx.movimientoCuentaCorriente.updateMany({ where: { origenTipo: 'COBRO', origenId: id }, data: { anulado: true, saldo: 0, saldoPesos: 0 } });
      await tx.ingresoValores.update({ where: { id }, data: { estado: 'ANULADO', asientoAnulacionId: contra.id, motivoAnulacion: motivo } });
      await this.auditoria.registrar(tx, { entidad: 'IngresoValores', entidadId: id, accion: 'ANULAR', datos: { motivo, fecha: fechaAR(fechaAnulacion) } });
      return this.obtener(id, tx);
    });
  }
}
