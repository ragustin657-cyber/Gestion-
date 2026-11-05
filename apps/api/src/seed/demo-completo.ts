import { INestApplicationContext } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AlicuotaIva, hoyEn, TODOS_LOS_PERMISOS, ZONA_ARGENTINA } from '@gestion/shared';
import { ComprobantesService } from '../compras/comprobantes/comprobantes.service';
import { OrdenesService } from '../compras/ordenes/ordenes.service';
import { RecepcionesService } from '../compras/recepciones/recepciones.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../contexto/contexto';
import { OrdenesPagoService } from '../pagos/ordenes/ordenes-pago.service';
import { PagoService } from '../pagos/ordenes/pago.service';
import { PadronService } from '../pagos/padron/padron.service';
import { PrismaService } from '../prisma/prisma.service';
import { DEMO, sembrarDemo } from './demo';

const hoy = () => new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`);

/** Empresa demo completa: maestros (sembrarDemo) + circuito de compras cargado con los servicios reales. */
export async function sembrarCompleto(app: INestApplicationContext): Promise<'creada' | 'existente'> {
  const prisma = app.get(PrismaService);
  if ((await sembrarDemo(prisma)) === 'existente') return 'existente';

  const empresa = await prisma.empresa.findFirstOrThrow({ where: { razonSocial: DEMO.empresa } });
  const admin = await prisma.usuario.findUniqueOrThrow({ where: { email: DEMO.email } });
  const cls = app.get(ClsService);
  const ctx: ContextoRequest = { usuarioId: admin.id, empresaId: empresa.id, permisos: TODOS_LOS_PERMISOS, superadmin: true, sucursalId: null };

  await cls.run(async () => {
    cls.set(CLAVE_CONTEXTO, ctx);
    const ordenes = app.get(OrdenesService);
    const recepciones = app.get(RecepcionesService);
    const comprobantes = app.get(ComprobantesService);
    const prov = async (razonSocial: string) => (await prisma.tercero.findFirstOrThrow({ where: { empresaId: empresa.id, razonSocial } })).id;
    const art = async (codigo: string) => prisma.articulo.findFirstOrThrow({ where: { empresaId: empresa.id, codigo } });
    const fecha = hoy();

    const crearOC = async (proveedor: string, codigo: string, cantidad: number, precio: number) => {
      const a = await art(codigo);
      return ordenes.crear({
        terceroId: await prov(proveedor), fecha, monedaCodigo: 'ARS',
        renglones: [{ articuloId: a.id, descripcion: a.descripcion, cantidad, precioUnitario: precio, bonificacionPct: 0, alicuotaIva: Number(a.alicuotaIva) as AlicuotaIva }],
      });
    };

    // 1. Borrador
    await crearOC('Papelera del Plata S.R.L.', 'RES-A4', 50, 6500);
    // 2. Pendiente de aprobación (supera el límite de $ 1.000.000)
    const pend = await crearOC('Distribuidora Andina S.A.', 'TON-85A', 50, 45000);
    await ordenes.confirmar(pend.id, pend.version);
    // 3. Aprobada automáticamente (servicio)
    const serv = await crearOC('Servicios Informáticos Pampa S.A.', 'SRV-SOPORTE', 1, 350000);
    const servOk = await ordenes.confirmar(serv.id, serv.version);
    // 4. Parcialmente recibida
    const lamp = await crearOC('Distribuidora Andina S.A.', 'LAM-LED', 100, 3500);
    const lampOk = await ordenes.confirmar(lamp.id, lamp.version);
    await recepciones.crear({ terceroId: lampOk.terceroId, fecha, remitoNumero: '00003-00004521', renglones: [{ ordenCompraRenglonId: lampOk.renglones[0].id, cantidad: 60 }] });
    // 5. Cumplida, recibida y facturada
    const resmas = await crearOC('Papelera del Plata S.R.L.', 'RES-A4', 100, 6500);
    const resmasOk = await ordenes.confirmar(resmas.id, resmas.version);
    const ir = await recepciones.crear({ terceroId: resmasOk.terceroId, fecha, remitoNumero: '00001-00012345', renglones: [{ ordenCompraRenglonId: resmasOk.renglones[0].id, cantidad: 100 }] });

    const base = { fechaEmision: fecha, fechaContable: fecha, percepcionIva: 0, impuestosInternos: 0, noGravado: 0, exento: 0, aceptoDiferencias: false };
    const facturaPapelera = await comprobantes.crear({
      ...base, terceroId: resmasOk.terceroId, tipo: 'FACTURA', letra: 'A', puntoVenta: 2, numero: 1532, monedaCodigo: 'ARS', totalDeclarado: 786500,
      percepcionesIibb: [],
      renglones: [{ origen: 'RECEPCION', informeRecepcionRenglonId: ir.renglones[0].id, descripcion: 'Resma papel A4 75g', cantidad: 100, precioUnitario: 6500, bonificacionPct: 0, alicuotaIva: 21 }],
    });
    const facturaUsd = await comprobantes.crear({
      ...base, terceroId: servOk.terceroId, tipo: 'FACTURA', letra: 'A', puntoVenta: 5, numero: 88, monedaCodigo: 'USD', cotizacion: 1450, totalDeclarado: 605,
      percepcionesIibb: [],
      renglones: [{ origen: 'DIRECTO', descripcion: 'Licencia anual de software', cantidad: 1, precioUnitario: 500, bonificacionPct: 0, alicuotaIva: 21 }],
    });
    const notaCredito = await comprobantes.crear({
      ...base, terceroId: resmasOk.terceroId, tipo: 'NOTA_CREDITO', letra: 'A', puntoVenta: 2, numero: 77, monedaCodigo: 'ARS', totalDeclarado: 12100,
      percepcionesIibb: [],
      renglones: [{ origen: 'DIRECTO', descripcion: 'Bonificación por volumen', cantidad: 1, precioUnitario: 10000, bonificacionPct: 0, alicuotaIva: 21 }],
    });

    // --- Padrón de IIBB de ejemplo (ARBA, mes actual) ---
    const [anio, mes] = hoyEn(ZONA_ARGENTINA).split('-').map(Number);
    const ddmmaaaa = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCMonth() + 1).padStart(2, '0')}${d.getUTCFullYear()}`;
    const desde = ddmmaaaa(new Date(Date.UTC(anio, mes - 1, 1)));
    const hasta = ddmmaaaa(new Date(Date.UTC(anio, mes, 0)));
    const lineas = [['30711223343', '0,50'], ['30700123452', '1,75'], ['30715554441', '1,00']]
      .map(([cuit, alic]) => `R;${desde};${desde};${hasta};${cuit};D;N;N;${alic};0`).join('\n');
    const carga = await prisma.padronCarga.create({ data: { jurisdiccion: '902', archivo: 'padron-demo.txt', creadoPor: admin.id } });
    await app.get(PadronService).procesar(carga.id, '902', Buffer.from(lineas, 'latin1'));

    // --- Órdenes de pago ---
    const ops = app.get(OrdenesPagoService);
    const pago = app.get(PagoService);
    const movimiento = async (origenId: string) => (await prisma.movimientoCuentaCorriente.findFirstOrThrow({ where: { origenId } })).id;
    // Pagada: factura y nota de crédito de la papelera, con retenciones, por transferencia
    const opPapelera = await ops.crear({
      terceroId: resmasOk.terceroId, fecha,
      imputaciones: [{ movimientoId: await movimiento(facturaPapelera.id), importe: 786500 }, { movimientoId: await movimiento(notaCredito.id), importe: -12100 }],
    });
    const opPapeleraOk = await ops.confirmar(opPapelera.id, opPapelera.version);
    const { netoPagar } = await ops.previsualizarRetenciones(opPapelera.id, fecha);
    const cuentaNacion = await prisma.cuentaBancaria.findFirstOrThrow({ where: { empresaId: empresa.id, monedaCodigo: 'ARS' } });
    await pago.pagar(opPapelera.id, opPapeleraOk.version, fecha, [
      { tipo: 'TRANSFERENCIA', monedaCodigo: 'ARS', importe: Number(netoPagar), cuentaBancariaId: cuentaNacion.id, referencia: 'Transferencia demo' },
    ]);
    // Aprobada (bajo el límite): factura en dólares de servicios informáticos
    const opUsd = await ops.crear({ terceroId: servOk.terceroId, fecha, cotizacion: 1450, imputaciones: [{ movimientoId: await movimiento(facturaUsd.id), importe: 605 }] });
    await ops.confirmar(opUsd.id, opUsd.version);
    // Pendiente de aprobación: anticipo que supera el límite
    const opAnticipo = await ops.crear({ terceroId: await prov('Distribuidora Andina S.A.'), fecha, imputaciones: [], anticipo: { monedaCodigo: 'ARS', importe: 1500000 } });
    await ops.confirmar(opAnticipo.id, opAnticipo.version);
  });
  return 'creada';
}
