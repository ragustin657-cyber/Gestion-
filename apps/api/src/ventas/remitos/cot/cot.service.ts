import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { descifrar } from '../../../arca/cifrado';
import { AuditoriaService } from '../../../auditoria/auditoria.service';
import { bloquear } from '../../../compras/comun';
import { TenantPrisma } from '../../../prisma/tenant-prisma.service';
import { D } from '../../../tesoreria/operaciones/tesoreria-comun';
import { archivoCot, codigoUnicoCot, nombreArchivoCot, type DatosArchivoCot } from './archivo';
import { ArbaCotReal, ArbaCotSimulado, ErrorConexionCot, type ClienteCot } from './cliente-cot';

export const SIN_CONEXION_COT = 'No se pudo conectar con ARBA: el COT quedó pendiente';

/** E57: pedido del COT de un remito (spec §4). */
@Injectable()
export class CotService {
  constructor(private readonly tenant: TenantPrisma, private readonly auditoria: AuditoriaService) {}

  private cliente(ambiente: string): ClienteCot {
    return ambiente === 'PRUEBA' || ambiente === 'PRODUCCION' ? new ArbaCotReal(ambiente) : new ArbaCotSimulado();
  }

  /** Datos del archivo con las validaciones de la spec (400 con el mensaje exacto). */
  private async datosArchivo(remitoId: string): Promise<{ datos: DatosArchivoCot; planta: number; puerta: number }> {
    const db = this.tenant.db;
    const r = await db.remito.findUniqueOrThrow({ where: { id: remitoId }, include: { renglones: { orderBy: { orden: 'asc' } } } });
    const [empresa, dep, cliente] = await Promise.all([
      db.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } }), db.deposito.findUniqueOrThrow({ where: { id: r.depositoId } }), db.tercero.findUniqueOrThrow({ where: { id: r.terceroId } }),
    ]);
    if (dep.plantaArba == null || dep.puertaArba == null || !dep.calle || !dep.numero || !dep.codigoPostal || !dep.localidad || !dep.provincia)
      throw new BadRequestException('El depósito no tiene el domicilio de ARBA completo (planta, puerta y domicilio)');
    if (!r.trasladoCalle || !r.trasladoNumero || !r.trasladoCodigoPostal || !r.trasladoLocalidad || !r.trasladoProvincia) throw new BadRequestException('Falta el domicilio de destino del traslado');
    const arts = new Map((await db.articulo.findMany({ where: { id: { in: r.renglones.map((x) => x.articuloId).filter((x): x is string => !!x) } } })).map((a) => [a.id, a]));
    const renglones = r.renglones.map((x) => {
      const a = x.articuloId ? arts.get(x.articuloId) : undefined;
      if (!a?.codigoNomencladorArba || !a.unidadMedidaArba) throw new BadRequestException(`El artículo ${a?.codigo ?? x.descripcion} no tiene código del nomenclador de ARBA`);
      return { unidad: a.unidadMedidaArba, cantidad: new D(x.cantidad).toString(), nomenclador: a.codigoNomencladorArba, descripcion: x.descripcion };
    });
    if (!r.patente) throw new BadRequestException('Falta la patente del vehículo');
    const transportista = r.transportistaId ? await db.transportista.findUnique({ where: { id: r.transportistaId } }) : null;
    const devolucion = r.tipo === 'DEVOLUCION';
    const datos: DatosArchivoCot = {
      cuitEmpresa: empresa.cuit, razonSocialEmpresa: empresa.razonSocial,
      remito: { tipo: r.tipo, puntoVenta: r.puntoVenta, numero: r.numero, fecha: r.fecha, fechaSalida: r.fechaSalida ?? r.fecha, horaSalida: r.horaSalida ?? '0000', importe: new D(r.importeDeclarado ?? 0).toString() },
      // En la devolución recibe la propia empresa
      destinatario: devolucion
        ? { tipoDocumento: 'CUIT', documento: empresa.cuit, razonSocial: empresa.razonSocial, consumidorFinal: false }
        : { tipoDocumento: cliente.tipoDocumento === 'CUIT' ? 'CUIT' : cliente.tipoDocumento === 'DNI' ? 'DNI' : 'OTRO', documento: cliente.cuit, razonSocial: cliente.razonSocial, consumidorFinal: cliente.condicionIva === 'CONSUMIDOR_FINAL' },
      deposito: { calle: dep.calle, numero: dep.numero, codigoPostal: dep.codigoPostal, localidad: dep.localidad, provincia: dep.provincia },
      traslado: { calle: r.trasladoCalle, numero: r.trasladoNumero, codigoPostal: r.trasladoCodigoPostal, localidad: r.trasladoLocalidad, provincia: r.trasladoProvincia },
      transportistaCuit: transportista?.cuit ?? null, patente: r.patente, patenteAcoplado: r.patenteAcoplado, renglones,
    };
    return { datos, planta: dep.plantaArba, puerta: dep.puertaArba };
  }

  /** Archivo para subir a mano (no cambia el estado). */
  async archivo(remitoId: string) {
    const { datos, planta, puerta } = await this.datosArchivo(remitoId);
    const conf = await this.tenant.db.configCot.findFirst();
    return { nombre: nombreArchivoCot(datos.cuitEmpresa, planta, puerta, new Date(), (conf?.secuencia ?? 0) + 1), contenido: archivoCot(datos) };
  }

  /** Pide (o reintenta) el COT: OTORGADO, RECHAZADO con los mensajes, o PENDIENTE y 502 sin conexión. */
  async pedir(remitoId: string) {
    const db = this.tenant.db;
    const r = await db.remito.findUniqueOrThrow({ where: { id: remitoId } });
    if (r.estado === 'ANULADO') throw new BadRequestException('El remito está anulado');
    if (r.cotEstado === 'OTORGADO') throw new BadRequestException('El remito ya tiene COT otorgado');
    if (!r.cotEstado || r.cotEstado === 'NO_CORRESPONDE') throw new BadRequestException('Al remito no le corresponde COT');
    const conf = await db.configCot.findFirst();
    if (!conf?.usuario || !conf.claveCifrada) throw new BadRequestException('Configure el usuario y la clave CIT de ARBA');
    const { datos, planta, puerta } = await this.datosArchivo(remitoId);
    const secuencia = await this.tenant.transaccion(async (tx) => (await tx.configCot.update({ where: { id: conf.id }, data: { secuencia: { increment: 1 } } })).secuencia);
    const nombre = nombreArchivoCot(datos.cuitEmpresa, planta, puerta, new Date(), secuencia);
    const codigo = codigoUnicoCot(r.puntoVenta, r.numero);
    let resp;
    try {
      resp = await this.cliente(conf.ambiente).presentar(this.tenant.empresaId, conf.usuario, descifrar(conf.claveCifrada), nombre, archivoCot(datos));
    } catch (e) {
      if (!(e instanceof ErrorConexionCot)) throw e;
      await this.registrar(remitoId, { cotEstado: 'PENDIENTE', cotMensaje: SIN_CONEXION_COT });
      throw new HttpException(SIN_CONEXION_COT, HttpStatus.BAD_GATEWAY);
    }
    const rr = resp.remitos.find((x) => x.codigoUnico === codigo);
    if (rr?.cot) await this.registrar(remitoId, { cotEstado: 'OTORGADO', cot: rr.cot, cotMensaje: null });
    else await this.registrar(remitoId, { cotEstado: 'RECHAZADO', cotMensaje: [...resp.errores, ...(rr?.errores ?? [])].join(' · ') || 'ARBA no otorgó el COT' });
    return db.remito.findUniqueOrThrow({ where: { id: remitoId } });
  }

  /** COT cargado a mano después de subir el archivo en la web de ARBA. */
  async cargarManual(remitoId: string, cot: string) {
    const r = await this.tenant.db.remito.findUniqueOrThrow({ where: { id: remitoId } });
    if (r.estado === 'ANULADO') throw new BadRequestException('El remito está anulado');
    await this.registrar(remitoId, { cotEstado: 'OTORGADO', cot, cotMensaje: null });
    return this.tenant.db.remito.findUniqueOrThrow({ where: { id: remitoId } });
  }

  private registrar(remitoId: string, data: { cotEstado: 'PENDIENTE' | 'OTORGADO' | 'RECHAZADO'; cot?: string; cotMensaje: string | null }) {
    return this.tenant.transaccion(async (tx) => {
      await bloquear(tx, 'Remito', this.tenant.empresaId, [remitoId]);
      await tx.remito.update({ where: { id: remitoId }, data: { ...data, cotPedidoEn: new Date() } });
      await this.auditoria.registrar(tx, { entidad: 'Remito', entidadId: remitoId, accion: 'MODIFICAR', datos: { cot: data } });
    });
  }
}
