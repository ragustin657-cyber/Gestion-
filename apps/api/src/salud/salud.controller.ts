import { Controller, Get } from '@nestjs/common';

@Controller('salud')
export class SaludController {
  @Get()
  salud() {
    return { ok: true };
  }
}
