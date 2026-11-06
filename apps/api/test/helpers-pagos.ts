import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { datosCompras, sesionConPlan } from './helpers';

/** Empresa con plan, proveedor, cuenta bancaria ARS, chequeras (e-cheq y física 1-50), caja USD y helpers de OP. */
export async function prepararPagos(app: INestApplication, prisma: PrismaService, o: { regimen?: string; iibb?: number } = {}) {
  const s = await sesionConPlan(app, prisma);
  const { proveedorId } = await datosCompras(prisma, s.empresaId);
  await prisma.empresa.update({ where: { id: s.empresaId }, data: { montoAprobacionOp: 1e12, jurisdiccionesIibb: o.iibb ? ['902'] : [] } });
  if (o.regimen) await prisma.tercero.update({ where: { id: proveedorId }, data: { regimenGanancias: o.regimen } });
  if (o.iibb) await prisma.terceroIibb.create({ data: { empresaId: s.empresaId, terceroId: proveedorId, jurisdiccion: '902', alicuotaPercepcion: 0, alicuotaRetencion: o.iibb } });
  const banco = (await s.http.post('/api/tesoreria/bancos', { nombre: 'Banco Nación' })).body;
  const cuentaBanco = await s.cuenta('1.1.01.002');
  const ars = (await s.http.post('/api/tesoreria/cuentas-bancarias', { bancoId: banco.id, numero: '1', monedaCodigo: 'ARS', cuentaContableId: cuentaBanco })).body;
  const echeq = (await s.http.post('/api/tesoreria/chequeras', { cuentaBancariaId: ars.id, tipo: 'ECHEQ' })).body;
  const fisica = (await s.http.post('/api/tesoreria/chequeras', { cuentaBancariaId: ars.id, tipo: 'FISICA', desde: 1, hasta: 50 })).body;
  const cajaUsd = (await s.http.post('/api/tesoreria/cajas', { nombre: 'Caja USD', monedaCodigo: 'USD', cuentaContableId: await s.cuenta('1.1.01.001') })).body;
  // Saldo inicial de la caja USD para los pagos en efectivo
  await prisma.movimientoTesoreria.create({
    data: { empresaId: s.empresaId, fecha: new Date('2026-11-01T00:00:00Z'), tipo: 'INGRESO', cajaId: cajaUsd.id, monedaCodigo: 'USD', importe: 10000, origenTipo: 'SALDO_INICIAL', origenId: cajaUsd.id },
  });
  const opAprobada = async (imputaciones: object[], extra: Record<string, unknown> = {}) => {
    const b = await s.http.post('/api/pagos/ordenes', { terceroId: proveedorId, fecha: '2026-11-10', imputaciones, ...extra });
    if (b.status !== 201) throw new Error(JSON.stringify(b.body));
    const c = await s.http.post(`/api/pagos/ordenes/${b.body.id}/confirmar`, { version: b.body.version });
    if (c.body.estado !== 'APROBADA') throw new Error(JSON.stringify(c.body));
    return c.body as { id: string; version: number; netoPagar: string; totalCancelarPesos: string };
  };
  const pagar = (op: { id: string; version: number }, medios: object[], fechaPago = '2026-11-15', http = s.http) =>
    http.post(`/api/pagos/ordenes/${op.id}/pagar`, { version: op.version, fechaPago, medios });
  const asiento = async (asientoId: string) => {
    const a = await prisma.asiento.findUniqueOrThrow({ where: { id: asientoId }, include: { renglones: true } });
    const r: Record<string, [string, string]> = {};
    for (const x of a.renglones) r[(await prisma.cuentaContable.findUniqueOrThrow({ where: { id: x.cuentaContableId } })).codigo] = [x.debe.toString(), x.haber.toString()];
    return r;
  };
  return { ...s, proveedorId, ars, echeq, fisica, cajaUsd, opAprobada, pagar, asiento };
}
