import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { zPassword, zTexto } from '../comun/esquemas';
import { ZodValidationPipe } from '../comun/zod.pipe';
import { UsuariosService } from './usuarios.service';

const esquemaAlta = z.object({
  email: z.string().trim().toLowerCase().email('Email inválido'),
  nombre: zTexto,
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
  rolId: z.string().uuid('Rol inválido'),
});
const esquemaModificacion = z.object({
  rolId: z.string().uuid('Rol inválido').optional(),
  activo: z.boolean().optional(),
  password: zPassword.nullish(),
});

@Controller('usuarios')
@RequierePermiso('usuario.administrar')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  listar() {
    return this.usuarios.listar();
  }

  @Post()
  crear(@Body(new ZodValidationPipe(esquemaAlta)) d: z.infer<typeof esquemaAlta>) {
    return this.usuarios.crear(d);
  }

  @Patch(':id')
  modificar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(esquemaModificacion)) d: z.infer<typeof esquemaModificacion>,
  ) {
    return this.usuarios.modificar(id, d);
  }
}
