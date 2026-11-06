import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, loginComo, otroUsuario } from './helpers';
import { FORMATO_CSV, prepararConciliacion } from './helpers-conciliacion';

describe('importación de extractos', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  const filas = ['05/10/2026;DEPOSITO;0045;53.000,00', '06/10/2026;IMP LEY 25413;;-318,00', '07/10/2026;COMISION;;-8.500,00'];

  it('importa, detecta duplicados y respeta repetidos dentro del archivo', async () => {
    const t = await prepararConciliacion(app, prisma);
    const r = await t.importar(t.csv(filas));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ lineas: 3, duplicadas: 0 });
    const lineas = await prisma.lineaExtracto.findMany({ orderBy: { fecha: 'asc' } });
    expect(lineas.map((l) => [l.importe.toString(), l.estado])).toEqual([['53000', 'PENDIENTE'], ['-318', 'PENDIENTE'], ['-8500', 'PENDIENTE']]);
    const otra = await t.importar(t.csv([...filas, '08/10/2026;INTERESES;;150,00']));
    expect(otra.body).toMatchObject({ lineas: 1, duplicadas: 3 });
    expect(otra.body.advertencias).toContain('3 líneas ya estaban importadas');
    const repetidas = await t.importar(t.csv(['09/10/2026;COMISION;;-10,00', '09/10/2026;COMISION;;-10,00']));
    expect(repetidas.body.lineas).toBe(2);
    expect((await t.http.get(`/api/conciliacion/importaciones?cuentaBancariaId=${t.ars.id}`)).body).toHaveLength(3);
  });

  it('un error de interpretación no guarda nada', async () => {
    const t = await prepararConciliacion(app, prisma);
    const r = await t.importar(t.csv(['05/10/2026;A;;1,00', '31/02/2026;B;;2,00']));
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('El archivo tiene errores');
    expect(r.body.errores).toEqual([{ fila: 3, mensaje: 'Fecha inválida' }]);
    expect(await prisma.lineaExtracto.count()).toBe(0);
  });

  it('previsualizar no guarda; cuenta sin formato y tipo de archivo distinto → 400', async () => {
    const t = await prepararConciliacion(app, prisma);
    const p = await t.previsualizar(t.csv(filas));
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ total: 3, duplicadas: 0, errores: [] });
    expect(p.body.lineas).toHaveLength(3);
    expect(await prisma.lineaExtracto.count()).toBe(0);
    const sinFormato = await t.importar(t.csv(filas), t.token, t.usd.id);
    expect(sinFormato.status).toBe(400);
    expect(sinFormato.body.message).toBe('La cuenta bancaria no tiene formato de extracto configurado');
    await t.http.put(`/api/conciliacion/formatos/${t.ars.id}`, { ...FORMATO_CSV, tipoArchivo: 'XLSX', separador: null });
    const tipo = await t.importar(t.csv(filas));
    expect(tipo.status).toBe(400);
    expect(tipo.body.message).toBe('El archivo no es XLSX');
  });

  it('deshacer una importación', async () => {
    const t = await prepararConciliacion(app, prisma);
    const r = await t.importar(t.csv(filas));
    const d = await t.http.post(`/api/conciliacion/importaciones/${r.body.id}/deshacer`, {});
    expect(d.status).toBe(200);
    expect(d.body.estado).toBe('DESHECHA');
    expect(await prisma.lineaExtracto.count()).toBe(0);
    // Ya no cuentan como duplicadas
    expect((await t.importar(t.csv(filas))).body.lineas).toBe(3);
  });

  it('permisos, tamaño y usuarios de sucursal', async () => {
    const t = await prepararConciliacion(app, prisma);
    const sinPermiso = await otroUsuario(app, prisma, t.empresaId, ['tesoreria.ver']);
    const tk = await loginComo(app, sinPermiso.usuario.email, 'clave-segura-123', t.empresaId);
    expect((await t.importar(t.csv(filas), tk)).status).toBe(403);
    const grande = Buffer.alloc(6 * 1024 * 1024, 'a');
    expect([400, 413]).toContain((await t.importar(grande)).status);
  });
});
