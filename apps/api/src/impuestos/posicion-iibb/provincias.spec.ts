import { jurisdiccionDeProvincia } from './provincias';

describe('normalización de provincias (E38)', () => {
  it.each([
    ['CABA', '901'], ['Capital Federal', '901'], ['Ciudad de Buenos Aires', '901'], ['C.A.B.A.', '901'], ['Ciudad Autónoma de Buenos Aires', '901'],
    ['Buenos Aires', '902'], ['Pcia. de Buenos Aires', '902'], ['Córdoba', '904'], ['cordoba', '904'], [' SANTA FE ', '921'],
    ['Tierra del Fuego, Antártida e Islas del Atlántico Sur', '923'], ['Entre Rios', '908'], ['Neuquen', '915'], ['Tucumán', '924'],
  ])('%s → %s', (texto, j) => expect(jurisdiccionDeProvincia(texto)).toBe(j));

  it.each([['xx'], [''], [null]])('%s → sin provincia', (texto) => expect(jurisdiccionDeProvincia(texto)).toBeNull());
});
