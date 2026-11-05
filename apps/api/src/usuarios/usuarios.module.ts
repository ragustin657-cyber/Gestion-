import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';

@Module({ controllers: [RolesController, UsuariosController], providers: [RolesService, UsuariosService] })
export class UsuariosModule {}
