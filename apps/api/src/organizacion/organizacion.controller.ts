import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { zTexto, zTextoOpcional } from '../comun/esquemas';
import { conUnicidad } from '../comun/errores';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { TenantPrisma } from '../prisma/tenant-prisma.service';

const esquemaCentro = z.object({ codigo: zTexto, nombre: zTexto, activo: z.boolean().optional() });
const esquemaDeposito = esquemaCentro.extend({ direccion: zTextoOpcional });
const DUP = 'Ya existe un registro con ese código';

@Controller()
@RequierePermiso('organizacion.editar')
export class OrganizacionController {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Get('centros-costo')
  @RequierePermiso()
  centros() {
    return this.tenant.db.centroCosto.findMany({ orderBy: { codigo: 'asc' } });
  }

  @Post('centros-costo')
  crearCentro(@Body(new ZodValidationPipe(esquemaCentro)) d: z.infer<typeof esquemaCentro>) {
    return conUnicidad(DUP, () =>
      this.tenant.transaccion(async (tx) => {
        const c = await tx.centroCosto.create({ data: { ...d, empresaId: this.tenant.empresaId } });
        await this.auditoria.registrar(tx, { entidad: 'CentroCosto', entidadId: c.id, accion: 'CREAR', datos: d });
        return c;
      }),
    );
  }

  @Patch('centros-costo/:id')
  modificarCentro(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaCentro.partial())) d: Partial<z.infer<typeof esquemaCentro>>) {
    return conUnicidad(DUP, () =>
      this.tenant.transaccion(async (tx) => {
        const c = await tx.centroCosto.update({ where: { id }, data: d });
        await this.auditoria.registrar(tx, { entidad: 'CentroCosto', entidadId: id, accion: 'MODIFICAR', datos: d });
        return c;
      }),
    );
  }

  @Get('depositos')
  @RequierePermiso()
  depositos() {
    return this.tenant.db.deposito.findMany({ orderBy: { codigo: 'asc' } });
  }

  @Post('depositos')
  crearDeposito(@Body(new ZodValidationPipe(esquemaDeposito)) d: z.infer<typeof esquemaDeposito>) {
    return conUnicidad(DUP, () =>
      this.tenant.transaccion(async (tx) => {
        const c = await tx.deposito.create({ data: { ...d, empresaId: this.tenant.empresaId } });
        await this.auditoria.registrar(tx, { entidad: 'Deposito', entidadId: c.id, accion: 'CREAR', datos: d });
        return c;
      }),
    );
  }

  @Patch('depositos/:id')
  modificarDeposito(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquemaDeposito.partial())) d: Partial<z.infer<typeof esquemaDeposito>>) {
    return conUnicidad(DUP, () =>
      this.tenant.transaccion(async (tx) => {
        const c = await tx.deposito.update({ where: { id }, data: d });
        await this.auditoria.registrar(tx, { entidad: 'Deposito', entidadId: id, accion: 'MODIFICAR', datos: d });
        return c;
      }),
    );
  }
}
