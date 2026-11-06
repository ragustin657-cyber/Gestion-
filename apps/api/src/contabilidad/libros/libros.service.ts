import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LibroLegal } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { fechaAR } from '../../compras/comun';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { TenantPrisma } from '../../prisma/tenant-prisma.service';
import { ConsultasContablesService } from '../consultas/consultas.service';
import { D, ejercicioDelRango } from '../consultas/saldos';
import { EstadosService } from '../estados/estados.service';
import { DocumentoFoliado } from './pdf-libros';

const iso = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class LibrosService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly consultas: ConsultasContablesService,
    private readonly estados: EstadosService,
    private readonly auditoria: AuditoriaService,
    private readonly cls: ClsService,
  ) {}

  private async folioPropuesto(libro: LibroLegal) {
    const u = await this.tenant.db.emisionLibro.findFirst({ where: { libro }, orderBy: { folioFinal: 'desc' } });
    return (u?.folioFinal ?? 0) + 1;
  }

  /** Registra la emisión y devuelve la advertencia si el rango ya se había emitido. */
  private async registrar(libro: LibroLegal, ejercicioId: string, desde: Date, hasta: Date, folioInicial: number, folioFinal: number) {
    const db = this.tenant.db;
    const previa = await db.emisionLibro.findFirst({ where: { libro, desde: { lte: hasta }, hasta: { gte: desde } }, orderBy: { fecha: 'asc' } });
    const e = await db.emisionLibro.create({
      data: { empresaId: this.tenant.empresaId, libro, ejercicioId, desde, hasta, folioInicial, folioFinal, usuarioId: this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId },
    });
    await this.auditoria.registrar(db, { entidad: 'EmisionLibro', entidadId: e.id, accion: 'CREAR', datos: { libro, desde: iso(desde), hasta: iso(hasta), folioInicial, folioFinal } });
    return previa ? `El rango ya fue emitido el ${fechaAR(previa.fecha)} (folios ${previa.folioInicial} a ${previa.folioFinal})` : null;
  }

  async diario(desde: Date, hasta: Date, folio?: number) {
    const db = this.tenant.db;
    if (hasta < desde) throw new BadRequestException('La fecha hasta no puede ser anterior a la fecha desde');
    const ej = await ejercicioDelRango(db, desde, hasta, desde);
    const periodos = await db.periodoContable.findMany({ where: { ejercicioId: ej.id, desde: { lte: hasta }, hasta: { gte: desde } }, orderBy: [{ anio: 'asc' }, { mes: 'asc' }] });
    const abierto = periodos.find((p) => p.estado !== 'CERRADO');
    if (abierto) throw new BadRequestException(`El período ${String(abierto.mes).padStart(2, '0')}/${abierto.anio} no está cerrado`);
    const folioInicial = folio ?? (await this.folioPropuesto('DIARIO'));
    const { items } = await this.consultas.diario({ desde: iso(desde), hasta: iso(hasta) }, true);
    items.sort((a, b) => (a.numeroDefinitivo ?? 0) - (b.numeroDefinitivo ?? 0));
    const e = await this.consultas.empresa();
    let debe = new D(0);
    let haber = new D(0);
    const doc = new DocumentoFoliado({ empresa: e.razonSocial, cuit: e.cuit, libro: 'Libro Diario', rango: `${fechaAR(desde)} al ${fechaAR(hasta)}` }, folioInicial, () => [debe.toString(), haber.toString()]);
    for (const a of items) {
      doc.reservar(a.renglones.length + 2);
      doc.fila([{ texto: `Asiento ${a.numeroDefinitivo}`, ancho: 70, negrita: true }, { texto: fechaAR(new Date(a.fecha)), ancho: 60, negrita: true }, { texto: a.descripcion, ancho: 385, negrita: true }]);
      for (const r of a.renglones) {
        doc.fila([{ texto: '', ancho: 20 }, { texto: `${r.cuenta.codigo} ${r.cuenta.nombre}${r.detalle ? ` · ${r.detalle}` : ''}`, ancho: 335 }, { texto: r.debe === '0' ? '' : r.debe, ancho: 80, importe: true }, { texto: r.haber === '0' ? '' : r.haber, ancho: 80, importe: true }]);
        debe = debe.plus(r.debe);
        haber = haber.plus(r.haber);
      }
    }
    doc.fila([{ texto: 'Totales', ancho: 355, negrita: true }, { texto: debe.toString(), ancho: 80, importe: true, negrita: true }, { texto: haber.toString(), ancho: 80, importe: true, negrita: true }]);
    const { pdf, folioFinal } = await doc.terminar();
    const advertencia = await this.registrar('DIARIO', ej.id, desde, hasta, folioInicial, folioFinal);
    return { pdf, folioInicial, folioFinal, advertencia };
  }

  async inventarios(ejercicioId: string, folio?: number) {
    const db = this.tenant.db;
    const ej = await db.ejercicio.findUnique({ where: { id: ejercicioId } });
    if (!ej) throw new NotFoundException('Ejercicio no encontrado');
    if (ej.estado !== 'CERRADO') throw new BadRequestException('El Libro de Inventarios y Balances se emite con el ejercicio cerrado');
    const folioInicial = folio ?? (await this.folioPropuesto('INVENTARIOS'));
    const e = await this.consultas.empresa();
    const doc = new DocumentoFoliado({ empresa: e.razonSocial, cuit: e.cuit, libro: 'Libro de Inventarios y Balances', rango: `Ejercicio ${ej.numero} · ${fechaAR(ej.desde)} al ${fechaAR(ej.hasta)}` }, folioInicial);
    const ss = await this.consultas.sumasSaldos({ ejercicioId });
    doc.titulo('Balance de sumas y saldos');
    for (const f of ss.filas)
      doc.fila([{ texto: `${'  '.repeat(f.nivel - 1)}${f.codigo} ${f.nombre}`, ancho: 195, negrita: !f.imputable }, { texto: f.debe, ancho: 80, importe: true }, { texto: f.haber, ancho: 80, importe: true }, { texto: f.saldoDeudor, ancho: 80, importe: true }, { texto: f.saldoAcreedor, ancho: 80, importe: true }]);
    doc.fila([{ texto: 'Totales', ancho: 195, negrita: true }, { texto: ss.totales.debe, ancho: 80, importe: true, negrita: true }, { texto: ss.totales.haber, ancho: 80, importe: true, negrita: true }, { texto: ss.totales.saldoDeudor, ancho: 80, importe: true, negrita: true }, { texto: ss.totales.saldoAcreedor, ancho: 80, importe: true, negrita: true }]);
    const sit = await this.estados.situacion({ fecha: iso(ej.hasta), nivel: '4' });
    doc.titulo('Estado de situación patrimonial');
    const bloque = (t: string, b: { total: string; filas: { codigo: string; nombre: string; nivel: number; importe: string }[] }) => {
      doc.fila([{ texto: t, ancho: 435, negrita: true }]);
      for (const f of b.filas) doc.fila([{ texto: `${'  '.repeat(f.nivel)}${f.codigo} ${f.nombre}`, ancho: 435 }, { texto: f.importe, ancho: 80, importe: true }]);
      doc.fila([{ texto: `Total ${t.toLowerCase()}`, ancho: 435, negrita: true }, { texto: b.total, ancho: 80, importe: true, negrita: true }]);
    };
    bloque('Activo', sit.activo);
    bloque('Pasivo', sit.pasivo);
    bloque('Patrimonio neto', sit.patrimonioNeto);
    const res = await this.estados.resultados({ desde: iso(ej.desde), hasta: iso(ej.hasta), nivel: '4' });
    doc.titulo('Estado de resultados');
    bloque('Resultados positivos', res.positivos);
    bloque('Resultados negativos', res.negativos);
    doc.fila([{ texto: 'Resultado del ejercicio', ancho: 435, negrita: true }, { texto: res.resultado, ancho: 80, importe: true, negrita: true }]);
    const { pdf, folioFinal } = await doc.terminar();
    const advertencia = await this.registrar('INVENTARIOS', ej.id, ej.desde, ej.hasta, folioInicial, folioFinal);
    return { pdf, folioInicial, folioFinal, advertencia };
  }

  emisiones() {
    return this.tenant.db.emisionLibro.findMany({ orderBy: { fecha: 'desc' }, take: 200 });
  }
}
