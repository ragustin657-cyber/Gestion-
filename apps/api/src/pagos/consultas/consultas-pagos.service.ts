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
export const numeroCertificado = (impuesto: string, jurisdiccion: string | null, n: number) =>
  `${impuesto === 'GANANCIAS' ? 'RET-GAN' : `RET-IIBB-${jurisdiccion}`} ${String(n).padStart(8, '0')}`;

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
    return filas.map((r) => ({
      id: r.id, ordenPagoId: r.ordenPagoId, fechaPago: r.ordenPago.fechaPago, certificado: numeroCertificado(r.impuesto, r.jurisdiccion, r.certificadoNumero!),
      impuesto: r.impuesto, jurisdiccion: r.jurisdiccion, regimen: r.regimen, razonSocial: r.ordenPago.tercero.razonSocial, cuit: r.ordenPago.tercero.cuit,
      base: r.base.toFixed(2), alicuota: r.alicuota, importe: r.importe.toFixed(2), ordenPagoNumero: numeroOP(r.ordenPago.numero), anulada: r.anulada,
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
        descripcion: r.impuesto === 'GANANCIAS' ? `Ganancias (régimen ${r.regimen})` : `IIBB ${NOMBRES_JUR[r.jurisdiccion ?? ''] ?? r.jurisdiccion}`,
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
      impuesto: r.impuesto === 'GANANCIAS' ? 'Impuesto a las Ganancias' : 'Ingresos Brutos',
      detalleImpuesto: r.impuesto === 'GANANCIAS' ? `RG 830 régimen ${r.regimen}` : `Jurisdicción ${r.jurisdiccion} ${NOMBRES_JUR[r.jurisdiccion ?? ''] ?? ''}`.trim(),
      base: r.base.toString(), alicuota: r.alicuota, importe: r.importe.toString(), ordenPago: numeroOP(r.ordenPago.numero), anulado: r.anulada,
    });
    return { nombre: `certificado-${certificado.replace(' ', '-')}.pdf`, contenido };
  }
}

export { D };
