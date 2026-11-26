import { Body, Controller, Get, Injectable, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { conUnicidad } from '../comun/errores';
import { zCuit, zTexto } from '../comun/esquemas';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { TenantPrisma } from '../prisma/tenant-prisma.service';

const DUP = 'Ya existe un transportista con ese CUIT';
const zPatente = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,7}$/, 'Patente inválida');
const esquema = z.object({ cuit: zCuit, razonSocial: zTexto, patentePorDefecto: zPatente.nullish(), activo: z.boolean().optional() });
type Datos = z.infer<typeof esquema>;

/** E57: transportistas para el COT de ARBA. */
@Injectable()
export class TransportistasService {
  constructor(private readonly tenant: TenantPrisma, private readonly auditoria: AuditoriaService) {}
  listar() {
    return this.tenant.db.transportista.findMany({ orderBy: { razonSocial: 'asc' } });
  }
  crear(d: Datos) {
    return conUnicidad(DUP, () => this.tenant.transaccion(async (tx) => {
      const t = await tx.transportista.create({ data: { ...d, empresaId: this.tenant.empresaId } });
      await this.auditoria.registrar(tx, { entidad: 'Transportista', entidadId: t.id, accion: 'CREAR', datos: d });
      return t;
    }));
  }
  modificar(id: string, d: Partial<Datos>) {
    return conUnicidad(DUP, () => this.tenant.transaccion(async (tx) => {
      const t = await tx.transportista.update({ where: { id }, data: d });
      await this.auditoria.registrar(tx, { entidad: 'Transportista', entidadId: id, accion: 'MODIFICAR', datos: d });
      return t;
    }));
  }
}

@Controller('transportistas')
export class TransportistasController {
  constructor(private readonly s: TransportistasService) {}
  @Get() @RequierePermiso('tercero.ver')
  listar() { return this.s.listar(); }
  @Post() @RequierePermiso('tercero.editar')
  crear(@Body(new ZodValidationPipe(esquema)) d: Datos) { return this.s.crear(d); }
  @Patch(':id') @RequierePermiso('tercero.editar')
  modificar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquema.partial())) d: Partial<Datos>) { return this.s.modificar(id, d); }
}
