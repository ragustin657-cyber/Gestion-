import { BadRequestException, Injectable } from '@nestjs/common';
import { EscalaGanancias, JurisdiccionIibb, Prisma, RegimenGanancias, SinPadron } from '@prisma/client';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { conUnicidad } from '../../comun/errores';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';

const D = Prisma.Decimal;
export const vistaRegimen = (r: RegimenGanancias) => ({ ...r, verificar: !r.editadoEn });

export interface TramoEscala { desde: number; hasta: number | null; fijo: number; porcentaje: number }
export interface DatosRegimen {
  codigo: string; descripcion: string; minimoNoSujeto: number; alicuotaInscripto: number; alicuotaNoInscripto: number;
  usaEscala?: boolean; minimoRetencion: number; activo?: boolean;
}
export interface DatosRegimenIva { codigoSire?: string | null; descripcion: string; porcentaje: number; minimoComprobante: number; minimoRetencion: number; condicionSire?: number | null; activo?: boolean }
export interface DatosRegimenSuss { codigoSire?: string | null; descripcion: string; porcentaje: number; minimoNoSujeto: number; minimoRetencion: number; activo?: boolean }
export interface DatosJurisdiccion {
  jurisdiccion: string; alicuotaDefecto: number; minimoRetencion: number; usaPadron: boolean; sinPadron: SinPadron;
  percibe?: boolean; alicuotaPercepcionDefecto?: number; minimoPercepcion?: number; sinPadronPercepcion?: SinPadron;
}
export interface DatosRegimenPercepcionIva { codigo: string; descripcion: string; alicuotaGeneral: number; alicuotaReducida: number; minimoNeto: number; activo?: boolean }

@Injectable()
export class ConfigPagosService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly auditoria: AuditoriaService,
  ) {}

  async parametros(tx: TxEmpresa = this.tenant.db): Promise<{ montoAprobacionOp: Prisma.Decimal }> {
    const e = await tx.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    return { montoAprobacionOp: e.montoAprobacionOp };
  }

  modificar(d: { montoAprobacionOp?: number }) {
    return this.tenant.transaccion(async (tx) => {
      await tx.empresa.update({ where: { id: this.tenant.empresaId }, data: d });
      await this.auditoria.registrar(tx, { entidad: 'ConfigPagos', entidadId: this.tenant.empresaId, accion: 'MODIFICAR', datos: d });
      return this.parametros(tx);
    });
  }

  regimen(tx: TxEmpresa, codigo: string): Promise<RegimenGanancias | null> {
    return tx.regimenGanancias.findUnique({ where: { empresaId_codigo: { empresaId: this.tenant.empresaId, codigo } } });
  }

  escala(tx: TxEmpresa = this.tenant.db): Promise<EscalaGanancias[]> {
    return tx.escalaGanancias.findMany({ orderBy: { desde: 'asc' } });
  }

  /** Jurisdicciones donde la empresa es agente de retención de IIBB. */
  async jurisdicciones(tx: TxEmpresa): Promise<JurisdiccionIibb[]> {
    const e = await tx.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    return tx.jurisdiccionIibb.findMany({ where: { jurisdiccion: { in: e.jurisdiccionesIibb } }, orderBy: { jurisdiccion: 'asc' } });
  }

  async regimenes() {
    return (await this.tenant.db.regimenGanancias.findMany({ orderBy: { codigo: 'asc' } })).map(vistaRegimen);
  }

  crearRegimen(d: DatosRegimen) {
    return conUnicidad('Ya existe un régimen con ese código', () =>
      this.tenant.transaccion(async (tx) => {
        const r = await tx.regimenGanancias.create({ data: { ...d, empresaId: this.tenant.empresaId, editadoEn: new Date() } });
        await this.auditoria.registrar(tx, { entidad: 'RegimenGanancias', entidadId: r.id, accion: 'CREAR', datos: d });
        return vistaRegimen(r);
      }),
    );
  }

  modificarRegimen(id: string, d: Partial<DatosRegimen>) {
    return conUnicidad('Ya existe un régimen con ese código', () =>
      this.tenant.transaccion(async (tx) => {
        const r = await tx.regimenGanancias.update({ where: { id }, data: { ...d, editadoEn: new Date() } });
        await this.auditoria.registrar(tx, { entidad: 'RegimenGanancias', entidadId: id, accion: 'MODIFICAR', datos: d });
        return vistaRegimen(r);
      }),
    );
  }

  reemplazarEscala(tramos: TramoEscala[]) {
    const ordenados = [...tramos].sort((a, b) => a.desde - b.desde);
    const valida = ordenados.length > 0 && ordenados[0].desde === 0 && ordenados.every((t, i) => {
      const sig = ordenados[i + 1];
      if (!sig) return t.hasta === null || t.hasta > t.desde;
      return t.hasta !== null && t.hasta > t.desde && new D(t.hasta).eq(sig.desde);
    });
    if (!valida) throw new BadRequestException('La escala debe tener tramos contiguos y crecientes');
    return this.tenant.transaccion(async (tx) => {
      await tx.escalaGanancias.deleteMany({});
      await tx.escalaGanancias.createMany({ data: ordenados.map((t) => ({ ...t, empresaId: this.tenant.empresaId })) });
      await this.auditoria.registrar(tx, { entidad: 'EscalaGanancias', entidadId: this.tenant.empresaId, accion: 'MODIFICAR', datos: ordenados });
      return this.escala(tx);
    });
  }

  todasLasJurisdicciones() {
    return this.tenant.db.jurisdiccionIibb.findMany({ orderBy: { jurisdiccion: 'asc' } });
  }

  reemplazarJurisdicciones(lista: DatosJurisdiccion[]) {
    return this.tenant.transaccion(async (tx) => {
      for (const j of lista)
        await tx.jurisdiccionIibb.upsert({
          where: { empresaId_jurisdiccion: { empresaId: this.tenant.empresaId, jurisdiccion: j.jurisdiccion } },
          create: { ...j, empresaId: this.tenant.empresaId },
          update: j,
        });
      await this.auditoria.registrar(tx, { entidad: 'JurisdiccionIibb', entidadId: this.tenant.empresaId, accion: 'MODIFICAR', datos: lista });
      return tx.jurisdiccionIibb.findMany({ orderBy: { jurisdiccion: 'asc' } });
    });
  }

  // --- Régimen de percepción de IVA (E39) ---

  regimenesPercepcionIva() {
    return this.tenant.db.regimenPercepcionIva.findMany({ orderBy: { codigo: 'asc' } });
  }

  /** El régimen activo de percepción de IVA, o null. */
  regimenPercepcionIvaActivo(tx: TxEmpresa) {
    return tx.regimenPercepcionIva.findFirst({ where: { activo: true } });
  }

  guardarRegimenPercepcionIva(id: string | null, d: Partial<DatosRegimenPercepcionIva>) {
    return conUnicidad('Ya existe un régimen con ese código', () =>
      this.tenant.transaccion(async (tx) => {
        // Pulido E42: altas y cambios simultáneos se serializan (un solo régimen activo)
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `regimen-percepcion-iva:${this.tenant.empresaId}`);
        const activo = d.activo ?? (id ? (await tx.regimenPercepcionIva.findUniqueOrThrow({ where: { id } })).activo : true);
        if (activo && (await tx.regimenPercepcionIva.count({ where: { activo: true, ...(id ? { id: { not: id } } : {}) } })))
          throw new BadRequestException('Active solo un régimen de percepción de IVA');
        const r = id
          ? await tx.regimenPercepcionIva.update({ where: { id }, data: d })
          : await tx.regimenPercepcionIva.create({ data: { ...(d as DatosRegimenPercepcionIva), empresaId: this.tenant.empresaId } });
        await this.auditoria.registrar(tx, { entidad: 'RegimenPercepcionIva', entidadId: r.id, accion: id ? 'MODIFICAR' : 'CREAR', datos: d });
        return r;
      }),
    );
  }

  /** Jurisdicciones donde la empresa percibe IIBB en las ventas (E39). */
  jurisdiccionesPercepcion(tx: TxEmpresa) {
    return tx.jurisdiccionIibb.findMany({ where: { percibe: true }, orderBy: { jurisdiccion: 'asc' } });
  }

  // --- Regímenes de IVA y SUSS (E35) ---

  private avisosSire(rs: { codigoSire: string | null; descripcion: string; activo: boolean }[]) {
    return rs.filter((r) => r.activo && !r.codigoSire).map((r) => `Cargue el código SIRE del régimen ${r.descripcion}`);
  }

  /** Lista de regímenes, cada uno con su aviso si está activo y sin código SIRE (como la lista de Ganancias, para el ABM). */
  async regimenesIva() {
    return (await this.tenant.db.regimenIva.findMany({ orderBy: { descripcion: 'asc' } })).map((r) => ({ ...r, aviso: this.avisosSire([r])[0] ?? null }));
  }

  async regimenesSuss() {
    return (await this.tenant.db.regimenSuss.findMany({ orderBy: { descripcion: 'asc' } })).map((r) => ({ ...r, aviso: this.avisosSire([r])[0] ?? null }));
  }

  guardarRegimenIva(id: string | null, d: Partial<DatosRegimenIva>) {
    return conUnicidad('Ya existe un régimen con esa descripción', () =>
      this.tenant.transaccion(async (tx) => {
        const r = id ? await tx.regimenIva.update({ where: { id }, data: d }) : await tx.regimenIva.create({ data: { ...(d as DatosRegimenIva), empresaId: this.tenant.empresaId } });
        await this.auditoria.registrar(tx, { entidad: 'RegimenIva', entidadId: r.id, accion: id ? 'MODIFICAR' : 'CREAR', datos: d });
        return r;
      }),
    );
  }

  guardarRegimenSuss(id: string | null, d: Partial<DatosRegimenSuss>) {
    return conUnicidad('Ya existe un régimen con esa descripción', () =>
      this.tenant.transaccion(async (tx) => {
        const r = id ? await tx.regimenSuss.update({ where: { id }, data: d }) : await tx.regimenSuss.create({ data: { ...(d as DatosRegimenSuss), empresaId: this.tenant.empresaId } });
        await this.auditoria.registrar(tx, { entidad: 'RegimenSuss', entidadId: r.id, accion: id ? 'MODIFICAR' : 'CREAR', datos: d });
        return r;
      }),
    );
  }
}
