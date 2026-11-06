import { BadRequestException, Injectable } from '@nestjs/common';
import type { ConfigArca } from '@prisma/client';
import { AmbienteArca } from '@prisma/client';
import { formatearCuit, normalizarCuit } from '@gestion/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { fechaAR } from '../compras/comun';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrisma } from '../prisma/tenant-prisma.service';
import { ArcaReal } from './arca-real';
import { ArcaSimulado } from './arca-simulado';
import { leerCertificado, verificarPar } from './certificado';
import { cifrar, descifrar } from './cifrado';
import { ClienteArca } from './cliente-arca';

const DIAS_AVISO = 30;
const SIN_CERTIFICADO = 'La empresa no tiene certificado de ARCA cargado';

@Injectable()
export class ConfigArcaService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private async config(): Promise<ConfigArca> {
    const c = await this.tenant.db.configArca.findFirst();
    return c ?? this.tenant.db.configArca.create({ data: { empresaId: this.tenant.empresaId } });
  }

  private vista(c: ConfigArca) {
    return {
      ambiente: c.ambiente, certificadoSujeto: c.certificadoSujeto, certificadoVence: c.certificadoVence, tieneCertificado: !!c.certificadoCifrado,
      venceProximo: !!c.certificadoVence && c.certificadoVence.getTime() - Date.now() <= DIAS_AVISO * 86400000,
    };
  }

  async obtener() {
    return this.vista(await this.config());
  }

  async guardar(d: { ambiente: AmbienteArca }) {
    const c = await this.config();
    const r = await this.tenant.db.configArca.update({ where: { id: c.id }, data: { ambiente: d.ambiente } });
    await this.auditoria.registrar(this.tenant.db, { entidad: 'ConfigArca', entidadId: c.id, accion: 'MODIFICAR', datos: { ambiente: d.ambiente } });
    return this.vista(r);
  }

  async cargarCertificado(crt?: string, key?: string) {
    if (!crt || !key) throw new BadRequestException('Cargue el certificado (.crt) y la clave privada (.key)');
    let datos;
    try {
      datos = leerCertificado(crt);
      verificarPar(crt, key);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const empresa = await this.prisma.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    if (datos.cuit !== normalizarCuit(empresa.cuit)) throw new BadRequestException(`El certificado es de otro CUIT (${datos.cuit ? formatearCuit(datos.cuit) : 'sin CUIT'})`);
    let cifrados;
    try {
      cifrados = { certificadoCifrado: cifrar(crt), claveCifrada: cifrar(key) };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const c = await this.config();
    const r = await this.tenant.transaccion(async (tx) => {
      const r = await tx.configArca.update({ where: { id: c.id }, data: { ...cifrados, certificadoSujeto: datos.sujeto, certificadoVence: datos.vence } });
      await tx.tokenArca.deleteMany({});
      await this.auditoria.registrar(tx, { entidad: 'ConfigArca', entidadId: c.id, accion: 'MODIFICAR', datos: { certificado: datos.sujeto, vence: datos.vence } });
      return r;
    });
    return this.vista(r);
  }

  /** Cliente de ARCA del ambiente de la empresa. 400 si falta el certificado o está vencido. */
  async cliente(): Promise<ClienteArca> {
    const c = await this.config();
    const db = this.tenant.db;
    if (c.ambiente === 'SIMULADO') return new ArcaSimulado(db, this.tenant.empresaId);
    if (!c.certificadoCifrado || !c.claveCifrada) throw new BadRequestException(SIN_CERTIFICADO);
    if (c.certificadoVence && c.certificadoVence.getTime() < Date.now()) throw new BadRequestException(`El certificado de ARCA venció el ${fechaAR(c.certificadoVence)}`);
    const empresa = await this.prisma.empresa.findUniqueOrThrow({ where: { id: this.tenant.empresaId } });
    let crt: string, key: string;
    try {
      crt = descifrar(c.certificadoCifrado);
      key = descifrar(c.claveCifrada);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const ambiente = c.ambiente;
    const filtro = { ambiente, servicio: 'wsfe' };
    return new ArcaReal({
      ambiente, cuit: normalizarCuit(empresa.cuit), crt, key,
      tokens: {
        leer: () => db.tokenArca.findFirst({ where: filtro }),
        guardar: async (t) => {
          await db.tokenArca.deleteMany({ where: filtro });
          await db.tokenArca.create({ data: { empresaId: this.tenant.empresaId, ...filtro, ...t } });
        },
        borrar: async () => { await db.tokenArca.deleteMany({ where: filtro }); },
      },
    });
  }

  async probar() {
    const cliente = await this.cliente();
    try {
      return await cliente.probar();
    } catch (e) {
      return { ok: false, detalle: (e as Error).message };
    }
  }
}
