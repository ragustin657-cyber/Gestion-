import { BadRequestException, Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { RequierePermiso } from '../../auth/requiere-permiso.decorator';
import { fechaAR } from '../../compras/comun';
import { ConsultasContablesService } from '../consultas/consultas.service';
import { Fila, tablaPdf } from '../consultas/exportar';
import { Bloque, EstadosService } from './estados.service';

const filas = (titulo: string, b: Bloque): Fila[] => [[titulo, null], ...b.filas.map((f) => [`${'  '.repeat(f.nivel - 1)}${f.codigo} ${f.nombre}`, f.importe] as Fila), [`Total ${titulo.toLowerCase()}`, b.total]];

@Controller('contabilidad/estados')
@RequierePermiso('plancuentas.ver')
export class EstadosController {
  constructor(
    private readonly estados: EstadosService,
    private readonly consultas: ConsultasContablesService,
  ) {}

  private async pdf(res: Response, nombre: string, titulo: string, subtitulo: string, contenido: Fila[]) {
    const e = await this.consultas.empresa();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}.pdf"`);
    return new StreamableFile(await tablaPdf(e.razonSocial, titulo, subtitulo, [{ titulo: 'Rubro / cuenta', ancho: 620 }, { titulo: 'Importe', ancho: 160, importe: true }], contenido));
  }

  @Get('situacion')
  async situacion(@Query() q: { fecha?: string; nivel?: string; formato?: string; comparativoReexpresado?: string }, @Res({ passthrough: true }) res: Response) {
    const s = await this.estados.situacion(q);
    if (!q.formato) return s;
    if (q.formato !== 'pdf') throw new BadRequestException('Formato inválido: use pdf');
    return this.pdf(res, 'estado-situacion-patrimonial', 'Estado de situación patrimonial', `Al ${fechaAR(new Date(s.fecha))}`, [
      ...filas('Activo', s.activo), ...filas('Pasivo', s.pasivo),
      ...filas('Patrimonio neto', s.patrimonioNeto).flatMap((f, i, arr) => (i === arr.length - 1 && s.resultadoEnCurso ? [['  Resultado del ejercicio (en curso)', s.resultadoEnCurso] as Fila, f] : [f])),
      ['Total pasivo + patrimonio neto', String(Number(s.pasivo.total) + Number(s.patrimonioNeto.total))],
    ]);
  }

  @Get('resultados')
  async resultados(@Query() q: { desde?: string; hasta?: string; nivel?: string; formato?: string; comparativoReexpresado?: string }, @Res({ passthrough: true }) res: Response) {
    const r = await this.estados.resultados(q);
    if (!q.formato) return r;
    if (q.formato !== 'pdf') throw new BadRequestException('Formato inválido: use pdf');
    return this.pdf(res, 'estado-de-resultados', 'Estado de resultados', `${fechaAR(r.desde)} al ${fechaAR(r.hasta)}`, [
      ...filas('Resultados positivos', r.positivos), ...filas('Resultados negativos', r.negativos), ['Resultado del período', r.resultado],
    ]);
  }
}
