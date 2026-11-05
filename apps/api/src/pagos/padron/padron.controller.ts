import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { tmpdir } from 'os';
import { SoloSuperadmin } from '../../auth/requiere-permiso.decorator';
import { UsuarioActual } from '../../auth/usuario-actual.decorator';
import { ContextoRequest } from '../../contexto/contexto';
import { PadronService } from './padron.service';

/** El padrón es común a todas las empresas: solo lo administra el administrador general. */
@Controller('padrones')
@SoloSuperadmin()
export class PadronController {
  constructor(private readonly padron: PadronService) {}

  @Post()
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('archivo', { dest: tmpdir(), limits: { fileSize: 2 * 1024 * 1024 * 1024 } }))
  cargar(@UploadedFile() archivo: { originalname: string; path: string } | undefined, @Body('jurisdiccion') jurisdiccion: string, @UsuarioActual() ctx: ContextoRequest) {
    if (!archivo) throw new BadRequestException('Falta el archivo del padrón');
    return this.padron.cargar(String(jurisdiccion ?? ''), archivo.originalname, archivo.path, ctx.usuarioId);
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
