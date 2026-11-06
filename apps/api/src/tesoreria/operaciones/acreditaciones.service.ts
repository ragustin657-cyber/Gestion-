import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { bloquear } from '../../compras/comun';
import { ConfigComprasService } from '../../compras/config/config-compras.service';
import { AsientosService } from '../../contabilidad/asientos/asientos.service';
import { TenantPrisma, TxEmpresa } from '../../prisma/tenant-prisma.service';
import { AlcanceSucursalService } from '../sucursales/alcance.service';
import { CarteraService } from './cartera.service';
import { ConsultasTesoreriaService } from './consultas.service';
import { DatosAcreditacion } from './dto';
import { aPesos, registrarMovimiento } from './tesoreria-comun';

@Injectable()
export class AcreditacionesService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly alcance: AlcanceSucursalService,
    private readonly cartera: CarteraService,
    private readonly consultas: ConsultasTesoreriaService,
    private readonly asientos: AsientosService,
    private readonly cuentas: ConfigComprasService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private filtroTransferencias() {
    const s = this.alcance.sucursalUsuario();
    return s ? { ingreso: { sucursalId: s } } : {};
  }

  async pendientes() {
    const db = this.tenant.db;
    const cheques = await db.chequeTercero.findMany({
      where: { AND: [{ estado: 'DEPOSITADO' }, await this.consultas.visibilidadCheques(db)] }, orderBy: [{ fechaPago: 'asc' }, { numero: 'asc' }],
    });
    const transferencias = await db.transferenciaRecibida.findMany({
      where: { estado: 'PENDIENTE', ...this.filtroTransferencias() }, include: { ingreso: true }, orderBy: { fecha: 'asc' },
    });
    const cuentas = await db.cuentaBancaria.findMany({ include: { banco: true } });
    const terceros = await db.tercero.findMany({
      where: { id: { in: [...cheques.map((c) => c.terceroOrigenId), ...transferencias.map((t) => t.ingreso.terceroId)].filter((x): x is string => !!x) } },
      select: { id: true, razonSocial: true },
    });
    const cuenta = (id: string | null) => {
      const c = cuentas.find((x) => x.id === id);
      return c ? { id: c.id, numero: c.numero, banco: c.banco.nombre, monedaCodigo: c.monedaCodigo } : null;
    };
    return {
      cheques: cheques.map((c) => ({ ...c, cuentaBancaria: cuenta(c.cuentaBancariaId), terceroOrigen: terceros.find((t) => t.id === c.terceroOrigenId) ?? null })),
      transferencias: transferencias.map(({ ingreso, ...t }) => ({
        ...t, cuentaBancaria: cuenta(t.cuentaBancariaId), ingresoNumero: ingreso.numero, concepto: ingreso.concepto,
        tercero: terceros.find((x) => x.id === ingreso.terceroId) ?? null,
      })),
    };
  }

  acreditar(d: DatosAcreditacion) {
    return this.tenant.transaccion(async (tx: TxEmpresa) => {
      const empresaId = this.tenant.empresaId;
      if (!d.cheques.length && !d.transferencias.length) throw new BadRequestException('Indique los valores a acreditar');
      await bloquear(tx, 'ChequeTercero', empresaId, d.cheques);
      const visibles = await tx.chequeTercero.findMany({ where: { AND: [{ id: { in: d.cheques } }, await this.consultas.visibilidadCheques(tx)] } });
      if (visibles.length !== new Set(d.cheques).size) throw new NotFoundException('Cheque no encontrado');
      for (const c of visibles) {
        if (c.fechaDeposito && d.fecha < c.fechaDeposito) throw new BadRequestException(`La fecha de acreditación del cheque ${c.numero} es anterior a su depósito`);
        await this.cartera.cambiarEstado(tx, c.id, 'ACREDITADO', { fechaAcreditacion: d.fecha }, { tipo: 'ACREDITACION', id: c.id, fecha: d.fecha }, ['DEPOSITADO']);
      }

      await bloquear(tx, 'TransferenciaRecibida', empresaId, d.transferencias);
      const transferencias = await tx.transferenciaRecibida.findMany({ where: { id: { in: d.transferencias }, ...this.filtroTransferencias() }, include: { ingreso: true } });
      if (transferencias.length !== new Set(d.transferencias).size) throw new NotFoundException('Transferencia no encontrada');
      const transitoria = transferencias.length ? await this.cuentas.cuenta(tx, 'TRANSFERENCIAS_A_ACREDITAR') : '';
      for (const t of transferencias) {
        if (t.estado !== 'PENDIENTE') throw new ConflictException('La transferencia ya no está pendiente de acreditar');
        const cuenta = await tx.cuentaBancaria.findUniqueOrThrow({ where: { id: t.cuentaBancariaId } });
        await registrarMovimiento(tx, empresaId, {
          fecha: d.fecha, tipo: 'INGRESO', cuentaBancariaId: cuenta.id, monedaCodigo: t.monedaCodigo, importe: t.importe, origenTipo: 'ACREDITACION_TRANSFERENCIA', origenId: t.id,
        });
        // En pesos a la cotización del ingreso: cancela exactamente lo registrado en la cuenta transitoria.
        const pesos = await aPesos(tx, t.monedaCodigo, t.importe, t.ingreso.fecha);
        const asiento = await this.asientos.generar(tx, {
          fecha: d.fecha, descripcion: `Acreditación de transferencia${t.referencia ? ` ${t.referencia}` : ''} - ingreso ${t.ingreso.numero}`,
          origenTipo: 'ACREDITACION_TRANSFERENCIA', origenId: t.id,
          renglones: [{ cuentaContableId: cuenta.cuentaContableId, debe: pesos.toFixed(2) }, { cuentaContableId: transitoria, haber: pesos.toFixed(2) }],
        });
        await tx.transferenciaRecibida.update({ where: { id: t.id }, data: { estado: 'ACREDITADA', fechaAcreditacion: d.fecha, asientoAcreditacionId: asiento.id } });
      }
      await this.auditoria.registrar(tx, { entidad: 'Acreditacion', entidadId: empresaId, accion: 'CREAR', datos: { cheques: d.cheques, transferencias: d.transferencias } });
      return { cheques: visibles.length, transferencias: transferencias.length };
    });
  }
}
