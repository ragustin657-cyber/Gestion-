import { INestApplicationContext } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AlicuotaIva, hoyEn, TODOS_LOS_PERMISOS, ZONA_ARGENTINA } from '@gestion/shared';
import { ComprobantesService } from '../compras/comprobantes/comprobantes.service';
import { OrdenesService } from '../compras/ordenes/ordenes.service';
import { RecepcionesService } from '../compras/recepciones/recepciones.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../contexto/contexto';
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
  const ctx: ContextoRequest = { usuarioId: admin.id, empresaId: empresa.id, permisos: TODOS_LOS_PERMISOS, superadmin: true };

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
    await comprobantes.crear({
      ...base, terceroId: resmasOk.terceroId, tipo: 'FACTURA', letra: 'A', puntoVenta: 2, numero: 1532, monedaCodigo: 'ARS', totalDeclarado: 786500,
      percepcionesIibb: [],
      renglones: [{ origen: 'RECEPCION', informeRecepcionRenglonId: ir.renglones[0].id, descripcion: 'Resma papel A4 75g', cantidad: 100, precioUnitario: 6500, bonificacionPct: 0, alicuotaIva: 21 }],
    });
    await comprobantes.crear({
      ...base, terceroId: servOk.terceroId, tipo: 'FACTURA', letra: 'A', puntoVenta: 5, numero: 88, monedaCodigo: 'USD', cotizacion: 1450, totalDeclarado: 605,
      percepcionesIibb: [],
      renglones: [{ origen: 'DIRECTO', descripcion: 'Licencia anual de software', cantidad: 1, precioUnitario: 500, bonificacionPct: 0, alicuotaIva: 21 }],
    });
    await comprobantes.crear({
      ...base, terceroId: resmasOk.terceroId, tipo: 'NOTA_CREDITO', letra: 'A', puntoVenta: 2, numero: 77, monedaCodigo: 'ARS', totalDeclarado: 12100,
      percepcionesIibb: [],
      renglones: [{ origen: 'DIRECTO', descripcion: 'Bonificación por volumen', cantidad: 1, precioUnitario: 10000, bonificacionPct: 0, alicuotaIva: 21 }],
    });
  });
  return 'creada';
}
