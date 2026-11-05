import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { zPermisos, zTexto } from '../comun/esquemas';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { RolesService } from './roles.service';

const esquemaRol = z.object({ nombre: zTexto, permisos: zPermisos });

@Controller('roles')
@RequierePermiso('rol.administrar')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  listar() {
    return this.roles.listar();
  }

  @Post()
  crear(@Body(new ZodValidationPipe(esquemaRol)) d: z.infer<typeof esquemaRol>) {
    return this.roles.crear(d);
  }

  @Patch(':id')
  modificar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(esquemaRol.partial())) d: Partial<z.infer<typeof esquemaRol>>,
  ) {
    return this.roles.modificar(id, d);
  }
}
