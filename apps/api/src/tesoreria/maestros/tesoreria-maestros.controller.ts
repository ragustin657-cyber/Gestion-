import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { PlanCuentasService } from '../../contabilidad/plan-cuentas/plan-cuentas.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { AlcanceSucursalService } from '../sucursales/alcance.service';
import { SucursalesService } from '../sucursales/sucursales.service';
import {
  esquemaBanco, esquemaCaja, esquemaChequera, esquemaChequeraMod, esquemaCuentaBancaria,
} from './dto';

type Banco = z.infer<typeof esquemaBanco>;
type CuentaB = z.infer<typeof esquemaCuentaBancaria>;
type Chequera = z.infer<typeof esquemaChequera>;
type Caja = z.infer<typeof esquemaCaja>;

@Controller('tesoreria')
@RequierePermiso('tesoreria.maestros.editar')
export class TesoreriaMaestrosController {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly auditoria: AuditoriaService,
    private readonly plan: PlanCuentasService,
    private readonly sucursales: SucursalesService,
    private readonly alcance: AlcanceSucursalService,
  ) {}

  /** Ejecuta la escritura y la auditoría en una transacción. */
  private escribir<T extends { id: string }>(entidad: string, accion: 'CREAR' | 'MODIFICAR', datos: unknown, fn: (tx: TxEmpresa) => Promise<T>) {
    return this.tenant.transaccion(async (tx) => {
      const r = await fn(tx);
      await this.auditoria.registrar(tx, { entidad, entidadId: r.id, accion, datos });
      return r;
    });
  }

  // Bancos
  @Get('bancos') @RequierePermiso()
  bancos() {
    return this.tenant.db.banco.findMany({ orderBy: { nombre: 'asc' } });
  }

  @Post('bancos')
  crearBanco(@Body(new ZodValidationPipe(esquemaBanco)) d: Banco) {
    return this.escribir('Banco', 'CREAR', d, (tx) => tx.banco.create({ data: { ...d, empresaId: this.tenant.empresaId } }));
  }

  @Patch('bancos/:id')
  modificarBanco(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaBanco.partial())) d: Partial<Banco>) {
    return this.escribir('Banco', 'MODIFICAR', d, (tx) => tx.banco.update({ where: { id }, data: d }));
  }

  // Cuentas bancarias
  @Get('cuentas-bancarias') @RequierePermiso()
  cuentas() {
    return this.tenant.db.cuentaBancaria.findMany({ include: { banco: true }, orderBy: { numero: 'asc' } });
  }

  private async validarCuentaBancaria(tx: TxEmpresa, d: Partial<CuentaB>) {
    if (d.bancoId && !(await tx.banco.findUnique({ where: { id: d.bancoId } })))
      throw new NotFoundException('Banco no encontrado');
    if (d.cuentaContableId) await this.plan.verificarImputable(tx, d.cuentaContableId, 'cuentaContableId');
  }

  @Post('cuentas-bancarias')
  crearCuenta(@Body(new ZodValidationPipe(esquemaCuentaBancaria)) d: CuentaB) {
    return this.escribir('CuentaBancaria', 'CREAR', d, async (tx) => {
      await this.validarCuentaBancaria(tx, d);
      return tx.cuentaBancaria.create({ data: { ...d, cbu: d.cbu || null, empresaId: this.tenant.empresaId } });
    });
  }

  @Patch('cuentas-bancarias/:id')
  modificarCuenta(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaCuentaBancaria.partial())) d: Partial<CuentaB>) {
    return this.escribir('CuentaBancaria', 'MODIFICAR', d, async (tx) => {
      await this.validarCuentaBancaria(tx, d);
      return tx.cuentaBancaria.update({ where: { id }, data: { ...d, cbu: d.cbu === '' ? null : d.cbu } });
    });
  }

  // Chequeras
  @Get('chequeras') @RequierePermiso()
  chequeras() {
    return this.tenant.db.chequera.findMany({ include: { cuentaBancaria: { include: { banco: true } } } });
  }

  @Post('chequeras')
  crearChequera(@Body(new ZodValidationPipe(esquemaChequera)) d: Chequera) {
    return this.escribir('Chequera', 'CREAR', d, async (tx) => {
      if (!(await tx.cuentaBancaria.findUnique({ where: { id: d.cuentaBancariaId } })))
        throw new NotFoundException('Cuenta bancaria no encontrada');
      return tx.chequera.create({
        data: { ...d, empresaId: this.tenant.empresaId, proximoNumero: d.tipo === 'FISICA' ? d.desde : null },
      });
    });
  }

  @Patch('chequeras/:id')
  modificarChequera(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaChequeraMod)) d: z.infer<typeof esquemaChequeraMod>) {
    return this.escribir('Chequera', 'MODIFICAR', d, (tx) => tx.chequera.update({ where: { id }, data: d }));
  }

  // Cajas
  @Get('cajas') @RequierePermiso()
  cajas() {
    return this.tenant.db.caja.findMany({ where: this.alcance.filtroCajas(), include: { sucursal: true }, orderBy: { nombre: 'asc' } });
  }

  /** Cajas activas de todas las sucursales, sin datos contables: destinos posibles de un traslado. */
  @Get('cajas/destinos') @RequierePermiso()
  async destinos() {
    const cajas = await this.tenant.db.caja.findMany({ where: { activa: true }, include: { sucursal: true }, orderBy: { nombre: 'asc' } });
    return cajas.map((c) => ({ id: c.id, nombre: c.nombre, monedaCodigo: c.monedaCodigo, sucursalId: c.sucursalId, sucursal: c.sucursal.nombre }));
  }

  @Post('cajas')
  crearCaja(@Body(new ZodValidationPipe(esquemaCaja)) d: Caja) {
    return this.escribir('Caja', 'CREAR', d, async (tx) => {
      await this.plan.verificarImputable(tx, d.cuentaContableId, 'cuentaContableId');
      const sucursalId = d.sucursalId ? (await this.sucursales.verificar(tx, d.sucursalId)).id : (await this.sucursales.central(tx)).id;
      return tx.caja.create({ data: { ...d, sucursalId, empresaId: this.tenant.empresaId } });
    });
  }

  @Patch('cajas/:id')
  modificarCaja(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaCaja.partial())) d: Partial<Caja>) {
    return this.escribir('Caja', 'MODIFICAR', d, async (tx) => {
      if (d.cuentaContableId) await this.plan.verificarImputable(tx, d.cuentaContableId, 'cuentaContableId');
      if (d.sucursalId) await this.sucursales.verificar(tx, d.sucursalId);
      const { sucursalId, ...resto } = d;
      return tx.caja.update({ where: { id }, data: { ...resto, ...(sucursalId ? { sucursalId } : {}) } });
    });
  }
}
