import { BadRequestException } from '@nestjs/common';
import type { TxEmpresa } from '../prisma/tenant-prisma.service';

type Modelo = 'deposito' | 'articulo' | 'centroCosto' | 'comprobanteCompra' | 'listaPrecios';
const NOMBRE: Record<Modelo, string> = { deposito: 'Depósito', articulo: 'Artículo', centroCosto: 'Centro de costo', comprobanteCompra: 'Comprobante asociado', listaPrecios: 'Lista de precios' };

/**
 * Identificadores recibidos que tienen que ser de la empresa activa (E36): el cliente por empresa filtra la búsqueda,
 * así que un id de otra empresa no aparece y se responde 400 `<Cosa> inexistente` en vez de crear un dato inconsistente.
 */
export async function verificarDeEmpresa(tx: TxEmpresa, refs: [Modelo, string | null | undefined][]): Promise<void> {
  for (const [modelo, id] of refs) {
    if (!id) continue;
    const delegado = tx[modelo] as unknown as { findUnique: (a: { where: { id: string }; select: { id: true } }) => Promise<unknown> };
    if (!(await delegado.findUnique({ where: { id }, select: { id: true } }))) throw new BadRequestException(`${NOMBRE[modelo]} inexistente`);
  }
}
