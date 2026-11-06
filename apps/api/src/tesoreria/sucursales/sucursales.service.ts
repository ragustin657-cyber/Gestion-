import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { conUnicidad } from '../../comun/errores';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';

export interface DatosSucursal {
  codigo: string;
  nombre: string;
  domicilio?: string | null;
  esCentral?: boolean;
  activa?: boolean;
}

const SIN_CENTRAL = 'La empresa debe tener una casa central';
const DUPLICADA = 'Ya existe una sucursal con ese código';

@Injectable()
export class SucursalesService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly auditoria: AuditoriaService,
  ) {}

  listar() {
    return this.tenant.db.sucursal.findMany({ orderBy: [{ esCentral: 'desc' }, { codigo: 'asc' }] });
  }

  /** Casa central de la empresa activa. */
  async central(tx: TxEmpresa) {
    const c = await tx.sucursal.findFirst({ where: { esCentral: true } });
    if (!c) throw new BadRequestException(SIN_CENTRAL);
    return c;
  }

  async verificar(tx: TxEmpresa, id: string) {
    const s = await tx.sucursal.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Sucursal no encontrada');
    return s;
  }

  crear(d: DatosSucursal) {
    return conUnicidad(DUPLICADA, () =>
      this.tenant.transaccion(async (tx) => {
        if (d.esCentral) await tx.sucursal.updateMany({ where: { esCentral: true }, data: { esCentral: false } });
        const s = await tx.sucursal.create({ data: { ...d, empresaId: this.tenant.empresaId } });
        await this.auditoria.registrar(tx, { entidad: 'Sucursal', entidadId: s.id, accion: 'CREAR', datos: d });
        return s;
      }),
    );
  }

  modificar(id: string, d: Partial<DatosSucursal>) {
    return conUnicidad(DUPLICADA, () =>
      this.tenant.transaccion(async (tx) => {
        const actual = await this.verificar(tx, id);
        if (actual.esCentral && (d.esCentral === false || d.activa === false)) throw new BadRequestException(SIN_CENTRAL);
        if (d.esCentral && !actual.esCentral) {
          if (actual.activa === false && d.activa !== true) throw new BadRequestException('La casa central debe estar activa');
          await tx.sucursal.updateMany({ where: { esCentral: true }, data: { esCentral: false } });
        }
        const s = await tx.sucursal.update({ where: { id }, data: d });
        await this.auditoria.registrar(tx, { entidad: 'Sucursal', entidadId: id, accion: 'MODIFICAR', datos: d });
        return s;
      }),
    );
  }
}
