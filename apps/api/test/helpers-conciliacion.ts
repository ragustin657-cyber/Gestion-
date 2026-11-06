import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { prepararTesoreria } from './helpers-tesoreria';

export const FORMATO_CSV = {
  tipoArchivo: 'CSV', separador: ';', filaInicio: 2, formatoFecha: 'DD/MM/AAAA', separadorDecimal: ',',
  columnaFecha: '1', columnaConcepto: '2', columnaReferencia: '3', columnaSaldo: null, modoImporte: 'IMPORTE_CON_SIGNO', columnaImporte: '4',
};

/** Tesorería preparada más un formato CSV (fecha;concepto;referencia;importe) en la cuenta ARS. */
export async function prepararConciliacion(app: INestApplication, prisma: PrismaService) {
  const t = await prepararTesoreria(app, prisma);
  const f = await t.http.put(`/api/conciliacion/formatos/${t.ars.id}`, FORMATO_CSV);
  if (f.status !== 200) throw new Error(JSON.stringify(f.body));
  const csv = (filas: string[]) => Buffer.from(['Fecha;Concepto;Referencia;Importe', ...filas].join('\n'), 'utf8');
  const subir = (ruta: string, buf: Buffer, token = t.token, cuentaBancariaId = t.ars.id, nombre = 'extracto.csv') =>
    request(app.getHttpServer()).post(ruta).set('Authorization', `Bearer ${token}`).field('cuentaBancariaId', cuentaBancariaId).attach('archivo', buf, nombre);
  const importar = (buf: Buffer, token?: string, cuenta?: string, nombre?: string) => subir('/api/conciliacion/importaciones', buf, token, cuenta, nombre);
  const previsualizar = (buf: Buffer) => subir('/api/conciliacion/importaciones/previsualizar', buf);
  return { ...t, csv, importar, previsualizar };
}
