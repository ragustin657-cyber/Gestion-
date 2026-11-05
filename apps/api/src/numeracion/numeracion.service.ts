import { Injectable } from '@nestjs/common';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';

@Injectable()
export class NumeracionService {
  constructor(private readonly tenant: TenantPrisma) {}

  /**
   * Próximo número del talonario (lo crea si no existe). Atómico: el UPSERT bloquea la fila
   * hasta que termina la transacción recibida, así dos operaciones nunca obtienen el mismo número.
   */
  async siguiente(tx: TxEmpresa, tipoComprobante: string, puntoVenta: number): Promise<number> {
    const empresaId = this.tenant.empresaId;
    const filas = await tx.$queryRaw<{ ultimoNumero: number }[]>`
      INSERT INTO "Talonario" ("id", "empresaId", "tipoComprobante", "puntoVenta", "ultimoNumero")
      VALUES (gen_random_uuid(), ${empresaId}::uuid, ${tipoComprobante}, ${puntoVenta}, 1)
      ON CONFLICT ("empresaId", "tipoComprobante", "puntoVenta")
      DO UPDATE SET "ultimoNumero" = "Talonario"."ultimoNumero" + 1
      RETURNING "ultimoNumero"`;
    return filas[0].ultimoNumero;
  }
}
