import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { ConsultasComprasService, fechaQuery } from '../../compras/consultas/consultas.service';
import { Columna, Fila, tablaPdf, tablaXlsx } from '../../contabilidad/consultas/exportar';
import { TenantPrisma } from '../../prisma/tenant-prisma.service';
import { D } from '../../tesoreria/operaciones/tesoreria-comun';
import { ALICUOTAS_LIBRO, LibroVentasService } from './libro-ventas.service';

const fecha = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('/');
const imp = (titulo: string, ancho = 12): Columna => ({ titulo, ancho, importe: true });
const porAlicuotaCols = (): Columna[] => ALICUOTAS_LIBRO.flatMap((a) => [imp(`Neto ${a.replace('.', ',')}%`, 13), ...(a === '0' ? [] : [imp(`IVA ${a.replace('.', ',')}%`)])]);
const COLUMNAS_VENTAS: Columna[] = [
  { titulo: 'Fecha', ancho: 11 }, { titulo: 'Comprobante', ancho: 26 }, { titulo: 'Cliente', ancho: 28 }, { titulo: 'CUIT/Doc.', ancho: 15 }, { titulo: 'Condición IVA', ancho: 18 },
  ...porAlicuotaCols(), imp('No discriminado', 14), imp('No gravado'), imp('Exento'), imp('Total', 14),
];
const COLUMNAS_COMPRAS: Columna[] = [
  { titulo: 'Fecha', ancho: 11 }, { titulo: 'Comprobante', ancho: 26 }, { titulo: 'Proveedor', ancho: 28 }, { titulo: 'CUIT/Doc.', ancho: 15 },
  ...porAlicuotaCols(), imp('Perc. IVA'), imp('Perc. IIBB'), imp('Imp. internos'), imp('No computable', 14), imp('No gravado'), imp('Exento'), imp('Total', 14),
];
const porAlicuota = (neto: Record<string, string>, iva: Record<string, string>) =>
  ALICUOTAS_LIBRO.flatMap((a) => [neto[a] ?? null, ...(a === '0' ? [] : [iva[a] ?? null])]);

@Controller('impuestos')
@RequierePermiso('impuestos.ver')
export class LibrosIvaController {
  constructor(
    private readonly ventas: LibroVentasService,
    private readonly compras: ConsultasComprasService,
    private readonly tenant: TenantPrisma,
  ) {}

  private async salida(res: Response, nombre: string, titulo: string, desde: string, hasta: string, formato: string | undefined, cols: Columna[], filas: Fila[]) {
    const subtitulo = `Del ${fecha(fechaQuery(desde, true)!)} al ${fecha(fechaQuery(hasta, true)!)}`;
    if (formato === 'xlsx') {
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${nombre}-${desde}-${hasta}.xlsx"` });
      return new StreamableFile(await tablaXlsx(titulo, subtitulo, cols, filas));
    }
    const empresa = await this.tenant.db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${nombre}-${desde}-${hasta}.pdf"` });
    return new StreamableFile(await tablaPdf(empresa.razonSocial, titulo, subtitulo, cols, filas));
  }

  @Get('libro-iva-ventas')
  async libroVentas(@Query('desde') desde: string, @Query('hasta') hasta: string, @Query('formato') formato: string | undefined, @Res({ passthrough: true }) res: Response) {
    const l = await this.ventas.libro(desde, hasta);
    if (formato !== 'xlsx' && formato !== 'pdf') return l;
    const filas: Fila[] = l.filas.map((f) => [fecha(f.fecha), f.comprobante, f.cliente, f.documento, f.condicionIva, ...porAlicuota(f.netoPorAlicuota, f.ivaPorAlicuota), f.noDiscriminado, f.noGravado, f.exento, f.total]);
    filas.push(['', 'Totales', '', '', '', ...porAlicuota(l.totales.netoPorAlicuota, l.totales.ivaPorAlicuota), l.totales.noDiscriminado, l.totales.noGravado, l.totales.exento, l.totales.total]);
    return this.salida(res, 'libro-iva-ventas', 'Libro IVA Ventas', desde, hasta, formato, COLUMNAS_VENTAS, filas);
  }

  @Get('libro-iva-compras')
  async libroCompras(@Query('desde') desde: string, @Query('hasta') hasta: string, @Query('formato') formato: string | undefined, @Res({ passthrough: true }) res: Response) {
    const l = await this.compras.libroIva(desde, hasta);
    const ivaLibro = Object.values(l.totales.ivaPorAlicuota).reduce((a, x) => a.plus(x), new D(0));
    const advertencias = await this.ventas.cuadre(this.tenant.db, 'IVA_CREDITO_FISCAL', fechaQuery(desde, true)!, fechaQuery(hasta, true)!, ivaLibro);
    if (formato !== 'xlsx' && formato !== 'pdf') return { ...l, advertencias };
    const extra = (f: { percepcionIva: string; percepcionesIibb: string; impuestosInternos: string; noComputable: string; noGravado: string; exento: string; total: string }) =>
      [f.percepcionIva, f.percepcionesIibb, f.impuestosInternos, f.noComputable, f.noGravado, f.exento, f.total];
    const filas: Fila[] = l.filas.map((f) => [fecha(f.fechaContable), `${f.tipo} ${f.letra} ${f.numero}`, f.razonSocial, f.cuit, ...porAlicuota(f.netoPorAlicuota, f.ivaPorAlicuota), ...extra(f)]);
    filas.push(['', 'Totales', '', '', ...porAlicuota(l.totales.netoPorAlicuota, l.totales.ivaPorAlicuota), ...extra(l.totales)]);
    return this.salida(res, 'libro-iva-compras', 'Libro IVA Compras', desde, hasta, formato, COLUMNAS_COMPRAS, filas);
  }
}
