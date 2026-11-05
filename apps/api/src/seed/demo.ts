import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';
import { Permiso, TODOS_LOS_PERMISOS } from '@gestion/shared';
import { cargarConfigCuentas } from '../compras/config/conceptos';
import { cargarPlanModelo } from './plan-cuentas-modelo';

export const DEMO = { email: 'admin@demo.com', password: 'admin1234', empresa: 'Demo S.A.', aprobador: 'aprobador@demo.com', passwordAprobador: 'aprobador1234' };

const ROLES: Record<string, Permiso[]> = {
  Administrador: TODOS_LOS_PERMISOS,
  Comprador: ['tercero.ver', 'articulo.ver', 'oc.ver', 'oc.crear', 'ir.ver', 'ir.crear', 'fc.ver', 'fc.crear'],
  Aprobador: ['oc.ver', 'oc.aprobar'],
  Tesorero: ['tercero.ver', 'op.crear', 'pago.ejecutar', 'tesoreria.maestros.editar'],
  Contador: ['plancuentas.ver', 'plancuentas.editar', 'auditoria.ver'],
};

const PROVEEDORES = [
  ['Distribuidora Andina S.A.', '30700123452'],
  ['Papelera del Plata S.R.L.', '30711223343'],
  ['Transportes Ruta 9 S.A.', '30698765433'],
  ['Servicios Informáticos Pampa S.A.', '30705556667'],
  ['Juan Pérez (Electricista)', '20234567897'],
] as const;
const CLIENTES = [
  ['Supermercados Litoral S.A.', '30719998883'],
  ['Constructora Norte S.R.L.', '30704445551'],
  ['María Gómez', '27312345671'],
] as const;
const ARTICULOS = [
  ['RES-A4', 'Resma papel A4 75g', 'UN', 21, false],
  ['TON-85A', 'Tóner HP 85A', 'UN', 21, false],
  ['CAB-UTP', 'Cable UTP Cat 6 (metro)', 'MT', 21, false],
  ['LAM-LED', 'Lámpara LED 12W', 'UN', 21, false],
  ['YER-1K', 'Yerba mate 1 kg', 'UN', 10.5, false],
  ['AZU-1K', 'Azúcar 1 kg', 'UN', 10.5, false],
  ['SRV-FLETE', 'Servicio de flete', 'UN', 21, true],
  ['SRV-SOPORTE', 'Soporte técnico mensual', 'MES', 21, true],
  ['SRV-ELEC', 'Mantenimiento eléctrico', 'HS', 21, true],
  ['LIB-CONT', 'Libro contable', 'UN', 0, false],
] as const;

/** Carga una empresa demo completa. Idempotente: si ya existe, no hace nada. */
export async function sembrarDemo(prisma: PrismaClient): Promise<'creada' | 'existente'> {
  if (await prisma.empresa.findFirst({ where: { razonSocial: DEMO.empresa } })) return 'existente';

  await prisma.$transaction(async (tx) => {
    const admin =
      (await tx.usuario.findUnique({ where: { email: DEMO.email } })) ??
      (await tx.usuario.create({
        data: { email: DEMO.email, nombre: 'Administrador', passwordHash: await hash(DEMO.password), superadmin: true },
      }));
    const empresa = await tx.empresa.create({
      data: {
        razonSocial: DEMO.empresa, cuit: '30712345671', condicionIva: 'RESPONSABLE_INSCRIPTO',
        domicilio: 'Av. Corrientes 1234, CABA', agenteRetencionGanancias: true, jurisdiccionesIibb: ['901', '902'], montoAprobacionOc: 1000000,
      },
    });
    const e = empresa.id;
    await tx.puntoVenta.create({ data: { empresaId: e, numero: 1, descripcion: 'Casa central' } });

    const roles: Record<string, string> = {};
    for (const [nombre, permisos] of Object.entries(ROLES)) roles[nombre] = (await tx.rol.create({ data: { empresaId: e, nombre, permisos } })).id;
    await tx.usuarioEmpresa.create({ data: { usuarioId: admin.id, empresaId: e, rolId: roles.Administrador } });
    const aprobador =
      (await tx.usuario.findUnique({ where: { email: DEMO.aprobador } })) ??
      (await tx.usuario.create({ data: { email: DEMO.aprobador, nombre: 'Gerente (aprobador)', passwordHash: await hash(DEMO.passwordAprobador) } }));
    await tx.usuarioEmpresa.create({ data: { usuarioId: aprobador.id, empresaId: e, rolId: roles.Aprobador } });

    await cargarPlanModelo(tx, e);
    await cargarConfigCuentas(tx, e);
    const cuenta = async (codigo: string) =>
      (await tx.cuentaContable.findFirstOrThrow({ where: { empresaId: e, codigo } })).id;

    let codigo = 0;
    for (const [razonSocial, cuit] of PROVEEDORES)
      await tx.tercero.create({ data: { empresaId: e, codigo: ++codigo, razonSocial, cuit, condicionIva: cuit.startsWith('20') ? 'MONOTRIBUTO' : 'RESPONSABLE_INSCRIPTO', esProveedor: true, diasPago: 30, regimenGanancias: '78' } });
    for (const [razonSocial, cuit] of CLIENTES)
      await tx.tercero.create({ data: { empresaId: e, codigo: ++codigo, razonSocial, cuit, condicionIva: cuit.startsWith('27') ? 'CONSUMIDOR_FINAL' : 'RESPONSABLE_INSCRIPTO', esCliente: true, diasPago: 15 } });
    await tx.talonario.create({ data: { empresaId: e, tipoComprobante: 'TERCERO', puntoVenta: 0, ultimoNumero: codigo } });

    const gastos = await cuenta('5.2.01');
    const ventas = await cuenta('4.1.01');
    for (const [cod, descripcion, unidad, alicuotaIva, esServicio] of ARTICULOS)
      await tx.articulo.create({ data: { empresaId: e, codigo: cod, descripcion, unidad, alicuotaIva, esServicio, cuentaCompraId: gastos, cuentaVentaId: ventas } });

    const hoy = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    await tx.cotizacion.create({ data: { empresaId: e, monedaCodigo: 'USD', fecha: hoy, valor: 1450 } });

    const banco = await tx.banco.create({ data: { empresaId: e, nombre: 'Banco de la Nación Argentina', codigoBcra: '011' } });
    const cb = await tx.cuentaBancaria.create({
      data: { empresaId: e, bancoId: banco.id, numero: '1234567/8', cbu: '0110599500000001234565', alias: 'DEMO.SA.NACION', monedaCodigo: 'ARS', cuentaContableId: await cuenta('1.1.01.002') },
    });
    await tx.chequera.create({ data: { empresaId: e, cuentaBancariaId: cb.id, tipo: 'ECHEQ' } });
    await tx.caja.create({ data: { empresaId: e, nombre: 'Caja principal', monedaCodigo: 'ARS', cuentaContableId: await cuenta('1.1.01.001') } });

    await tx.centroCosto.createMany({ data: [{ empresaId: e, codigo: 'ADM', nombre: 'Administración' }, { empresaId: e, codigo: 'COM', nombre: 'Comercial' }] });
    await tx.deposito.create({ data: { empresaId: e, codigo: 'CEN', nombre: 'Depósito central', direccion: 'Av. Corrientes 1234, CABA' } });
  }, { timeout: 30000 });
  return 'creada';
}
