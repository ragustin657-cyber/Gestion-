import { Injectable } from '@nestjs/common';
import { CondicionIva, Prisma } from '@prisma/client';
import { TODOS_LOS_PERMISOS } from '@gestion/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PlanCuentasService } from '../contabilidad/plan-cuentas/plan-cuentas.service';
import { cargarConfigCuentas } from '../compras/config/conceptos';
import { cargarConfigPagos } from '../pagos/config/valores-iniciales';
import { cargarReglasIniciales } from '../conciliacion/reglas-iniciales';
import { BadRequestException } from '@nestjs/common';
import { hoyEn, ZONA_ARGENTINA } from '@gestion/shared';
import { crearEjercicio, rangoEjercicio } from '../contabilidad/periodos/ejercicios';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrisma } from '../prisma/tenant-prisma.service';

export interface DatosEmpresa {
  razonSocial: string;
  cuit: string;
  condicionIva: CondicionIva;
  domicilio?: string | null;
  inicioEjercicioMes?: number;
  agenteRetencionGanancias?: boolean;
  agenteRetencionIva?: boolean;
  agenteRetencionSuss?: boolean;
  jurisdiccionesIibb?: string[];
}

@Injectable()
export class EmpresasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantPrisma,
    private readonly auditoria: AuditoriaService,
    private readonly planCuentas: PlanCuentasService,
  ) {}

  /** Alta de empresa (superadmin): crea rol Administrador y asigna al creador. */
  crear(d: DatosEmpresa, creadorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const empresa = await tx.empresa.create({ data: d });
      const rol = await tx.rol.create({
        data: { empresaId: empresa.id, nombre: 'Administrador', permisos: TODOS_LOS_PERMISOS },
      });
      await tx.usuarioEmpresa.create({ data: { usuarioId: creadorId, empresaId: empresa.id, rolId: rol.id } });
      await tx.sucursal.create({ data: { empresaId: empresa.id, codigo: 'CEN', nombre: 'Casa central', esCentral: true } });
      await this.planCuentas.cargarModelo(tx, empresa.id);
      await cargarConfigCuentas(tx, empresa.id);
      await cargarConfigPagos(tx, empresa.id);
      await cargarReglasIniciales(tx, empresa.id);
      await tx.configArca.create({ data: { empresaId: empresa.id } });
      await crearEjercicio(tx, empresa.id, rangoEjercicio(empresa.inicioEjercicioMes, new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`)).desde, 1);
      await tx.auditoria.create({
        data: { empresaId: empresa.id, usuarioId: creadorId, entidad: 'Empresa', entidadId: empresa.id, accion: 'CREAR' },
      });
      return empresa;
    });
  }

  actual() {
    return this.prisma.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
  }

  modificarActual(d: Partial<DatosEmpresa>) {
    return this.tenant.transaccion(async (tx) => {
      const anterior = await tx.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
      if (d.inicioEjercicioMes && d.inicioEjercicioMes !== anterior.inicioEjercicioMes) {
        // Sin asientos, los ejercicios (vacíos) se rehacen con el nuevo inicio
        if (await tx.asiento.count()) throw new BadRequestException('No se puede cambiar el inicio del ejercicio con ejercicios en uso');
        await tx.ejercicio.deleteMany({});
        await crearEjercicio(tx as unknown as Prisma.TransactionClient, this.tenant.empresaId, rangoEjercicio(d.inicioEjercicioMes, new Date(`${hoyEn(ZONA_ARGENTINA)}T00:00:00Z`)).desde, 1);
      }
      const empresa = await tx.empresa.update({ where: { id: this.tenant.empresaId }, data: d });
      await this.auditoria.registrar(tx, { entidad: 'Empresa', entidadId: empresa.id, accion: 'MODIFICAR', datos: d });
      return empresa;
    });
  }

  puntosVenta() {
    return this.tenant.db.puntoVenta.findMany({ orderBy: { numero: 'asc' } });
  }

  crearPuntoVenta(d: { numero: number; descripcion?: string | null; electronico?: boolean; sucursalId?: string | null }) {
    return this.tenant.db.puntoVenta.create({ data: { empresaId: this.tenant.empresaId, ...d } });
  }
}
