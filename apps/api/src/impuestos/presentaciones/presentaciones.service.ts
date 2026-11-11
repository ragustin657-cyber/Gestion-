import { createHash } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, TipoPresentacion } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { CLAVE_CONTEXTO, ContextoRequest } from '../../contexto/contexto';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { ConfigImpuestosService } from '../config/config-impuestos.service';
import { ErrorFormato } from '../formato/escritor';
import { libroIvaDigital } from '../libros-iva/libro-iva-digital';
import { agip } from '../retenciones/agip';
import { arba } from '../retenciones/arba';
import { sicore } from '../retenciones/sicore';
import { NumeracionService } from '../../numeracion/numeracion.service';
import { ContextoGeneracion, Generador } from './generado';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const CON_QUINCENA: TipoPresentacion[] = ['SICORE', 'ARBA'];
const MAX_VERIFICADAS = 24;
const EN_PARALELO = 4;

@Injectable()
export class PresentacionesService {
  private readonly generadores = new Map<TipoPresentacion, Generador>([['LIBRO_IVA_DIGITAL', libroIvaDigital], ['SICORE', sicore], ['ARBA', arba], ['AGIP', agip]]);

  constructor(
    private readonly tenant: TenantPrisma,
    private readonly config: ConfigImpuestosService,
    private readonly numeracion: NumeracionService,
    private readonly auditoria: AuditoriaService,
    private readonly cls: ClsService,
  ) {}

  registrar(tipo: TipoPresentacion, g: Generador) {
    this.generadores.set(tipo, g);
  }

  private async contexto(tx: TxEmpresa, periodo: string, quincena: number, nombreGuardado?: string): Promise<ContextoGeneracion> {
    const anio = Number(periodo.slice(0, 4)), mes = Number(periodo.slice(4, 6));
    let desde = new Date(Date.UTC(anio, mes - 1, 1)), hasta = new Date(Date.UTC(anio, mes, 0));
    if (quincena === 1) hasta = new Date(Date.UTC(anio, mes - 1, 15));
    if (quincena === 2) desde = new Date(Date.UTC(anio, mes - 1, 16));
    const empresa = await tx.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    return { empresa, config: await this.config.obtener(tx), periodo, quincena, desde, hasta, nombreGuardado };
  }

  private async ejecutar(tipo: TipoPresentacion, tx: TxEmpresa, ctx: ContextoGeneracion) {
    const g = this.generadores.get(tipo);
    if (!g) throw new BadRequestException(`Presentación no disponible: ${tipo}`);
    try {
      return await g(tx, ctx);
    } catch (e) {
      if (e instanceof ErrorFormato) throw new BadRequestException(e.message);
      throw e;
    }
  }

  generar(d: { tipo: TipoPresentacion; periodo: string; quincena?: number }) {
    const mes = Number(d.periodo.slice(4, 6));
    if (!/^\d{6}$/.test(d.periodo) || mes < 1 || mes > 12) throw new BadRequestException('Período inválido (AAAAMM)');
    const quincena = d.quincena ?? 0;
    if (quincena && !CON_QUINCENA.includes(d.tipo)) throw new BadRequestException('Esta presentación es mensual');
    if (d.tipo === 'SICORE' && quincena === 2) throw new BadRequestException('SICORE solo admite el mes completo o la primera quincena');
    return this.tenant.transaccion(async (tx) => {
      const ctx = { ...(await this.contexto(tx, d.periodo, quincena)), siguienteLote: () => this.numeracion.siguiente(tx, 'ARBA-LOTE', 0) };
      const r = await this.ejecutar(d.tipo, tx, ctx);
      const usuario = this.cls.get<ContextoRequest>(CLAVE_CONTEXTO).usuarioId;
      const p = await tx.presentacion.create({
        data: {
          empresaId: this.tenant.empresaId, tipo: d.tipo, periodo: d.periodo, quincena, nombreArchivo: r.nombreArchivo, contenido: new Uint8Array(r.contenido),
          registros: r.registros, total: r.total, huella: sha(r.huellaDe), advertencias: r.advertencias as Prisma.InputJsonValue, generadoPor: usuario,
        },
      });
      await this.auditoria.registrar(tx, { entidad: 'Presentacion', entidadId: p.id, accion: 'CREAR', datos: { tipo: d.tipo, periodo: d.periodo, quincena, registros: r.registros, huella: p.huella } });
      return { id: p.id, nombreArchivo: p.nombreArchivo, registros: p.registros, total: p.total, advertencias: r.advertencias, controles: r.controles };
    }, { timeout: 60000 });
  }

  /**
   * Historial. La generación más reciente de cada (tipo, período, quincena) se recalcula para avisar si los datos cambiaron
   * (solo las 24 más recientes, de a 4 en paralelo). Si no se puede recalcular, `cambiaron` es null y `error` dice por qué.
   */
  async listar(f: { tipo?: string; periodo?: string }) {
    const db = this.tenant.db;
    const filas = await db.presentacion.findMany({
      where: { tipo: (f.tipo || undefined) as TipoPresentacion | undefined, periodo: f.periodo || undefined },
      select: { id: true, tipo: true, periodo: true, quincena: true, nombreArchivo: true, registros: true, total: true, huella: true, advertencias: true, generadoPor: true, generadoEn: true },
      orderBy: { generadoEn: 'desc' },
    });
    const ultimas: typeof filas = [];
    const claves = new Set<string>();
    for (const p of filas) {
      const k = `${p.tipo}|${p.periodo}|${p.quincena}`;
      if (!claves.has(k)) { claves.add(k); ultimas.push(p); }
    }
    const verificar = ultimas.slice(0, MAX_VERIFICADAS);
    const estado = new Map<string, { cambiaron: boolean | null; error?: string }>();
    for (let i = 0; i < verificar.length; i += EN_PARALELO)
      await Promise.all(verificar.slice(i, i + EN_PARALELO).map(async (p) => {
        try {
          const g = await this.ejecutar(p.tipo, db, await this.contexto(db, p.periodo, p.quincena, p.nombreArchivo));
          estado.set(p.id, { cambiaron: sha(g.huellaDe) !== p.huella });
        } catch (e) {
          estado.set(p.id, { cambiaron: null, error: `No se pudo verificar: ${(e as Error).message}` });
        }
      }));
    return filas.map((p) => ({ ...p, huella: undefined, ...(estado.get(p.id) ?? { cambiaron: null }) }));
  }

  async archivo(id: string) {
    const p = await this.tenant.db.presentacion.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Presentación no encontrada');
    return p;
  }
}
