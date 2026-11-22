import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { hoyEn, ZONA_ARGENTINA } from '@gestion/shared';
import { fechaQuery } from '../../compras/consultas/consultas.service';
import { TenantPrisma } from '../../prisma/tenant-prisma.service';
import { describirMovimientos } from '../ordenes/describir';
import { pdfCertificado, pdfOrdenPago } from './pdf';

const D = Prisma.Decimal;
const NOMBRES_JUR: Record<string, string> = { '901': 'CABA', '902': 'Buenos Aires' };
export const numeroOP = (n: number | null) => `0001-${String(n ?? 0).padStart(8, '0')}`;
const PREFIJO: Record<string, string> = { GANANCIAS: 'RET-GAN', IVA: 'RET-IVA', SUSS: 'RET-SUSS', GANANCIAS_EXTERIOR: 'RET-GAN-EXT' };
export const numeroCertificado = (impuesto: string, jurisdiccion: string | null, n: number) =>
  `${PREFIJO[impuesto] ?? `RET-IIBB-${jurisdiccion}`} ${String(n).padStart(8, '0')}`;
/** Descripción de la retención en el PDF de la orden de pago (revisión E43: Ganancias exterior). */
export const descripcionRetencionOP = (r: { impuesto: string; regimen: string | null; jurisdiccion: string | null; detalle: Prisma.JsonValue }) => {
  const d = r.detalle as Record<string, string>;
  if (r.impuesto === 'GANANCIAS') return `Ganancias (régimen ${r.regimen})`;
  if (r.impuesto === 'GANANCIAS_EXTERIOR') return `Ganancias exterior (régimen ${d.codigoSire ?? ''})`;
  if (r.impuesto === 'IVA' || r.impuesto === 'SUSS') return `${r.impuesto} ${String(d.puntoVenta ?? '').padStart(5, '0')}-${String(d.numero ?? '').padStart(8, '0')}`;
  return `IIBB ${NOMBRES_JUR[r.jurisdiccion ?? ''] ?? r.jurisdiccion}`;
};
/** Detalle de la retención al exterior en la constancia (revisión E43): régimen, código SIRE, convenio y acrecentamiento. */
export const detalleExterior = (reg: { descripcion: string } | null, detalle: Prisma.JsonValue) => {
  const d = detalle as Record<string, string>;
  return [reg?.descripcion ?? 'Régimen', `régimen SIRE ${d.codigoSire ?? ''}`, d.aplicaCdi === 'true' ? 'con convenio de doble imposición' : '', d.acrecentamiento === 'true' ? 'con acrecentamiento (impuesto a cargo del pagador)' : '']
    .filter(Boolean).join(' — ');
};
const NOMBRE_IMPUESTO: Record<string, string> = { GANANCIAS: 'Impuesto a las Ganancias', IVA: 'IVA', SUSS: 'SUSS (seguridad social)', IIBB: 'Ingresos Brutos', GANANCIAS_EXTERIOR: 'Ganancias (beneficiarios del exterior)' };

@Injectable()
export class ConsultasPagosService {
  constructor(private readonly tenant: TenantPrisma) {}

  async pagosARealizar(fecha?: string) {
    const corte = fechaQuery(fecha) ?? new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`);
    const movs = await this.tenant.db.movimientoCuentaCorriente.findMany({
      where: { anulado: false, origenTipo: 'COMPRA', saldo: { gt: 0 } }, orderBy: { fechaVencimiento: 'asc' },
    });
    const terceros = await this.tenant.db.tercero.findMany({ where: { id: { in: [...new Set(movs.map((m) => m.terceroId))] } }, select: { id: true, razonSocial: true } });
    const desc = await describirMovimientos(this.tenant.db, movs);
    const ops = await this.tenant.db.ordenPago.findMany({ where: { estado: 'APROBADA' }, include: { tercero: { select: { razonSocial: true } } }, orderBy: { fecha: 'asc' } });
    return {
      comprobantes: movs.map((m) => ({
        terceroId: m.terceroId, razonSocial: terceros.find((t) => t.id === m.terceroId)?.razonSocial ?? '', movimientoId: m.id, comprobante: desc.get(m.id),
        fechaVencimiento: m.fechaVencimiento, monedaCodigo: m.monedaCodigo, saldo: m.saldo, saldoPesos: m.saldoPesos, vencido: m.fechaVencimiento < corte,
      })),
      ordenesAprobadas: ops.map((o) => ({ id: o.id, numero: o.numero, razonSocial: o.tercero.razonSocial, netoPagar: o.netoPagar, fecha: o.fecha })),
    };
  }

  /** Guarda el número de certificado SIRE de una retención (E43). */
  async certificadoSire(id: string, certificadoSire: string | null) {
    const r = await this.tenant.db.ordenPagoRetencion.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Retención inexistente');
    return this.tenant.db.ordenPagoRetencion.update({ where: { id }, data: { certificadoSire } });
  }

  async retenciones(f: { desde?: string; hasta?: string; impuesto?: string; jurisdiccion?: string; incluirAnuladas?: string }) {
    const filas = await this.tenant.db.ordenPagoRetencion.findMany({
      where: {
        certificadoNumero: { not: null }, impuesto: f.impuesto || undefined, jurisdiccion: f.jurisdiccion || undefined,
        anulada: f.incluirAnuladas === 'true' ? undefined : false,
        ordenPago: { fechaPago: { gte: fechaQuery(f.desde, true), lte: fechaQuery(f.hasta, true) } },
      },
      include: { ordenPago: { include: { tercero: { select: { razonSocial: true, cuit: true } } } } },
      orderBy: [{ impuesto: 'asc' }, { jurisdiccion: 'asc' }, { certificadoNumero: 'asc' }],
    });
    // IVA, SUSS y Ganancias exterior guardan el id del régimen: se muestra su descripción (revisión E35, E43)
    const ids = filas.filter((r) => (r.impuesto === 'IVA' || r.impuesto === 'SUSS' || r.impuesto === 'GANANCIAS_EXTERIOR') && r.regimen).map((r) => r.regimen!);
    const nombres = new Map([
      ...(await this.tenant.db.regimenIva.findMany({ where: { id: { in: ids } } })), ...(await this.tenant.db.regimenSuss.findMany({ where: { id: { in: ids } } })),
      ...(await this.tenant.db.regimenExterior.findMany({ where: { id: { in: ids } } })),
    ].map((g) => [g.id, g.descripcion]));
    return filas.map((r) => ({
      id: r.id, ordenPagoId: r.ordenPagoId, fechaPago: r.ordenPago.fechaPago, certificado: numeroCertificado(r.impuesto, r.jurisdiccion, r.certificadoNumero!),
      impuesto: r.impuesto, jurisdiccion: r.jurisdiccion, regimen: (r.regimen && nombres.get(r.regimen)) ?? r.regimen, razonSocial: r.ordenPago.tercero.razonSocial, cuit: r.ordenPago.tercero.cuit,
      base: r.base.toFixed(2), alicuota: r.alicuota, importe: r.importe.toFixed(2), ordenPagoNumero: numeroOP(r.ordenPago.numero), anulada: r.anulada, certificadoSire: r.certificadoSire,
    }));
  }

  async retencionesXlsx(f: Parameters<ConsultasPagosService['retenciones']>[0]): Promise<Buffer> {
    const filas = await this.retenciones(f);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Retenciones');
    ws.columns = [
      { header: 'Fecha', key: 'fecha', width: 12 }, { header: 'Certificado', key: 'certificado', width: 24 }, { header: 'Impuesto', key: 'impuesto', width: 12 },
      { header: 'Jurisdicción / régimen', key: 'detalle', width: 20 }, { header: 'Proveedor', key: 'razonSocial', width: 32 }, { header: 'CUIT', key: 'cuit', width: 14 },
      { header: 'Base', key: 'base', width: 15, style: { numFmt: '#,##0.00' } }, { header: 'Alícuota', key: 'alicuota', width: 10 },
      { header: 'Importe', key: 'importe', width: 15, style: { numFmt: '#,##0.00' } }, { header: 'Orden de pago', key: 'op', width: 16 }, { header: 'Anulada', key: 'anulada', width: 9 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of filas)
      ws.addRow({
        fecha: r.fechaPago?.toISOString().slice(0, 10).split('-').reverse().join('/'), certificado: r.certificado, impuesto: r.impuesto,
        detalle: r.jurisdiccion ?? r.regimen, razonSocial: r.razonSocial, cuit: r.cuit, base: Number(r.base), alicuota: r.alicuota,
        importe: Number(r.importe), op: r.ordenPagoNumero, anulada: r.anulada ? 'Sí' : '',
      });
    const t = ws.addRow({ fecha: 'Totales', importe: filas.filter((r) => !r.anulada).reduce((s, r) => s + Number(r.importe), 0) });
    t.font = { bold: true };
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private async empresa() {
    return this.tenant.db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
  }

  async pdfOP(id: string): Promise<{ nombre: string; contenido: Buffer }> {
    const op = await this.tenant.db.ordenPago.findUnique({ where: { id }, include: { tercero: true, imputaciones: true, retenciones: true, medios: true } });
    if (!op) throw new NotFoundException('Orden de pago no encontrada');
    if (op.numero === null) throw new BadRequestException('La orden no está confirmada');
    const movs = await this.tenant.db.movimientoCuentaCorriente.findMany({ where: { id: { in: op.imputaciones.map((i) => i.movimientoId) } } });
    const desc = await describirMovimientos(this.tenant.db, movs);
    const contenido = await pdfOrdenPago({
      empresa: await this.empresa(), proveedor: op.tercero, numero: numeroOP(op.numero), fecha: op.fecha, fechaPago: op.fechaPago, estado: op.estado,
      imputaciones: op.imputaciones.map((i) => ({ comprobante: desc.get(i.movimientoId) ?? '', moneda: movs.find((m) => m.id === i.movimientoId)?.monedaCodigo ?? 'ARS', importe: i.importe.toString(), importePesos: i.importePesos.toString() })),
      retenciones: op.retenciones.filter((r) => r.importe.gt(0)).map((r) => ({
        descripcion: descripcionRetencionOP(r),
        base: r.base.toString(), importe: r.importe.toString(), certificado: r.certificadoNumero ? numeroCertificado(r.impuesto, r.jurisdiccion, r.certificadoNumero) : '',
      })),
      medios: op.medios.map((m) => ({ descripcion: `${m.tipo === 'TRANSFERENCIA' ? 'Transferencia' : m.tipo === 'CHEQUE' ? `Cheque ${m.chequeNumero}` : 'Efectivo'} ${m.monedaCodigo}${m.monedaCodigo === 'USD' ? ` ${m.importe.toString()}` : ''}`, importe: m.importePesos.toString() })),
      totalCancelar: op.totalCancelarPesos.toString(), totalRetenciones: op.totalRetenciones.toString(), neto: op.netoPagar.toString(),
    });
    return { nombre: `orden-pago-${numeroOP(op.numero)}.pdf`, contenido };
  }

  async pdfCertificado(opId: string, retencionId: string): Promise<{ nombre: string; contenido: Buffer }> {
    const r = await this.tenant.db.ordenPagoRetencion.findUnique({ where: { id: retencionId }, include: { ordenPago: { include: { tercero: true } } } });
    if (!r || r.ordenPagoId !== opId) throw new NotFoundException('Retención no encontrada');
    if (!r.certificadoNumero || !['PAGADA', 'ANULADA'].includes(r.ordenPago.estado)) throw new BadRequestException('La retención todavía no tiene certificado');
    const certificado = numeroCertificado(r.impuesto, r.jurisdiccion, r.certificadoNumero);
    const contenido = await pdfCertificado({
      empresa: await this.empresa(), proveedor: r.ordenPago.tercero, certificado, fecha: r.ordenPago.fechaPago!,
      impuesto: NOMBRE_IMPUESTO[r.impuesto] ?? r.impuesto,
      detalleImpuesto: await this.detalleImpuesto(r),
      base: r.base.toString(), alicuota: r.alicuota, importe: r.importe.toString(), ordenPago: numeroOP(r.ordenPago.numero), anulado: r.anulada,
      // E35: con el SIRE el certificado oficial lo emite ARCA; el PDF del sistema es una constancia
      constancia: r.impuesto === 'IVA' || r.impuesto === 'SUSS' ? { titulo: `CONSTANCIA DE RETENCIÓN DE ${r.impuesto}`, leyenda: 'El certificado oficial se emite en el SIRE de ARCA' }
        // E43: Ganancias a beneficiarios del exterior (F.2003)
        : r.impuesto === 'GANANCIAS_EXTERIOR' ? { titulo: 'CONSTANCIA DE RETENCIÓN DE GANANCIAS (BENEFICIARIO DEL EXTERIOR)', leyenda: 'El certificado oficial se emite en el SIRE de ARCA' } : null,
    });
    return { nombre: `certificado-${certificado.replace(' ', '-')}.pdf`, contenido };
  }

  /** Detalle del impuesto en el PDF: régimen de Ganancias, jurisdicción de IIBB o régimen y factura de IVA/SUSS (E35). */
  private async detalleImpuesto(r: { impuesto: string; regimen: string | null; jurisdiccion: string | null; detalle: Prisma.JsonValue }) {
    if (r.impuesto === 'GANANCIAS') return `RG 830 régimen ${r.regimen}`;
    if (r.impuesto === 'IVA' || r.impuesto === 'SUSS') {
      const reg = r.regimen ? (r.impuesto === 'IVA' ? await this.tenant.db.regimenIva.findUnique({ where: { id: r.regimen } }) : await this.tenant.db.regimenSuss.findUnique({ where: { id: r.regimen } })) : null;
      const d = r.detalle as Record<string, string>;
      return `${reg?.descripcion ?? 'Régimen'} — factura ${d.letra ?? ''} ${String(d.puntoVenta ?? '').padStart(5, '0')}-${String(d.numero ?? '').padStart(8, '0')} del ${d.fecha ?? ''} por $ ${d.total ?? ''}`.replace(/\s+/g, ' ');
    }
    if (r.impuesto === 'GANANCIAS_EXTERIOR') return detalleExterior(r.regimen ? await this.tenant.db.regimenExterior.findUnique({ where: { id: r.regimen } }) : null, r.detalle);
    return `Jurisdicción ${r.jurisdiccion} ${NOMBRES_JUR[r.jurisdiccion ?? ''] ?? ''}`.trim();
  }
}

export { D };
