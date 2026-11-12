import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';
import { hoyEn, Permiso, TODOS_LOS_PERMISOS, ZONA_ARGENTINA } from '@gestion/shared';
import { cargarConfigCuentas } from '../compras/config/conceptos';
import { cargarConfigPagos } from '../pagos/config/valores-iniciales';
import { cargarPlanModelo } from './plan-cuentas-modelo';
import { cargarReglasIniciales } from '../conciliacion/reglas-iniciales';
import { MODELOS_FORMATO } from '../conciliacion/modelos-formato';
import { crearEjercicio, rangoEjercicio } from '../contabilidad/periodos/ejercicios';

export const DEMO = {
  email: 'admin@demo.com', password: 'admin1234', empresa: 'Demo S.A.',
  aprobador: 'aprobador@demo.com', passwordAprobador: 'aprobador1234',
  tesorero: 'tesorero@demo.com', passwordTesorero: 'tesorero1234',
  cajero: 'cajero.rosario@demo.com', passwordCajero: 'cajero1234',
  contador: 'contador@demo.com', passwordContador: 'contador1234',
  facturacion: 'facturacion@demo.com', passwordFacturacion: 'facturacion1234',
};

const ROLES: Record<string, Permiso[]> = {
  Administrador: TODOS_LOS_PERMISOS,
  Comprador: ['tercero.ver', 'articulo.ver', 'oc.ver', 'oc.crear', 'ir.ver', 'ir.crear', 'fc.ver', 'fc.crear', 'op.ver', 'op.crear', 'stock.ver'],
  Aprobador: ['oc.ver', 'oc.aprobar', 'op.ver', 'op.aprobar'],
  Tesorero: ['tercero.ver', 'op.ver', 'pago.ejecutar', 'tesoreria.maestros.editar', 'fc.ver', 'tesoreria.ver', 'tesoreria.operar', 'tesoreria.aceptar', 'conciliacion.operar'],
  'Cajero sucursal': ['tercero.ver', 'tesoreria.ver', 'tesoreria.operar'],
  Contador: ['plancuentas.ver', 'plancuentas.editar', 'auditoria.ver', 'asiento.registrar', 'contabilidad.cerrar', 'impuestos.ver', 'impuestos.presentar', 'stock.ver', 'stock.operar', 'informes.ver'],
  Facturación: ['tercero.ver', 'articulo.ver', 'venta.emitir', 'cobro.registrar', 'venta.ver', 'tesoreria.ver', 'stock.ver', 'precios.editar', 'pedido.gestionar'],
};

/** Proveedores demo: razón social, CUIT y régimen de Ganancias (null: sin retención). */
export const PROVEEDORES = [
  ['Distribuidora Andina S.A.', '30700123452', '78'],
  ['Papelera del Plata S.R.L.', '30711223343', '78'],
  ['Transportes Ruta 9 S.A.', '30698765433', '94'],
  ['Servicios Informáticos Pampa S.A.', '30705556667', '94'],
  ['Juan Pérez (Electricista)', '20234567897', null],
  ['Consultora Delta S.R.L.', '30715554441', '94'],
] as const;
const CLIENTES = [
  ['Supermercados Litoral S.A.', '30719998883'],
  ['Constructora Norte S.R.L.', '30704445551'],
  ['María Gómez', '27312345671'],
  ['Distribuidora Norte SA', '30718882229'],
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

/** Precios de la lista Minorista (la Mayorista es un 15 % menor). */
const PRECIOS_MINORISTA: Record<string, number> = {
  'RES-A4': 9500, 'TON-85A': 68000, 'CAB-UTP': 1200, 'LAM-LED': 2500, 'YER-1K': 4800, 'AZU-1K': 1500,
  'SRV-FLETE': 25000, 'SRV-SOPORTE': 350000, 'SRV-ELEC': 18000, 'LIB-CONT': 12000,
};

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
        domicilio: 'Av. Corrientes 1234, CABA', agenteRetencionGanancias: true, jurisdiccionesIibb: ['901', '902'], montoAprobacionOc: 1000000, montoAprobacionOp: 1000000,
      },
    });
    const e = empresa.id;
    const central = await tx.sucursal.create({ data: { empresaId: e, codigo: 'CEN', nombre: 'Casa central', domicilio: 'Av. Corrientes 1234, CABA', esCentral: true } });
    await tx.puntoVenta.create({ data: { empresaId: e, numero: 1, descripcion: 'Casa central (manual)', electronico: false } });
    await tx.puntoVenta.create({ data: { empresaId: e, numero: 2, descripcion: 'Factura electrónica', electronico: true, sucursalId: central.id } });
    await tx.configArca.create({ data: { empresaId: e, ambiente: 'SIMULADO' } });
    const rosario = await tx.sucursal.create({ data: { empresaId: e, codigo: 'ROS', nombre: 'Sucursal Rosario', domicilio: 'Córdoba 1450, Rosario' } });

    const roles: Record<string, string> = {};
    for (const [nombre, permisos] of Object.entries(ROLES)) roles[nombre] = (await tx.rol.create({ data: { empresaId: e, nombre, permisos } })).id;
    await tx.usuarioEmpresa.create({ data: { usuarioId: admin.id, empresaId: e, rolId: roles.Administrador } });
    const aprobador =
      (await tx.usuario.findUnique({ where: { email: DEMO.aprobador } })) ??
      (await tx.usuario.create({ data: { email: DEMO.aprobador, nombre: 'Gerente (aprobador)', passwordHash: await hash(DEMO.passwordAprobador) } }));
    await tx.usuarioEmpresa.create({ data: { usuarioId: aprobador.id, empresaId: e, rolId: roles.Aprobador } });
    const tesorero =
      (await tx.usuario.findUnique({ where: { email: DEMO.tesorero } })) ??
      (await tx.usuario.create({ data: { email: DEMO.tesorero, nombre: 'Tesorero', passwordHash: await hash(DEMO.passwordTesorero) } }));
    await tx.usuarioEmpresa.create({ data: { usuarioId: tesorero.id, empresaId: e, rolId: roles.Tesorero } });
    const cajero =
      (await tx.usuario.findUnique({ where: { email: DEMO.cajero } })) ??
      (await tx.usuario.create({ data: { email: DEMO.cajero, nombre: 'Cajero Rosario', passwordHash: await hash(DEMO.passwordCajero) } }));
    await tx.usuarioEmpresa.create({ data: { usuarioId: cajero.id, empresaId: e, rolId: roles['Cajero sucursal'], sucursalId: rosario.id } });
    const contador =
      (await tx.usuario.findUnique({ where: { email: DEMO.contador } })) ??
      (await tx.usuario.create({ data: { email: DEMO.contador, nombre: 'Contador', passwordHash: await hash(DEMO.passwordContador) } }));
    await tx.usuarioEmpresa.create({ data: { usuarioId: contador.id, empresaId: e, rolId: roles.Contador } });
    const facturacion =
      (await tx.usuario.findUnique({ where: { email: DEMO.facturacion } })) ??
      (await tx.usuario.create({ data: { email: DEMO.facturacion, nombre: 'Facturación', passwordHash: await hash(DEMO.passwordFacturacion) } }));
    await tx.usuarioEmpresa.create({ data: { usuarioId: facturacion.id, empresaId: e, rolId: roles['Facturación'] } });

    await cargarPlanModelo(tx, e);
    await cargarConfigCuentas(tx, e);
    await cargarConfigPagos(tx, e);
    await cargarReglasIniciales(tx, e);
    await crearEjercicio(tx, e, rangoEjercicio(1, new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`)).desde, 1);
    const cuenta = async (codigo: string) =>
      (await tx.cuentaContable.findFirstOrThrow({ where: { empresaId: e, codigo } })).id;

    let codigo = 0;
    for (const [razonSocial, cuit, regimenGanancias] of PROVEEDORES) {
      const ri = !cuit.startsWith('20');
      // Los RI con Convenio Multilateral: número de inscripción de 10 dígitos (para AGIP)
      await tx.tercero.create({
        data: {
          empresaId: e, codigo: ++codigo, razonSocial, cuit, condicionIva: ri ? 'RESPONSABLE_INSCRIPTO' : 'MONOTRIBUTO', esProveedor: true, diasPago: 30, regimenGanancias,
          situacionIibb: ri ? 'CONVENIO' : 'NO_INSCRIPTO', numeroIibb: ri ? `901${cuit.slice(2, 9)}` : null,
        },
      });
    }
    for (const [razonSocial, cuit] of CLIENTES)
      await tx.tercero.create({ data: { empresaId: e, codigo: ++codigo, razonSocial, cuit, condicionIva: cuit.startsWith('27') ? 'CONSUMIDOR_FINAL' : 'RESPONSABLE_INSCRIPTO', esCliente: true, diasPago: 15 } });
    await tx.tercero.create({ data: { empresaId: e, codigo: ++codigo, razonSocial: 'Consumidor Final', cuit: 'Consumidor final', tipoDocumento: 'OTRO', condicionIva: 'CONSUMIDOR_FINAL', esCliente: true } });
    await tx.talonario.create({ data: { empresaId: e, tipoComprobante: 'TERCERO', puntoVenta: 0, ultimoNumero: codigo } });

    const gastos = await cuenta('5.2.01');
    const ventas = await cuenta('4.1.01');
    const minorista = await tx.listaPrecios.create({ data: { empresaId: e, nombre: 'Minorista', monedaCodigo: 'ARS', porDefecto: true } });
    const mayorista = await tx.listaPrecios.create({ data: { empresaId: e, nombre: 'Mayorista', monedaCodigo: 'ARS' } });
    for (const [cod, descripcion, unidad, alicuotaIva, esServicio] of ARTICULOS) {
      const a = await tx.articulo.create({ data: { empresaId: e, codigo: cod, descripcion, unidad, alicuotaIva, esServicio, cuentaCompraId: gastos, cuentaVentaId: ventas, controlaStock: cod === 'LAM-LED' } });
      const precio = PRECIOS_MINORISTA[cod];
      await tx.precioLista.createMany({ data: [
        { empresaId: e, listaId: minorista.id, articuloId: a.id, precio },
        { empresaId: e, listaId: mayorista.id, articuloId: a.id, precio: Math.round(precio * 0.85) },
      ] });
    }

    const hoy = new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`);
    await tx.cotizacion.create({ data: { empresaId: e, monedaCodigo: 'USD', fecha: hoy, valor: 1450 } });

    const banco = await tx.banco.create({ data: { empresaId: e, nombre: 'Banco de la Nación Argentina', codigoBcra: '011' } });
    const cb = await tx.cuentaBancaria.create({
      data: { empresaId: e, bancoId: banco.id, numero: '1234567/8', cbu: '0110599500000001234565', alias: 'DEMO.SA.NACION', monedaCodigo: 'ARS', cuentaContableId: await cuenta('1.1.01.002') },
    });
    await tx.chequera.create({ data: { empresaId: e, cuentaBancariaId: cb.id, tipo: 'ECHEQ' } });
    const { nombre: _modelo, ...nacion } = MODELOS_FORMATO.NACION;
    await tx.formatoExtracto.create({ data: { ...nacion, empresaId: e, cuentaBancariaId: cb.id } });
    await tx.caja.create({ data: { empresaId: e, sucursalId: central.id, nombre: 'Caja principal', monedaCodigo: 'ARS', cuentaContableId: await cuenta('1.1.01.001') } });
    await tx.caja.create({ data: { empresaId: e, sucursalId: rosario.id, nombre: 'Caja Rosario', monedaCodigo: 'ARS', cuentaContableId: await cuenta('1.1.01.001') } });

    await tx.centroCosto.createMany({ data: [{ empresaId: e, codigo: 'ADM', nombre: 'Administración' }, { empresaId: e, codigo: 'COM', nombre: 'Comercial' }] });
    const deposito = await tx.deposito.create({ data: { empresaId: e, codigo: 'CEN', nombre: 'Depósito central', direccion: 'Av. Corrientes 1234, CABA' } });
    await tx.puntoVenta.updateMany({ where: { empresaId: e }, data: { depositoId: deposito.id } });
  }, { timeout: 30000 });
  return 'creada';
}
