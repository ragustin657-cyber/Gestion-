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

  crearLista(d: { nombre: string; monedaCodigo: string; activa: boolean; porDefecto: boolean }) {
    return conUnicidad(LISTA_DUPLICADA, () => this.tenant.transaccion(async (tx) => {
      if (d.porDefecto && !d.activa) throw new BadRequestException(INACTIVA_DEFECTO);
      await this.bloquearListas(tx);
      if (d.porDefecto) await tx.listaPrecios.updateMany({ data: { porDefecto: false } });
      const l = await tx.listaPrecios.create({ data: { ...d, empresaId: this.tenant.empresaId } });
      await this.auditoria.registrar(tx, { entidad: 'ListaPrecios', entidadId: l.id, accion: 'CREAR', datos: d });
      return l;
    }));
  }

  modificarLista(id: string, d: { nombre?: string; monedaCodigo?: string; activa?: boolean; porDefecto?: boolean }) {
    return conUnicidad(LISTA_DUPLICADA, () => this.tenant.transaccion(async (tx) => {
      await this.bloquearListas(tx);
      const l = await this.lista(tx, id);
      if ((d.porDefecto ?? l.porDefecto) && !(d.activa ?? l.activa)) throw new BadRequestException(INACTIVA_DEFECTO);
      if (d.monedaCodigo && d.monedaCodigo !== l.monedaCodigo && (await tx.precioLista.count({ where: { listaId: id } })))
        throw new BadRequestException('La lista tiene precios: no se puede cambiar la moneda');
      if (d.porDefecto) await tx.listaPrecios.updateMany({ where: { id: { not: id } }, data: { porDefecto: false } });
      const r = await tx.listaPrecios.update({ where: { id }, data: d });
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
      .map((f) => ({ articuloId: f.articuloId, codigo: arts.get(f.articuloId)?.codigo ?? '', descripcion: arts.get(f.articuloId)?.descripcion ?? '', precio: new D(f.precio).toString(), actualizadoEn: f.actualizadoEn }))
      .filter((f) => !t || f.codigo.toLowerCase().includes(t) || f.descripcion.toLowerCase().includes(t))
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
  }

  /** Fija un precio (o lo borra con null) y lo registra en el historial. */
  private async fijar(tx: TxEmpresa, listaId: string, articuloId: string, precio: Dec | null, motivo: MotivoPrecio) {
    const actual = await tx.precioLista.findUnique({ where: { listaId_articuloId: { listaId, articuloId } } });
    if (precio === null) {
      if (!actual) return false;
      await tx.precioLista.delete({ where: { id: actual.id } });
    } else if (actual) {
      if (new D(actual.precio).eq(precio)) return false;
      await tx.precioLista.update({ where: { id: actual.id }, data: { precio } });
    } else {
      await tx.precioLista.create({ data: { empresaId: this.tenant.empresaId, listaId, articuloId, precio } });
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
}
