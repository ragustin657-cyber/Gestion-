import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearApp, limpiarBase, otroUsuario } from './helpers';
import { prepararTesoreria } from './helpers-tesoreria';

describe('formatos de extracto', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await crearApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => limpiarBase(prisma));
  afterAll(async () => app.close());

  it('modelos precargados y alta de un formato desde el modelo Nación', async () => {
    const t = await prepararTesoreria(app, prisma);
    const modelos = (await t.http.get('/api/conciliacion/formatos/modelos')).body;
    expect(Object.keys(modelos)).toEqual(expect.arrayContaining(['NACION', 'GALICIA', 'SANTANDER', 'MACRO', 'BBVA', 'GENERICO']));
    const { nombre: _n, ...nacion } = modelos.NACION;
    const r = await t.http.put(`/api/conciliacion/formatos/${t.ars.id}`, nacion);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ cuentaBancariaId: t.ars.id, tipoArchivo: nacion.tipoArchivo });
    expect((await t.http.put(`/api/conciliacion/formatos/${t.ars.id}`, { ...nacion, filaInicio: 3 })).body.filaInicio).toBe(3);
    const lista = (await t.http.get('/api/conciliacion/formatos')).body;
    expect(lista).toHaveLength(1);
    expect(lista[0].cuentaBancaria.numero).toBe('1');
  });

  it('validaciones, permisos, otra empresa y usuarios de sucursal', async () => {
    const t = await prepararTesoreria(app, prisma);
    const base = {
      tipoArchivo: 'CSV', separador: ';', filaInicio: 2, formatoFecha: 'DD/MM/AAAA', separadorDecimal: ',',
      columnaFecha: '1', columnaConcepto: '2', modoImporte: 'DEBITO_CREDITO', columnaDebito: null, columnaCredito: '4',
    };
    const sinDebito = await t.http.put(`/api/conciliacion/formatos/${t.ars.id}`, base);
    expect(sinDebito.status).toBe(400);
    expect(sinDebito.body.campos.columnaDebito).toBeTruthy();
    const ok = { ...base, columnaDebito: 'C' };
    expect((await t.http.put(`/api/conciliacion/formatos/${t.ars.id}`, { ...ok, columnaFecha: '??' })).status).toBe(400);
    const sinPermiso = await otroUsuario(app, prisma, t.empresaId, ['conciliacion.operar']);
    expect((await sinPermiso.http.put(`/api/conciliacion/formatos/${t.ars.id}`, ok)).status).toBe(403);
    const otra = await prepararTesoreria(app, prisma);
    expect((await otra.http.put(`/api/conciliacion/formatos/${t.ars.id}`, ok)).status).toBe(404);
    const ros = await t.usuario(['tesoreria.maestros.editar', 'conciliacion.operar'], t.ros.id);
    expect((await ros.put(`/api/conciliacion/formatos/${t.ars.id}`, ok)).status).toBe(404);
    expect((await ros.get('/api/conciliacion/formatos')).body).toEqual([]);
  });
});
