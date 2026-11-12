import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { datosCompras, sesionConPlan } from './helpers';

let numero = 5000;

/** Empresa con plan, proveedor y atajos para bienes de uso. */
export async function prepararBienes(app: INestApplication, prisma: PrismaService) {
  const s = await sesionConPlan(app, prisma);
  const { proveedorId } = await datosCompras(prisma, s.empresaId);
  const rubro = async (nombre: string) => (await prisma.rubroBienUso.findFirstOrThrow({ where: { empresaId: s.empresaId, nombre } }));
  const factura = (o: { neto: number; fecha?: string; cuenta?: string; bien?: object | null; moneda?: 'ARS' | 'USD'; cotizacion?: number }) =>
    s.cuenta(o.cuenta ?? '1.2.01.002').then((cuentaContableId) => s.http.post('/api/compras/comprobantes', {
      terceroId: proveedorId, tipo: 'FACTURA', letra: 'A', puntoVenta: 1, numero: ++numero,
      fechaEmision: o.fecha ?? '2026-03-15', fechaContable: o.fecha ?? '2026-03-15', monedaCodigo: o.moneda ?? 'ARS', cotizacion: o.cotizacion ?? null,
      totalDeclarado: Math.round(o.neto * 121) / 100,
      renglones: [{ origen: 'DIRECTO', descripcion: 'Bien', cantidad: 1, precioUnitario: o.neto, alicuotaIva: 21, cuentaContableId, ...(o.bien === null ? {} : { bien: o.bien ?? { descripcion: 'Camioneta' } }) }],
    }));
  const facturaBien = async (o: { neto: number; fecha?: string; cuenta?: string; bien?: object; moneda?: 'ARS' | 'USD'; cotizacion?: number }) => {
    const r = await factura(o);
    if (r.status !== 201) throw new Error(`factura: ${JSON.stringify(r.body)}`);
    const bien = await prisma.bienUso.findFirstOrThrow({ where: { empresaId: s.empresaId, comprobanteCompraRenglonId: r.body.renglones[0].id } });
    return { comprobanteId: r.body.id as string, bien };
  };
  const generar = async (mes: string) => {
    const r = await s.http.post('/api/bienes-uso/amortizacion', { mes });
    if (r.status !== 201) throw new Error(`amortización ${mes}: ${JSON.stringify(r.body)}`);
    return r.body;
  };
  /** Saldo deudor − acreedor de una cuenta (todos los asientos o hasta una fecha). */
  const saldo = async (codigo: string, hasta?: string) => {
    const rs = await prisma.asientoRenglon.findMany({ where: { empresaId: s.empresaId, cuentaContableId: await s.cuenta(codigo), ...(hasta ? { asiento: { fecha: { lte: new Date(`${hasta}T00:00:00Z`) } } } : {}) } });
    return rs.reduce((t, r) => t + Number(r.debe) - Number(r.haber), 0).toFixed(2);
  };
  return { ...s, proveedorId, rubro, factura, facturaBien, generar, saldo };
}
