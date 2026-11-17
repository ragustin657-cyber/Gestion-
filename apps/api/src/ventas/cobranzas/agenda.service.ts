import { Injectable, NotFoundException } from '@nestjs/common';
import { GestionCobranza, MovimientoCuentaCorriente, Prisma } from '@prisma/client';
import { ORIGENES_CLIENTE } from '../../compras/comun';
import { TenantPrisma } from '../../prisma/tenant-prisma.service';
import { hoy } from '../../tesoreria/operaciones/tesoreria-comun';
import { ConsultasVentasService } from '../consultas/consultas-ventas.service';
import { gestionSalida, GestionesService } from './gestiones.service';
import { EstadoPromesa, estadoPromesa } from './promesas';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const DIA = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Saldos de la cuenta corriente de un cliente a hoy (spec E25 §4), en pesos. */
function saldos(movs: MovimientoCuentaCorriente[], corte: Date) {
  let vencido = new D(0), porVencer = new D(0), aFavor = new D(0);
  let masViejo: Date | null = null;
  for (const m of movs) {
    if (m.saldoPesos.lt(0)) aFavor = aFavor.plus(m.saldoPesos);
    else if (m.saldo.gt(0) && m.fechaVencimiento < corte) {
      vencido = vencido.plus(m.saldoPesos);
      if (!masViejo || m.fechaVencimiento < masViejo) masViejo = m.fechaVencimiento;
    } else if (m.saldo.gt(0)) porVencer = porVencer.plus(m.saldoPesos);
  }
  return { vencido, porVencer, aFavor, dias: masViejo ? Math.round((corte.getTime() - masViejo.getTime()) / DIA) : 0 };
}

/** Promesa de cada gestión con su estado: la vigente es la de la gestión más reciente con promesa. */
function promesas(gestiones: GestionCobranza[], movs: { origenTipo: string; fecha: Date; importePesos: Dec }[], corte: Date) {
  // gestiones: de la más nueva a la más vieja
  const conPromesa = gestiones.filter((g) => g.promesaFecha && g.promesaImporte);
  const estados = new Map<string, EstadoPromesa>();
  conPromesa.forEach((g, i) => {
    const siguiente = i > 0 ? conPromesa[i - 1] : null;
    estados.set(g.id, estadoPromesa({ fecha: g.promesaFecha!, importe: g.promesaImporte!, desde: g.fecha, hasta: siguiente?.fecha ?? null }, movs, corte));
  });
  return { estados, vigente: conPromesa[0] ?? null };
}

/** Agenda de cobranzas y ficha de cada cliente (spec E25 §7 y §8): todo se calcula desde la cuenta corriente. */
@Injectable()
export class AgendaCobranzasService {
  constructor(private readonly tenant: TenantPrisma, private readonly gestiones: GestionesService, private readonly consultas: ConsultasVentasService) {}

  async agenda(q: { soloHoy?: string; incumplidas?: string; minDias?: string; q?: string }) {
    const db = this.tenant.db;
    const corte = hoy();
    const movs = await db.movimientoCuentaCorriente.findMany({ where: { anulado: false, origenTipo: { in: ORIGENES_CLIENTE } } });
    const porCliente = new Map<string, MovimientoCuentaCorriente[]>();
    for (const m of movs) porCliente.set(m.terceroId, [...(porCliente.get(m.terceroId) ?? []), m]);
    const vencidos = [...porCliente.entries()].map(([id, ms]) => ({ id, ms, s: saldos(ms.filter((m) => !m.saldo.isZero()), corte) })).filter((x) => x.s.vencido.gt(0));
    const ids = vencidos.map((x) => x.id);
    const terceros = new Map((await db.tercero.findMany({ where: { id: { in: ids } }, select: { id: true, razonSocial: true } })).map((t) => [t.id, t.razonSocial]));
    const todas = ids.length ? await db.gestionCobranza.findMany({ where: { terceroId: { in: ids } }, orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }] }) : [];
    const f2 = (x: Dec) => x.toFixed(2);
    let filas = vencidos.map(({ id, ms, s }) => {
      const gs = todas.filter((g) => g.terceroId === id);
      const { estados, vigente } = promesas(gs, ms, corte);
      const proxima = gs.find((g) => g.proximaAccion)?.proximaAccion ?? null;
      const ultima = gs[0] ?? null;
      return {
        terceroId: id, cliente: terceros.get(id) ?? '', vencido: f2(s.vencido), porVencer: f2(s.porVencer), aFavor: f2(s.aFavor), dias: s.dias,
        ultimaGestion: ultima ? { fecha: iso(ultima.fecha), medio: ultima.medio, nota: ultima.nota } : null,
        proximaAccion: proxima ? iso(proxima) : null, accionAtrasada: !!proxima && proxima <= corte,
        promesa: vigente ? { fecha: iso(vigente.promesaFecha!), importe: f2(vigente.promesaImporte!), estado: estados.get(vigente.id)! } : null,
        _vencido: s.vencido,
      };
    });
    if (q.soloHoy === 'true') filas = filas.filter((f) => f.accionAtrasada);
    if (q.incumplidas === 'true') filas = filas.filter((f) => f.promesa?.estado === 'INCUMPLIDA');
    if (q.minDias && Number(q.minDias) > 0) filas = filas.filter((f) => f.dias >= Number(q.minDias));
    if (q.q?.trim()) filas = filas.filter((f) => f.cliente.toLowerCase().includes(q.q!.trim().toLowerCase()));
    // Orden (§7): acciones vencidas (la más vieja primero), promesas incumplidas, y el resto por atraso e importe
    const grupo = (f: (typeof filas)[number]) => (f.accionAtrasada ? 0 : f.promesa?.estado === 'INCUMPLIDA' ? 1 : 2);
    filas.sort((a, b) => grupo(a) - grupo(b) || (grupo(a) === 0 ? a.proximaAccion!.localeCompare(b.proximaAccion!) : 0) || b.dias - a.dias || b._vencido.comparedTo(a._vencido) || a.cliente.localeCompare(b.cliente));
    return { hoy: iso(corte), clientes: filas.map(({ _vencido, ...f }) => f) };
  }

  async ficha(terceroId: string) {
    const db = this.tenant.db;
    const t = await db.tercero.findUnique({ where: { id: terceroId }, select: { id: true, razonSocial: true, cuit: true, telefono: true, email: true, esCliente: true } });
    if (!t || !t.esCliente) throw new NotFoundException('Cliente inexistente');
    const corte = hoy();
    const movs = await db.movimientoCuentaCorriente.findMany({ where: { terceroId, anulado: false, origenTipo: { in: ORIGENES_CLIENTE } } });
    const s = saldos(movs.filter((m) => !m.saldo.isZero()), corte);
    const pendientes = movs.filter((m) => m.saldo.gt(0)).sort((a, b) => a.fechaVencimiento.getTime() - b.fechaVencimiento.getTime());
    const describir = await this.consultas.describir(pendientes);
    const gs = await this.gestiones.deCliente(db, terceroId);
    const { estados } = promesas(gs, movs, corte);
    const f2 = (x: Dec) => x.toFixed(2);
    const { esCliente: _c, ...cliente } = t;
    return {
      cliente, vencido: f2(s.vencido), porVencer: f2(s.porVencer), aFavor: f2(s.aFavor), dias: s.dias,
      comprobantes: pendientes.map((m) => ({
        movimientoId: m.id, origenTipo: m.origenTipo, descripcion: describir(m), fecha: iso(m.fecha), fechaVencimiento: iso(m.fechaVencimiento),
        dias: Math.max(0, Math.round((corte.getTime() - m.fechaVencimiento.getTime()) / DIA)), importe: f2(m.importePesos), saldo: f2(m.saldoPesos), vencido: m.fechaVencimiento < corte,
      })),
      gestiones: gs.map((g) => ({ ...gestionSalida(g), promesaEstado: estados.get(g.id) ?? null })),
    };
  }
}
