import { Controller, Get } from '@nestjs/common';
import { Publico } from '../auth/publico.decorator';

@Controller('salud')
export class SaludController {
  @Publico()
  @Get()
  salud() {
    return { ok: true };
  }
}
