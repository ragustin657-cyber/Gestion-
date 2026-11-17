import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { DatosVendedor } from './dto';

/** Maestro de vendedores (spec E24 §3). */
@Injectable()
export class VendedoresService {
  constructor(private readonly tenant: TenantPrisma) {}

  async listar() {
    const vs = await this.tenant.db.vendedor.findMany({ orderBy: { nombre: 'asc' } });
    const empleados = new Map((await this.tenant.db.empleado.findMany({ where: { id: { in: vs.flatMap((v) => (v.empleadoId ? [v.empleadoId] : [])) } } })).map((e) => [e.id, `${e.apellido}, ${e.nombre}`]));
    const proveedores = new Map((await this.tenant.db.tercero.findMany({ where: { id: { in: vs.flatMap((v) => (v.proveedorId ? [v.proveedorId] : [])) } } })).map((t) => [t.id, t.razonSocial]));
    return vs.map((v) => ({
      ...v, porcentaje: v.porcentaje.toFixed(2),
      empleado: v.empleadoId ? empleados.get(v.empleadoId) ?? null : null, proveedor: v.proveedorId ? proveedores.get(v.proveedorId) ?? null : null,
    }));
  }

  private async validar(tx: TxEmpresa, d: DatosVendedor, id?: string) {
    const otro = { id: id ? { not: id } : undefined };
    if (await tx.vendedor.findFirst({ where: { nombre: d.nombre, ...otro } })) throw new BadRequestException(`Ya existe el vendedor ${d.nombre}`);
    if (d.tipo === 'EMPLEADO') {
      if (!d.empleadoId) throw new BadRequestException('Elija el empleado del vendedor');
      if (!(await tx.empleado.findUnique({ where: { id: d.empleadoId } }))) throw new BadRequestException('Empleado inexistente');
      if (await tx.vendedor.findFirst({ where: { empleadoId: d.empleadoId, ...otro } })) throw new BadRequestException('El empleado ya es vendedor');
      return { empleadoId: d.empleadoId, proveedorId: null };
    }
    if (!d.proveedorId) throw new BadRequestException('Elija el proveedor del vendedor');
    const t = await tx.tercero.findUnique({ where: { id: d.proveedorId } });
    if (!t) throw new BadRequestException('Proveedor inexistente');
    if (!t.esProveedor) throw new BadRequestException('El tercero no es proveedor');
    if (await tx.vendedor.findFirst({ where: { proveedorId: d.proveedorId, ...otro } })) throw new BadRequestException('El proveedor ya es vendedor');
    return { empleadoId: null, proveedorId: d.proveedorId };
  }

  crear(d: DatosVendedor) {
    return this.tenant.transaccion(async (tx) => {
      const vinculo = await this.validar(tx, d);
      return this.guardado(() => tx.vendedor.create({ data: { empresaId: this.tenant.empresaId, nombre: d.nombre, tipo: d.tipo, porcentaje: d.porcentaje, activo: d.activo ?? true, ...vinculo } }));
    });
  }

  modificar(id: string, d: DatosVendedor) {
    return this.tenant.transaccion(async (tx) => {
      if (!(await tx.vendedor.findUnique({ where: { id } }))) throw new NotFoundException('Vendedor inexistente');
      const vinculo = await this.validar(tx, d, id);
      return this.guardado(() => tx.vendedor.update({ where: { id }, data: { nombre: d.nombre, tipo: d.tipo, porcentaje: d.porcentaje, activo: d.activo ?? true, ...vinculo } }));
    });
  }

  /** Dos altas simultáneas chocan con los índices únicos: 400 en vez de 500. */
  private async guardado<T>(f: () => Promise<T>) {
    try {
      return await f();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new BadRequestException('Ya existe un vendedor con esos datos');
      throw e;
    }
  }
}
