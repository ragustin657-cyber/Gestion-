import { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import type { Permiso } from '@gestion/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { conToken, datosCompras, loginComo, sesionConPlan } from './helpers';

let n = 0;

/**
 * Empresa con plan, sucursal ROS, cajas ARS en CEN y ROS y USD en CEN, cuentas bancarias ARS y USD,
 * cliente, proveedor, cotización USD 1000 y un usuario de ROS con tesoreria.ver/operar.
 */
export async function prepararTesoreria(app: INestApplication, prisma: PrismaService, permisosRos: Permiso[] = ['tesoreria.ver', 'tesoreria.operar']) {
  const s = await sesionConPlan(app, prisma);
  const { proveedorId } = await datosCompras(prisma, s.empresaId);
  const cliente = await prisma.tercero.create({
    data: { empresaId: s.empresaId, codigo: 100, razonSocial: 'Cliente SA', cuit: '30500010912', condicionIva: 'RESPONSABLE_INSCRIPTO', esCliente: true },
  });
  const sucursales = (await s.http.get('/api/tesoreria/sucursales')).body;
  const cen = sucursales[0];
  const ros = (await s.http.post('/api/tesoreria/sucursales', { codigo: 'ROS', nombre: 'Sucursal Rosario' })).body;
  const cuentaCaja = await s.cuenta('1.1.01.001');
  const cuentaBanco = await s.cuenta('1.1.01.002');
  const crearCaja = async (nombre: string, monedaCodigo: string, sucursalId: string) =>
    (await s.http.post('/api/tesoreria/cajas', { nombre, monedaCodigo, cuentaContableId: cuentaCaja, sucursalId })).body;
  const cajaCen = await crearCaja('Caja central', 'ARS', cen.id);
  const cajaRos = await crearCaja('Caja Rosario', 'ARS', ros.id);
  const cajaUsd = await crearCaja('Caja dólares', 'USD', cen.id);
  const banco = (await s.http.post('/api/tesoreria/bancos', { nombre: 'Banco Nación' })).body;
  const ars = (await s.http.post('/api/tesoreria/cuentas-bancarias', { bancoId: banco.id, numero: '1', monedaCodigo: 'ARS', cuentaContableId: cuentaBanco })).body;
  const usd = (await s.http.post('/api/tesoreria/cuentas-bancarias', { bancoId: banco.id, numero: '2', monedaCodigo: 'USD', cuentaContableId: cuentaBanco })).body;
  await prisma.empresa.update({ where: { id: s.empresaId }, data: { montoAprobacionOp: 1e12 } });

  /** Usuario de la empresa, opcionalmente asignado a una sucursal. */
  const usuario = async (permisos: Permiso[], sucursalId: string | null) => {
    n++;
    const rol = await prisma.rol.create({ data: { empresaId: s.empresaId, nombre: `Rol tes ${n}`, permisos } });
    const u = await prisma.usuario.create({ data: { email: `tes${n}-${Date.now()}@test.com`, nombre: `Tes ${n}`, passwordHash: await hash('clave-segura-123') } });
    await prisma.usuarioEmpresa.create({ data: { usuarioId: u.id, empresaId: s.empresaId, rolId: rol.id, sucursalId } });
    return conToken(app, await loginComo(app, u.email, 'clave-segura-123', s.empresaId));
  };
  const rosario = await usuario(permisosRos, ros.id);

  const asiento = async (asientoId: string) => {
    const a = await prisma.asiento.findUniqueOrThrow({ where: { id: asientoId }, include: { renglones: true } });
    const r: Record<string, [string, string]> = {};
    for (const x of a.renglones) r[(await prisma.cuentaContable.findUniqueOrThrow({ where: { id: x.cuentaContableId } })).codigo] = [x.debe.toString(), x.haber.toString()];
    return r;
  };
  const saldoCaja = async (cajaId: string) => {
    const movs = await prisma.movimientoTesoreria.findMany({ where: { cajaId, anulado: false } });
    return movs.reduce((t, m) => t + (m.tipo === 'INGRESO' ? 1 : -1) * Number(m.importe), 0);
  };
  const saldoBanco = async (cuentaBancariaId: string) => {
    const movs = await prisma.movimientoTesoreria.findMany({ where: { cuentaBancariaId, anulado: false } });
    return movs.reduce((t, m) => t + (m.tipo === 'INGRESO' ? 1 : -1) * Number(m.importe), 0);
  };

  let numeroCheque = 1000;
  /** Datos de un cheque de terceros con número único. */
  const cheque = (importe: number, extra: Record<string, unknown> = {}) => ({
    tipo: 'FISICO', banco: 'Galicia', numero: String(++numeroCheque), libradorNombre: 'Librador SA', libradorCuit: '30500010912',
    fechaEmision: '2026-11-01', fechaPago: '2030-12-01', importe, ...extra,
  });
  /** Ingreso de cliente confirmado (por defecto en la caja de CEN con el admin). */
  const ingresar = async (d: { cajaId?: string; efectivo?: number; cheques?: object[]; transferencias?: object[] }, http = s.http) => {
    const r = await http.post('/api/tesoreria/ingresos', {
      fecha: '2026-11-10', cajaId: d.cajaId ?? cajaCen.id, origen: 'CLIENTE', terceroId: cliente.id, concepto: 'Cobranza',
      efectivo: d.efectivo ? { importe: d.efectivo } : undefined, cheques: d.cheques ?? [], transferencias: d.transferencias ?? [],
    });
    if (r.status !== 201) throw new Error(`ingreso: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body as { id: string; numero: number; asientoId: string; cheques: { id: string; numero: string }[]; transferencias: { id: string }[] };
  };

  return {
    ...s, proveedorId, clienteId: cliente.id, cen, ros, cajaCen, cajaRos, cajaUsd, banco, ars, usd, rosario,
    usuario, asiento, saldoCaja, saldoBanco, cheque, ingresar,
  };
}
