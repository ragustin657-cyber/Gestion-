import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { sesionConPlan } from './helpers';

/** Empresa RI con plan, punto de venta 1 electrónico, un cliente RI y un consumidor final. */
export async function prepararVentas(app: INestApplication, prisma: PrismaService) {
  const s = await sesionConPlan(app, prisma);
  const puntoVenta = (await s.http.post('/api/empresas/actual/puntos-venta', { numero: 1, descripcion: 'Electrónico' })).body as { id: string; numero: number };
  const alta = async (d: object) => {
    const r = await s.http.post('/api/terceros', { esCliente: true, ...d });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    return r.body as { id: string };
  };
  const clienteRI = await alta({ razonSocial: 'Distribuidora Norte SA', cuit: '20-17254359-7', condicionIva: 'RESPONSABLE_INSCRIPTO', diasPago: 30 });
  const clienteCF = await alta({ razonSocial: 'Consumidor Final', cuit: 'Consumidor final', tipoDocumento: 'OTRO', condicionIva: 'CONSUMIDOR_FINAL' });
  const datos = (o: Record<string, unknown> = {}) => ({
    terceroId: clienteRI.id, puntoVentaId: puntoVenta.id, tipo: 'FACTURA', concepto: 'PRODUCTOS', fecha: '2026-11-02', fechaVencimiento: '2026-12-02', monedaCodigo: 'ARS',
    renglones: [{ descripcion: 'Producto', cantidad: 1, precioUnitario: 1000, alicuota: 21 }], ...o,
  });
  /** Crea y emite una factura (por defecto A, 1.000 + 21 %) y devuelve el comprobante. */
  const factura = async (o: Record<string, unknown> = {}) => {
    const r = await s.http.post('/api/ventas/comprobantes', { ...datos(o), emitir: true });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    return r.body as { id: string; numero: number; total: string; version: number; estado: string; cae: string };
  };
  const sucursal = (await s.http.get('/api/tesoreria/sucursales')).body[0] as { id: string };
  const caja = (await s.http.post('/api/tesoreria/cajas', { nombre: 'Caja central', monedaCodigo: 'ARS', cuentaContableId: await s.cuenta('1.1.01.001'), sucursalId: sucursal.id })).body as { id: string };
  /** Cobro en efectivo registrado en Tesorería (ingreso de valores de cliente): queda como saldo a favor. */
  const cobro = async (importe: number, fecha = '2026-11-03', terceroId = clienteRI.id) => {
    const r = await s.http.post('/api/tesoreria/ingresos', { fecha, cajaId: caja.id, origen: 'CLIENTE', terceroId, concepto: 'Cobro', efectivo: { importe } });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    const mov = await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenTipo: 'COBRO', origenId: r.body.id } });
    return { ingreso: r.body as { id: string }, mov };
  };
  const cotizacionUsd = (fecha: string, valor: number) =>
    prisma.cotizacion.upsert({
      where: { empresaId_monedaCodigo_fecha: { empresaId: s.empresaId, monedaCodigo: 'USD', fecha: new Date(`${fecha}T00:00:00Z`) } },
      create: { empresaId: s.empresaId, monedaCodigo: 'USD', fecha: new Date(`${fecha}T00:00:00Z`), valor }, update: { valor },
    });
  const movDe = (origenId: string) => prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenId } });
  return { ...s, puntoVenta, clienteRI, clienteCF, datos, factura, sucursal, caja, cobro, cotizacionUsd, movDe };
}
