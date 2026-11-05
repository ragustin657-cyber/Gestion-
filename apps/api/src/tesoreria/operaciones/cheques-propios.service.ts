import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EstadoChequePropio, Prisma } from '@prisma/client';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { bloquear } from '../../compras/comun';
import { fechaQuery } from '../../compras/consultas/consultas.service';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { paginacion } from '../../comun/paginado';
import { AsientosService } from '../../contabilidad/asientos/asientos.service';
import { TenantPrisma } from '../../prisma/tenant-prisma.service';
import { AlcanceSucursalService } from '../sucursales/alcance.service';
import { DatosDebito } from './dto';
import { registrarMovimiento } from './tesoreria-comun';

const ESTADOS = Object.values(EstadoChequePropio) as string[];

@Injectable()
export class ChequesPropiosService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly alcance: AlcanceSucursalService,
    private readonly asientos: AsientosService,
    private readonly cuentas: ConfigComprasService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Cheques propios (los usuarios de sucursal no operan bancos: lista vacía). */
  async listar(q: { estado?: string; desde?: string; hasta?: string; pagina?: string; porPagina?: string }) {
    if (q.estado && !ESTADOS.includes(q.estado)) throw new BadRequestException('Estado inválido');
    const desde = fechaQuery(q.desde);
    const hasta = fechaQuery(q.hasta);
    if (this.alcance.sucursalUsuario()) return { items: [], total: 0 };
    const db = this.tenant.db;
    const where: Prisma.ChequePropioWhereInput = { estado: (q.estado as EstadoChequePropio) || undefined, fechaPago: { gte: desde, lte: hasta } };
    const [filas, total] = await Promise.all([
      db.chequePropio.findMany({ where, orderBy: [{ fechaPago: 'asc' }, { numero: 'asc' }], ...paginacion(q) }),
      db.chequePropio.count({ where }),
    ]);
    const chequeras = await db.chequera.findMany({ where: { id: { in: filas.map((f) => f.chequeraId) } }, include: { cuentaBancaria: { include: { banco: true } } } });
    const terceros = await db.tercero.findMany({ where: { id: { in: filas.map((f) => f.beneficiarioId) } }, select: { id: true, razonSocial: true } });
    const ops = await db.ordenPago.findMany({ where: { id: { in: filas.map((f) => f.ordenPagoId) } }, select: { id: true, numero: true } });
    return {
      items: filas.map((f) => {
        const ch = chequeras.find((c) => c.id === f.chequeraId)!;
        return {
          ...f,
          diferido: f.fechaPago > f.fechaEmision,
          tipoChequera: ch.tipo,
          cuentaBancaria: { id: ch.cuentaBancaria.id, numero: ch.cuentaBancaria.numero, banco: ch.cuentaBancaria.banco.nombre },
          beneficiario: terceros.find((t) => t.id === f.beneficiarioId) ?? null,
          ordenPagoNumero: ops.find((o) => o.id === f.ordenPagoId)?.numero ?? null,
        };
      }),
      total,
    };
  }

  debitar(d: DatosDebito) {
    return this.tenant.transaccion(async (tx) => {
      const empresaId = this.tenant.empresaId;
      if (this.alcance.sucursalUsuario()) throw new NotFoundException('Cheque no encontrado');
      const ids = [...new Set(d.cheques)];
      await bloquear(tx, 'ChequePropio', empresaId, ids);
      const cheques = await tx.chequePropio.findMany({ where: { id: { in: ids } } });
      if (cheques.length !== ids.length) throw new NotFoundException('Cheque no encontrado');
      for (const c of cheques) {
        if (c.estado !== 'EMITIDO') throw new ConflictException(`El cheque ${c.numero} ya fue debitado o está anulado`);
        if (d.fecha < c.fechaEmision) throw new BadRequestException(`La fecha de débito del cheque ${c.numero} es anterior a su emisión`);
        if (c.fechaPago > c.fechaEmision) {
          // Diferido: el egreso del banco se registra recién ahora, por el importe en pesos con que se registró al pagar
          const chequera = await tx.chequera.findUniqueOrThrow({ where: { id: c.chequeraId }, include: { cuentaBancaria: true } });
          const medio = await tx.ordenPagoMedio.findFirst({ where: { ordenPagoId: c.ordenPagoId, chequeraId: c.chequeraId, chequeNumero: c.numero } });
          const pesos = medio?.importePesos ?? c.importe;
          await registrarMovimiento(tx, empresaId, {
            fecha: d.fecha, tipo: 'EGRESO', cuentaBancariaId: chequera.cuentaBancariaId, monedaCodigo: c.monedaCodigo, importe: c.importe, origenTipo: 'DEBITO_CHEQUE', origenId: c.id,
          });
          await this.asientos.generar(tx, {
            fecha: d.fecha, descripcion: `Débito del cheque propio ${c.numero}`, origenTipo: 'DEBITO_CHEQUE', origenId: c.id,
            renglones: [
              { cuentaContableId: await this.cuentas.cuenta(tx, 'CHEQUES_DIFERIDOS'), debe: pesos.toFixed(2) },
              { cuentaContableId: chequera.cuentaBancaria.cuentaContableId, haber: pesos.toFixed(2) },
            ],
          });
        }
        await tx.chequePropio.update({ where: { id: c.id }, data: { estado: 'DEBITADO', fechaDebito: d.fecha } });
      }
      await this.auditoria.registrar(tx, { entidad: 'ChequePropio', entidadId: ids[0], accion: 'MODIFICAR', datos: { debito: ids, fecha: d.fecha } });
      return { debitados: cheques.length };
    });
  }
}
