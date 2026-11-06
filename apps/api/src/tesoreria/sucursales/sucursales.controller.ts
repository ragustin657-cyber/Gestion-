import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { zTexto, zTextoOpcional } from '../../comun/esquemas';
import { ZodValidationPipe } from '../../comun/zod.pipe';
import { SucursalesService } from './sucursales.service';

const esquema = z.object({
  codigo: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,6}$/, 'Código inválido (hasta 6 letras o números)'),
  nombre: zTexto,
  domicilio: zTextoOpcional,
  esCentral: z.boolean().optional(),
  activa: z.boolean().optional(),
});
type Datos = z.infer<typeof esquema>;

@Controller('tesoreria/sucursales')
@RequierePermiso('tesoreria.maestros.editar')
export class SucursalesController {
  constructor(private readonly sucursales: SucursalesService) {}

  @Get() @RequierePermiso()
  listar() {
    return this.sucursales.listar();
  }

  @Post()
  crear(@Body(new ZodValidationPipe(esquema)) d: Datos) {
    return this.sucursales.crear(d);
  }

  @Patch(':id')
  modificar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(esquema.partial())) d: Partial<Datos>) {
    return this.sucursales.modificar(id, d);
  }
}
