import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../../auth/usuario-actual.decorator';
import { ContextoRequest } from '../../contexto/contexto';
import { PadronService } from './padron.service';

@Controller('padrones')
@RequierePermiso('padron.cargar')
export class PadronController {
  constructor(private readonly padron: PadronService) {}

  @Post()
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: 600 * 1024 * 1024 } }))
  cargar(@UploadedFile() archivo: { originalname: string; buffer: Buffer } | undefined, @Body('jurisdiccion') jurisdiccion: string, @UsuarioActual() ctx: ContextoRequest) {
    if (!archivo) throw new BadRequestException('Falta el archivo del padrón');
    return this.padron.cargar(String(jurisdiccion ?? ''), archivo.originalname, archivo.buffer, ctx.usuarioId);
  }

  @Get()
  listar() {
    return this.padron.listar();
  }

  @Get(':id')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.padron.obtener(id);
  }
}
