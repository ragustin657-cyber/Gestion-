import { Module } from '@nestjs/common';
import { TesoreriaMaestrosController } from './tesoreria-maestros.controller';

@Module({ controllers: [TesoreriaMaestrosController] })
export class TesoreriaMaestrosModule {}
