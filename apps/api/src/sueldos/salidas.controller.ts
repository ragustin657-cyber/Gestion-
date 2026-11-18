import { BadRequestException, NotFoundException, Controller, Get, Param, ParseUUIDPipe, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { RequierePermiso } from '../auth/requiere-permiso.decorator';
import { Columna, Fila, tablaPdf } from '../contabilidad/consultas/exportar';
import { TenantPrisma } from '../prisma/tenant-prisma.service';
import { LiquidacionesService } from './liquidaciones.service';
import { CAUSAS_EGRESO } from './contabilizacion.service';
import { DatosRecibo, pdfRecibos } from './recibo-pdf';
import { HojaGanancias } from './ganancias/calculo';
import { pdfHojaGanancias } from './ganancias/hoja-pdf';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('sueldos/liquidaciones')
export class SalidasSueldosController {
  constructor(private readonly l: LiquidacionesService, private readonly tenant: TenantPrisma) {}

  private periodo(x: { tipo: string; anio: number; mes: number }) {
    const mm = `${String(x.mes).padStart(2, '0')}/${x.anio}`;
    return x.tipo === 'SAC' ? `SAC ${x.mes === 6 ? '1.er' : '2.º'} semestre ${x.anio}` : x.tipo === 'FINAL' ? `Final ${mm}` : `Mensual ${mm}`;
  }

  @Get(':id/recibos/:reciboId/ganancias.pdf') @RequierePermiso('sueldos.ver')
  async hojaGanancias(@Param('id', ParseUUIDPipe) id: string, @Param('reciboId', ParseUUIDPipe) reciboId: string, @Res({ passthrough: true }) res: Response) {
    const r = await this.tenant.db.reciboSueldo.findFirst({ where: { id: reciboId, liquidacionId: id }, include: { liquidacion: true } });
    if (!r) throw new NotFoundException('Recibo inexistente');
    if (!r.hojaGanancias) throw new BadRequestException('El recibo no tiene cálculo de Ganancias');
    const empresa = await this.tenant.db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    const pdf = await pdfHojaGanancias({ empresa, empleado: r, periodo: this.periodo(r.liquidacion), hoja: r.hojaGanancias as unknown as HojaGanancias });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="ganancias-legajo-${r.legajo}.pdf"` });
    return new StreamableFile(pdf);
  }

  @Get(':id/recibos.pdf') @RequierePermiso('sueldos.ver')
  async recibos(@Param('id', ParseUUIDPipe) id: string, @Query('empleadoId') empleadoId: string | undefined, @Res({ passthrough: true }) res: Response) {
    if (empleadoId !== undefined && !/^[0-9a-f-]{36}$/i.test(empleadoId)) throw new BadRequestException('Empleado inválido');
    const liq = await this.l.obtener(id);
    const empresa = await this.tenant.db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    const recibos = liq.recibos.filter((r) => !empleadoId || r.empleadoId === empleadoId);
    if (empleadoId && !recibos.length) throw new BadRequestException('El empleado no tiene recibo en la liquidación');
    const formas = new Map((await this.tenant.db.empleado.findMany({ where: { id: { in: recibos.map((r) => r.empleadoId) } }, select: { id: true, formaPago: true } })).map((e) => [e.id, e.formaPago]));
    const datos: DatosRecibo[] = recibos.map((r) => ({
      empresa: { razonSocial: empresa.razonSocial, cuit: empresa.cuit, domicilio: empresa.domicilio },
      empleado: { legajo: r.legajo, apellido: r.apellido, nombre: r.nombre, cuil: r.cuil, categoria: r.categoria, fechaIngreso: r.fechaIngreso, antiguedadAnios: r.antiguedadAnios, basico: r.basico ?? '0.00', formaPago: r.formaPago ?? formas.get(r.empleadoId) ?? 'TRANSFERENCIA' },
      periodo: this.periodo(liq), numero: r.numero,
      renglones: r.renglones.map((x) => ({ codigo: x.codigo, nombre: x.nombre, clase: x.clase, cantidad: x.cantidad, base: x.base, porcentaje: x.porcentaje, importe: x.importe ?? '0.00' })),
      totales: { remunerativo: r.totalRemunerativo ?? '0.00', noRemunerativo: r.totalNoRemunerativo ?? '0.00', descuentos: r.totalDescuentos ?? '0.00', neto: r.neto ?? '0.00' },
      deposito: { fecha: liq.ultimoDepositoFecha, banco: liq.ultimoDepositoBanco, periodo: liq.ultimoDepositoPeriodo },
      fechaPago: liq.fechaPago, borrador: liq.estado === 'BORRADOR',
      final: liq.egreso ? { causa: CAUSAS_EGRESO[liq.egreso.causa], fechaEgreso: liq.egreso.fechaEgreso } : null,
    }));
    const nombre = `recibos-${liq.anio}-${String(liq.mes).padStart(2, '0')}${liq.tipo === 'SAC' ? '-sac' : liq.tipo === 'FINAL' ? '-final' : ''}${recibos.length === 1 ? `-legajo-${recibos[0].legajo}` : ''}`;
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nombre}.pdf"` });
    return new StreamableFile(await pdfRecibos(datos));
  }

  @Get(':id/resumen') @RequierePermiso('sueldos.ver')
  async resumen(@Param('id', ParseUUIDPipe) id: string, @Query('formato') formato: string, @Res({ passthrough: true }) res: Response) {
    if (formato !== 'xlsx' && formato !== 'pdf') throw new BadRequestException('Formato inválido: use xlsx o pdf');
    const liq = await this.l.obtener(id);
    // Por concepto: suma de importes de todos los recibos, en el orden de los conceptos
    const conceptos = new Map<string, { codigo: string; nombre: string; orden: number; importe: number }>();
    for (const r of liq.recibos) for (const x of r.renglones) {
      const c = conceptos.get(x.codigo) ?? { codigo: x.codigo, nombre: x.nombre, orden: x.orden, importe: 0 };
      c.importe = Math.round((c.importe + Number(x.importe)) * 100) / 100;
      conceptos.set(x.codigo, c);
    }
    const porConcepto: Fila[] = [...conceptos.values()].sort((a, b) => a.orden - b.orden || a.codigo.localeCompare(b.codigo)).map((c) => [c.codigo, c.nombre, c.importe]);
    const porEmpleado: Fila[] = liq.recibos.map((r) => [r.legajo, `${r.apellido}, ${r.nombre}`, r.cuil, r.categoria, Number(r.totalRemunerativo), Number(r.totalNoRemunerativo), Number(r.totalDescuentos), Number(r.neto)]);
    const t = liq.totales;
    const totalEmp: Fila = ['', 'Totales', '', '', Number(t.remunerativo), Number(t.noRemunerativo), Number(t.descuentos), Number(t.neto)];
    const titulo = `Resumen de liquidación ${this.periodo(liq)}`.replace(/[*?:\\/\[\]]/g, '-');
    const nombre = `resumen-sueldos-${liq.anio}-${String(liq.mes).padStart(2, '0')}${liq.tipo === 'SAC' ? '-sac' : liq.tipo === 'FINAL' ? '-final' : ''}`;
    if (formato === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const hoja = (n: string, cab: string[], filas: Fila[], importes: number[]) => {
        const ws = wb.addWorksheet(n);
        ws.addRow(cab).font = { bold: true };
        for (const f of filas) ws.addRow(f);
        for (const i of importes) ws.getColumn(i).numFmt = '#,##0.00';
        cab.forEach((_, i) => (ws.getColumn(i + 1).width = i === 1 ? 32 : 16));
      };
      hoja('Por concepto', ['Código', 'Concepto', 'Importe'], porConcepto, [3]);
      hoja('Por empleado', ['Legajo', 'Empleado', 'CUIL', 'Categoría', 'Remunerativo', 'No remunerativo', 'Descuentos', 'Neto'], [...porEmpleado, totalEmp], [5, 6, 7, 8]);
      res.set({ 'Content-Type': XLSX, 'Content-Disposition': `attachment; filename="${nombre}.xlsx"` });
      return new StreamableFile(Buffer.from(await wb.xlsx.writeBuffer()));
    }
    const imp = (titulo: string): Columna => ({ titulo, ancho: 95, importe: true });
    const columnas: Columna[] = [{ titulo: 'Legajo / Código', ancho: 80 }, { titulo: 'Empleado / Concepto', ancho: 200 }, imp('Remunerativo'), imp('No remunerativo'), imp('Descuentos'), imp('Neto')];
    const filas: Fila[] = [
      ...porEmpleado.map((f) => [f[0], f[1], f[4], f[5], f[6], f[7]]),
      ['', 'Totales', totalEmp[4], totalEmp[5], totalEmp[6], totalEmp[7]],
      ['', '', null, null, null, null],
      ...[...conceptos.values()].sort((a, b) => a.orden - b.orden).map((c) => [c.codigo, c.nombre, null, null, null, c.importe] as Fila),
    ];
    const empresa = await this.tenant.db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nombre}.pdf"` });
    return new StreamableFile(await tablaPdf(empresa.razonSocial, titulo, liq.estado === 'BORRADOR' ? 'Borrador' : 'Cerrada', columnas, filas));
  }
}
