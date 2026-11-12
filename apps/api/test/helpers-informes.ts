import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { prepararPedidos } from './helpers-pedidos';

/** El ejemplo de la entrega 13 (§2): ventas en pesos y en dólares, remito facturado, servicio sin costo y NC con devolución. */
export async function escenarioInformes(app: INestApplication, prisma: PrismaService) {
  const e = await prepararPedidos(app, prisma);
  const a = await e.articulo();
  await e.inicial(a.id, 100, 10, { fecha: '2026-11-02' });
  const s = await prisma.articulo.create({ data: { empresaId: e.empresaId, codigo: 'SRV', descripcion: 'Servicio', alicuotaIva: 21, esServicio: true } });
  const y = (await e.http.post('/api/terceros', { esCliente: true, razonSocial: 'Cliente Y SA', cuit: '30-71999888-3', condicionIva: 'RESPONSABLE_INSCRIPTO', diasPago: 30 })).body as { id: string };
  const ren = (articuloId: string, cantidad: number, precioUnitario: number, o: Record<string, unknown> = {}) => ({ articuloId, descripcion: 'x', cantidad, precioUnitario, alicuota: 21, ...o });
  const emitir = async (o: Record<string, unknown>) => {
    const r = await e.http.post('/api/ventas/comprobantes', { ...e.datos({ fecha: '2026-11-03', fechaVencimiento: '2026-12-03', ...o }), emitir: true });
    if (r.body.estado !== 'AUTORIZADO') throw new Error(JSON.stringify(r.body));
    return r.body as { id: string };
  };
  const f1 = await emitir({ renglones: [ren(a.id, 10, 20)] });
  await emitir({ terceroId: y.id, monedaCodigo: 'USD', cotizacion: 1000, renglones: [ren(a.id, 5, 0.04)] });
  const rem = (await e.remito([{ articuloId: a.id, descripcion: 'x', cantidad: 20 }])).body as { renglones: { id: string }[] };
  await emitir({ renglones: [ren(a.id, 20, 20, { origen: 'REMITO', remitoRenglonId: rem.renglones[0].id })] });
  await emitir({ terceroId: y.id, renglones: [ren(s.id, 1, 300)] });
  await emitir({ tipo: 'NOTA_CREDITO', comprobanteAsociadoId: f1.id, devuelveMercaderia: true, renglones: [ren(a.id, 2, 20)] });
  return { ...e, a, s, y, ren, emitir };
}
