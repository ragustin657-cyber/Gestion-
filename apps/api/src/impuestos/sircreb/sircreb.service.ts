import { JURISDICCIONES_CM } from '@gestion/shared';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';

const D = Prisma.Decimal;
export interface DatosRecaudacion { periodo: string; jurisdiccion: string; importe: number; cuentaBancariaId?: string | null; cbu?: string | null; referencia?: string | null }
const nombre = (j: string) => (JURISDICCIONES_CM as Record<string, string>)[j] ?? j;

/** Recaudaciones bancarias de IIBB (SIRCREB, spec E48 §5): pago a cuenta de la liquidación de IIBB del período. */
@Injectable()
export class SircrebService {
  constructor(private readonly tenant: TenantPrisma, private readonly auditoria: AuditoriaService) {}

  /** Con la liquidación de IIBB del período cerrada no se modifican (mismo lock que la liquidación). */
  private async editable(tx: TxEmpresa, periodo: string) {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `posicion-iibb:${this.tenant.empresaId}`);
    const anio = Number(periodo.slice(0, 4)), mes = Number(periodo.slice(4, 6));
    if (await tx.posicionIibb.findFirst({ where: { anio, mes } })) throw new BadRequestException(`La liquidación de IIBB de ${periodo.slice(4, 6)}/${anio} está cerrada`);
  }

  async listar(periodo?: string) {
    const rs = await this.tenant.db.recaudacionBancaria.findMany({ where: periodo ? { periodo } : {}, orderBy: [{ periodo: 'desc' }, { jurisdiccion: 'asc' }] });
    return rs.map((r) => ({ ...r, importe: new D(r.importe).toFixed(2), nombre: nombre(r.jurisdiccion) }));
  }

  /** Una fila por período, jurisdicción y cuenta (o CBU): si existe, se actualiza. */
  private async guardarEn(tx: TxEmpresa, d: DatosRecaudacion) {
    const clave = { periodo: d.periodo, jurisdiccion: d.jurisdiccion, cuentaBancariaId: d.cuentaBancariaId ?? null, cbu: d.cbu ?? null };
    const previa = await tx.recaudacionBancaria.findFirst({ where: clave });
    return previa
      ? tx.recaudacionBancaria.update({ where: { id: previa.id }, data: { importe: d.importe, referencia: d.referencia ?? previa.referencia } })
      : tx.recaudacionBancaria.create({ data: { ...clave, importe: d.importe, referencia: d.referencia ?? null, empresaId: this.tenant.empresaId } });
  }

  guardar(id: string | null, d: DatosRecaudacion) {
    return this.tenant.transaccion(async (tx) => {
      await this.editable(tx, d.periodo);
      let r;
      if (id) {
        const actual = await tx.recaudacionBancaria.findUnique({ where: { id } });
        if (!actual) throw new NotFoundException('Recaudación no encontrada');
        await this.editable(tx, actual.periodo);
        // Revisión E48: si no vienen, se conservan la cuenta y el CBU (la reimportación los usa para encontrar la fila)
        r = await tx.recaudacionBancaria.update({ where: { id }, data: { ...d, cuentaBancariaId: d.cuentaBancariaId === undefined ? actual.cuentaBancariaId : d.cuentaBancariaId, cbu: d.cbu === undefined ? actual.cbu : d.cbu } });
      } else {
        // Revisión E48: la carga a mano no pisa otra recaudación (dos bancos pueden debitar la misma jurisdicción): se pide modificarla o distinguirla
        const clave = { periodo: d.periodo, jurisdiccion: d.jurisdiccion, cuentaBancariaId: d.cuentaBancariaId ?? null, cbu: d.cbu ?? null };
        if (await tx.recaudacionBancaria.findFirst({ where: clave }))
          throw new BadRequestException(`Ya hay una recaudación de ${nombre(d.jurisdiccion)} en ${d.periodo.slice(4, 6)}/${d.periodo.slice(0, 4)}: modifíquela o indique la cuenta o el CBU`);
        r = await this.guardarEn(tx, d);
      }
      await this.auditoria.registrar(tx, { entidad: 'RecaudacionBancaria', entidadId: r.id, accion: id ? 'MODIFICAR' : 'CREAR', datos: d });
      return r;
    });
  }

  eliminar(id: string) {
    return this.tenant.transaccion(async (tx) => {
      const r = await tx.recaudacionBancaria.findUnique({ where: { id } });
      if (!r) throw new NotFoundException('Recaudación no encontrada');
      await this.editable(tx, r.periodo);
      await tx.recaudacionBancaria.delete({ where: { id } });
      await this.auditoria.registrar(tx, { entidad: 'RecaudacionBancaria', entidadId: id, accion: 'ELIMINAR' });
      return { ok: true };
    });
  }

  /** Importa la consulta de SIRCREB: `periodo;jurisdiccion;importe[;cbu]` (con o sin encabezado; decimales con punto o coma). */
  importar(texto: string) {
    const filas: DatosRecaudacion[] = [];
    texto.split(/\r?\n/).forEach((linea, i) => {
      if (!linea.trim()) return;
      // El separador es «;» o tabulador; la coma solo si no hay otro (puede ser el decimal)
      const sep = linea.includes(';') ? ';' : linea.includes('\t') ? '\t' : ',';
      const c = linea.split(sep).map((x) => x.trim());
      // Con coma de separador, «1500,50» se partiría: el cuarto campo tiene que ser un CBU (22 dígitos)
      if (sep === ',' && (c.length > 4 || (c[3] !== undefined && !/^\d{22}$/.test(c[3])))) throw new BadRequestException(`Línea ${i + 1} inválida: use «;» como separador si el importe tiene coma decimal`);
      if (i === 0 && !/^\d{6}$/.test(c[0])) return; // encabezado
      const mal = (campo: string): never => { throw new BadRequestException(`Línea ${i + 1} inválida: ${campo}`); };
      if (!/^\d{6}$/.test(c[0]) || Number(c[0].slice(4)) < 1 || Number(c[0].slice(4)) > 12) mal('período');
      if (!(c[1] in JURISDICCIONES_CM)) mal('jurisdicción');
      const importe = Number((c[2] ?? '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
      if (!c[2] || Number.isNaN(importe) || importe < 0) mal('importe');
      filas.push({ periodo: c[0], jurisdiccion: c[1], importe, cbu: c[3] || null });
    });
    if (!filas.length) throw new BadRequestException('El archivo no tiene filas');
    return this.tenant.transaccion(async (tx) => {
      for (const p of new Set(filas.map((f) => f.periodo))) await this.editable(tx, p);
      for (const f of filas) await this.guardarEn(tx, f);
      await this.auditoria.registrar(tx, { entidad: 'RecaudacionBancaria', entidadId: this.tenant.empresaId, accion: 'CREAR', datos: { importadas: filas.length } });
      return { importadas: filas.length };
    });
  }
}
