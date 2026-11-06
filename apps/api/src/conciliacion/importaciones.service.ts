import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { fechaAR } from '../compras/comun';
import { CLAVE_CONTEXTO, ContextoRequest } from '../contexto/contexto';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { AlcanceSucursalService } from '../tesoreria/sucursales/alcance.service';
import { FormatosService } from './formatos.service';
import { LineaParseada, parsearExtracto } from './interprete';

export const MAX_FILAS = 20000;
const clave = (l: { fecha: Date; importe: { toFixed(n: number): string }; concepto: string; referencia: string | null }) =>
  `${l.fecha.toISOString().slice(0, 10)}|${l.importe.toFixed(2)}|${l.concepto}|${l.referencia ?? ''}`;

@Injectable()
export class ImportacionesService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly formatos: FormatosService,
    private readonly alcance: AlcanceSucursalService,
    private readonly auditoria: AuditoriaService,
    private readonly cls: ClsService,
  ) {}

  /** Interpreta el archivo y separa las líneas ya importadas en la cuenta. */
  private async interpretar(tx: TxEmpresa, cuentaBancariaId: string, archivo: Buffer | undefined) {
    if (!archivo?.length) throw new BadRequestException('Adjunte el archivo del extracto');
    await this.formatos.cuenta(tx, cuentaBancariaId);
    const formato = await this.formatos.paraParsear(tx, cuentaBancariaId);
    const esZip = archivo.subarray(0, 2).toString('latin1') === 'PK';
    if (formato.tipoArchivo === 'XLSX' && !esZip) throw new BadRequestException('El archivo no es XLSX');
    if (formato.tipoArchivo === 'CSV' && esZip) throw new BadRequestException('El archivo no es CSV');
    const r = await parsearExtracto(archivo, formato);
    if (r.lineas.length + r.errores.length > MAX_FILAS) throw new BadRequestException('El archivo supera las 20.000 filas');
    // Las líneas de períodos ya conciliados y cerrados no se importan
    const cerrada = await tx.conciliacion.findFirst({ where: { cuentaBancariaId, estado: 'CERRADA' }, orderBy: { hasta: 'desc' } });
    const enCerrados = cerrada ? r.lineas.filter((l) => l.fecha <= cerrada.hasta).length : 0;
    if (cerrada) r.lineas = r.lineas.filter((l) => l.fecha > cerrada.hasta);
    const fechas = r.lineas.map((l) => l.fecha.getTime());
    const existentes = r.lineas.length
      ? await tx.lineaExtracto.findMany({
        where: { cuentaBancariaId, fecha: { gte: new Date(Math.min(...fechas)), lte: new Date(Math.max(...fechas)) } },
        select: { fecha: true, importe: true, concepto: true, referencia: true },
      })
      : [];
    // Cada línea existente "consume" una igual del archivo: así se respetan las repetidas dentro del archivo
    const disponibles = new Map<string, number>();
    for (const e of existentes) disponibles.set(clave(e), (disponibles.get(clave(e)) ?? 0) + 1);
    const nuevas: LineaParseada[] = [];
    let duplicadas = 0;
    for (const l of r.lineas) {
      const k = clave(l);
      const n = disponibles.get(k) ?? 0;
      if (n > 0) {
        disponibles.set(k, n - 1);
        duplicadas++;
      } else nuevas.push(l);
    }
    const advertencias = [...r.advertencias];
    if (duplicadas) advertencias.unshift(`${duplicadas} líneas ya estaban importadas`);
    if (enCerrados) advertencias.unshift(`Se omitieron ${enCerrados} líneas de períodos ya conciliados (hasta ${fechaAR(cerrada!.hasta)})`);
    return { nuevas, duplicadas, errores: r.errores, advertencias };
  }

  async previsualizar(cuentaBancariaId: string, archivo: Buffer | undefined) {
    const r = await this.interpretar(this.tenant.db, cuentaBancariaId, archivo);
    return { lineas: r.nuevas.slice(0, 20), total: r.nuevas.length, duplicadas: r.duplicadas, errores: r.errores, advertencias: r.advertencias };
  }

  importar(cuentaBancariaId: string, archivo: Buffer | undefined, nombre: string) {
    return this.tenant.transaccion(async (tx) => {
      const r = await this.interpretar(tx, cuentaBancariaId, archivo);
      if (r.errores.length) throw new BadRequestException({ statusCode: 400, message: 'El archivo tiene errores', errores: r.errores });
      const empresaId = this.tenant.empresaId;
      const imp = await tx.importacionExtracto.create({
        data: { empresaId, cuentaBancariaId, archivo: nombre.slice(0, 200), usuarioId: this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId, lineas: r.nuevas.length, duplicadas: r.duplicadas },
      });
      await tx.lineaExtracto.createMany({
        data: r.nuevas.map((l) => ({
          empresaId, cuentaBancariaId, importacionId: imp.id, fila: l.fila, fecha: l.fecha, concepto: l.concepto, referencia: l.referencia, importe: l.importe, saldo: l.saldo,
        })),
      });
      await this.auditoria.registrar(tx, { entidad: 'ImportacionExtracto', entidadId: imp.id, accion: 'CREAR', datos: { archivo: nombre, lineas: r.nuevas.length, duplicadas: r.duplicadas } });
      return { id: imp.id, lineas: r.nuevas.length, duplicadas: r.duplicadas, advertencias: r.advertencias };
    }, { timeout: 60000 });
  }

  async listar(cuentaBancariaId?: string) {
    if (this.alcance.sucursalUsuario()) return [];
    return this.tenant.db.importacionExtracto.findMany({ where: { cuentaBancariaId: cuentaBancariaId || undefined }, orderBy: { fecha: 'desc' }, take: 100 });
  }

  deshacer(id: string) {
    return this.tenant.transaccion(async (tx) => {
      const imp = this.alcance.sucursalUsuario() ? null : await tx.importacionExtracto.findUnique({ where: { id } });
      if (!imp) throw new NotFoundException('Importación no encontrada');
      if (imp.estado === 'DESHECHA') throw new BadRequestException('La importación ya fue deshecha');
      const cerrada = await tx.conciliacion.findFirst({ where: { cuentaBancariaId: imp.cuentaBancariaId, estado: 'CERRADA' }, orderBy: { hasta: 'desc' } });
      if (cerrada && (await tx.lineaExtracto.count({ where: { importacionId: id, fecha: { lte: cerrada.hasta } } })))
        throw new BadRequestException('La importación tiene líneas de un período ya conciliado y cerrado');
      if (await tx.lineaExtracto.count({ where: { importacionId: id, estado: 'CONCILIADA' } }))
        throw new BadRequestException('La importación tiene líneas conciliadas: deshaga primero esas conciliaciones');
      await tx.lineaExtracto.deleteMany({ where: { importacionId: id } });
      const r = await tx.importacionExtracto.update({ where: { id }, data: { estado: 'DESHECHA' } });
      await this.auditoria.registrar(tx, { entidad: 'ImportacionExtracto', entidadId: id, accion: 'ANULAR', datos: {} });
      return r;
    });
  }
}
