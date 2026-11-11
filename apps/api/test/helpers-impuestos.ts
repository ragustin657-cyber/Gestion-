import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { datosCompras, facturaPendiente } from './helpers';
import { prepararVentas } from './helpers-ventas';

/**
 * Ventas de noviembre: FC A (1.000 al 21% + 500 al 10,5%), FC B a consumidor final (1.000 al 21%),
 * NC A exenta por 100 sobre la FC A y una FC en USD exenta por 100 a cotización 1000. Y una compra A de neto 1.000.
 */
export async function periodoConMovimientos(app: INestApplication, prisma: PrismaService) {
  const v = await prepararVentas(app, prisma);
  const fcA = await v.factura({ fecha: '2026-11-02', renglones: [{ descripcion: 'Uno', cantidad: 1, precioUnitario: 1000, alicuota: 21 }, { descripcion: 'Dos', cantidad: 1, precioUnitario: 500, alicuota: 10.5 }] });
  const fcB = await v.factura({ fecha: '2026-11-03', terceroId: v.clienteCF.id });
  const nc = await v.factura({ fecha: '2026-11-04', tipo: 'NOTA_CREDITO', comprobanteAsociadoId: fcA.id, aplicarAAsociado: false, renglones: [{ descripcion: 'Ajuste', cantidad: 1, precioUnitario: 100, alicuota: 'EXENTO' }] });
  const usd = await v.factura({ fecha: '2026-11-05', monedaCodigo: 'USD', cotizacion: 1000, renglones: [{ descripcion: 'Servicio', cantidad: 1, precioUnitario: 100, alicuota: 'EXENTO' }] });
  const { proveedorId } = await datosCompras(prisma, v.empresaId);
  const compra = await facturaPendiente(v.http, prisma, { proveedorId, neto: 1000 });
  return { v, fcA, fcB, nc, usd, proveedorId, compra };
}
