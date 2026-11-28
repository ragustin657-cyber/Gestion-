import type { ReglaLista } from './dto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { MotivoPrecio } from '@prisma/client';
import { hoyEn, ZONA_ARGENTINA } from '@gestion/shared';
import { ClsService } from 'nestjs-cls';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { conUnicidad } from '../../comun/errores';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { cotizacion, D, Dec } from '../../tesoreria/operaciones/tesoreria-comun';
import { aumentar, Redondeo } from './aumento';
import { leerPrecios } from './importacion';
import { costosDeArticulos } from './costos';
import { precioDerivado } from './derivadas';

const LISTA_DUPLICADA = 'Ya existe una lista con ese nombre';
const INACTIVA_DEFECTO = 'Una lista inactiva no puede ser la lista por defecto';
const hoy = () => new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`);

@Injectable()
export class PreciosService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly auditoria: AuditoriaService,
    private readonly cls: ClsService,
  ) {}

  /** Serializa los cambios de listas de la empresa (una sola por defecto). */
  private async bloquearListas(tx: TxEmpresa) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`listas-precios:${this.tenant.empresaId}`}))`;
  }

  private usuario() {
    return this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId;
  }

  listas() {
    return this.tenant.db.listaPrecios.findMany({ orderBy: { nombre: 'asc' } });
  }

  private async lista(tx: TxEmpresa, id: string) {
    const l = await tx.listaPrecios.findUnique({ where: { id } });
    if (!l) throw new NotFoundException('Lista de precios no encontrada');
    return l;
  }

  /** E52: valida la regla con los valores finales (la base existe y no depende de esta lista; rangos del porcentaje). */
  private async validarRegla(tx: TxEmpresa, id: string | null, r: { base: string; listaBaseId: string | null; porcentaje: number }) {
    if (r.base === 'COSTO' && r.porcentaje < 0) throw new BadRequestException('El margen sobre el costo no puede ser negativo');
    if (r.base !== 'LISTA') return;
    if (!r.listaBaseId) throw new BadRequestException('Indique la lista base');
    const DEPENDE = 'La lista base no puede depender de esta lista';
    if (r.listaBaseId === id) throw new BadRequestException(DEPENDE);
    const vistas = new Set<string>();
    for (let actual: string | null = r.listaBaseId; actual; ) {
      if (actual === id) throw new BadRequestException(DEPENDE);
      if (vistas.has(actual)) break;
      vistas.add(actual);
      const base: { base: string; listaBaseId: string | null } | null = await tx.listaPrecios.findUnique({ where: { id: actual } });
      if (!base) throw new BadRequestException('Lista base inexistente');
      actual = base.base === 'LISTA' ? base.listaBaseId : null;
    }
  }

  crearLista(d: { nombre: string; monedaCodigo: string; activa: boolean; porDefecto: boolean } & ReglaLista) {
    return conUnicidad(LISTA_DUPLICADA, () => this.tenant.transaccion(async (tx) => {
      if (d.porDefecto && !d.activa) throw new BadRequestException(INACTIVA_DEFECTO);
      await this.bloquearListas(tx);
      await this.validarRegla(tx, null, { base: d.base ?? 'MANUAL', listaBaseId: d.listaBaseId ?? null, porcentaje: d.porcentaje ?? 0 });
      if (d.porDefecto) await tx.listaPrecios.updateMany({ data: { porDefecto: false } });
      const l = await tx.listaPrecios.create({ data: { ...d, listaBaseId: d.base === 'LISTA' ? d.listaBaseId : null, empresaId: this.tenant.empresaId } });
      await this.auditoria.registrar(tx, { entidad: 'ListaPrecios', entidadId: l.id, accion: 'CREAR', datos: d });
      return l;
    }));
  }

  modificarLista(id: string, d: { nombre?: string; monedaCodigo?: string; activa?: boolean; porDefecto?: boolean } & ReglaLista) {
    return conUnicidad(LISTA_DUPLICADA, () => this.tenant.transaccion(async (tx) => {
      await this.bloquearListas(tx);
      const l = await this.lista(tx, id);
      if ((d.porDefecto ?? l.porDefecto) && !(d.activa ?? l.activa)) throw new BadRequestException(INACTIVA_DEFECTO);
      if (d.monedaCodigo && d.monedaCodigo !== l.monedaCodigo && (await tx.precioLista.count({ where: { listaId: id } })))
        throw new BadRequestException('La lista tiene precios: no se puede cambiar la moneda');
      const base = d.base ?? l.base;
      const listaBaseId = d.listaBaseId === undefined ? l.listaBaseId : d.listaBaseId;
      await this.validarRegla(tx, id, { base, listaBaseId, porcentaje: d.porcentaje ?? Number(l.porcentaje) });
      if (d.porDefecto) await tx.listaPrecios.updateMany({ where: { id: { not: id } }, data: { porDefecto: false } });
      const r = await tx.listaPrecios.update({ where: { id }, data: { ...d, listaBaseId: base === 'LISTA' ? listaBaseId : null } });
      await this.auditoria.registrar(tx, { entidad: 'ListaPrecios', entidadId: id, accion: 'MODIFICAR', datos: d });
      return r;
    }));
  }

  async precios(listaId: string, q?: string) {
    const db = this.tenant.db;
    await this.lista(db, listaId);
    const filas = await db.precioLista.findMany({ where: { listaId } });
    const arts = new Map((await db.articulo.findMany({ where: { id: { in: filas.map((f) => f.articuloId) } } })).map((a) => [a.id, a]));
    const t = q?.trim().toLowerCase();
    return filas
      .map((f) => ({ articuloId: f.articuloId, codigo: arts.get(f.articuloId)?.codigo ?? '', descripcion: arts.get(f.articuloId)?.descripcion ?? '', precio: new D(f.precio).toString(), actualizadoEn: f.actualizadoEn, fijo: f.fijo, margenPct: f.margenPct?.toString() ?? null }))
      .filter((f) => !t || f.codigo.toLowerCase().includes(t) || f.descripcion.toLowerCase().includes(t))
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
  }

  /** Fija un precio (o lo borra con null) y lo registra en el historial. */
  private async fijar(tx: TxEmpresa, listaId: string, articuloId: string, precio: Dec | null, motivo: MotivoPrecio) {
    const actual = await tx.precioLista.findUnique({ where: { listaId_articuloId: { listaId, articuloId } } });
    // E52: en una lista calculada, un precio cargado a mano, importado o aumentado queda fijo
    const fijo = (motivo === 'MANUAL' || motivo === 'IMPORTACION' || motivo === 'AUMENTO') && (await tx.listaPrecios.findUniqueOrThrow({ where: { id: listaId } })).base !== 'MANUAL';
    if (precio === null) {
      if (!actual) return false;
      await tx.precioLista.delete({ where: { id: actual.id } });
    } else if (actual) {
      if (new D(actual.precio).eq(precio)) {
        if (fijo && !actual.fijo) await tx.precioLista.update({ where: { id: actual.id }, data: { fijo } });
        return false;
      }
      await tx.precioLista.update({ where: { id: actual.id }, data: { precio, ...(fijo ? { fijo } : {}) } });
    } else {
      await tx.precioLista.create({ data: { empresaId: this.tenant.empresaId, listaId, articuloId, precio, fijo } });
    }
    await tx.historialPrecio.create({
      data: { empresaId: this.tenant.empresaId, listaId, articuloId, precioAnterior: actual?.precio ?? null, precioNuevo: precio, motivo, usuario: this.usuario() },
    });
    return true;
  }

  fijarPrecio(listaId: string, articuloId: string, precio: number | null) {
    return this.tenant.transaccion(async (tx) => {
      await this.lista(tx, listaId);
      if (!(await tx.articulo.findUnique({ where: { id: articuloId } }))) throw new BadRequestException('Artículo inexistente');
      await this.fijar(tx, listaId, articuloId, precio === null ? null : new D(precio), precio === null ? 'BAJA' : 'MANUAL');
      return { ok: true };
    });
  }

  /** E52: quitar o poner la marca de fijo y el margen propio de un artículo. */
  marcas(listaId: string, articuloId: string, d: { fijo?: boolean; margenPct?: number | null }) {
    return this.tenant.transaccion(async (tx) => {
      await this.lista(tx, listaId);
      const p = await tx.precioLista.findUnique({ where: { listaId_articuloId: { listaId, articuloId } } });
      if (!p) throw new NotFoundException('El artículo no tiene precio en la lista');
      await tx.precioLista.update({ where: { id: p.id }, data: d });
      await this.auditoria.registrar(tx, { entidad: 'PrecioLista', entidadId: p.id, accion: 'MODIFICAR', datos: d });
      return { ok: true };
    });
  }

  /**
   * E52: precios nuevos de una lista calculada (desde otra lista o desde el costo). No guarda nada.
   * Con `articuloIds`, solo esos (los que no se recalculan siguen con su motivo).
   */
  private async calcularLista(tx: TxEmpresa, listaId: string) {
    const lista = await this.lista(tx, listaId);
    if (lista.base === 'MANUAL') throw new BadRequestException('La lista se carga a mano');
    const actuales = new Map((await tx.precioLista.findMany({ where: { listaId } })).map((p) => [p.articuloId, p]));
    let origen: Map<string, Dec>;
    let monedaOrigen: string;
    let sinOrigen: string;
    if (lista.base === 'LISTA') {
      const base = await this.lista(tx, lista.listaBaseId!);
      origen = new Map((await tx.precioLista.findMany({ where: { listaId: base.id } })).map((p) => [p.articuloId, new D(p.precio)]));
      monedaOrigen = base.monedaCodigo;
      sinOrigen = 'Sin precio en la lista base';
    } else {
      const ids = (await tx.articulo.findMany({ where: { activo: true, esServicio: false }, select: { id: true } })).map((a) => a.id);
      origen = await costosDeArticulos(tx, [...new Set([...ids, ...actuales.keys()])], this.tenant.empresaId);
      monedaOrigen = 'ARS';
      sinOrigen = 'Sin costo';
    }
    // Conversión de moneda con la cotización vigente (la del día o la última anterior)
    const factor = monedaOrigen === lista.monedaCodigo ? new D(1)
      : lista.monedaCodigo === 'USD' ? new D(1).div(await cotizacion(tx, 'USD', hoy())) : await cotizacion(tx, 'USD', hoy());
    // Revisión E52: los que tienen origen (precio en la base o costo) y los que ya tienen precio en la lista (con su motivo si no se recalculan)
    const candidatos = [...new Set([...origen.keys(), ...actuales.keys()])];
    const arts = new Map((await tx.articulo.findMany({ where: { id: { in: candidatos } }, select: { id: true, codigo: true, descripcion: true, activo: true, rubroId: true } })).map((a) => [a.id, a]));
    // E56: margen del rubro (activo) en esta lista
    const margenesRubro = lista.base === 'COSTO'
      ? new Map((await tx.margenRubroLista.findMany({ where: { listaId: lista.id } })).map((m) => [m.rubroId, new D(m.margenPct)]))
      : new Map<string, Dec>();
    const rubrosActivos = margenesRubro.size ? new Set((await tx.rubroArticulo.findMany({ where: { id: { in: [...margenesRubro.keys()] }, activo: true }, select: { id: true } })).map((r) => r.id)) : new Set<string>();
    const filas = candidatos
      .filter((id) => arts.get(id)?.activo !== false || actuales.has(id))
      .map((id) => {
        const a = arts.get(id);
        const actual = actuales.get(id);
        const base = origen.get(id);
        let motivo: string | null = null;
        let nuevo: Dec | null = null;
        // Margen: el del artículo en la lista > el del rubro en la lista > el de la lista (E56)
        let margen = new D(lista.porcentaje);
        let origenMargen: 'ARTICULO' | 'RUBRO' | 'LISTA' = 'LISTA';
        if (lista.base === 'COSTO' && actual?.margenPct != null) { margen = new D(actual.margenPct); origenMargen = 'ARTICULO'; }
        else if (lista.base === 'COSTO' && a?.rubroId && rubrosActivos.has(a.rubroId)) { margen = margenesRubro.get(a.rubroId)!; origenMargen = 'RUBRO'; }
        if (actual?.fijo) motivo = 'Precio fijo';
        else if (!base) motivo = sinOrigen;
        else nuevo = precioDerivado(base.times(factor), margen, lista.redondeo as Redondeo);
        const act = actual ? new D(actual.precio) : null;
        return {
          articuloId: id, codigo: a?.codigo ?? '', descripcion: a?.descripcion ?? '', actual: act?.toString() ?? null, nuevo: nuevo?.toString() ?? null,
          variacionPct: act && nuevo && act.gt(0) ? nuevo.div(act).minus(1).times(100).toDecimalPlaces(2).toString() : null, motivo,
          ...(lista.base === 'COSTO' ? { margen: margen.toString(), origenMargen } : {}),
        };
      })
      .sort((x, y) => x.codigo.localeCompare(y.codigo));
    return { lista, filas };
  }

  async vistaPrevia(listaId: string) {
    return { filas: (await this.calcularLista(this.tenant.db, listaId)).filas };
  }

  /** E52: aplica el recálculo (recalcula en el momento); los fijos y sin origen no cambian aunque se elijan. */
  aplicarRecalculo(listaId: string, articuloIds?: string[]) {
    // Revisión E52: un catálogo grande no entra en el tiempo por defecto de la transacción
    return this.tenant.transaccion(async (tx) => {
      await this.bloquearListas(tx);
      const { lista, filas } = await this.calcularLista(tx, listaId);
      const elegidos = articuloIds ? new Set(articuloIds) : null;
      let actualizados = 0, agregados = 0;
      for (const f of filas) {
        if (!f.nuevo || (elegidos && !elegidos.has(f.articuloId))) continue;
        if (await this.fijar(tx, listaId, f.articuloId, new D(f.nuevo), 'RECALCULO')) f.actual === null ? agregados++ : actualizados++;
      }
      await this.auditoria.registrar(tx, { entidad: 'ListaPrecios', entidadId: listaId, accion: 'MODIFICAR', datos: { recalculo: true, actualizados, agregados } });
      const dependientes = await tx.listaPrecios.findMany({ where: { base: 'LISTA', listaBaseId: lista.id }, orderBy: { nombre: 'asc' } });
      return { actualizados, agregados, aviso: dependientes.length ? `Las listas ${dependientes.map((d) => d.nombre).join(', ')} dependen de esta: recalcúlelas` : null };
    }, { timeout: 120000 });
  }

  aumento(listaId: string, d: { porcentaje: number; articuloIds?: string[]; redondeo: Redondeo }) {
    return this.tenant.transaccion(async (tx) => {
      await this.lista(tx, listaId);
      if (d.articuloIds && !d.articuloIds.length) throw new BadRequestException('Elija al menos un artículo');
      const filas = await tx.precioLista.findMany({ where: { listaId, articuloId: d.articuloIds ? { in: d.articuloIds } : undefined } });
      let actualizados = 0;
      for (const f of filas) if (await this.fijar(tx, listaId, f.articuloId, aumentar(new D(f.precio), d.porcentaje, d.redondeo), 'AUMENTO')) actualizados++;
      await this.auditoria.registrar(tx, { entidad: 'ListaPrecios', entidadId: listaId, accion: 'MODIFICAR', datos: { aumento: d, actualizados } });
      return { actualizados };
    });
  }

  async importar(listaId: string, contenido: Buffer | undefined, nombre: string) {
    const filas = await leerPrecios(contenido ?? Buffer.alloc(0), nombre);
    if (!filas.length) throw new BadRequestException('El archivo no tiene precios');
    return this.tenant.transaccion(async (tx) => {
      await this.lista(tx, listaId);
      const arts = new Map((await tx.articulo.findMany({ where: { codigo: { in: filas.map((f) => f.codigo) } } })).map((a) => [a.codigo, a.id]));
      const existentes = new Set((await tx.precioLista.findMany({ where: { listaId } })).map((p) => p.articuloId));
      let creados = 0;
      let actualizados = 0;
      for (const f of filas) {
        const id = arts.get(f.codigo);
        if (!id) throw new BadRequestException(`Línea ${f.linea}: artículo inexistente`);
        const habia = existentes.has(id);
        if (await this.fijar(tx, listaId, id, new D(f.precio), 'IMPORTACION')) habia ? actualizados++ : creados++;
      }
      return { creados, actualizados };
    });
  }

  async historial(listaId: string, articuloId?: string) {
    const h = await this.tenant.db.historialPrecio.findMany({ where: { listaId, articuloId: articuloId || undefined }, orderBy: { fecha: 'asc' } });
    return h.map((x) => ({ ...x, precioAnterior: x.precioAnterior?.toString() ?? null, precioNuevo: x.precioNuevo?.toString() ?? null }));
  }

  /** Precio sugerido para un cliente y artículo en la moneda del comprobante (spec §2). */
  async sugerido(tx: TxEmpresa, q: { terceroId: string; articuloId: string; monedaCodigo: string; cotizacion?: number | null }) {
    const t = await tx.tercero.findUnique({ where: { id: q.terceroId } });
    let lista = t?.listaPreciosId ? await tx.listaPrecios.findFirst({ where: { id: t.listaPreciosId, activa: true } }) : null;
    lista ??= await tx.listaPrecios.findFirst({ where: { porDefecto: true, activa: true } });
    if (!lista) return { precio: null, lista: null };
    const p = await tx.precioLista.findUnique({ where: { listaId_articuloId: { listaId: lista.id, articuloId: q.articuloId } } });
    const resumen = { id: lista.id, nombre: lista.nombre };
    if (!p) return { precio: null, lista: resumen };
    let precio = new D(p.precio);
    if (lista.monedaCodigo !== q.monedaCodigo) {
      const cot = q.cotizacion ? new D(q.cotizacion) : await cotizacion(tx, 'USD', hoy());
      precio = lista.monedaCodigo === 'USD' ? precio.times(cot) : precio.div(cot);
    }
    return { precio: precio.toFixed(2), lista: resumen };
  }

  /** E56: márgenes por rubro de una lista desde el costo (todos los rubros activos, con su margen o null). */
  async margenesRubro(listaId: string) {
    const db = this.tenant.db;
    const lista = await this.lista(db, listaId);
    if (lista.base !== 'COSTO') throw new BadRequestException('La lista no se calcula desde el costo');
    const m = new Map((await db.margenRubroLista.findMany({ where: { listaId } })).map((x) => [x.rubroId, x.margenPct]));
    return (await db.rubroArticulo.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } })).map((r) => ({ rubroId: r.id, nombre: r.nombre, margenPct: m.has(r.id) ? new D(m.get(r.id)!).toString() : null }));
  }

  guardarMargenesRubro(listaId: string, d: { margenes: { rubroId: string; margenPct: number }[] }) {
    return this.tenant.transaccion(async (tx) => {
      const lista = await this.lista(tx, listaId);
      if (lista.base !== 'COSTO') throw new BadRequestException('La lista no se calcula desde el costo');
      const ids = d.margenes.map((x) => x.rubroId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Hay un rubro repetido');
      const activos = await tx.rubroArticulo.count({ where: { id: { in: ids }, activo: true } });
      if (activos !== ids.length) throw new BadRequestException('Rubro inexistente o inactivo');
      // Solo se reemplazan los de rubros activos: los de un rubro desactivado se conservan por si se reactiva
      await tx.margenRubroLista.deleteMany({ where: { listaId, rubroId: { in: (await tx.rubroArticulo.findMany({ where: { activo: true }, select: { id: true } })).map((r) => r.id) } } });
      if (d.margenes.length) await tx.margenRubroLista.createMany({ data: d.margenes.map((x) => ({ empresaId: this.tenant.empresaId, listaId, rubroId: x.rubroId, margenPct: x.margenPct })) });
      await this.auditoria.registrar(tx, { entidad: 'ListaPrecios', entidadId: listaId, accion: 'MODIFICAR', datos: { margenesRubro: d.margenes } });
    }).then(() => this.margenesRubro(listaId));
  }
}
