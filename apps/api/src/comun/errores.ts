import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Ejecuta fn y convierte un error de unicidad (P2002) en 409 con el mensaje indicado. */
export async function conUnicidad<T>(mensaje: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
      throw new ConflictException(mensaje);
    throw e;
  }
}
