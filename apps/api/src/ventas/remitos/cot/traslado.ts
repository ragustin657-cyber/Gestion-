import { BadRequestException } from '@nestjs/common';
import type { EstadoCot } from '@prisma/client';
import { z } from 'zod';
import { zFecha } from '../../../compras/comun';
import type { TxEmpresa } from '../../../prisma/tenant-prisma.service';
import { D, Dec } from '../../../tesoreria/operaciones/tesoreria-comun';
import type { PreciosService } from '../../precios/precios.service';
import { esProvinciaArba } from '@gestion/shared';

const zTxt = z.string().trim().max(200).nullish();
/** E57: datos del traslado (alta y edición); vacíos = se proponen. */
export const esquemaTraslado = z.object({
  calle: zTxt, numero: zTxt, codigoPostal: zTxt, localidad: zTxt,
  provincia: z.string().trim().toUpperCase().refine(esProvinciaArba, 'Provincia inválida (letra de la tabla de ARBA)').nullish(),
  transportistaId: z.string().uuid('Valor inválido').nullish(),
  patente: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,7}$/, 'Patente inválida').nullish(),
  patenteAcoplado: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,7}$/, 'Patente inválida').nullish(),
  fechaSalida: zFecha.nullish(),
  horaSalida: z.string().regex(/^([01]\d|2[0-3])[0-5]\d$/, 'Hora inválida (HHMM)').nullish(),
  importeDeclarado: z.number().min(0).nullish(),
});
export type DatosTraslado = z.infer<typeof esquemaTraslado>;

/** Hora actual de Argentina en HHMM. */
export const horaArgentina = (d = new Date()) =>
  new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(':', '');

/** Corresponde COT si el origen o el destino están en la provincia de Buenos Aires (B); sin provincia todavía, queda para pedir. */
export function estadoCot(origen: string | null | undefined, destino: string | null | undefined): EstadoCot {
  if (!origen || !destino) return 'SIN_PEDIR';
  return origen === 'B' || destino === 'B' ? 'SIN_PEDIR' : 'NO_CORRESPONDE';
}

/** Importe declarado sin IVA en pesos (spec §3). */
async function importeDeclarado(tx: TxEmpresa, precios: PreciosService, terceroId: string, renglones: { cantidad: Dec; articuloId: string | null; pedidoRenglonId: string | null; remitoRenglonOrigenId: string | null }[]): Promise<Dec> {
  let total = new D(0);
  for (const r of renglones) {
    let prId = r.pedidoRenglonId;
    if (!prId && r.remitoRenglonOrigenId) prId = (await tx.remitoRenglon.findUnique({ where: { id: r.remitoRenglonOrigenId } }))?.pedidoRenglonId ?? null;
    const pr = prId ? await tx.pedidoVentaRenglon.findUnique({ where: { id: prId }, include: { pedido: true } }) : null;
    let precio: Dec | null = null;
    if (pr) precio = new D(pr.precioUnitario).times(new D(1).minus(new D(pr.bonificacionPct).div(100))).times(pr.pedido.monedaCodigo === 'ARS' ? 1 : pr.pedido.cotizacion);
    else if (r.articuloId) {
      const s = await precios.sugerido(tx, { terceroId, articuloId: r.articuloId, monedaCodigo: 'ARS', cotizacion: null }).catch(() => ({ precio: null }));
      if (s.precio) precio = new D(s.precio);
    }
    if (precio) total = total.plus(new D(r.cantidad).times(precio));
  }
  return total.toDecimalPlaces(2);
}

/**
 * Completa y guarda los datos del traslado de un remito y calcula el estado del COT (spec §3). `entrada` son los datos que mandó
 * el usuario; lo que falta se propone (destino/origen del cliente, salida, importe) solo en el alta (`alta`).
 */
export async function guardarTraslado(tx: TxEmpresa, precios: PreciosService, remitoId: string, entrada: DatosTraslado | null | undefined, alta: boolean) {
  const r = await tx.remito.findUniqueOrThrow({ where: { id: remitoId }, include: { renglones: true } });
  const conf = await tx.configCot.findFirst();
  const e = entrada ?? {};
  const data: Record<string, unknown> = {};
  const set = (campo: string, v: unknown) => { if (v !== undefined) data[campo] = v; };
  set('trasladoCalle', e.calle); set('trasladoNumero', e.numero); set('trasladoCodigoPostal', e.codigoPostal); set('trasladoLocalidad', e.localidad); set('trasladoProvincia', e.provincia);
  set('transportistaId', e.transportistaId); set('patente', e.patente); set('patenteAcoplado', e.patenteAcoplado);
  set('fechaSalida', e.fechaSalida); set('horaSalida', e.horaSalida); set('importeDeclarado', e.importeDeclarado);
  if (e.transportistaId && !(await tx.transportista.findUnique({ where: { id: e.transportistaId } }))) throw new BadRequestException('Transportista inexistente');
  if (alta) {
    const t = await tx.tercero.findUniqueOrThrow({ where: { id: r.terceroId } });
    if (e.calle === undefined && e.provincia === undefined && t.entregaCalle) {
      Object.assign(data, { trasladoCalle: t.entregaCalle, trasladoNumero: t.entregaNumero, trasladoCodigoPostal: t.entregaCodigoPostal, trasladoLocalidad: t.entregaLocalidad, trasladoProvincia: t.entregaProvincia });
    }
    if (e.patente === undefined && e.transportistaId) data.patente = (await tx.transportista.findUnique({ where: { id: e.transportistaId } }))?.patentePorDefecto ?? null;
    if (!e.fechaSalida) data.fechaSalida = r.fecha;
    if (!e.horaSalida) data.horaSalida = horaArgentina();
    if (e.importeDeclarado == null) data.importeDeclarado = await importeDeclarado(tx, precios, r.terceroId, r.renglones.map((x) => ({ cantidad: new D(x.cantidad), articuloId: x.articuloId, pedidoRenglonId: x.pedidoRenglonId, remitoRenglonOrigenId: x.remitoRenglonOrigenId })));
  }
  // Estado del COT: solo con el COT activo (o si el remito ya tenía estado)
  if (conf?.activo || r.cotEstado) {
    const dep = await tx.deposito.findUniqueOrThrow({ where: { id: r.depositoId } });
    const provTraslado = (data.trasladoProvincia !== undefined ? data.trasladoProvincia : r.trasladoProvincia) as string | null;
    const [origen, destino] = r.tipo === 'DEVOLUCION' ? [provTraslado, dep.provincia] : [dep.provincia, provTraslado];
    if (r.cotEstado !== 'OTORGADO' && r.cotEstado !== 'PENDIENTE') data.cotEstado = estadoCot(origen, destino);
    if (r.cotEstado === 'RECHAZADO') data.cotMensaje = null;
  }
  if (Object.keys(data).length) await tx.remito.update({ where: { id: remitoId }, data });
}
