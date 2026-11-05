import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/** Traduce errores conocidos de Prisma a respuestas HTTP en castellano. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(e: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (e.code === 'P2025')
      return res.status(404).json({ statusCode: 404, message: 'Registro no encontrado' });
    if (e.code === 'P2002')
      return res.status(409).json({ statusCode: 409, message: 'Ya existe un registro con esos datos' });
    if (e.code === 'P2003')
      return res.status(400).json({ statusCode: 400, message: 'Referencia a un registro inexistente' });
    return res.status(500).json({ statusCode: 500, message: 'Error interno' });
  }
}
