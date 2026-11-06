import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { TenantPrisma, TxEmpresa } from '../prisma/tenant-prisma.service';
import { AlcanceSucursalService } from '../tesoreria/sucursales/alcance.service';
import { DatosFormato } from './dto';
import type { FormatoParseo } from './interprete';

@Injectable()
export class FormatosService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly alcance: AlcanceSucursalService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Cuenta bancaria de la empresa; los usuarios de sucursal no operan bancos (404). */
  async cuenta(tx: TxEmpresa, id: string) {
    const c = this.alcance.sucursalUsuario() ? null : await tx.cuentaBancaria.findUnique({ where: { id }, include: { banco: true } });
    if (!c) throw new NotFoundException('Cuenta bancaria no encontrada');
    return c;
  }

  async listar() {
    if (this.alcance.sucursalUsuario()) return [];
    const formatos = await this.tenant.db.formatoExtracto.findMany();
    const cuentas = await this.tenant.db.cuentaBancaria.findMany({ where: { id: { in: formatos.map((f) => f.cuentaBancariaId) } }, include: { banco: true } });
    return formatos.map((f) => {
      const c = cuentas.find((x) => x.id === f.cuentaBancariaId)!;
      return { ...f, cuentaBancaria: { id: c.id, numero: c.numero, banco: c.banco.nombre, monedaCodigo: c.monedaCodigo } };
    });
  }

  guardar(cuentaBancariaId: string, d: DatosFormato) {
    return this.tenant.transaccion(async (tx) => {
      await this.cuenta(tx, cuentaBancariaId);
      const datos = {
        ...d, separador: d.tipoArchivo === 'CSV' ? d.separador! : null, hoja: d.tipoArchivo === 'XLSX' ? d.hoja || null : null,
        columnaReferencia: d.columnaReferencia ?? null, columnaSaldo: d.columnaSaldo ?? null,
        columnaImporte: d.modoImporte === 'IMPORTE_CON_SIGNO' ? d.columnaImporte! : null,
        columnaDebito: d.modoImporte === 'DEBITO_CREDITO' ? d.columnaDebito! : null,
        columnaCredito: d.modoImporte === 'DEBITO_CREDITO' ? d.columnaCredito! : null,
      };
      const f = await tx.formatoExtracto.upsert({
        where: { cuentaBancariaId }, create: { ...datos, cuentaBancariaId, empresaId: this.tenant.empresaId }, update: datos,
      });
      await this.auditoria.registrar(tx, { entidad: 'FormatoExtracto', entidadId: f.id, accion: 'MODIFICAR', datos });
      return f;
    });
  }

  /** Formato de la cuenta listo para el intérprete; 400 si no tiene. */
  async paraParsear(tx: TxEmpresa, cuentaBancariaId: string): Promise<FormatoParseo> {
    const f = await tx.formatoExtracto.findUnique({ where: { cuentaBancariaId } });
    if (!f) throw new BadRequestException('La cuenta bancaria no tiene formato de extracto configurado');
    return f as unknown as FormatoParseo;
  }
}
