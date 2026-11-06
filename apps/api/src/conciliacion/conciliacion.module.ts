import { Module } from '@nestjs/common';
import { FormatosController } from './formatos.controller';
import { FormatosService } from './formatos.service';

@Module({
  controllers: [FormatosController],
  providers: [FormatosService],
})
export class ConciliacionModule {}
